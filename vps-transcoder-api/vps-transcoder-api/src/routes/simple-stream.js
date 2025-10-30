const express = require('express');
const SimpleStreamManager = require('../services/SimpleStreamManager');
const PreloadScheduler = require('../services/PreloadScheduler');
const PreloadHealthCheck = require('../services/PreloadHealthCheck');
const RecordScheduler = require('../services/RecordScheduler');  // 🆕 录制调度器
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// 🔐 添加API认证中间件到所有SimpleStream路由
router.use(authMiddleware);

// 创建全局流管理器实例
const streamManager = new SimpleStreamManager();

// 🆕 创建预加载调度器实例
const preloadScheduler = new PreloadScheduler(streamManager);

// 🆕 创建预加载健康检查实例
const preloadHealthCheck = new PreloadHealthCheck(streamManager, preloadScheduler);

// 🆕 创建录制调度器实例
const recordScheduler = new RecordScheduler(streamManager);

// 🆕 延迟5秒启动调度器（等待服务器完全启动）
setTimeout(() => {
  // 启动预加载调度器
  preloadScheduler.start()
    .then(() => {
      logger.info('✅ PreloadScheduler started successfully');
      
      // 启动健康检查
      preloadHealthCheck.start();
      logger.info('✅ PreloadHealthCheck started successfully');
    })
    .catch((error) => {
      logger.error('Failed to start PreloadScheduler', { error: error.message });
    });
  
  // 启动录制调度器
  recordScheduler.start()
    .then(() => {
      logger.info('✅ RecordScheduler started successfully');
    })
    .catch((error) => {
      logger.error('Failed to start RecordScheduler', { error: error.message });
    });
}, 5000);

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
 * Body: { channelId: string, sessionId?: string }
 */
router.post('/heartbeat', (req, res) => {
  try {
    const { channelId, sessionId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    // 🔵 保持现有逻辑：更新频道心跳（用于清理FFmpeg）
    streamManager.handleHeartbeat(channelId);
    
    // 🆕 可选：跟踪用户会话（用于统计活跃用户数）
    if (sessionId) {
      streamManager.trackUserSession(channelId, sessionId);
    }
    
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

// ===== 🆕 预加载API端点 =====

/**
 * 获取预加载状态（从VPS）
 * GET /api/preload/vps-status
 */
router.get('/preload/vps-status', (req, res) => {
  try {
    const schedulerStatus = preloadScheduler.getStatus();
    const streamManagerStatus = streamManager.getPreloadStatus();
    
    res.json({
      status: 'success',
      data: {
        scheduler: schedulerStatus,
        streamManager: streamManagerStatus
      }
    });
  } catch (error) {
    logger.error('Failed to get preload status', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * 重新加载预加载调度器（配置变更时调用）
 * POST /api/preload/reload-schedule
 */
router.post('/preload/reload-schedule', async (req, res) => {
  try {
    logger.info('Reloading preload scheduler...');
    
    await preloadScheduler.reload();
    
    res.json({
      status: 'success',
      message: 'Schedule reloaded successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to reload schedule', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// ===== 🆕 录制API端点 =====

/**
 * 重新加载录制调度器（配置变更时调用）
 * POST /api/record/reload-schedule
 * Body: { channelId, config } - config为可选，直接传递避免KV读取延迟
 */
router.post('/record/reload-schedule', async (req, res) => {
  try {
    const { channelId, config } = req.body;
    
    logger.info('Reloading record scheduler...', { 
      channelId, 
      hasDirectConfig: !!config,
      configEnabled: config?.enabled 
    });
    
    // 🔧 修复：支持直接传递配置，避免KV最终一致性问题
    if (config) {
      // 使用Workers直接传递的配置（最新的、准确的）
      await recordScheduler.reloadScheduleWithConfig(channelId, config);
    } else {
      // 兼容旧方式：从Workers API重新读取所有配置
      await recordScheduler.reloadSchedule();
    }
    
    res.json({
      status: 'success',
      message: 'Record schedule reloaded successfully',
      timestamp: new Date().toISOString(),
      debug: {
        usedDirectConfig: !!config
      }
    });
  } catch (error) {
    logger.error('Failed to reload record schedule', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * 获取录制状态（从VPS）
 * GET /api/record/status
 */
router.get('/record/status', (req, res) => {
  try {
    const schedulerStatus = recordScheduler.getStatus();
    const recordingStatus = streamManager.getRecordingStatus();
    
    res.json({
      status: 'success',
      data: {
        scheduler: schedulerStatus,
        streamManager: recordingStatus
      }
    });
  } catch (error) {
    logger.error('Failed to get recording status', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// 导出路由和管理器实例
module.exports = { router, streamManager, preloadScheduler, recordScheduler };
