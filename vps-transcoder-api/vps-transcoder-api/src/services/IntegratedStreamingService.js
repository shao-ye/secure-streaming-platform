/**
 * 集成流媒体服务
 * 统一管理所有流媒体相关组件
 * 基于COMPLETE_VIDEO_STREAMING_LOGIC.md设计
 */

const logger = require('../utils/logger');
const SimpleStreamManager = require('./SimpleStreamManager');
const ProxyManager = require('./ProxyManager');
const ChannelRouter = require('./ChannelRouter');
const IntelligentRoutingManager = require('./IntelligentRoutingManager');
const RTMPSourceManager = require('./RTMPSourceManager');
const SessionProtectionManager = require('./SessionProtectionManager');

class IntegratedStreamingService {
  constructor(options = {}) {
    // 核心组件初始化
    this.simpleStreamManager = new SimpleStreamManager();
    this.proxyManager = new ProxyManager();
    this.channelRouter = new ChannelRouter();
    this.intelligentRoutingManager = new IntelligentRoutingManager();
    this.rtmpSourceManager = new RTMPSourceManager();
    this.sessionProtectionManager = new SessionProtectionManager();
    
    // 服务状态
    this.isInitialized = false;
    this.activeChannels = new Map(); // 活跃频道映射
    this.routingPaths = new Map(); // 路由路径缓存
    
    // 配置选项
    this.options = {
      enableIntelligentRouting: options.enableIntelligentRouting !== false, // 默认启用
      enableSessionProtection: options.enableSessionProtection !== false, // 默认启用
      enableRTMPSourceManagement: options.enableRTMPSourceManagement !== false, // 默认启用
      heartbeatInterval: options.heartbeatInterval || 30000, // 30秒心跳
      ...options
    };
    
    logger.info('IntegratedStreamingService 构造完成', this.options);
  }

  /**
   * 初始化服务
   */
  async initialize() {
    try {
      logger.info('开始初始化 IntegratedStreamingService...');
      
      // 1. 初始化基础服务
      await this.simpleStreamManager.initialize();
      await this.proxyManager.initialize();
      
      // 2. 初始化智能组件
      await this.channelRouter.initialize();
      await this.intelligentRoutingManager.initialize();
      await this.rtmpSourceManager.initialize();
      await this.sessionProtectionManager.initialize();
      
      // 3. 设置组件间通信
      this.setupInterComponentCommunication();
      
      // 4. 启动监控服务
      this.startMonitoringServices();
      
      this.isInitialized = true;
      logger.info('IntegratedStreamingService 初始化完成');
      
    } catch (error) {
      logger.error('IntegratedStreamingService 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 设置组件间通信
   */
  setupInterComponentCommunication() {
    // 路由管理器监听代理状态变化
    this.proxyManager.on?.('proxyStateChanged', async (newState) => {
      if (this.options.enableSessionProtection) {
        await this.sessionProtectionManager.handleProxyStateChange(newState);
      }
    });

    // RTMP源管理器监听源变更
    this.rtmpSourceManager.on?.('sourceChanged', async (channelId, newSource) => {
      const activeSessions = this.sessionProtectionManager.getActiveSessions();
      const affectedSessions = activeSessions.filter(s => s.channelId === channelId);
      
      if (affectedSessions.length > 0) {
        await this.handleRTMPSourceChange(channelId, newSource, affectedSessions);
      }
    });

    // 智能路由管理器监听网络质量变化
    this.intelligentRoutingManager.on?.('routingChanged', async (channelId, newRoute) => {
      await this.updateChannelRouting(channelId, newRoute);
    });
  }

  /**
   * 启动监控服务
   */
  startMonitoringServices() {
    // 定期检查系统状态
    setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('健康检查失败:', error);
      }
    }, this.options.heartbeatInterval);

    // 定期优化路由
    if (this.options.enableIntelligentRouting) {
      setInterval(async () => {
        try {
          await this.optimizeRouting();
        } catch (error) {
          logger.error('路由优化失败:', error);
        }
      }, 60000); // 每分钟优化一次
    }
  }

