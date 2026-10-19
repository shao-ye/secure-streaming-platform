const express = require('express');
const SimpleStreamManager = require('../services/SimpleStreamManager');
const PreloadScheduler = require('../services/PreloadScheduler');
const PreloadHealthCheck = require('../services/PreloadHealthCheck');
const RecordScheduler = require('../services/RecordScheduler');  // 🆕 录制调度器
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/auth');
const axios = require('axios');  // 🆕 用于查询Workers配置

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

// ⚠️ 调度器启动逻辑已移至 app.js 的服务器启动回调中
// 这样可以确保在服务器完全启动后才启动调度器，避免PM2 Cluster模式下的时序问题

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
    
    logger.info('Starting stream with provided parameters', { channelId });

    // 配置未知不能解释为用户改成原始比例；失败时继续传 null，由管理器保留现有流设置。
    // 日志只保留结构化诊断字段，不记录请求头、响应原文或可能含凭据的完整错误消息。
    let channelConfig = null;
    const configRequestStartedAt = Date.now();
    try {
      const config = require('../../config');
      const configUrl = `${config.workersApiUrl}/api/channel/${channelId}/config`;
      const response = await axios.get(configUrl, { timeout: 3000 });
      const responseConfig = response.data?.data;
      if (response.data?.status === 'success' && responseConfig
        && ['original', '4:3', '16:9'].includes(responseConfig.videoAspectRatio)) {
        channelConfig = responseConfig;
        logger.info('Fetched channel config', {
          channelId,
          videoAspectRatio: channelConfig.videoAspectRatio
        });
      } else {
        logger.warn('Invalid channel config response, retaining current stream settings', {
          channelId,
          httpStatus: response.status,
          responseStatus: ['success', 'error'].includes(response.data?.status)
            ? response.data.status : 'invalid',
          elapsedMs: Date.now() - configRequestStartedAt
        });
      }
    } catch (error) {
      logger.warn('Failed to fetch channel config, retaining current stream settings', {
        channelId,
        errorCode: typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
          ? error.code : 'UNKNOWN',
        httpStatus: Number.isInteger(error.response?.status) ? error.response.status : null,
        elapsedMs: Date.now() - configRequestStartedAt
      });
    }

    // 启动观看，传递配置
    const hlsUrl = await streamManager.startWatching(channelId, rtmpUrl, channelConfig);
    
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
    
    // 在管理器的频道锁内完成重启，保留原录制模式及配置，避免先停频道再变成纯观看。
    const hlsUrl = await streamManager.restartChannel(channelId, rtmpUrl);

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
 * Body: { channelId, config } - config为可选，直接传递避免KV读取延迟
 */
router.post('/preload/reload-schedule', async (req, res) => {
  try {
    const { channelId, config } = req.body;
    
    logger.info('Reloading preload scheduler...', { 
      channelId, 
      hasDirectConfig: !!config,
      configEnabled: config?.enabled 
    });
    
    // 🔧 支持直接传递配置，避免KV最终一致性问题（复用录制功能的成功模式）
    if (config) {
      // 使用Workers直接传递的配置（最新的、准确的）
      await preloadScheduler.reloadScheduleWithConfig(channelId, config);
    } else {
      // 兼容旧方式：从Workers API重新读取所有配置
      await preloadScheduler.reload();
    }
    
    res.json({
      status: 'success',
      message: 'Preload schedule reloaded successfully',
      timestamp: new Date().toISOString(),
      debug: {
        usedDirectConfig: !!config
      }
    });
  } catch (error) {
    logger.error('Failed to reload preload schedule', { error: error.message });
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
module.exports = { 
  router, 
  streamManager, 
  preloadScheduler, 
  preloadHealthCheck,  // 🆕 导出healthCheck供app.js使用
  recordScheduler 
};
