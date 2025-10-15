/**
 * 智能通道路由管理器
 * 基于COMPLETE_VIDEO_STREAMING_LOGIC.md设计
 * 实现多通道路由管理和智能切换
 */

const logger = require('../utils/logger');

class ChannelRouter {
  constructor() {
    this.channelSources = new Map();
    this.userPreferences = new Map(); // 用户手动选择的通道
    this.channelHealthStatus = new Map(); // 通道健康状态
    
    // 通道优先级配置
    this.channelPriority = {
      userManual: 0,        // 用户手动选择 (最高优先级)
      proxyOptimized: 1,    // 代理优化通道
      tunnelOptimized: 2,   // 隧道优化通道
      directConnection: 3   // 直连通道
    };
  }

  /**
   * 获取通道优先级策略
   */
  getChannelPriority() {
    return [
      {
        type: 'user_manual',
        priority: 0,
        description: '用户手动指定通道'
      },
      {
        type: 'proxy_optimized',
        priority: 1,
        description: '代理加速通道 (推荐)'
      },
      {
        type: 'tunnel_optimized',
        priority: 2,
        description: 'Cloudflare隧道优化'
      },
      {
        type: 'direct_connection',
        priority: 3,
        description: '直连通道 (备用)'
      }
    ];
  }

  /**
   * 获取频道的所有可用路径
   */
  getChannelPaths(channelId) {
    return {
      channelId,
      rtmpSource: this.getRtmpSource(channelId), // 原始RTMP源
      accessPaths: [
        {
          type: 'proxy_optimized',
          priority: 1,
          url: `https://yoyoapi.5202021.xyz/hls/${channelId}/playlist.m3u8`,
          healthCheck: () => this.checkProxyHealth(),
          fallbackReason: null
        },
        {
          type: 'tunnel_optimized',
          priority: 2,
          url: `https://tunnel-hls.yoyo-vps.5202021.xyz/hls/${channelId}/playlist.m3u8`,
          healthCheck: () => this.checkTunnelHealth(),
          fallbackReason: null
        },
        {
          type: 'direct_connection',
          priority: 3,
          url: `https://yoyo-vps.5202021.xyz/hls/${channelId}/playlist.m3u8`,
          healthCheck: () => this.checkDirectHealth(),
          fallbackReason: null
        }
      ]
    };
  }

  /**
   * 智能选择最佳通道
   */
  async selectBestChannel(channelId, userId, options = {}) {
    try {
      const userPreference = this.userPreferences.get(userId);
      
      // 1. 用户手动选择优先
      if (userPreference && userPreference.channelId === channelId) {
        const manualPath = await this.validateChannelPath(userPreference.path);
        if (manualPath.isValid) {
          logger.info(`用户 ${userId} 使用手动选择的通道`, {
            channelId,
            pathType: manualPath.type
          });
          
          return {
            selectedPath: manualPath,
            reason: 'user_manual_selection',
            message: `使用用户指定的${manualPath.description}通道`
          };
        }
      }

      // 2. 自动选择最佳可用通道
      const channelPaths = this.getChannelPaths(channelId);
      const sortedPaths = channelPaths.accessPaths.sort((a, b) => a.priority - b.priority);

      for (const path of sortedPaths) {
        const healthStatus = await path.healthCheck();
        
        if (healthStatus.isHealthy) {
          logger.info(`为用户 ${userId} 自动选择通道`, {
            channelId,
            pathType: path.type,
            healthScore: healthStatus.score
          });
          
          return {
            selectedPath: path,
            reason: 'auto_selection',
            message: `自动选择${path.description || path.type}通道`,
            healthScore: healthStatus.score
          };
        } else {
          path.fallbackReason = healthStatus.reason;
          logger.warn(`通道不可用`, {
            channelId,
            pathType: path.type,
            reason: healthStatus.reason
          });
        }
      }

      // 3. 所有通道都不可用时的处理
      throw new Error('所有通道都不可用，请稍后重试');
      
    } catch (error) {
      logger.error('选择最佳通道失败:', error);
      throw error;
    }
  }