  /**
   * 启动观看 - 统一入口
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {Object} options - 选项
   */
  async startWatching(channelId, rtmpUrl, options = {}) {
    try {
      logger.info('启动观看请求:', { channelId, rtmpUrl, options });
      
      // 1. 检查RTMP源状态
      if (this.options.enableRTMPSourceManagement) {
        const sourceStatus = await this.rtmpSourceManager.validateSource(rtmpUrl);
        if (!sourceStatus.isValid) {
          throw new Error(`RTMP源无效: ${sourceStatus.reason}`);
        }
      }

      // 2. 获取最佳路由路径
      let routingPath;
      if (this.options.enableIntelligentRouting) {
        routingPath = await this.intelligentRoutingManager.selectBestRoute(channelId, {
          rtmpUrl,
          userLocation: options.userLocation,
          networkType: options.networkType
        });
      } else {
        // 使用基础路由
        routingPath = await this.channelRouter.selectChannel(channelId);
      }

      // 3. 应用路由配置
      await this.applyRoutingConfiguration(routingPath);

      // 4. 启动流媒体转码
      const hlsUrl = await this.simpleStreamManager.startWatching(channelId, rtmpUrl);

      // 5. 注册会话保护
      if (this.options.enableSessionProtection) {
        await this.sessionProtectionManager.registerSession({
          channelId,
          rtmpUrl,
          hlsUrl,
          routingPath,
          startTime: Date.now(),
          userOptions: options
        });
      }

      // 6. 缓存频道信息
      this.activeChannels.set(channelId, {
        rtmpUrl,
        hlsUrl,
        routingPath,
        startTime: Date.now(),
        lastHeartbeat: Date.now()
      });

      logger.info('观看启动成功:', { channelId, hlsUrl, routingPath: routingPath?.type });

      return {
        success: true,
        hlsUrl,
        routingPath,
        channelId
      };

    } catch (error) {
      logger.error('启动观看失败:', { channelId, rtmpUrl, error: error.message });
      throw error;
    }
  }

  /**
   * 处理心跳请求
   * @param {string} channelId - 频道ID
   * @param {Object} clientInfo - 客户端信息
   */
  async handleHeartbeat(channelId, clientInfo = {}) {
    try {
      // 1. 更新基础流管理器心跳
      this.simpleStreamManager.handleHeartbeat(channelId);

      // 2. 更新会话保护心跳
      if (this.options.enableSessionProtection) {
        await this.sessionProtectionManager.updateHeartbeat(channelId, clientInfo);
      }

      // 3. 更新本地缓存
      const channelInfo = this.activeChannels.get(channelId);
      if (channelInfo) {
        channelInfo.lastHeartbeat = Date.now();
        channelInfo.clientInfo = clientInfo;
      }

      // 4. 检查是否需要路由优化
      if (this.options.enableIntelligentRouting && clientInfo.networkQuality) {
        await this.checkRoutingOptimization(channelId, clientInfo);
      }

      return { success: true, timestamp: Date.now() };

    } catch (error) {
      logger.error('处理心跳失败:', { channelId, error: error.message });
      throw error;
    }
  }

  /**
   * 停止观看
   * @param {string} channelId - 频道ID
   */
  async stopWatching(channelId) {
    try {
      logger.info('停止观看请求:', { channelId });

      // 1. 停止流媒体转码
      await this.simpleStreamManager.stopWatching(channelId);

      // 2. 取消会话保护
      if (this.options.enableSessionProtection) {
        await this.sessionProtectionManager.unregisterSession(channelId);
      }

      // 3. 清理本地缓存
      this.activeChannels.delete(channelId);
      this.routingPaths.delete(channelId);

      logger.info('停止观看成功:', { channelId });

      return { success: true, channelId };

    } catch (error) {
      logger.error('停止观看失败:', { channelId, error: error.message });
      throw error;
    }
  }

