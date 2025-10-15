/**
 * RTMP源变更处理器
 * 基于COMPLETE_VIDEO_STREAMING_LOGIC.md设计
 * 处理RTMP源变更时的用户体验优化
 */

const logger = require('../utils/logger');

class RTMPSourceManager {
  constructor(options = {}) {
    this.activeViewers = new Map(); // 频道观看者
    this.channelConfigs = new Map(); // 频道配置
    this.sourceChangeHistory = new Map(); // 源变更历史
    
    // 配置选项
    this.options = {
      notificationDelay: options.notificationDelay || 5000, // 通知延迟时间
      maxRetries: options.maxRetries || 3,
      cleanupDelay: options.cleanupDelay || 2000,
      ...options
    };
  }

  /**
   * 更新频道RTMP源
   */
  async updateChannelRTMP(channelId, newRtmpUrl, options = {}) {
    try {
      logger.info('开始更新频道RTMP源', {
        channelId,
        newRtmpUrl,
        options
      });

      // 1. 检查是否有用户观看
      const activeViewers = this.getChannelViewers(channelId);
      
      if (activeViewers.length === 0) {
        // 无用户观看，直接更新配置
        const result = await this.directUpdateConfig(channelId, newRtmpUrl);
        logger.info('无用户观看，直接更新RTMP源配置', result);
        return { strategy: 'direct_update', affectedUsers: 0, ...result };
      }
      
      // 2. 有用户观看，执行优雅通知流程
      return await this.gracefulSourceUpdate(channelId, newRtmpUrl, activeViewers, options);
      
    } catch (error) {
      logger.error('更新频道RTMP源失败:', error);
      throw error;
    }
  }

  /**
   * 优雅的源更新流程
   */
  async gracefulSourceUpdate(channelId, newRtmpUrl, viewers, options = {}) {
    try {
      const updateId = `update_${channelId}_${Date.now()}`;
      
      logger.info('开始优雅源更新流程', {
        updateId,
        channelId,
        viewerCount: viewers.length,
        newRtmpUrl
      });

      // 1. 记录更新开始
      this.recordSourceChange(channelId, {
        updateId,
        oldRtmpUrl: this.getChannelRtmpUrl(channelId),
        newRtmpUrl,
        viewers: viewers.map(v => v.userId),
        startTime: Date.now(),
        status: 'started'
      });

      // 2. 通知用户即将更新 (5秒倒计时)
      await this.notifyViewersOfUpdate(viewers, {
        channelId,
        updateId,
        message: '管理员正在更新视频源，5秒后画面将刷新',
        countdown: this.options.notificationDelay / 1000,
        newSource: this.maskRtmpUrl(newRtmpUrl)
      });
      
      // 3. 等待通知时间
      await this.delay(this.options.notificationDelay);
      
      // 4. 执行源切换
      const switchResult = await this.executeSourceSwitch(channelId, newRtmpUrl);
      
      // 5. 通知前端重新加载
      await this.triggerPlayerReload(viewers, channelId, updateId);
      
      // 6. 更新记录状态
      this.updateSourceChangeStatus(channelId, updateId, 'completed', {
        switchResult,
        completedTime: Date.now()
      });
      
      logger.info('优雅源更新完成', {
        updateId,
        channelId,
        affectedUsers: viewers.length,
        switchResult
      });
      
      return { 
        strategy: 'graceful_update', 
        affectedUsers: viewers.length,
        updateId,
        switchResult
      };
      
    } catch (error) {
      logger.error('优雅源更新失败:', error);
      
      // 记录失败状态
      this.updateSourceChangeStatus(channelId, updateId, 'failed', {
        error: error.message,
        failedTime: Date.now()
      });
      
      // 通知用户更新失败
      await this.notifyUpdateFailure(viewers, channelId, error.message);
      
      throw error;
    }
  }

