const express = require('express');
const SimpleStreamManager = require('../services/SimpleStreamManager');
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 🔐 添加API认证中间件到所有SimpleStream路由
router.use(authMiddleware);

// 创建全局流管理器实例
const streamManager = new SimpleStreamManager();

/**
 * 开始观看频道 - 要求完整参数：channelId和rtmpUrl
 * POST /api/simple-stream/start-watching
 */
router.post('/start-watching', async (req, res) => {
  try {
    const { channelId, rtmpUrl } = req.body;
    
    if (!channelId || !rtmpUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId and rtmpUrl are required'
      });
    }
    
    logger.info('Starting stream with provided parameters', { channelId, rtmpUrl });
    
    const hlsUrl = await streamManager.startWatching(channelId, rtmpUrl);
    
    res.json({
      status: 'success',
      message: 'Started watching successfully',
      data: {
        channelId,
        hlsUrl,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('Failed to start watching', { channelId: req.body.channelId, error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'STREAM_START_ERROR'
    });
  }
});

/**
 * 频道心跳 - 简化心跳机制
 * POST /api/simple-stream/heartbeat
 */
router.post('/heartbeat', (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    streamManager.handleHeartbeat(channelId);
    
    res.json({
      status: 'success',
      message: 'Heartbeat received',
      data: {
        channelId,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('Failed to handle heartbeat', { channelId: req.body.channelId, error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * 停止频道观看
 * POST /api/simple-stream/stop-watching
 */
router.post('/stop-watching', async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    const result = await streamManager.stopWatching(channelId);
    
    res.json({
      ...result,
      data: {
        ...result.data,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('Failed to stop watching', { channelId: req.body.channelId, error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});


/**
 * 获取系统状态
 * GET /api/simple-stream/system/status
 */
router.get('/system/status', (req, res) => {
  try {
    const status = streamManager.getSystemStatus();
    
    res.json({
      status: 'success',
      data: status
    });
    
  } catch (error) {
    logger.error('Failed to get system status', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * 健康检查
 * GET /api/simple-stream/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'success',
    message: 'SimpleStreamManager is running',
    data: {
      service: 'SimpleStreamManager',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  });
});

/**
 * 🔥 重启频道 - 当RTMP URL变化时使用
 * POST /api/simple-stream/restart-channel
 */
router.post('/restart-channel', async (req, res) => {
  try {
    const { channelId, rtmpUrl, reason } = req.body;
    
    if (!channelId || !rtmpUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId and rtmpUrl are required'
      });
    }
    
    logger.info('Restarting channel due to RTMP URL change', { 
      channelId, 
      rtmpUrl, 
      reason: reason || 'No reason provided' 
    });
    
    // 步骤1：停止当前频道
    try {
      await streamManager.stopChannel(channelId);
      logger.info('Channel stopped successfully', { channelId });
    } catch (stopError) {
      // 如果频道未运行，忽略停止错误
      logger.warn('Failed to stop channel (may not be running)', { 
        channelId, 
        error: stopError.message 
      });
    }
    
    // 步骤2：使用新的RTMP URL重新启动
    const hlsUrl = await streamManager.startWatching(channelId, rtmpUrl);
    
    logger.info('Channel restarted successfully', { 
      channelId, 
      hlsUrl 
    });
    
    res.json({
      status: 'success',
      message: 'Channel restarted successfully',
      data: {
        channelId,
        hlsUrl,
        rtmpUrl,
        reason,
        timestamp: Date.now()
      }
    });
    
  } catch (error) {
    logger.error('Failed to restart channel', { 
      channelId: req.body.channelId, 
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      status: 'error',
      message: error.message,
      code: 'CHANNEL_RESTART_ERROR'
    });
  }
});

// 导出路由和管理器实例
module.exports = { router, streamManager };