  /**
   * 应用路由配置
   * @param {Object} routingPath - 路由路径配置
   */
  async applyRoutingConfiguration(routingPath) {
    if (!routingPath) return;

    try {
      switch (routingPath.type) {
        case 'proxy':
          if (routingPath.proxyConfig) {
            await this.proxyManager.startProxy(routingPath.proxyConfig);
          }
          break;
        case 'tunnel':
          // 隧道配置逻辑
          logger.info('应用隧道路由配置:', routingPath);
          break;
        case 'direct':
          // 直连配置 - 确保代理关闭
          await this.proxyManager.stopProxy();
          break;
        default:
          logger.warn('未知路由类型:', routingPath.type);
      }
    } catch (error) {
      logger.error('应用路由配置失败:', error);
      throw error;
    }
  }

  /**
   * 处理RTMP源变更
   * @param {string} channelId - 频道ID
   * @param {string} newSource - 新的RTMP源
   * @param {Array} affectedSessions - 受影响的会话
   */
  async handleRTMPSourceChange(channelId, newSource, affectedSessions) {
    try {
      logger.info('处理RTMP源变更:', { channelId, newSource, sessionCount: affectedSessions.length });

      // 1. 通知客户端源变更
      for (const session of affectedSessions) {
        await this.notifySourceChange(session, newSource);
      }

      // 2. 等待客户端确认或超时
      await this.waitForSourceChangeConfirmation(channelId, 30000);

      // 3. 重启流媒体转码
      await this.simpleStreamManager.stopChannel(channelId);
      await this.simpleStreamManager.startWatching(channelId, newSource);

      logger.info('RTMP源变更处理完成:', { channelId, newSource });

    } catch (error) {
      logger.error('RTMP源变更处理失败:', error);
      throw error;
    }
  }

  /**
   * 通知客户端源变更
   * @param {Object} session - 会话信息
   * @param {string} newSource - 新源地址
   */
  async notifySourceChange(session, newSource) {
    // 这里应该通过WebSocket或其他实时通信方式通知前端
    // 暂时记录日志
    logger.info('通知客户端源变更:', {
      sessionId: session.id,
      channelId: session.channelId,
      newSource
    });
  }

  /**
   * 等待源变更确认
   * @param {string} channelId - 频道ID
   * @param {number} timeout - 超时时间
   */
  async waitForSourceChangeConfirmation(channelId, timeout) {
    return new Promise((resolve) => {
      setTimeout(resolve, timeout);
    });
  }

  /**
   * 检查路由优化需求
   * @param {string} channelId - 频道ID
   * @param {Object} clientInfo - 客户端信息
   */
  async checkRoutingOptimization(channelId, clientInfo) {
    try {
      const currentPath = this.routingPaths.get(channelId);
      if (!currentPath) return;

      // 检查网络质量是否需要优化
      if (clientInfo.networkQuality === 'poor' || clientInfo.latency > 1000) {
        logger.info('检测到网络质量问题，尝试路由优化:', { channelId, clientInfo });
        
        const newPath = await this.intelligentRoutingManager.selectBestRoute(channelId, {
          currentPath,
          networkQuality: clientInfo.networkQuality,
          latency: clientInfo.latency
        });

        if (newPath && newPath.id !== currentPath.id) {
          await this.performRoutingSwitching(channelId, newPath);
        }
      }
    } catch (error) {
      logger.error('路由优化检查失败:', error);
    }
  }

  /**
   * 执行路由切换
   * @param {string} channelId - 频道ID
   * @param {Object} newPath - 新路由路径
   */
  async performRoutingSwitching(channelId, newPath) {
    try {
      logger.info('执行路由切换:', { channelId, newPath: newPath.type });

      // 1. 检查是否有活跃会话需要保护
      const hasActiveSessions = this.sessionProtectionManager.hasActiveSession(channelId);
      
      if (hasActiveSessions && this.options.enableSessionProtection) {
        // 2. 使用会话保护机制切换
        await this.sessionProtectionManager.handleProxyStateChange(newPath, {
          channelId,
          graceful: true
        });
      } else {
        // 3. 直接切换路由
        await this.applyRoutingConfiguration(newPath);
      }

      // 4. 更新路由缓存
      this.routingPaths.set(channelId, newPath);

      logger.info('路由切换完成:', { channelId, newPath: newPath.type });

    } catch (error) {
      logger.error('路由切换失败:', error);
      throw error;
    }
  }

