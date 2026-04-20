const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

/**
 * 上传任务队列服务（内存版）
 *
 * 定位：
 *   - 纯内存队列，进程重启即丢失，依靠 `RecordingUploadScanner`（迭代 3）启动扫描重建
 *   - 单进程 Node.js 内使用，不需要加锁（事件循环天然串行化）
 *
 * 双 Set 防重：
 *   - pendingSet：在队列里、还没被 Worker 取走的 filePath
 *   - uploadingSet：Worker 正在处理的 filePath
 *   - 入队前检查两个 Set 任一包含 → 直接拒绝，避免重复上传
 *
 * 排序策略（用户需求：创建时间最早的优先上传）：
 *   - enqueue 时计算 `startTimeMs`（文件名里的录制起始时间戳），按升序插入
 *   - 新文件（mtime 晚）会被插到队尾；老文件（mtime 早）会被插到队首
 *   - Scanner 扫到的一批"历史漏网文件"天然会排在实时触发的新文件前面，达成"最早先传"
 *   - requeueHead 仍保持 unshift 语义（登录失效恢复场景必须让原任务留在队首）
 */
class UploadQueueService {
  /**
   * 构造器
   */
  constructor() {
    // FIFO 队列，元素结构见 enqueue 注释
    this.queue = [];
    // 等待 Worker 消费的 filePath 集合
    this.pendingSet = new Set();
    // 正在被 Worker 处理的 filePath 集合
    this.uploadingSet = new Set();
    // 最近失败任务摘要，用于前端展示；保留最新 10 条
    this.recentFailures = [];
  }

