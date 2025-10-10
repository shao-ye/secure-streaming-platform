const express = require('express');
const router = express.Router();
const OnDemandStreamManager = require('../services/OnDemandStreamManager');
const logger = require('../utils/logger');

// 创建按需转码管理器实例
const streamManager = new OnDemandStreamManager();

/**
 * 验证频道配置请求参数
 */
const validateChannelConfig = (req, res, next) => {
  const { channelId, name, rtmpUrl } = req.body;

  if (!channelId || typeof channelId !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'channelId is required and must be a string',
      code: 'INVALID_CHANNEL_ID'
    });
  }

  if (!rtmpUrl || typeof rtmpUrl !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'rtmpUrl is required and must be a string',
      code: 'INVALID_RTMP_URL'
    });
  }

  // 验证channelId格式
  if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) {
    return res.status(400).json({
      status: 'error',
      message: 'channelId can only contain letters, numbers, underscores and hyphens',
      code: 'INVALID_CHANNEL_ID_FORMAT'
    });
  }

  // 验证RTMP URL格式
  if (!rtmpUrl.startsWith('rtmp://') && !rtmpUrl.startsWith('rtmps://')) {
    return res.status(400).json({
      status: 'error',
      message: 'rtmpUrl must be a valid RTMP URL (rtmp:// or rtmps://)',
      code: 'INVALID_RTMP_URL_FORMAT'
    });
  }

  next();
};

/**
 * POST /api/ondemand/configure-channel
 * 配置频道信息
 */