  /**
   * 更新频道路由
   * @param {string} channelId - 频道ID
   * @param {Object} newRoute - 新路由
   */
  async updateChannelRouting(channelId, newRoute) {
    try {
      const channelInfo = this.activeChannels.get(channelId);
      if (channelInfo) {
        channelInfo.routingPath = newRoute;
        await this.applyRoutingConfiguration(newRoute);
        this.routingPaths.set(channelId, newRoute);
      }
    } catch (error) {
      logger.error('更新频道路由失败:', error);
    }
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck() {
    try {
      const status = {
        timestamp: Date.now(),
        simpleStreamManager: this.simpleStreamManager.getSystemStatus(),
        proxyManager: await this.proxyManager.getProxyStatus(),
        activeChannels: this.activeChannels.size,
        routingPaths: this.routingPaths.size
      };

      // 检查组件健康状态
      if (this.options.enableIntelligentRouting) {
        status.intelligentRoutingManager = await this.intelligentRoutingManager.getStatus();
      }

      if (this.options.enableSessionProtection) {
        status.sessionProtectionManager = await this.sessionProtectionManager.getStatus();
      }

      logger.debug('系统健康检查:', status);
      return status;

    } catch (error) {
      logger.error('健康检查执行失败:', error);
      throw error;
    }
  }

  /**
   * 优化路由
   */
  async optimizeRouting() {
    try {
      if (!this.options.enableIntelligentRouting) return;

      for (const [channelId, channelInfo] of this.activeChannels) {
        // 检查频道是否需要路由优化
        const shouldOptimize = await this.intelligentRoutingManager.shouldOptimizeRoute(channelId, {
          currentPath: channelInfo.routingPath,
          duration: Date.now() - channelInfo.startTime,
          lastHeartbeat: channelInfo.lastHeartbeat
        });

        if (shouldOptimize) {
          const newPath = await this.intelligentRoutingManager.selectBestRoute(channelId);
          if (newPath && newPath.id !== channelInfo.routingPath?.id) {
            await this.performRoutingSwitching(channelId, newPath);
          }
        }
      }
    } catch (error) {
      logger.error('路由优化失败:', error);
    }
  }

  /**
   * 获取系统状态
   */
  async getSystemStatus() {
    try {
      return await this.performHealthCheck();
    } catch (error) {
      logger.error('获取系统状态失败:', error);
      return {
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * 获取频道信息
   * @param {string} channelId - 频道ID
   */
  getChannelInfo(channelId) {
    const channelInfo = this.activeChannels.get(channelId);
    if (!channelInfo) {
      return null;
    }

    return {
      ...channelInfo,
      isActive: true,
      duration: Date.now() - channelInfo.startTime,
      lastHeartbeatAge: Date.now() - channelInfo.lastHeartbeat
    };
  }

  /**
   * 销毁服务
   */
  async destroy() {
    try {
      logger.info('开始销毁 IntegratedStreamingService...');

      // 停止所有活跃频道
      const stopPromises = [];
      for (const channelId of this.activeChannels.keys()) {
        stopPromises.push(this.stopWatching(channelId));
      }
      await Promise.all(stopPromises);

      // 销毁各个组件
      await this.simpleStreamManager.destroy();
      await this.proxyManager.stopProxy();
      
      // 清理状态
      this.activeChannels.clear();
      this.routingPaths.clear();
      this.isInitialized = false;

      logger.info('IntegratedStreamingService 销毁完成');

    } catch (error) {
      logger.error('IntegratedStreamingService 销毁失败:', error);
      throw error;
    }
  }
}

module.exports = IntegratedStreamingService;
