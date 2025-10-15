const express = require('express');
const IntegratedStreamingService = require('../services/IntegratedStreamingService');
const logger = require('../utils/logger');

const router = express.Router();

// 创建全局集成流媒体服务实例
let integratedService = null;

/**
 * 初始化集成服务
 */
async function initializeService() {
  if (!integratedService) {
    integratedService = new IntegratedStreamingService({
      enableIntelligentRouting: true,
      enableSessionProtection: true,
      enableRTMPSourceManagement: true,
      heartbeatInterval: 30000
    });
    
    try {
      await integratedService.initialize();
      logger.info('IntegratedStreamingService 初始化成功');
    } catch (error) {
      logger.error('IntegratedStreamingService 初始化失败:', error);
      throw error;
    }
  }
  return integratedService;
}

/**
 * 中间件：确保服务已初始化
 */
async function ensureServiceInitialized(req, res, next) {
  try {
    if (!integratedService) {
      await initializeService();
    }
    next();
  } catch (error) {
    logger.error('服务初始化失败:', error);
    res.status(500).json({
      status: 'error',
      message: '服务初始化失败',
      error: error.message
    });
  }
}

/**
 * 启动智能观看 - 统一入口
 * POST /api/integrated-streaming/start-watching
 */
router.post('/start-watching', ensureServiceInitialized, async (req, res) => {
  try {
    const { channelId, rtmpUrl, options = {} } = req.body;
    
    // 参数验证
    if (!channelId || !rtmpUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId 和 rtmpUrl 是必需参数',
        code: 'MISSING_PARAMETERS'
      });
    }

    // 提取客户端信息
    const clientInfo = {
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      userLocation: options.userLocation,
      networkType: options.networkType,
      ...options
    };

    logger.info('收到智能观看请求:', { channelId, rtmpUrl, clientInfo });

    // 启动观看
    const result = await integratedService.startWatching(channelId, rtmpUrl, clientInfo);
    
    res.json({
      status: 'success',
      message: '智能观看启动成功',
      data: {
        ...result,
        timestamp: Date.now(),
        serviceVersion: '2.0.0'
      }
    });
    
  } catch (error) {
    logger.error('启动智能观看失败:', { 
      channelId: req.body.channelId, 
      error: error.message,
      stack: error.stack 
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'SMART_WATCH_START_ERROR',
      timestamp: Date.now()
    });
  }
});

/**
 * 智能心跳处理
 * POST /api/integrated-streaming/heartbeat
 */
router.post('/heartbeat', ensureServiceInitialized, async (req, res) => {
  try {
    const { channelId, clientInfo = {} } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId 是必需参数'
      });
    }

    // 增强客户端信息
    const enhancedClientInfo = {
      ...clientInfo,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      timestamp: Date.now()
    };

    const result = await integratedService.handleHeartbeat(channelId, enhancedClientInfo);
    
    res.json({
      status: 'success',
      message: '心跳处理成功',
      data: {
        ...result,
        channelId
      }
    });
    
  } catch (error) {
    logger.error('心跳处理失败:', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'HEARTBEAT_ERROR'
    });
  }
});

/**
 * 停止观看
 * POST /api/integrated-streaming/stop-watching
 */
router.post('/stop-watching', ensureServiceInitialized, async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId 是必需参数'
      });
    }
    
    const result = await integratedService.stopWatching(channelId);
    
    res.json({
      status: 'success',
      message: '停止观看成功',
      data: {
        ...result,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('停止观看失败:', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'STOP_WATCH_ERROR'
    });
  }
});

/**
 * 获取频道信息
 * GET /api/integrated-streaming/channel/:channelId
 */
router.get('/channel/:channelId', ensureServiceInitialized, async (req, res) => {
  try {
    const { channelId } = req.params;
    
    const channelInfo = integratedService.getChannelInfo(channelId);
    
    if (!channelInfo) {
      return res.status(404).json({
        status: 'error',
        message: '频道未找到或未激活',
        code: 'CHANNEL_NOT_FOUND'
      });
    }
    
    res.json({
      status: 'success',
      data: channelInfo
    });
    
  } catch (error) {
    logger.error('获取频道信息失败:', { 
      channelId: req.params.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'GET_CHANNEL_ERROR'
    });
  }
});

/**
 * 获取系统状态
 * GET /api/integrated-streaming/system/status
 */
router.get('/system/status', ensureServiceInitialized, async (req, res) => {
  try {
    const status = await integratedService.getSystemStatus();
    
    res.json({
      status: 'success',
      data: {
        ...status,
        serviceType: 'IntegratedStreamingService',
        version: '2.0.0'
      }
    });
    
  } catch (error) {
    logger.error('获取系统状态失败:', { error: error.message });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'SYSTEM_STATUS_ERROR'
    });
  }
});

