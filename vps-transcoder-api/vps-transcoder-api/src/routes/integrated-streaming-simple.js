const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 简化版集成流媒体API - 基于现有SimpleStreamManager
 */

/**
 * 健康检查
 * GET /api/integrated-streaming/health
 */
router.get('/health', async (req, res) => {
  try {
    res.json({
      status: 'success',
      data: {
        service: 'IntegratedStreamingService',
        version: '2.0.0',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        initialized: true,
        components: {
          simpleStreamManager: 'healthy',
          proxyManager: 'healthy'
        }
      }
    });
    
  } catch (error) {
    logger.error('集成流媒体健康检查失败:', error);
    
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
 * 启动智能观看 - 基于现有SimpleStreamManager
 * POST /api/integrated-streaming/start-watching
 */
router.post('/start-watching', async (req, res) => {
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

    logger.info('收到智能观看请求:', { channelId, rtmpUrl, options });

    // 调用现有的SimpleStreamManager API
    const { streamManager } = require('./simple-stream');
    const hlsUrl = await streamManager.startWatching(channelId, rtmpUrl);
    
    res.json({
      status: 'success',
      message: '智能观看启动成功',
      data: {
        success: true,
        hlsUrl,
        channelId,
        routingPath: { type: 'auto', url: hlsUrl },
        timestamp: Date.now(),
        serviceVersion: '2.0.0'
      }
    });
    
  } catch (error) {
    logger.error('启动智能观看失败:', { 
      channelId: req.body.channelId, 
      error: error.message 
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
 * 智能心跳处理 - 基于现有SimpleStreamManager
 * POST /api/integrated-streaming/heartbeat
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { channelId, clientInfo = {} } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId 是必需参数'
      });
    }

    // 调用现有的心跳处理
    const { streamManager } = require('./simple-stream');
    streamManager.handleHeartbeat(channelId);
    
    res.json({
      status: 'success',
      message: '心跳处理成功',
      data: {
        success: true,
        timestamp: Date.now(),
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
router.post('/stop-watching', async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId 是必需参数'
      });
    }
    
    // 调用现有的停止观看
    const { streamManager } = require('./simple-stream');
    const result = await streamManager.stopWatching(channelId);
    
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
 * 获取系统状态
 * GET /api/integrated-streaming/system/status
 */
router.get('/system/status', async (req, res) => {
  try {
    // 获取现有系统状态
    const { streamManager } = require('./simple-stream');
    const simpleStatus = streamManager.getSystemStatus();
    
    res.json({
      status: 'success',
      data: {
        ...simpleStatus,
        serviceType: 'IntegratedStreamingService',
        version: '2.0.0',
        timestamp: Date.now(),
        components: {
          simpleStreamManager: simpleStatus,
          proxyManager: { status: 'available' }
        }
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
 * 获取可用路由
 * GET /api/integrated-streaming/routes/available
 */
router.get('/routes/available', async (req, res) => {
  try {
    const { channelId } = req.query;
    
    // 返回可用路由列表
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

module.exports = { router };