  /**
   * 入队一个上传任务
   *
   * task 结构：
   *   {
   *     filePath: string,         // 本地文件绝对路径（唯一键）
   *     channelId: string,        // 来源频道 ID
   *     uploadConfig: {           // 入队时的配置快照（避免运行中配置变化）
   *       destinationType: 'familyAlbum',
   *       groupId: string,        // 家庭 ID
   *       albumId: string,        // 相册 ID（对应 HybridUploader 的 targetAlbumId）
   *       targetName?: string,    // 相册显示名
   *       retryTimes?: number     // 最大重试次数，默认 3
   *     },
   *     enqueuedAt?: number       // 入队时间戳，调用方未提供时本方法补齐
   *   }
   *
   * @param {Object} task 上传任务
   * @returns {{enqueued: boolean, reason?: string}}
   *   enqueued=true 表示入队成功
   *   enqueued=false 时 reason 可能是 'invalid_task' / 'already_in_queue' / 'already_uploading'
   */
  enqueue(task) {
    // 基础参数校验
    if (!task || typeof task.filePath !== 'string' || !task.filePath) {
      return { enqueued: false, reason: 'invalid_task' };
    }
    const { filePath } = task;

    // 双 Set 去重
    if (this.pendingSet.has(filePath)) {
      logger.info('[UploadQueue] 拒绝重复入队（已在队列）', { filePath });
      return { enqueued: false, reason: 'already_in_queue' };
    }
    if (this.uploadingSet.has(filePath)) {
      logger.info('[UploadQueue] 拒绝重复入队（正在上传）', { filePath });
      return { enqueued: false, reason: 'already_uploading' };
    }

    // 🆕 解析文件起始时间（录制开始时刻），用于按时间排序插入
    const startTimeMs = this._resolveStartTimeMs(filePath);

    // 填充入队时间戳 + 起始时间戳
    const enqueuedTask = {
      ...task,
      enqueuedAt: typeof task.enqueuedAt === 'number' ? task.enqueuedAt : Date.now(),
      startTimeMs
    };

    // 🆕 按 startTimeMs 升序线性插入（队列规模通常百级以内，O(N) 插入可接受）
    // 这样越"老"的文件越靠前，Worker 串行消费时就是"创建时间最早的先上传"
    let insertIdx = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].startTimeMs > startTimeMs) {
        insertIdx = i;
        break;
      }
    }
    this.queue.splice(insertIdx, 0, enqueuedTask);
    this.pendingSet.add(filePath);

    logger.info('[UploadQueue] 入队成功', {
      filePath,
      channelId: task.channelId,
      pendingSize: this.pendingSet.size,
      // 便于排查：插入到队列哪个位置、起始时间戳是多少
      insertPosition: insertIdx,
      startTimeMs
    });
    return { enqueued: true };
  }

  /**
   * 解析文件的"录制起始时间"（ms 时间戳），用于入队排序
   *
   * 优先级：
   *   1) 文件名里的 `_YYYYMMDD_HHMMSS_to_HHMMSS.mp4` 起始时间戳
   *      （这是录制真正开始的时刻，最稳、最贴合"创建时间"语义）
   *   2) 文件系统的 mtime（改名后的修改时间，接近录制结束时间；不理想但能兜底）
   *   3) 当前时间（最差情况，确保不会报错）
   *
   * 注意：文件名里的时间戳是北京时间；本方法显式拼接 +08:00 时区，
   * 这样即使 VPS 运行在 UTC 时区也能正确比较。
   *
   * @private
   * @param {string} filePath 文件绝对路径
   * @returns {number} 起始时间戳（ms）
   */
  _resolveStartTimeMs(filePath) {
    try {
      const name = path.basename(filePath);
      // 匹配 channelId_YYYYMMDD_HHMMSS_to_HHMMSS.mp4 或 xx_YYYYMMDD_HHMMSS_to_HHMMSS.mp4
      const m = name.match(/_(\d{8})_(\d{6})_to_\d{6}\.(mp4|MP4)$/);
      if (m) {
        const d = m[1];            // YYYYMMDD
        const t = m[2];            // HHMMSS
        // 显式指定 +08:00（北京时间），避免 VPS 时区差异
        const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T`
          + `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}+08:00`;
        const ms = Date.parse(iso);
        if (!Number.isNaN(ms)) return ms;
      }
    } catch (err) {
      // 文件名解析异常不应阻塞入队，走后续 fallback
    }

    // fallback 1：使用 mtime
    try {
      const st = fs.statSync(filePath);
      if (st && typeof st.mtimeMs === 'number') return st.mtimeMs;
    } catch (err) {
      // stat 失败（文件已被删等）走最终 fallback
    }

    // fallback 2：当前时间戳（最老的会排队尾，但至少不会报错）
    return Date.now();
  }

  /**
   * 出队下一个任务（FIFO）
   *
   * 注意：出队后 pendingSet 立刻移除，但 uploadingSet 不会自动添加
   * 调用方（Worker）应在开始处理时显式调 markUploading，处理完成后调 markFinished
   *
   * @returns {Object|null} 任务对象；队列空返回 null
   */
  dequeue() {
    const task = this.queue.shift();
    if (!task) return null;
    this.pendingSet.delete(task.filePath);
    return task;
  }

  /**
   * 把任务放回队列头部（登录失效等场景，让任务保持原有 FIFO 顺序）
   *
   * @param {Object} task 待回退的任务
   */
  requeueHead(task) {
    if (!task || !task.filePath) return;
    // 防止 unshift 后又被标记 pending 但 Worker 认为已在处理
    this.uploadingSet.delete(task.filePath);
    if (!this.pendingSet.has(task.filePath)) {
      this.queue.unshift(task);
      this.pendingSet.add(task.filePath);
      logger.info('[UploadQueue] 任务回退队列头', { filePath: task.filePath });
    }
  }

  /**
   * 标记任务开始上传（加入 uploadingSet）
   *
   * @param {string} filePath 文件路径
   */
  markUploading(filePath) {
    if (filePath) this.uploadingSet.add(filePath);
  }

  /**
   * 标记任务结束（成功或失败都要调，从 uploadingSet 移除）
   *
   * @param {string} filePath 文件路径
   */
  markFinished(filePath) {
    if (filePath) this.uploadingSet.delete(filePath);
  }

  /**
   * 记录一条失败摘要（供前端最近失败面板展示）
   *
   * @param {Object} entry { filePath, reason, error, finishedAt }
   */
  recordFailure(entry) {
    if (!entry) return;
    this.recentFailures.unshift({
      filePath: entry.filePath || '',
      reason: entry.reason || '',
      error: entry.error || '',
      finishedAt: entry.finishedAt || Date.now()
    });
    // 只保留最新 10 条，防止长期运行内存堆积
    if (this.recentFailures.length > 10) {
      this.recentFailures.length = 10;
    }
  }

  /**
   * 查询队列状态（供前端轮询 / API）
   *
   * @returns {{
   *   pending: number,
   *   uploading: number,
   *   queue: Array<{filePath, channelId, enqueuedAt}>,
   *   uploadingList: string[],
   *   recentFailures: Array
   * }}
   */
  getStatus() {
    return {
      pending: this.queue.length,
      uploading: this.uploadingSet.size,
      queue: this.queue.map((t) => ({
        filePath: t.filePath,
        channelId: t.channelId,
        enqueuedAt: t.enqueuedAt,
        // 🆕 暴露出队列当前排序依据，便于前端 / 排查确认"按时间升序"生效
        startTimeMs: t.startTimeMs
      })),
      uploadingList: [...this.uploadingSet],
      recentFailures: [...this.recentFailures]
    };
  }
}

module.exports = UploadQueueService;
