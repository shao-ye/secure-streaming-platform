const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * 观看者管理系统
 * 实现需求文档FR-9的按需播放功能：
 * - FR-9.1: 无观看者时不处理RTMP流
 * - FR-9.2: 第一个用户观看时启动转码
 * - FR-9.3: 多用户共享同一转码进程
 */
class ViewerManager {
  constructor() {
    // 存储每个频道的观看者信息
    // 格式: { channelId: { viewers: Map<sessionId, viewerInfo>, lastActivity: timestamp } }
    this.channelViewers = new Map();
    
    // 观看者会话超时时间（毫秒）- 5分钟无活动则认为离开
    this.sessionTimeout = parseInt(process.env.VIEWER_SESSION_TIMEOUT) || 5 * 60 * 1000;
    
    // 定期清理过期会话
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 1000); // 每分钟清理一次
    
    logger.info('ViewerManager initialized', {
      sessionTimeout: this.sessionTimeout,
      cleanupInterval: '60s'
    });
  }

  /**
   * 用户加入观看频道
   * @param {string} channelId - 频道ID
   * @param {string} userId - 用户ID（可选）
   * @param {Object} clientInfo - 客户端信息
   * @returns {Object} 加入结果，包含会话ID和是否为第一个观看者
   */
  joinChannel(channelId, userId = null, clientInfo = {}) {
    try {
      if (!channelId) {
        throw new Error('channelId is required');
      }

      // 生成唯一会话ID
      const sessionId = uuidv4();
      const joinTime = new Date();

      // 获取或创建频道观看者信息
      if (!this.channelViewers.has(channelId)) {
        this.channelViewers.set(channelId, {
          viewers: new Map(),
          lastActivity: joinTime
        });
      }

      const channelInfo = this.channelViewers.get(channelId);
      const isFirstViewer = channelInfo.viewers.size === 0;

      // 添加观看者信息
      const viewerInfo = {
        sessionId,
        userId,
        joinTime,
        lastActivity: joinTime,
        clientInfo: {
          ip: clientInfo.ip || 'unknown',
          userAgent: clientInfo.userAgent || 'unknown',
          ...clientInfo
        }
      };

      channelInfo.viewers.set(sessionId, viewerInfo);
      channelInfo.lastActivity = joinTime;

      logger.info('Viewer joined channel', {
        channelId,
        sessionId,
        userId,
        isFirstViewer,
        totalViewers: channelInfo.viewers.size,
        clientIp: clientInfo.ip
      });

      return {
        success: true,
        sessionId,
        isFirstViewer,
        totalViewers: channelInfo.viewers.size,
        message: `Joined channel ${channelId} successfully`
      };

    } catch (error) {
      logger.error('Failed to join channel', {
        channelId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 用户离开观看频道
   * @param {string} channelId - 频道ID
   * @param {string} sessionId - 会话ID
   * @returns {Object} 离开结果，包含是否为最后一个观看者
   */
  leaveChannel(channelId, sessionId) {
    try {
      if (!channelId || !sessionId) {
        throw new Error('channelId and sessionId are required');
      }

      if (!this.channelViewers.has(channelId)) {
        logger.warn('Channel not found when leaving', { channelId, sessionId });
        return {
          success: true,
          isLastViewer: true,
          totalViewers: 0,
          message: 'Channel was already empty'
        };
      }

      const channelInfo = this.channelViewers.get(channelId);
      const viewerInfo = channelInfo.viewers.get(sessionId);

      if (!viewerInfo) {
        logger.warn('Viewer session not found when leaving', { channelId, sessionId });
        return {
          success: true,
          isLastViewer: channelInfo.viewers.size === 0,
          totalViewers: channelInfo.viewers.size,
          message: 'Session was already removed'
        };
      }

      // 移除观看者
      channelInfo.viewers.delete(sessionId);
      channelInfo.lastActivity = new Date();

      const isLastViewer = channelInfo.viewers.size === 0;

      // 如果没有观看者了，清理频道信息
      if (isLastViewer) {
        this.channelViewers.delete(channelId);
      }

      logger.info('Viewer left channel', {
        channelId,
        sessionId,
        userId: viewerInfo.userId,
        isLastViewer,
        totalViewers: channelInfo.viewers.size,
        watchDuration: Date.now() - viewerInfo.joinTime.getTime()
      });

      return {
        success: true,
        isLastViewer,
        totalViewers: isLastViewer ? 0 : channelInfo.viewers.size,
        message: `Left channel ${channelId} successfully`
      };

    } catch (error) {
      logger.error('Failed to leave channel', {
        channelId,
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 更新观看者活动时间（心跳）
   * @param {string} channelId - 频道ID
   * @param {string} sessionId - 会话ID
   * @returns {Object} 更新结果
   */
  updateActivity(channelId, sessionId) {
    try {
      if (!channelId || !sessionId) {
        throw new Error('channelId and sessionId are required');
      }

      if (!this.channelViewers.has(channelId)) {
        return {
          success: false,
          message: 'Channel not found'
        };
      }

      const channelInfo = this.channelViewers.get(channelId);
      const viewerInfo = channelInfo.viewers.get(sessionId);

      if (!viewerInfo) {
        return {
          success: false,
          message: 'Session not found'
        };
      }

      // 更新活动时间
      const now = new Date();
      viewerInfo.lastActivity = now;
      channelInfo.lastActivity = now;

      return {
        success: true,
        message: 'Activity updated successfully'
      };

    } catch (error) {
      logger.error('Failed to update activity', {
        channelId,
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 获取频道观看者数量
   * @param {string} channelId - 频道ID
   * @returns {number} 观看者数量
   */
  getViewerCount(channelId) {
    if (!this.channelViewers.has(channelId)) {
      return 0;
    }
    return this.channelViewers.get(channelId).viewers.size;
  }

  /**
   * 检查频道是否有观看者
   * @param {string} channelId - 频道ID
   * @returns {boolean} 是否有观看者
   */
  hasViewers(channelId) {
    return this.getViewerCount(channelId) > 0;
  }

  /**
   * 获取频道详细信息
   * @param {string} channelId - 频道ID
   * @returns {Object|null} 频道信息
   */
  getChannelInfo(channelId) {
    if (!this.channelViewers.has(channelId)) {
      return null;
    }

    const channelInfo = this.channelViewers.get(channelId);
    const viewers = [];

    for (const [sessionId, viewerInfo] of channelInfo.viewers) {
      viewers.push({
        sessionId,
        userId: viewerInfo.userId,
        joinTime: viewerInfo.joinTime,
        lastActivity: viewerInfo.lastActivity,
        watchDuration: Date.now() - viewerInfo.joinTime.getTime(),
        clientInfo: viewerInfo.clientInfo
      });
    }

    return {
      channelId,
      viewerCount: viewers.length,
      viewers,
      lastActivity: channelInfo.lastActivity
    };
  }

  /**
   * 获取所有频道的观看者统计
   * @returns {Array} 频道统计数组
   */
  getAllChannelsStats() {
    const stats = [];

    for (const [channelId, channelInfo] of this.channelViewers) {
      stats.push({
        channelId,
        viewerCount: channelInfo.viewers.size,
        lastActivity: channelInfo.lastActivity,
        totalWatchTime: this.calculateTotalWatchTime(channelInfo.viewers)
      });
    }

    return stats;
  }

  /**
   * 计算频道总观看时长
   * @param {Map} viewers - 观看者Map
   * @returns {number} 总观看时长（毫秒）
   */
  calculateTotalWatchTime(viewers) {
    let totalTime = 0;
    const now = Date.now();

    for (const viewerInfo of viewers.values()) {
      totalTime += now - viewerInfo.joinTime.getTime();
    }

    return totalTime;
  }

  /**
   * 清理过期的观看者会话
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedSessions = 0;
    const channelsToRemove = [];

    for (const [channelId, channelInfo] of this.channelViewers) {
      const expiredSessions = [];

      // 查找过期会话
      for (const [sessionId, viewerInfo] of channelInfo.viewers) {
        if (now - viewerInfo.lastActivity.getTime() > this.sessionTimeout) {
          expiredSessions.push(sessionId);
        }
      }

      // 移除过期会话
      for (const sessionId of expiredSessions) {
        const viewerInfo = channelInfo.viewers.get(sessionId);
        channelInfo.viewers.delete(sessionId);
        cleanedSessions++;

        logger.info('Cleaned expired viewer session', {
          channelId,
          sessionId,
          userId: viewerInfo.userId,
          inactiveTime: now - viewerInfo.lastActivity.getTime()
        });
      }

      // 如果频道没有观看者了，标记为待删除
      if (channelInfo.viewers.size === 0) {
        channelsToRemove.push(channelId);
      }
    }

    // 删除空频道
    for (const channelId of channelsToRemove) {
      this.channelViewers.delete(channelId);
    }

    if (cleanedSessions > 0 || channelsToRemove.length > 0) {
      logger.info('Session cleanup completed', {
        cleanedSessions,
        removedChannels: channelsToRemove.length,
        activeChannels: this.channelViewers.size
      });
    }

    return {
      cleanedSessions,
      removedChannels: channelsToRemove.length,
      activeChannels: this.channelViewers.size
    };
  }

  /**
   * 获取系统统计信息
   * @returns {Object} 系统统计
   */
  getSystemStats() {
    let totalViewers = 0;
    let totalChannels = this.channelViewers.size;

    for (const channelInfo of this.channelViewers.values()) {
      totalViewers += channelInfo.viewers.size;
    }

    return {
      totalChannels,
      totalViewers,
      sessionTimeout: this.sessionTimeout,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 销毁管理器，清理资源
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.channelViewers.clear();
    logger.info('ViewerManager destroyed');
  }
}

module.exports = ViewerManager;
