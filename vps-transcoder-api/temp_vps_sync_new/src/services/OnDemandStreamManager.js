const ProcessManager = require('./ProcessManager');
const ViewerManager = require('./ViewerManager');
const logger = require('../utils/logger');

/**
 * 按需转码管理系统
 * 实现需求文档FR-9的完整按需播放功能：
 * - FR-9.1: 无观看者时不处理RTMP流
 * - FR-9.2: 第一个用户观看时启动转码
 * - FR-9.3: 多用户共享同一转码进程
 */
class OnDemandStreamManager {
  constructor() {
    // 初始化进程管理器和观看者管理器
    this.processManager = new ProcessManager();
    this.viewerManager = new ViewerManager();
    
    // 存储频道配置信息
    // 格式: { channelId: { name, rtmpUrl, streamId, status } }
    this.channelConfigs = new Map();
    
    // 自动清理检查间隔（毫秒）
    this.cleanupInterval = parseInt(process.env.AUTO_CLEANUP_INTERVAL) || 30 * 1000; // 30秒
    
    // 启动自动清理任务
    this.startAutoCleanup();
    
    logger.info('OnDemandStreamManager initialized', {
      cleanupInterval: this.cleanupInterval
    });
  }

  /**
   * 配置频道信息
   * @param {string} channelId - 频道ID
   * @param {Object} config - 频道配置 { name, rtmpUrl }
   */
  configureChannel(channelId, config) {
    try {
      if (!channelId || !config.rtmpUrl) {
        throw new Error('channelId and rtmpUrl are required');
      }

      // 生成流ID（用于ffmpeg输出目录）
      const streamId = `stream_${channelId}`;

      this.channelConfigs.set(channelId, {
        channelId,
        name: config.name || channelId,
        rtmpUrl: config.rtmpUrl,
        streamId,
        status: 'configured',
        configuredAt: new Date()
      });

      logger.info('Channel configured', {
        channelId,
        name: config.name,
        rtmpUrl: config.rtmpUrl,
        streamId
      });

      return {
        success: true,
        channelId,
        streamId,
        message: 'Channel configured successfully'
      };

    } catch (error) {
      logger.error('Failed to configure channel', {
        channelId,
        config,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 用户开始观看频道（按需启动转码）
   * @param {string} channelId - 频道ID
   * @param {string} userId - 用户ID（可选）
   * @param {Object} clientInfo - 客户端信息
   * @returns {Object} 观看结果
   */
  async startWatching(channelId, userId = null, clientInfo = {}) {
    try {
      // 检查频道是否已配置
      if (!this.channelConfigs.has(channelId)) {
        throw new Error(`Channel ${channelId} is not configured`);
      }

      const channelConfig = this.channelConfigs.get(channelId);

      // 用户加入观看
      const joinResult = this.viewerManager.joinChannel(channelId, userId, clientInfo);
      
      let streamStarted = false;
      let hlsUrl = null;

      // 如果是第一个观看者，启动转码进程
      if (joinResult.isFirstViewer) {
        logger.info('First viewer joined, starting transcoding', {
          channelId,
          sessionId: joinResult.sessionId,
          userId
        });

        try {
          // 启动转码进程
          const startResult = await this.processManager.startStream(
            channelConfig.rtmpUrl,
            channelConfig.streamId
          );

          streamStarted = true;
          hlsUrl = startResult.hlsUrl;
          
          // 更新频道状态
          channelConfig.status = 'streaming';
          channelConfig.streamStartedAt = new Date();
          channelConfig.processId = startResult.processId;

          logger.info('Transcoding started for first viewer', {
            channelId,
            streamId: channelConfig.streamId,
            processId: startResult.processId,
            hlsUrl
          });

        } catch (streamError) {
          // 转码启动失败，移除观看者
          this.viewerManager.leaveChannel(channelId, joinResult.sessionId);
          
          logger.error('Failed to start transcoding for first viewer', {
            channelId,
            sessionId: joinResult.sessionId,
            error: streamError.message
          });
          
          throw new Error(`Failed to start stream: ${streamError.message}`);
        }
      } else {
        // 不是第一个观看者，检查转码是否正在运行
        if (this.processManager.isStreamRunning(channelConfig.streamId)) {
          hlsUrl = `/hls/${channelConfig.streamId}/playlist.m3u8`;
          logger.info('Additional viewer joined existing stream', {
            channelId,
            sessionId: joinResult.sessionId,
            userId,
            totalViewers: joinResult.totalViewers
          });
        } else {
          // 转码进程意外停止，重新启动
          logger.warn('Stream process not running for existing viewers, restarting', {
            channelId,
            streamId: channelConfig.streamId
          });

          try {
            const startResult = await this.processManager.startStream(
              channelConfig.rtmpUrl,
              channelConfig.streamId
            );

            streamStarted = true;
            hlsUrl = startResult.hlsUrl;
            channelConfig.status = 'streaming';
            channelConfig.processId = startResult.processId;

          } catch (streamError) {
            this.viewerManager.leaveChannel(channelId, joinResult.sessionId);
            throw new Error(`Failed to restart stream: ${streamError.message}`);
          }
        }
      }

      return {
        success: true,
        sessionId: joinResult.sessionId,
        channelId,
        channelName: channelConfig.name,
        hlsUrl,
        isFirstViewer: joinResult.isFirstViewer,
        totalViewers: joinResult.totalViewers,
        streamStarted,
        message: 'Started watching successfully'
      };

    } catch (error) {
      logger.error('Failed to start watching', {
        channelId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 用户停止观看频道（可能触发转码停止）
   * @param {string} channelId - 频道ID
   * @param {string} sessionId - 会话ID
   * @returns {Object} 停止观看结果
   */
  async stopWatching(channelId, sessionId) {
    try {
      if (!channelId || !sessionId) {
        throw new Error('channelId and sessionId are required');
      }

      // 用户离开观看
      const leaveResult = this.viewerManager.leaveChannel(channelId, sessionId);
      
      let streamStopped = false;

      // 如果是最后一个观看者，停止转码进程
      if (leaveResult.isLastViewer && this.channelConfigs.has(channelId)) {
        const channelConfig = this.channelConfigs.get(channelId);

        logger.info('Last viewer left, stopping transcoding', {
          channelId,
          sessionId,
          streamId: channelConfig.streamId
        });

        try {
          // 停止转码进程
          if (this.processManager.isStreamRunning(channelConfig.streamId)) {
            await this.processManager.stopStream(channelConfig.streamId);
            streamStopped = true;
            
            // 更新频道状态
            channelConfig.status = 'configured';
            channelConfig.streamStoppedAt = new Date();
            delete channelConfig.processId;

            logger.info('Transcoding stopped for last viewer', {
              channelId,
              streamId: channelConfig.streamId
            });
          }

        } catch (streamError) {
          logger.error('Failed to stop transcoding for last viewer', {
            channelId,
            sessionId,
            streamId: channelConfig.streamId,
            error: streamError.message
          });
          // 不抛出错误，因为用户已经成功离开
        }
      }

      return {
        success: true,
        channelId,
        sessionId,
        isLastViewer: leaveResult.isLastViewer,
        totalViewers: leaveResult.totalViewers,
        streamStopped,
        message: 'Stopped watching successfully'
      };

    } catch (error) {
      logger.error('Failed to stop watching', {
        channelId,
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 更新观看者活动（心跳）
   * @param {string} channelId - 频道ID
   * @param {string} sessionId - 会话ID
   * @returns {Object} 更新结果
   */
  updateViewerActivity(channelId, sessionId) {
    return this.viewerManager.updateActivity(channelId, sessionId);
  }

  /**
   * 获取频道状态
   * @param {string} channelId - 频道ID
   * @returns {Object|null} 频道状态
   */
  getChannelStatus(channelId) {
    if (!this.channelConfigs.has(channelId)) {
      return null;
    }

    const channelConfig = this.channelConfigs.get(channelId);
    const viewerInfo = this.viewerManager.getChannelInfo(channelId);
    const isStreaming = this.processManager.isStreamRunning(channelConfig.streamId);

    return {
      channelId,
      name: channelConfig.name,
      rtmpUrl: channelConfig.rtmpUrl,
      streamId: channelConfig.streamId,
      status: channelConfig.status,
      isStreaming,
      viewerCount: viewerInfo ? viewerInfo.viewerCount : 0,
      viewers: viewerInfo ? viewerInfo.viewers : [],
      hlsUrl: isStreaming ? `/hls/${channelConfig.streamId}/playlist.m3u8` : null,
      configuredAt: channelConfig.configuredAt,
      streamStartedAt: channelConfig.streamStartedAt,
      streamStoppedAt: channelConfig.streamStoppedAt
    };
  }

  /**
   * 获取所有频道状态
   * @returns {Array} 频道状态数组
   */
  getAllChannelsStatus() {
    const channels = [];

    for (const channelId of this.channelConfigs.keys()) {
      channels.push(this.getChannelStatus(channelId));
    }

    return channels;
  }

  /**
   * 启动自动清理任务
   */
  startAutoCleanup() {
    this.autoCleanupTimer = setInterval(async () => {
      try {
        await this.performAutoCleanup();
      } catch (error) {
        logger.error('Auto cleanup failed', { error: error.message });
      }
    }, this.cleanupInterval);

    logger.info('Auto cleanup started', { interval: this.cleanupInterval });
  }

  /**
   * 执行自动清理
   */
  async performAutoCleanup() {
    // 清理过期的观看者会话
    const cleanupResult = this.viewerManager.cleanupExpiredSessions();
    
    // 检查是否有转码进程需要停止（观看者会话过期后）
    const channelsToStop = [];

    for (const [channelId, channelConfig] of this.channelConfigs) {
      const hasViewers = this.viewerManager.hasViewers(channelId);
      const isStreaming = this.processManager.isStreamRunning(channelConfig.streamId);

      // 如果没有观看者但转码还在运行，需要停止
      if (!hasViewers && isStreaming) {
        channelsToStop.push({ channelId, streamId: channelConfig.streamId });
      }
    }

    // 停止无观看者的转码进程
    for (const { channelId, streamId } of channelsToStop) {
      try {
        await this.processManager.stopStream(streamId);
        
        const channelConfig = this.channelConfigs.get(channelId);
        channelConfig.status = 'configured';
        channelConfig.streamStoppedAt = new Date();
        delete channelConfig.processId;

        logger.info('Auto-stopped stream with no viewers', {
          channelId,
          streamId
        });

      } catch (error) {
        logger.error('Failed to auto-stop stream', {
          channelId,
          streamId,
          error: error.message
        });
      }
    }

    if (cleanupResult.cleanedSessions > 0 || channelsToStop.length > 0) {
      logger.info('Auto cleanup completed', {
        cleanedSessions: cleanupResult.cleanedSessions,
        stoppedStreams: channelsToStop.length,
        activeChannels: cleanupResult.activeChannels
      });
    }
  }

  /**
   * 获取系统统计信息
   * @returns {Object} 系统统计
   */
  getSystemStats() {
    const viewerStats = this.viewerManager.getSystemStats();
    const processStats = this.processManager.getSystemStatus();

    return {
      channels: {
        total: this.channelConfigs.size,
        streaming: Array.from(this.channelConfigs.values()).filter(c => c.status === 'streaming').length,
        configured: Array.from(this.channelConfigs.values()).filter(c => c.status === 'configured').length
      },
      viewers: {
        totalChannels: viewerStats.totalChannels,
        totalViewers: viewerStats.totalViewers
      },
      processes: {
        totalStreams: processStats.totalStreams,
        runningStreams: processStats.runningStreams
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 销毁管理器，清理所有资源
   */
  async destroy() {
    // 停止自动清理
    if (this.autoCleanupTimer) {
      clearInterval(this.autoCleanupTimer);
      this.autoCleanupTimer = null;
    }

    // 停止所有转码进程
    try {
      await this.processManager.stopAllStreams();
    } catch (error) {
      logger.error('Failed to stop all streams during destroy', { error: error.message });
    }

    // 销毁观看者管理器
    this.viewerManager.destroy();

    // 清理频道配置
    this.channelConfigs.clear();

    logger.info('OnDemandStreamManager destroyed');
  }
}

module.exports = OnDemandStreamManager;
