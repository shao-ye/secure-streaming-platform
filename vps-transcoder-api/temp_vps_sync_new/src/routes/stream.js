const express = require('express');
const router = express.Router();
const ProcessManager = require('../services/ProcessManager');
const logger = require('../utils/logger');

// 创建ProcessManager实例
const processManager = new ProcessManager();

/**
 * 验证请求体参数
 */
const validateStreamRequest = (req, res, next) => {
  const { streamId, rtmpUrl } = req.body;

  if (!streamId || typeof streamId !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'streamId is required and must be a string',
      code: 'INVALID_STREAM_ID'
    });
  }

  if (!rtmpUrl || typeof rtmpUrl !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'rtmpUrl is required and must be a string',
      code: 'INVALID_RTMP_URL'
    });
  }

  // 验证streamId格式（只允许字母、数字、下划线、连字符）
  if (!/^[a-zA-Z0-9_-]+$/.test(streamId)) {
    return res.status(400).json({
      status: 'error',
      message: 'streamId can only contain letters, numbers, underscores and hyphens',
      code: 'INVALID_STREAM_ID_FORMAT'
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
 * POST /api/start-stream
 * 启动视频流转码
 */
router.post('/start-stream', validateStreamRequest, async (req, res) => {
  const { streamId, rtmpUrl } = req.body;
  const startTime = Date.now();

  try {
    logger.info('Received start-stream request', {
      streamId,
      rtmpUrl,
      clientIp: req.clientIp
    });

    // 启动转码流 - 修复参数顺序：rtmpUrl在前，streamId在后
    const result = await processManager.startStream(rtmpUrl, streamId);

    const responseTime = Date.now() - startTime;

    logger.info('Stream started successfully', {
      streamId,
      processId: result.processId,
      pid: result.pid,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: `Stream ${streamId} started successfully`,
      data: {
        streamId: result.streamId,
        processId: result.processId,
        pid: result.pid,
        hlsUrl: result.hlsUrl,
        outputDir: result.outputDir,
        responseTime: responseTime
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;

    logger.error('Failed to start stream', {
      streamId,
      rtmpUrl,
      error: error.message,
      stack: error.stack,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    // 根据错误类型返回适当的状态码
    let statusCode = 500;
    let errorCode = 'STREAM_START_ERROR';

    if (error.message.includes('timeout')) {
      statusCode = 504;
      errorCode = 'STREAM_START_TIMEOUT';
    } else if (error.message.includes('Connection refused') || 
               error.message.includes('No route to host')) {
      statusCode = 502;
      errorCode = 'RTMP_CONNECTION_ERROR';
    } else if (error.message.includes('required')) {
      statusCode = 400;
      errorCode = 'INVALID_PARAMETERS';
    }

    res.status(statusCode).json({
      status: 'error',
      message: `Failed to start stream ${streamId}: ${error.message}`,
      code: errorCode,
      data: {
        streamId,
        responseTime: responseTime
      }
    });
  }
});

/**
 * POST /api/stop-stream
 * 停止视频流转码
 */
router.post('/stop-stream', async (req, res) => {
  const { streamId } = req.body;
  const startTime = Date.now();

  try {
    if (!streamId || typeof streamId !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'streamId is required and must be a string',
        code: 'INVALID_STREAM_ID'
      });
    }

    logger.info('Received stop-stream request', {
      streamId,
      clientIp: req.clientIp
    });

    // 停止转码流
    const result = await processManager.stopStream(streamId);

    const responseTime = Date.now() - startTime;

    logger.info('Stream stopped successfully', {
      streamId,
      processId: result.processId,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: result.message || `Stream ${streamId} stopped successfully`,
      data: {
        streamId: result.streamId,
        processId: result.processId,
        responseTime: responseTime
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;

    logger.error('Failed to stop stream', {
      streamId,
      error: error.message,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: `Failed to stop stream ${streamId}: ${error.message}`,
      code: 'STREAM_STOP_ERROR',
      data: {
        streamId,
        responseTime: responseTime
      }
    });
  }
});

/**
 * GET /api/streams
 * 获取所有运行中的流
 */
router.get('/streams', async (req, res) => {
  try {
    const streams = processManager.getRunningStreams();

    logger.info('Retrieved running streams', {
      count: streams.length,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: 'Running streams retrieved successfully',
      data: {
        count: streams.length,
        streams: streams
      }
    });

  } catch (error) {
    logger.error('Failed to retrieve streams', {
      error: error.message,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve running streams',
      code: 'STREAMS_RETRIEVAL_ERROR'
    });
  }
});

/**
 * GET /api/stream/:streamId
 * 获取指定流的信息
 */
router.get('/stream/:streamId', async (req, res) => {
  const { streamId } = req.params;

  try {
    const streams = processManager.getRunningStreams();
    const stream = streams.find(s => s.streamId === streamId);

    if (!stream) {
      return res.status(404).json({
        status: 'error',
        message: `Stream ${streamId} not found`,
        code: 'STREAM_NOT_FOUND'
      });
    }

    logger.info('Retrieved stream info', {
      streamId,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: 'Stream information retrieved successfully',
      data: stream
    });

  } catch (error) {
    logger.error('Failed to retrieve stream info', {
      streamId,
      error: error.message,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve stream information',
      code: 'STREAM_INFO_ERROR'
    });
  }
});

module.exports = router;