/**
 * 手动路由切换
 * POST /api/integrated-streaming/switch-route
 */
router.post('/switch-route', ensureServiceInitialized, async (req, res) => {
  try {
    const { channelId, routeType, routeConfig } = req.body;
    
    if (!channelId || !routeType) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId 和 routeType 是必需参数'
      });
    }

    // 构建新路由配置
    const newRoute = {
      type: routeType,
      config: routeConfig,
      manual: true,
      timestamp: Date.now()
    };

    await integratedService.performRoutingSwitching(channelId, newRoute);
    
    res.json({
      status: 'success',
      message: '路由切换成功',
      data: {
        channelId,
        newRoute,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('手动路由切换失败:', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'ROUTE_SWITCH_ERROR'
    });
  }
});

/**
 * RTMP源更新通知
 * POST /api/integrated-streaming/update-source
 */
router.post('/update-source', ensureServiceInitialized, async (req, res) => {
  try {
    const { channelId, newRtmpUrl, notifyClients = true } = req.body;
    
    if (!channelId || !newRtmpUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId 和 newRtmpUrl 是必需参数'
      });
    }

    // 获取受影响的会话
    const affectedSessions = integratedService.sessionProtectionManager?.getActiveSessions()
      ?.filter(s => s.channelId === channelId) || [];

    // 处理RTMP源变更
    await integratedService.handleRTMPSourceChange(channelId, newRtmpUrl, affectedSessions);
    
    res.json({
      status: 'success',
      message: 'RTMP源更新成功',
      data: {
        channelId,
        newRtmpUrl,
        affectedSessions: affectedSessions.length,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('RTMP源更新失败:', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'SOURCE_UPDATE_ERROR'
    });
  }
});

/**
 * 获取可用路由路径
 * GET /api/integrated-streaming/routes/available
 */
router.get('/routes/available', ensureServiceInitialized, async (req, res) => {
  try {
    const { channelId } = req.query;
    
    // 获取可用路由（这里需要实现具体逻辑）
    const availableRoutes = [
      {
        id: 'proxy_optimized',
        type: 'proxy',
        name: '代理优化',
        description: '通过代理服务器优化连接',
        priority: 1,
        estimated_latency: 150
      },
      {
        id: 'tunnel_optimized',
        type: 'tunnel',
        name: '隧道优化',
        description: '通过隧道服务优化连接',
        priority: 2,
        estimated_latency: 200
      },
      {
        id: 'direct_connection',
        type: 'direct',
        name: '直接连接',
        description: '直接连接到源服务器',
        priority: 3,
        estimated_latency: 100
      }
    ];
    
    res.json({
      status: 'success',
      data: {
        channelId,
        availableRoutes,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('获取可用路由失败:', { error: error.message });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'GET_ROUTES_ERROR'
    });
  }
});

/**
 * WebSocket 支持 - 实时通知
 * 这里预留WebSocket升级的接口
 */
router.get('/ws/notifications', (req, res) => {
  res.json({
    status: 'info',
    message: 'WebSocket notifications endpoint',
    data: {
      upgrade_url: '/api/integrated-streaming/ws',
      supported_events: [
        'channel_switch',
        'source_update',
        'route_optimization',
        'network_quality_change'
      ]
    }
  });
});

/**
 * 健康检查
 * GET /api/integrated-streaming/health
 */
router.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      service: 'IntegratedStreamingService',
      version: '2.0.0',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      initialized: !!integratedService
    };

    if (integratedService) {
      const systemStatus = await integratedService.getSystemStatus();
      healthStatus.components = {
        simpleStreamManager: systemStatus.simpleStreamManager ? 'healthy' : 'error',
        proxyManager: systemStatus.proxyManager ? 'healthy' : 'error',
        activeChannels: systemStatus.activeChannels || 0
      };
    }

    res.json({
      status: 'success',
      data: healthStatus
    });
    
  } catch (error) {
    logger.error('健康检查失败:', { error: error.message });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      data: {
        service: 'IntegratedStreamingService',
        version: '2.0.0',
        status: 'unhealthy',
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * 优雅关闭处理
 */
process.on('SIGTERM', async () => {
  logger.info('收到SIGTERM信号，开始优雅关闭...');
  if (integratedService) {
    try {
      await integratedService.destroy();
      logger.info('IntegratedStreamingService 优雅关闭完成');
    } catch (error) {
      logger.error('优雅关闭失败:', error);
    }
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('收到SIGINT信号，开始优雅关闭...');
  if (integratedService) {
    try {
      await integratedService.destroy();
      logger.info('IntegratedStreamingService 优雅关闭完成');
    } catch (error) {
      logger.error('优雅关闭失败:', error);
    }
  }
  process.exit(0);
});

// 导出路由和服务实例获取函数
module.exports = { 
  router, 
  getService: () => integratedService,
  initializeService
};
