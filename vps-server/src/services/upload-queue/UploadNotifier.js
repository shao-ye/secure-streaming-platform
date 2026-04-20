const logger = require('../../utils/logger');

/**
 * 上传通知骨架
 *
 * 定位：
 *   - 把"谁来通知"这件事从 Worker 里解耦出来
 *   - 本次实施仅 logger.error，后续可挂邮件 / 飞书 / 短信等
 *
 * 为什么不在 Worker 里直接 logger.error：
 *   - 后续接通知渠道时，Worker 代码不用再改
 *   - 不同级别的事件（登录失效 vs 单次上传失败）可以在这里按渠道分发
 */
class UploadNotifier {
  /**
   * 构造器
   * @param {Object} [options]
   * @param {Function} [options.loggerOverride] 可选，用于单元测试注入 mock logger
   */
  constructor(options = {}) {
    this.logger = options.loggerOverride || logger;
  }

  /**
   * 登录态失效通知
   *
   * 触发场景：Worker 取任务前检查 CloudDriveService 状态为非 valid
   * 处理策略：调用方应暂停 Worker、把任务回退队列头，并通知运维
   *
   * @param {Object} payload
   * @param {string} [payload.filePath] 发现失效时正要处理的文件
   * @param {string} [payload.authStatus] 当前云盘状态值（unknown/invalid）
   * @param {string} [payload.authMessage] 云盘状态附加信息
   */
  async notifyLoginExpired(payload = {}) {
    this.logger.error('[UploadNotifier] 云盘登录失效，上传队列已暂停', {
      filePath: payload.filePath || '',
      authStatus: payload.authStatus || '',
      authMessage: payload.authMessage || ''
    });
    // TODO: 迭代结束后，这里挂邮件 / 飞书等
  }

  /**
   * 单文件上传永久失败通知
   *
   * 触发场景：同一次入队内重试达到 retryTimes 后仍失败
   * 处理策略：仅记录，文件名保持原样；下次扫描或触发点会重新入队
   *
   * @param {Object} payload
   * @param {string} payload.filePath 永久失败的文件
   * @param {number} [payload.attempts] 实际尝试次数
   * @param {string} [payload.lastError] 最后一次错误信息
   * @param {string} [payload.reason] 业务原因（如 'file_too_small'），可选
   */
  async notifyUploadFailed(payload = {}) {
    this.logger.error('[UploadNotifier] 文件上传永久失败', {
      filePath: payload.filePath || '',
      attempts: typeof payload.attempts === 'number' ? payload.attempts : undefined,
      lastError: payload.lastError || '',
      reason: payload.reason || ''
    });
    // TODO: 迭代结束后，这里挂邮件 / 飞书等
  }
}

module.exports = UploadNotifier;