  /**
   * 直接更新配置
   */
  async directUpdateConfig(channelId, newRtmpUrl) {
    try {
      // 获取旧配置
      const oldConfig = this.channelConfigs.get(channelId);
      
      // 更新配置
      this.channelConfigs.set(channelId, {
        ...oldConfig,
        rtmpUrl: newRtmpUrl,
        lastUpdated: Date.now()
      });
      
      logger.info('直接更新频道配置', {
        channelId,
        oldRtmpUrl: oldConfig?.rtmpUrl,
        newRtmpUrl
      });
      
      return {
        success: true,
        oldRtmpUrl: oldConfig?.rtmpUrl,
        newRtmpUrl,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('直接更新配置失败:', error);
      throw error;
    }
  }

  /**
   * 执行源切换
   */
  async executeSourceSwitch(channelId, newRtmpUrl) {
    try {
      logger.info('开始执行源切换', { channelId, newRtmpUrl });
      
      // 1. 停止旧的FFmpeg进程
      await this.stopFFmpegProcess(channelId);
      
      // 2. 清理旧的HLS文件
      await this.cleanupChannelHLS(channelId);
      
      // 3. 更新频道配置
      const channelConfig = this.channelConfigs.get(channelId) || {};
      channelConfig.rtmpUrl = newRtmpUrl;
      channelConfig.lastUpdated = Date.now();
      this.channelConfigs.set(channelId, channelConfig);
      
      // 4. 启动新的FFmpeg进程
      const newProcess = await this.spawnFFmpegProcess(channelId, newRtmpUrl);
      
      // 5. 等待进程稳定
      await this.waitForProcessStable(newProcess, 3000);
      
      logger.info('源切换执行完成', {
        channelId,
        newRtmpUrl,
        processId: newProcess.pid
      });
      
      return {
        success: true,
        processId: newProcess.pid,
        switchTime: Date.now(),
        newRtmpUrl
      };
      
    } catch (error) {
      logger.error('源切换执行失败:', error);
      throw error;
    }
  }

  /**
   * 通知观看者即将更新
   */
  async notifyViewersOfUpdate(viewers, notification) {
    const message = {
      type: 'rtmp_source_change',
      channelId: notification.channelId,
      updateId: notification.updateId,
      title: '视频源更新通知',
      message: notification.message,
      countdown: notification.countdown,
      newSource: notification.newSource,
      action: 'prepare_reload',
      timestamp: Date.now()
    };
    
    logger.info('通知观看者视频源更新', {
      viewerCount: viewers.length,
      notification: message
    });
    
    // 通过WebSocket或轮询通知所有用户
    for (const viewer of viewers) {
      await this.sendUserNotification(viewer.sessionId, message);
    }
  }

  /**
   * 触发播放器重新加载
   */
  async triggerPlayerReload(viewers, channelId, updateId) {
    const reloadMessage = {
      type: 'channel_reload_required',
      channelId: channelId,
      updateId: updateId,
      action: 'reload_player',
      reason: 'rtmp_source_changed',
      timestamp: Date.now()
    };
    
    logger.info('触发播放器重新加载', {
      viewerCount: viewers.length,
      channelId,
      updateId
    });
    
    for (const viewer of viewers) {
      await this.sendUserNotification(viewer.sessionId, reloadMessage);
    }
  }

  /**
   * 通知更新失败
   */
  async notifyUpdateFailure(viewers, channelId, errorMessage) {
    const failureMessage = {
      type: 'rtmp_update_failed',
      channelId: channelId,
      title: '视频源更新失败',
      message: '视频源更新失败，请刷新页面重试',
      error: errorMessage,
      action: 'show_error',
      timestamp: Date.now()
    };
    
    logger.warn('通知用户更新失败', {
      viewerCount: viewers.length,
      channelId,
      errorMessage
    });
    
    for (const viewer of viewers) {
      await this.sendUserNotification(viewer.sessionId, failureMessage);
    }
  }

  /**
   * 发送用户通知
   */
  async sendUserNotification(sessionId, message) {
    try {
      // 这里应该通过WebSocket或其他实时通信方式发送通知
      // 暂时记录到日志
      logger.info(`发送通知给会话 ${sessionId}`, message);
      
      // 模拟发送延迟
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return { success: true, sessionId, message };
    } catch (error) {
      logger.error(`发送通知失败 ${sessionId}:`, error);
      return { success: false, sessionId, error: error.message };
    }
  }

  /**
   * 停止FFmpeg进程
   */
  async stopFFmpegProcess(channelId) {
    try {
      logger.info(`停止频道 ${channelId} 的FFmpeg进程`);
      
      // 这里应该调用实际的进程管理器
      // 暂时模拟实现
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true, channelId };
    } catch (error) {
      logger.error(`停止FFmpeg进程失败 ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * 清理频道HLS文件
   */
  async cleanupChannelHLS(channelId) {
    try {
      logger.info(`清理频道 ${channelId} 的HLS文件`);
      
      // 这里应该清理实际的HLS文件
      // 暂时模拟实现
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return { success: true, channelId };
    } catch (error) {
      logger.error(`清理HLS文件失败 ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * 启动FFmpeg进程
   */
  async spawnFFmpegProcess(channelId, rtmpUrl) {
    try {
      logger.info(`启动频道 ${channelId} 的FFmpeg进程`, { rtmpUrl });
      
      // 这里应该调用实际的进程管理器
      // 暂时模拟实现
      const mockProcess = {
        pid: Math.floor(Math.random() * 10000) + 1000,
        channelId,
        rtmpUrl,
        startTime: Date.now()
      };
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return mockProcess;
    } catch (error) {
      logger.error(`启动FFmpeg进程失败 ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * 等待进程稳定
   */
  async waitForProcessStable(process, timeout = 3000) {
    try {
      logger.info(`等待进程 ${process.pid} 稳定`);
      
      // 模拟等待进程稳定
      await new Promise(resolve => setTimeout(resolve, Math.min(timeout, 2000)));
      
      return { stable: true, processId: process.pid };
    } catch (error) {
      logger.error(`等待进程稳定失败:`, error);
      throw error;
    }
  }

  /**
   * 获取频道观看者
   */
  getChannelViewers(channelId) {
    const viewers = this.activeViewers.get(channelId) || [];
    return viewers.filter(viewer => viewer.isActive);
  }

  /**
   * 添加频道观看者
   */
  addChannelViewer(channelId, viewerInfo) {
    if (!this.activeViewers.has(channelId)) {
      this.activeViewers.set(channelId, []);
    }
    
    const viewers = this.activeViewers.get(channelId);
    const existingIndex = viewers.findIndex(v => v.userId === viewerInfo.userId);
    
    if (existingIndex >= 0) {
      // 更新现有观看者信息
      viewers[existingIndex] = {
        ...viewers[existingIndex],
        ...viewerInfo,
        lastActivity: Date.now()
      };
    } else {
      // 添加新观看者
      viewers.push({
        ...viewerInfo,
        isActive: true,
        startTime: Date.now(),
        lastActivity: Date.now()
      });
    }
    
    logger.info(`添加频道 ${channelId} 观看者`, viewerInfo);
  }

  /**
   * 移除频道观看者
   */
  removeChannelViewer(channelId, userId) {
    const viewers = this.activeViewers.get(channelId);
    if (viewers) {
      const index = viewers.findIndex(v => v.userId === userId);
      if (index >= 0) {
        viewers.splice(index, 1);
        logger.info(`移除频道 ${channelId} 观看者 ${userId}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 获取频道RTMP URL
   */
  getChannelRtmpUrl(channelId) {
    const config = this.channelConfigs.get(channelId);
    return config?.rtmpUrl || null;
  }

  /**
   * 记录源变更
   */
  recordSourceChange(channelId, changeInfo) {
    if (!this.sourceChangeHistory.has(channelId)) {
      this.sourceChangeHistory.set(channelId, []);
    }
    
    const history = this.sourceChangeHistory.get(channelId);
    history.push(changeInfo);
    
    // 保持历史记录不超过100条
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    
    logger.info(`记录频道 ${channelId} 源变更`, changeInfo);
  }

  /**
   * 更新源变更状态
   */
  updateSourceChangeStatus(channelId, updateId, status, additionalInfo = {}) {
    const history = this.sourceChangeHistory.get(channelId);
    if (history) {
      const record = history.find(r => r.updateId === updateId);
      if (record) {
        record.status = status;
        record.lastUpdated = Date.now();
        Object.assign(record, additionalInfo);
        
        logger.info(`更新源变更状态`, {
          channelId,
          updateId,
          status,
          additionalInfo
        });
      }
    }
  }

  /**
   * 掩码RTMP URL（隐藏敏感信息）
   */
  maskRtmpUrl(rtmpUrl) {
    if (!rtmpUrl) return null;
    
    try {
      const url = new URL(rtmpUrl);
      return `${url.protocol}//${url.host}/${url.pathname.split('/')[1]}/***`;
    } catch (error) {
      return rtmpUrl.substring(0, 20) + '***';
    }
  }

  /**
   * 延迟函数
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const totalViewers = Array.from(this.activeViewers.values())
      .reduce((sum, viewers) => sum + viewers.length, 0);
    
    const totalChannels = this.activeViewers.size;
    const totalSourceChanges = Array.from(this.sourceChangeHistory.values())
      .reduce((sum, history) => sum + history.length, 0);
    
    return {
      totalViewers,
      totalChannels,
      totalSourceChanges,
      channelConfigs: this.channelConfigs.size,
      lastActivity: Date.now()
    };
  }

  /**
   * 清理过期数据
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000) { // 默认24小时
    const now = Date.now();
    let cleanedCount = 0;
    
    // 清理过期的观看者
    for (const [channelId, viewers] of this.activeViewers) {
      const activeViewers = viewers.filter(v => 
        v.isActive && (now - v.lastActivity) < maxAge
      );
      
      if (activeViewers.length !== viewers.length) {
        this.activeViewers.set(channelId, activeViewers);
        cleanedCount += viewers.length - activeViewers.length;
      }
      
      if (activeViewers.length === 0) {
        this.activeViewers.delete(channelId);
      }
    }
    
    // 清理过期的源变更历史
    for (const [channelId, history] of this.sourceChangeHistory) {
      const recentHistory = history.filter(h => 
        (now - h.startTime) < maxAge
      );
      
      if (recentHistory.length !== history.length) {
        this.sourceChangeHistory.set(channelId, recentHistory);
        cleanedCount += history.length - recentHistory.length;
      }
      
      if (recentHistory.length === 0) {
        this.sourceChangeHistory.delete(channelId);
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`清理过期数据完成，清理 ${cleanedCount} 条记录`);
    }
    
    return cleanedCount;
  }
}

module.exports = RTMPSourceManager;
