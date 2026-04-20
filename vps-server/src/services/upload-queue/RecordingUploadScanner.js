const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

/**
 * 录制文件上传扫描器（迭代 3）
 *
 * 定位：
 *   作为上传链路的"兜底"，覆盖所有未被实时触发点捕获的文件。
 *
 * 触发时机：
 *   - 服务启动后延迟 30 秒扫一次（让 RecordingRecoveryService 先跑完，
 *     它会把 `_temp_` 转为 `_to_xxxxxx.mp4` 并通过 dispatcher 入队）
 *   - 每小时再扫一次
 *
 * 扫描规则：
 *   - 只处理 `.mp4` 扩展名
 *   - 跳过 `_temp_*.mp4`（正在录制）
 *   - 跳过 `*_u.mp4`（已上传）
 *   - 只处理符合 `*_to_<HHMMSS>.mp4` 命名规则（录制输出）
 *   - channelId 从目录结构反推：{root}/{channelId}/{date}/file.mp4
 *
 * 防洪峰：
 *   - 本扫描器只负责调 dispatcher.onFinalize；是否入队由 dispatcher 决定
 *   - 重复入队被 UploadQueueService 的双 Set 拦截，不会重复上传
 *   - Worker 有 15s 节流，即使一次性扫到 100 个文件也不会打爆 139 风控
 */
class RecordingUploadScanner {
  /**
   * 构造器
   *
   * @param {Object} options
   * @param {Object} options.dispatcher      FileFinalizeDispatcher 实例
   * @param {string} [options.recordingsPath] 录制根目录，默认读环境变量 RECORDINGS_PATH
   * @param {number} [options.initialDelayMs] 启动后首次扫描延迟（毫秒），默认 30s
   * @param {number} [options.scanIntervalMs] 周期性扫描间隔（毫秒），默认 1 小时
   */
  constructor(options = {}) {
    if (!options.dispatcher) throw new Error('RecordingUploadScanner 需要 dispatcher');
    this.dispatcher = options.dispatcher;
    this.recordingsPath = options.recordingsPath
      || process.env.RECORDINGS_PATH
      || '/srv/filebrowser/yoyo-k';
    this.initialDelayMs = typeof options.initialDelayMs === 'number'
      ? options.initialDelayMs
      : 30 * 1000;
    this.scanIntervalMs = typeof options.scanIntervalMs === 'number'
      ? options.scanIntervalMs
      : 60 * 60 * 1000;

    this.initialTimer = null;
    this.intervalTimer = null;
    this.scanning = false;        // 防止周期扫描与启动扫描重入
    this.lastScanAt = null;
    this.lastScanStats = null;    // { scanned, dispatched, skipped, durationMs }
  }

  /**
   * 启动扫描器（幂等）
   */
  start() {
    if (this.initialTimer || this.intervalTimer) {
      logger.warn('[UploadScanner] start 被重复调用，忽略');
      return;
    }

    logger.info('[UploadScanner] 已调度启动扫描', {
      recordingsPath: this.recordingsPath,
      initialDelayMs: this.initialDelayMs,
      scanIntervalMs: this.scanIntervalMs
    });

    // 延迟首次扫描
    this.initialTimer = setTimeout(() => {
      this._runScanSafe('initial');
    }, this.initialDelayMs);

    // 周期扫描
    this.intervalTimer = setInterval(() => {
      this._runScanSafe('interval');
    }, this.scanIntervalMs);
  }

  /**
   * 停止扫描器
   */
  stop() {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    logger.info('[UploadScanner] 已停止');
  }

  /**
   * 立即运行一次扫描（供 API 手动触发 / 测试用）
   * @returns {Promise<Object>} 本次扫描的统计结果
   */
  async scanNow() {
    return this._runScanSafe('manual');
  }

