const logger = require('../../utils/logger');

/**
 * 文件最终化调度器（迭代 3）
 *
 * 定位：
 *   所有"录制文件改名/标准化完成"的触发点最终都调用本类的 onFinalize。
 *   本类负责查询频道的上传配置，判断是否需要入队，以及统一的错误处理。
 *
 * 触发点一览（见实施文档 2.2）：
 *   1. SimpleStreamManager.renameCompletedSegment        — 录制中分段切换
 *   2. SimpleStreamManager.renameFinalSegment            — 停止录制时扫剩余 temp
 *   3. SimpleStreamManager.renameRecordingWithActualEndTime — 单文件模式录制结束
 *   4. RecordingRecoveryService.renameTempFile           — 服务启动恢复 temp
 *   5. RecordingRecoveryService.fixEndTime               — 服务启动修正结束时间
 *   6. RecordingUploadScanner                            — 启动/定时兜底扫描
 *
 * 设计原则：
 *   - 非阻塞：整个链路用 setImmediate 推到下一 tick，调用方的 rename 路径不因 axios
 *     慢或 workers 故障而被拖延
 *   - 单一职责：本类只负责"是否入队" + "怎么入队"，实际 I/O 交给 UploadQueueService
 *   - 幂等：重复 dispatch 同一文件被 UploadQueueService 的双 Set 兜底去重
 */
class FileFinalizeDispatcher {
  /**
   * 构造器
   *
   * @param {Object} options
   * @param {Object} options.uploadQueue        UploadQueueService 实例
   * @param {Function} options.channelConfigFetcher  async (channelId) => channelConfig
   *                                                 返回结构需至少包含 recordConfig.upload
   */
  constructor(options = {}) {
    if (!options.uploadQueue) throw new Error('FileFinalizeDispatcher 需要 uploadQueue');
    if (typeof options.channelConfigFetcher !== 'function') {
      throw new Error('FileFinalizeDispatcher 需要 channelConfigFetcher');
    }
    this.queue = options.uploadQueue;
    this.fetchChannelConfig = options.channelConfigFetcher;

    // 简单计数，方便日志观测
    this.stats = {
      totalDispatched: 0,
      totalEnqueued: 0,
      totalSkipped: 0,
      totalErrored: 0
    };
  }

  /**
   * 录制文件最终化成功后的统一入口
   *
   * 调用此方法 **不会抛异常**；内部所有错误都会吃掉并 logger.error 记录，
   * 以保护调用方（rename 路径）的正常流程。
   *
   * @param {string} filePath   完成 rename 后的最终文件绝对路径（不能是 _temp_ 文件）
   * @param {string} channelId  频道 ID
   */
  onFinalize(filePath, channelId) {
    // 将后续异步逻辑推到下一 tick，立即释放调用方
    setImmediate(() => {
      this._doDispatch(filePath, channelId).catch((err) => {
        // 这里不应该再抛，保险起见再兜一次
        logger.error('[FileFinalizeDispatcher] 内部异常（已吞）', {
          filePath,
          channelId,
          error: err && err.message
        });
      });
    });
  }

  /**
   * 实际的异步调度逻辑
   *
   * @param {string} filePath
   * @param {string} channelId
   */
  async _doDispatch(filePath, channelId) {
    this.stats.totalDispatched++;

    // 基础参数校验
    if (!filePath || typeof filePath !== 'string') {
      logger.warn('[FileFinalizeDispatcher] filePath 非法，跳过', { filePath, channelId });
      this.stats.totalSkipped++;
      return;
    }
    if (!channelId || typeof channelId !== 'string') {
      logger.warn('[FileFinalizeDispatcher] channelId 非法，跳过', { filePath, channelId });
      this.stats.totalSkipped++;
      return;
    }

    // 防呆：扫描/触发点都应该传入最终文件（不含 _temp_），这里再校验一次
    if (/_temp_/.test(filePath)) {
      logger.warn('[FileFinalizeDispatcher] 收到 _temp_ 文件，跳过', { filePath, channelId });
      this.stats.totalSkipped++;
      return;
    }
    // 已上传标记的文件不应再入队
    if (/_u\.(mp4|MP4)$/.test(filePath)) {
      logger.info('[FileFinalizeDispatcher] 已标记 _u，跳过', { filePath, channelId });
      this.stats.totalSkipped++;
      return;
    }

    // 拉频道配置
    let channelData;
    try {
      channelData = await this.fetchChannelConfig(channelId);
    } catch (err) {
      this.stats.totalErrored++;
      logger.error('[FileFinalizeDispatcher] 拉取频道配置失败，跳过本次上传', {
        filePath,
        channelId,
        error: err && err.message
      });
      return;
    }

    const uploadCfg = channelData && channelData.recordConfig && channelData.recordConfig.upload;

    // 未启用自动上传
    if (!uploadCfg || uploadCfg.enabled !== true) {
      logger.info('[FileFinalizeDispatcher] 频道未启用自动上传，跳过', { filePath, channelId });
      this.stats.totalSkipped++;
      return;
    }

    // 当前迭代仅支持家庭相册
    if (uploadCfg.destinationType !== 'familyAlbum') {
      logger.info('[FileFinalizeDispatcher] 当前仅支持 destinationType=familyAlbum，跳过', {
        filePath,
        channelId,
        destinationType: uploadCfg.destinationType
      });
      this.stats.totalSkipped++;
      return;
    }

    // 家庭相册必要字段校验
    if (!uploadCfg.groupId || !uploadCfg.albumId) {
      logger.warn('[FileFinalizeDispatcher] 家庭相册缺 groupId/albumId，跳过', {
        filePath,
        channelId,
        groupId: uploadCfg.groupId,
        albumId: uploadCfg.albumId
      });
      this.stats.totalSkipped++;
      return;
    }

    // 构造队列任务（配置快照 — 防止运行中配置变更影响当前任务）
    const task = {
      filePath,
      channelId,
      uploadConfig: {
        destinationType: 'familyAlbum',
        groupId: uploadCfg.groupId,
        albumId: uploadCfg.albumId,
        targetName: uploadCfg.targetName || '',
        retryTimes: typeof uploadCfg.retryTimes === 'number' && uploadCfg.retryTimes > 0
          ? uploadCfg.retryTimes
          : 3
      },
      enqueuedAt: Date.now()
    };

    const result = this.queue.enqueue(task);
    if (result.enqueued) {
      this.stats.totalEnqueued++;
      logger.info('[FileFinalizeDispatcher] 入队成功', {
        filePath,
        channelId,
        albumId: uploadCfg.albumId,
        targetName: uploadCfg.targetName
      });
    } else {
      // 已在 pendingSet / uploadingSet，属于正常去重，不记为错误
      this.stats.totalSkipped++;
      logger.info('[FileFinalizeDispatcher] 未入队（已在队列或正在上传）', {
        filePath,
        channelId,
        reason: result.reason
      });
    }
  }

  /**
   * 统计数据（调试 / 查询用）
   */
  getStats() {
    return { ...this.stats };
  }
}

module.exports = FileFinalizeDispatcher;