router.post('/configure-channel', validateChannelConfig, async (req, res) => {
  const { channelId, name, rtmpUrl } = req.body;
  const startTime = Date.now();

  try {
    logger.info('Configuring channel', {
      channelId,
      name,
      rtmpUrl,
      clientIp: req.clientIp
    });

    const result = streamManager.configureChannel(channelId, { name, rtmpUrl });
    const responseTime = Date.now() - startTime;

    logger.info('Channel configured successfully', {
      channelId,
      streamId: result.streamId,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: result.message,
      data: {
        channelId: result.channelId,
        streamId: result.streamId,
        responseTime: responseTime
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;

    logger.error('Failed to configure channel', {
      channelId,
      name,
      rtmpUrl,
      error: error.message,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: `Failed to configure channel: ${error.message}`,
      code: 'CHANNEL_CONFIG_ERROR',
      data: {
        channelId,
        responseTime: responseTime
      }
    });
  }
});

/**
 * POST /api/ondemand/start-watching
 * 用户开始观看频道（按需启动转码）
 */
router.post('/start-watching', async (req, res) => {
  const { channelId, userId } = req.body;
  const startTime = Date.now();

  try {
    if (!channelId || typeof channelId !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required and must be a string',
        code: 'INVALID_CHANNEL_ID'
      });
    }

    const clientInfo = {
      ip: req.clientIp || req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date()
    };

    logger.info('User starting to watch channel', {
      channelId,
      userId,
      clientIp: clientInfo.ip
    });

    const result = await streamManager.startWatching(channelId, userId, clientInfo);
    const responseTime = Date.now() - startTime;

    logger.info('User started watching successfully', {
      channelId,
      userId,
      sessionId: result.sessionId,
      isFirstViewer: result.isFirstViewer,
      totalViewers: result.totalViewers,
      streamStarted: result.streamStarted,
      responseTime: `${responseTime}ms`,
      clientIp: clientInfo.ip
    });

    res.json({
      status: 'success',
      message: result.message,
      data: {
        sessionId: result.sessionId,
        channelId: result.channelId,
        channelName: result.channelName,
        hlsUrl: result.hlsUrl,
        isFirstViewer: result.isFirstViewer,
        totalViewers: result.totalViewers,
        streamStarted: result.streamStarted,
        responseTime: responseTime
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;

    logger.error('Failed to start watching', {
      channelId,
      userId,
      error: error.message,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    let statusCode = 500;
    let errorCode = 'START_WATCHING_ERROR';

    if (error.message.includes('not configured')) {
      statusCode = 404;
      errorCode = 'CHANNEL_NOT_CONFIGURED';
    } else if (error.message.includes('Failed to start stream')) {
      statusCode = 502;
      errorCode = 'STREAM_START_ERROR';
    }

    res.status(statusCode).json({
      status: 'error',
      message: `Failed to start watching: ${error.message}`,
      code: errorCode,
      data: {
        channelId,
        responseTime: responseTime
      }
    });
  }
});

/**
 * POST /api/ondemand/stop-watching
 * 用户停止观看频道（可能触发转码停止）
 */
router.post('/stop-watching', async (req, res) => {
  const { channelId, sessionId } = req.body;
  const startTime = Date.now();

  try {
    if (!channelId || typeof channelId !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required and must be a string',
        code: 'INVALID_CHANNEL_ID'
      });
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'sessionId is required and must be a string',
        code: 'INVALID_SESSION_ID'
      });
    }

    logger.info('User stopping watching channel', {
      channelId,
      sessionId,
      clientIp: req.clientIp
    });

    const result = await streamManager.stopWatching(channelId, sessionId);
    const responseTime = Date.now() - startTime;

    logger.info('User stopped watching successfully', {
      channelId,
      sessionId,
      isLastViewer: result.isLastViewer,
      totalViewers: result.totalViewers,
      streamStopped: result.streamStopped,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: result.message,
      data: {
        channelId: result.channelId,
        sessionId: result.sessionId,
        isLastViewer: result.isLastViewer,
        totalViewers: result.totalViewers,
        streamStopped: result.streamStopped,
        responseTime: responseTime
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;

    logger.error('Failed to stop watching', {
      channelId,
      sessionId,
      error: error.message,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: `Failed to stop watching: ${error.message}`,
      code: 'STOP_WATCHING_ERROR',
      data: {
        channelId,
        sessionId,
        responseTime: responseTime
      }
    });
  }
});

/**
 * POST /api/ondemand/heartbeat
 * 更新观看者活动（心跳）
 */
router.post('/heartbeat', async (req, res) => {
  const { channelId, sessionId } = req.body;

  try {
    if (!channelId || !sessionId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId and sessionId are required',
        code: 'INVALID_PARAMETERS'
      });
    }

    const result = streamManager.updateViewerActivity(channelId, sessionId);

    res.json({
      status: 'success',
      message: result.message,
      data: {
        channelId,
        sessionId,
        updated: result.success
      }
    });

  } catch (error) {
    logger.error('Failed to update heartbeat', {
      channelId,
      sessionId,
      error: error.message,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: `Failed to update heartbeat: ${error.message}`,
      code: 'HEARTBEAT_ERROR'
    });
  }
});

/**
 * GET /api/ondemand/channel/:channelId
 * 获取频道状态
 */
router.get('/channel/:channelId', async (req, res) => {
  const { channelId } = req.params;

  try {
    const channelStatus = streamManager.getChannelStatus(channelId);

    if (!channelStatus) {
      return res.status(404).json({
        status: 'error',
        message: `Channel ${channelId} not found`,
        code: 'CHANNEL_NOT_FOUND'
      });
    }

    logger.info('Retrieved channel status', {
      channelId,
      viewerCount: channelStatus.viewerCount,
      isStreaming: channelStatus.isStreaming,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: 'Channel status retrieved successfully',
      data: channelStatus
    });

  } catch (error) {
    logger.error('Failed to retrieve channel status', {
      channelId,
      error: error.message,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve channel status',
      code: 'CHANNEL_STATUS_ERROR'
    });
  }
});

/**
 * GET /api/ondemand/channels
 * 获取所有频道状态
 */
router.get('/channels', async (req, res) => {
  try {
    const channels = streamManager.getAllChannelsStatus();

    logger.info('Retrieved all channels status', {
      count: channels.length,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: 'All channels status retrieved successfully',
      data: {
        count: channels.length,
        channels: channels
      }
    });

  } catch (error) {
    logger.error('Failed to retrieve all channels status', {
      error: error.message,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve channels status',
      code: 'CHANNELS_STATUS_ERROR'
    });
  }
});

/**
 * GET /api/ondemand/stats
 * 获取系统统计信息
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = streamManager.getSystemStats();

    logger.info('Retrieved system stats', {
      totalChannels: stats.channels.total,
      streamingChannels: stats.channels.streaming,
      totalViewers: stats.viewers.totalViewers,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: 'System statistics retrieved successfully',
      data: stats
    });

  } catch (error) {
    logger.error('Failed to retrieve system stats', {
      error: error.message,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve system statistics',
      code: 'SYSTEM_STATS_ERROR'
    });
  }
});

module.exports = router;
