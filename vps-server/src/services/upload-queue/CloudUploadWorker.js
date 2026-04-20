const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const HybridUploader = require('../cloud-backup/hybrid-uploader');

/**
 * 云盘上传 Worker（单实例、串行消费）
 *
 * 职责：
 *   - 作为 UploadQueueService 的唯一消费者，从队列拉任务并实际调用 HybridUploader 上传
 *   - 串行（永远只有 1 个文件在传），节流（任务之间 15s 间隔），重试（最多 retryTimes 次）
 *   - 登录态失效时自动暂停，任务回退队列头等待人工恢复
 *   - 上传成功后在文件名末尾添加 `_u` 标记，避免下次重复上传
 *
 * 本类 **不负责自动触发入队** —— 入队由 FileFinalizeDispatcher（迭代 3）或
 * 管理员手动调 `POST /api/upload/enqueue` 完成。
 *
 * HybridUploader 的管理方式（方案 A）：
 *   - 每个任务 new 一个 HybridUploader 实例
 *   - 成本极低（构造器仅 cookie 查找），不同频道/相册完全隔离
 *   - 运行时 sessionBundle 从磁盘最新版读取，登录刷新后立即生效
 */
class CloudUploadWorker {
  /**
   * 构造器
   *
   * @param {Object} options
   * @param {Object} options.queue UploadQueueService 实例
   * @param {Object} options.notifier UploadNotifier 实例
   * @param {Object} options.cloudDriveService CloudDriveService 实例（读 sessionBundle + 登录态）
   * @param {number} [options.throttleMs=15000] 任务之间的节流间隔（毫秒）
   * @param {number} [options.retryDelayMs=5000] 同任务内重试之间的等待（毫秒）
   * @param {number} [options.idlePollMs=5000] 队列为空时轮询等待时长（毫秒）
   * @param {number} [options.minFileSize=1048576] 视为"太小可能空"的阈值（字节），默认 1MB
   * @param {number} [options.mtimeGraceMs=5000] 文件 mtime 距今不到这个值则跳过，防止还在写（毫秒）
   */
  constructor(options = {}) {
    if (!options.queue) throw new Error('CloudUploadWorker 需要 queue');
    if (!options.notifier) throw new Error('CloudUploadWorker 需要 notifier');
    if (!options.cloudDriveService) throw new Error('CloudUploadWorker 需要 cloudDriveService');

    this.queue = options.queue;
    this.notifier = options.notifier;
    this.cloudDriveService = options.cloudDriveService;

    this.throttleMs = options.throttleMs || 15000;
    this.retryDelayMs = options.retryDelayMs || 5000;
    this.idlePollMs = options.idlePollMs || 5000;
    this.minFileSize = options.minFileSize || 1024 * 1024;
    this.mtimeGraceMs = options.mtimeGraceMs || 5000;

    // 运行状态
    this.running = false;         // 主循环是否在跑
    this.paused = false;          // 是否暂停消费（登录失效时）
    this.loopPromise = null;      // 主循环 Promise，便于 stop 等待
    this.lastAuthMessage = '';    // 最近一次登录失效原因，供状态查询展示

    // 运行统计
    this.stats = {
      totalEnqueued: 0,
      totalSuccess: 0,
      totalFailed: 0,
      lastSuccessAt: null,
      lastFailedAt: null,
      currentTask: null           // { filePath, channelId, startedAt, attempt }
    };
  }

  /**
   * 启动 Worker 主循环（非阻塞）
   * 幂等：重复调 start 不会叠加循环
   */
  start() {
    if (this.running) {
      logger.warn('[UploadWorker] start 被重复调用，忽略');
      return;
    }
    this.running = true;
    this.paused = false;
    logger.info('[UploadWorker] 启动');
    // setImmediate 让 start() 立即返回，不阻塞调用方
    this.loopPromise = this.runLoop();
  }

  /**
   * 停止 Worker（把 running 置 false，当前任务执行完自然退出）
   * @returns {Promise<void>} 当前循环完全退出后 resolve
   */
  async stop() {
    if (!this.running) return;
    logger.info('[UploadWorker] 收到 stop，等待当前任务结束');
    this.running = false;
    if (this.loopPromise) await this.loopPromise.catch(() => { /* 吞掉异常 */ });
    this.loopPromise = null;
  }

  /**
   * 暂停消费（登录失效时内部调用）
   * 暂停期间 runLoop 会空转轮询，等 resume 被调用后恢复
   */
  pause(reason = '') {
    if (this.paused) return;
    this.paused = true;
    logger.warn('[UploadWorker] 已暂停消费', { reason });
  }