  /**
   * 设置用户手动选择的通道
   */
  setUserPreference(userId, channelId, pathType) {
    const channelPaths = this.getChannelPaths(channelId);
    const selectedPath = channelPaths.accessPaths.find(path => path.type === pathType);
    
    if (selectedPath) {
      this.userPreferences.set(userId, {
        channelId,
        path: selectedPath,
        timestamp: Date.now()
      });
      
      logger.info(`用户 ${userId} 手动选择通道`, {
        channelId,
        pathType
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * 清除用户手动选择
   */
  clearUserPreference(userId) {
    const removed = this.userPreferences.delete(userId);
    if (removed) {
      logger.info(`清除用户 ${userId} 的手动通道选择`);
    }
    return removed;
  }

  /**
   * 获取RTMP源
   */
  getRtmpSource(channelId) {
    // 这里应该从配置或数据库获取RTMP源
    // 暂时返回示例数据
    return this.channelSources.get(channelId) || null;
  }

  /**
   * 设置频道RTMP源
   */
  setChannelSource(channelId, rtmpUrl) {
    this.channelSources.set(channelId, rtmpUrl);
    logger.info(`设置频道 ${channelId} RTMP源`, { rtmpUrl });
  }

  /**
   * 检查代理通道健康状态
   */
  async checkProxyHealth() {
    try {
      // 实际实现应该检查代理服务器状态
      const response = await fetch('https://yoyoapi.5202021.xyz/health', {
        timeout: 5000
      });
      
      return {
        isHealthy: response.ok,
        score: response.ok ? 95 : 0,
        latency: Date.now() - response.timestamp,
        reason: response.ok ? null : 'Proxy server unreachable'
      };
    } catch (error) {
      return {
        isHealthy: false,
        score: 0,
        latency: null,
        reason: error.message
      };
    }
  }

  /**
   * 检查隧道通道健康状态
   */
  async checkTunnelHealth() {
    try {
      // 实际实现应该检查隧道状态
      const response = await fetch('https://tunnel-hls.yoyo-vps.5202021.xyz/health', {
        timeout: 5000
      });
      
      return {
        isHealthy: response.ok,
        score: response.ok ? 90 : 0,
        latency: Date.now() - response.timestamp,
        reason: response.ok ? null : 'Tunnel unreachable'
      };
    } catch (error) {
      return {
        isHealthy: false,
        score: 0,
        latency: null,
        reason: error.message
      };
    }
  }

  /**
   * 检查直连通道健康状态
   */
  async checkDirectHealth() {
    try {
      // 实际实现应该检查VPS直连状态
      const response = await fetch('https://yoyo-vps.5202021.xyz/health', {
        timeout: 5000
      });
      
      return {
        isHealthy: response.ok,
        score: response.ok ? 85 : 0,
        latency: Date.now() - response.timestamp,
        reason: response.ok ? null : 'Direct connection failed'
      };
    } catch (error) {
      return {
        isHealthy: false,
        score: 0,
        latency: null,
        reason: error.message
      };
    }
  }

  /**
   * 验证通道路径
   */
  async validateChannelPath(path) {
    try {
      const healthStatus = await path.healthCheck();
      return {
        ...path,
        isValid: healthStatus.isHealthy,
        healthStatus
      };
    } catch (error) {
      return {
        ...path,
        isValid: false,
        healthStatus: {
          isHealthy: false,
          reason: error.message
        }
      };
    }
  }

  /**
   * 获取通道统计信息
   */
  getChannelStats() {
    return {
      totalChannels: this.channelSources.size,
      userPreferences: this.userPreferences.size,
      healthChecks: this.channelHealthStatus.size,
      priorityConfig: this.getChannelPriority()
    };
  }
}

module.exports = ChannelRouter;