  /**
   * 带去重的安全扫描包装
   *
   * @param {string} reason  触发原因，用于日志
   */
  async _runScanSafe(reason) {
    if (this.scanning) {
      logger.info('[UploadScanner] 上一次扫描尚在进行，本次跳过', { reason });
      return this.lastScanStats || null;
    }
    this.scanning = true;
    try {
      return await this._scanAll(reason);
    } finally {
      this.scanning = false;
    }
  }

  /**
   * 递归扫全部 mp4 文件，符合规则的调 dispatcher
   *
   * @param {string} reason  触发原因
   */
  async _scanAll(reason) {
    const started = Date.now();
    logger.info('[UploadScanner] 扫描开始', { reason, recordingsPath: this.recordingsPath });

    if (!fs.existsSync(this.recordingsPath)) {
      logger.warn('[UploadScanner] 录制目录不存在，跳过', { recordingsPath: this.recordingsPath });
      const stats = { reason, scanned: 0, dispatched: 0, skipped: 0, durationMs: 0 };
      this.lastScanStats = stats;
      this.lastScanAt = Date.now();
      return stats;
    }

    let scanned = 0;     // 全部 mp4 计数
    let dispatched = 0;  // 调 dispatcher 的次数
    let skipped = 0;     // 被规则过滤掉的文件

    try {
      // 目录结构：{root}/{channelId}/{YYYYMMDD}/{file.mp4}
      const channelDirs = fs
        .readdirSync(this.recordingsPath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^stream_/.test(d.name))
        .map((d) => d.name);

      for (const channelId of channelDirs) {
        const channelDir = path.join(this.recordingsPath, channelId);
        let dateEntries;
        try {
          dateEntries = fs.readdirSync(channelDir, { withFileTypes: true });
        } catch (err) {
          logger.warn('[UploadScanner] 读取频道目录失败', {
            channelId,
            error: err.message
          });
          continue;
        }

        for (const dateEntry of dateEntries) {
          if (!dateEntry.isDirectory() || !/^\d{8}$/.test(dateEntry.name)) continue;
          const dateDir = path.join(channelDir, dateEntry.name);

          let fileEntries;
          try {
            fileEntries = fs.readdirSync(dateDir);
          } catch (err) {
            logger.warn('[UploadScanner] 读取日期目录失败', {
              channelId,
              date: dateEntry.name,
              error: err.message
            });
            continue;
          }

          for (const fileName of fileEntries) {
            // 仅处理 .mp4
            if (!/\.(mp4|MP4)$/.test(fileName)) continue;
            scanned++;

            // 跳过正在录制
            if (fileName.includes('_temp_')) {
              skipped++;
              continue;
            }
            // 跳过已上传
            if (/_u\.(mp4|MP4)$/.test(fileName)) {
              skipped++;
              continue;
            }
            // 仅处理符合 _to_HHMMSS.mp4 命名的最终文件
            if (!/_to_\d{6}\.(mp4|MP4)$/.test(fileName)) {
              skipped++;
              continue;
            }

            const filePath = path.join(dateDir, fileName);
            // 交给 dispatcher（内部 setImmediate 不阻塞）
            this.dispatcher.onFinalize(filePath, channelId);
            dispatched++;
          }
        }
      }
    } catch (err) {
      logger.error('[UploadScanner] 扫描过程异常', { error: err.message, stack: err.stack });
    }

    const durationMs = Date.now() - started;
    const stats = { reason, scanned, dispatched, skipped, durationMs };
    this.lastScanStats = stats;
    this.lastScanAt = Date.now();
    logger.info('[UploadScanner] 扫描完成', stats);
    return stats;
  }

  /**
   * 查询当前扫描器状态（调试 / 查询用）
   */
  getStatus() {
    return {
      running: !!(this.initialTimer || this.intervalTimer),
      scanning: this.scanning,
      lastScanAt: this.lastScanAt,
      lastScanStats: this.lastScanStats
    };
  }
}

module.exports = RecordingUploadScanner;