  /**
   * 恢复消费（登录恢复后由外部显式调用）
   */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.lastAuthMessage = '';
    logger.info('[UploadWorker] 已恢复消费');
  }

  /**
   * Sleep 工具
   * @param {number} ms 毫秒
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 主循环
   * 只有通过 stop() 才会退出；异常会记录日志但不会中断循环
   */
  async runLoop() {
    while (this.running) {
      try {
        // 暂停态：空转轮询
        if (this.paused) {
          await this.sleep(this.idlePollMs);
          continue;
        }

        // 取任务
        const task = this.queue.dequeue();
        if (!task) {
          await this.sleep(this.idlePollMs);
          continue;
        }

        // 处理
        this.queue.markUploading(task.filePath);
        try {
          await this.processTask(task);
        } finally {
          this.queue.markFinished(task.filePath);
          this.stats.currentTask = null;
        }

        // 节流：下一个任务前等 throttleMs（注意登录失效已暂停，这里只针对正常处理后）
        if (this.running && !this.paused) {
          await this.sleep(this.throttleMs);
        }
      } catch (err) {
        // 任何意外错误都不应让 Worker 退出
        logger.error('[UploadWorker] runLoop 异常', {
          error: err && err.message,
          stack: err && err.stack
        });
        await this.sleep(this.idlePollMs);
      }
    }
    logger.info('[UploadWorker] 主循环已退出');
  }

  /**
   * 处理单个任务
   *
   * @param {Object} task UploadQueueService 的任务对象
   */
  async processTask(task) {
    const { filePath, channelId, uploadConfig } = task;
    const cfg = uploadConfig || {};
    const retryTimes = typeof cfg.retryTimes === 'number' && cfg.retryTimes > 0 ? cfg.retryTimes : 3;

    this.stats.currentTask = {
      filePath,
      channelId,
      startedAt: Date.now(),
      attempt: 0
    };

    // 步骤 1：登录态检查（每次任务前都检查，登录失效场景能立即感知）
    const authCheck = this.checkAuth();
    if (!authCheck.ok) {
      await this.notifier.notifyLoginExpired({
        filePath,
        authStatus: authCheck.authStatus,
        authMessage: authCheck.authMessage
      });
      this.lastAuthMessage = authCheck.authMessage || '';
      this.pause('login_expired');
      // 任务回退队列头，等外部 resume 后继续
      this.queue.requeueHead(task);
      return;
    }

    // 步骤 2：文件完整性检查
    const fileCheck = this.checkFile(filePath);
    if (!fileCheck.ok) {
      logger.warn('[UploadWorker] 文件检查未通过，跳过该任务', {
        filePath,
        reason: fileCheck.reason,
        detail: fileCheck.detail
      });
      // mtime 太新只是临时跳过，不通知；其他原因认为永久失败
      if (fileCheck.reason !== 'mtime_too_recent') {
        this.stats.totalFailed++;
        this.stats.lastFailedAt = Date.now();
        this.queue.recordFailure({
          filePath,
          reason: fileCheck.reason,
          error: fileCheck.detail,
          finishedAt: Date.now()
        });
        await this.notifier.notifyUploadFailed({
          filePath,
          reason: fileCheck.reason,
          lastError: fileCheck.detail
        });
      }
      return;
    }

    // 步骤 3：解密 sessionBundle（每次任务都读最新，登录刷新后能立即用）
    let sessionBundle;
    try {
      sessionBundle = this.loadSessionBundle();
    } catch (err) {
      // 解密失败视同登录失效
      logger.error('[UploadWorker] 读取 sessionBundle 失败', { error: err.message });
      await this.notifier.notifyLoginExpired({
        filePath,
        authStatus: 'invalid',
        authMessage: '读取本地会话失败：' + err.message
      });
      this.lastAuthMessage = err.message;
      this.pause('session_load_failed');
      this.queue.requeueHead(task);
      return;
    }

    // 步骤 4：重试循环
    let lastError = null;
    for (let attempt = 1; attempt <= retryTimes; attempt++) {
      this.stats.currentTask.attempt = attempt;
      try {
        logger.info('[UploadWorker] 开始上传', {
          filePath,
          channelId,
          attempt,
          maxAttempts: retryTimes,
          albumId: cfg.albumId,
          groupId: cfg.groupId
        });

        // 方案 A：每个任务 new 一个 HybridUploader 实例
        const uploader = new HybridUploader({
          sessionBundle,
          groupId: cfg.groupId,
          targetAlbumId: cfg.albumId
        });
        const result = await uploader.upload(filePath);

        // 上传成功：加 _u 标记
        const newPath = await this.renameWithSuccessMark(filePath);
        this.stats.totalSuccess++;
        this.stats.lastSuccessAt = Date.now();
        logger.info('[UploadWorker] 上传成功', {
          filePath: newPath,
          channelId,
          attempt,
          rapidUpload: result.rapidUpload,
          fileId: result.fileId
        });
        return;
      } catch (err) {
        lastError = err;
        logger.error('[UploadWorker] 上传失败', {
          filePath,
          channelId,
          attempt,
          maxAttempts: retryTimes,
          error: err.message
        });
        if (attempt < retryTimes) {
          await this.sleep(this.retryDelayMs);
        }
      }
    }

    // 所有重试均失败
    this.stats.totalFailed++;
    this.stats.lastFailedAt = Date.now();
    const errMsg = lastError && lastError.message ? lastError.message : '未知错误';
    this.queue.recordFailure({
      filePath,
      reason: 'upload_failed',
      error: errMsg,
      finishedAt: Date.now()
    });
    await this.notifier.notifyUploadFailed({
      filePath,
      attempts: retryTimes,
      lastError: errMsg
    });
  }

  /**
   * 登录态检查
   *
   * @returns {{ok: boolean, authStatus?: string, authMessage?: string}}
   */
  checkAuth() {
    try {
      const state = this.cloudDriveService.loadState();
      if (state.authStatus !== 'valid' || !state.sessionBundleEncrypted) {
        return {
          ok: false,
          authStatus: state.authStatus || 'unknown',
          authMessage: state.authMessage || '云盘尚未完成登录'
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, authStatus: 'unknown', authMessage: err.message };
    }
  }

  /**
   * 文件完整性检查
   *
   * @param {string} filePath 待检查文件
   * @returns {{ok: boolean, reason?: string, detail?: string}}
   */
  checkFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return { ok: false, reason: 'file_not_found', detail: '' };
    }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      return { ok: false, reason: 'stat_failed', detail: err.message };
    }
    if (!stat.isFile()) {
      return { ok: false, reason: 'not_a_file', detail: '' };
    }
    if (stat.size < this.minFileSize) {
      return {
        ok: false,
        reason: 'file_too_small',
        detail: `size=${stat.size} < ${this.minFileSize}`
      };
    }
    // mtime 距现在太近 → 可能还在写，跳过等下次
    if (Date.now() - stat.mtimeMs < this.mtimeGraceMs) {
      return {
        ok: false,
        reason: 'mtime_too_recent',
        detail: `mtime diff = ${Date.now() - stat.mtimeMs}ms`
      };
    }
    return { ok: true };
  }

  /**
   * 读取并解密 sessionBundle
   *
   * @returns {Object} 解密后的 sessionBundle 对象
   */
  loadSessionBundle() {
    const state = this.cloudDriveService.loadState();
    if (!state.sessionBundleEncrypted) {
      throw new Error('sessionBundleEncrypted 为空');
    }
    const plain = this.cloudDriveService.decryptText(state.sessionBundleEncrypted);
    return JSON.parse(plain);
  }

  /**
   * 上传成功后把文件名末尾（扩展名之前）加上 `_u` 标记
   *
   * 示例：
   *   xxx_to_105601.mp4 → xxx_to_105601_u.mp4
   *
   * 如果目标文件名已经存在（极端情况），会退回成加 `_u_<ts>` 后缀避免冲突
   *
   * @param {string} filePath 原始文件路径
   * @returns {Promise<string>} 新文件路径
   */
  async renameWithSuccessMark(filePath) {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);

    let target = path.join(dir, `${base}_u${ext}`);
    if (fs.existsSync(target)) {
      // 极少触发：目标名已存在时，加上时间戳后缀避免覆盖
      target = path.join(dir, `${base}_u_${Date.now()}${ext}`);
    }
    await fs.promises.rename(filePath, target);
    return target;
  }

  /**
   * 查询 Worker 当前状态（供前端 / API 使用）
   *
   * @returns {Object}
   */
  getStatus() {
    return {
      running: this.running,
      paused: this.paused,
      lastAuthMessage: this.lastAuthMessage,
      stats: { ...this.stats }
    };
  }
}

module.exports = CloudUploadWorker;
