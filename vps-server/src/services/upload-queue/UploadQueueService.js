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

    // 填充入队时间戳
    const enqueuedTask = {
      ...task,
      enqueuedAt: typeof task.enqueuedAt === 'number' ? task.enqueuedAt : Date.now()
    };
    this.queue.push(enqueuedTask);
    this.pendingSet.add(filePath);
    logger.info('[UploadQueue] 入队成功', {
      filePath,
      channelId: task.channelId,
      pendingSize: this.pendingSet.size
    });
    return { enqueued: true };
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
        enqueuedAt: t.enqueuedAt
      })),
      uploadingList: [...this.uploadingSet],
      recentFailures: [...this.recentFailures]
    };
  }
}

module.exports = UploadQueueService;
