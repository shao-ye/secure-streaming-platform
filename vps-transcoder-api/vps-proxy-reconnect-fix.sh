#!/bin/bash

# VPS代理重连后代码一致性修复脚本
# 解决代理重连导致视频播放失败的问题

echo "=== VPS代理重连后代码一致性修复 ==="

# 1. 删除有问题的备份文件
echo "1. 清理错误的备份文件..."
rm -f /opt/yoyo-transcoder/src/routes/status.js.backup
rm -f /opt/yoyo-transcoder/src/routes/status.js.broken
rm -f /opt/yoyo-transcoder/src/routes/simple-stream.js.backup
rm -f /opt/yoyo-transcoder/src/routes/simple-stream.js.broken

# 2. 确保正确的status.js文件
echo "2. 确保status.js文件正确..."
cat > /opt/yoyo-transcoder/src/routes/status.js << 'EOF'
const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');

// 安全的日志函数，避免logger初始化问题
const safeLogger = {
  info: (msg, data) => console.log('INFO:', msg, data ? JSON.stringify(data) : ''),
  warn: (msg, data) => console.warn('WARN:', msg, data ? JSON.stringify(data) : ''),
  error: (msg, data) => console.error('ERROR:', msg, data ? JSON.stringify(data) : '')
};

// 安全的健康检查端点 - 不依赖任何外部模块
router.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        freemem: os.freemem(),
        totalmem: os.totalmem()
      },
      services: {
        express: 'running',
        node: process.version
      }
    };
    
    // 检查HLS目录是否存在（安全方式）
    try {
      const hlsDir = process.env.HLS_OUTPUT_DIR || './hls';
      const hlsPath = path.resolve(hlsDir);
      if (fs.existsSync(hlsPath)) {
        healthStatus.services.hls_directory = 'available';
      } else {
        healthStatus.services.hls_directory = 'missing';
      }
    } catch (error) {
      healthStatus.services.hls_directory = 'error';
    }
    
    safeLogger.info('Health check performed', { status: 'healthy' });
    res.json(healthStatus);
  } catch (error) {
    safeLogger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
EOF

# 3. 确保正确的simple-stream.js文件
echo "3. 确保simple-stream.js文件正确..."
cat > /opt/yoyo-transcoder/src/routes/simple-stream.js << 'EOF'
const express = require('express');
const SimpleStreamManager = require('../services/SimpleStreamManager');
const logger = require('../utils/logger');

const router = express.Router();
const streamManager = new SimpleStreamManager();

const CHANNEL_RTMP_MAP = {
  'stream_gkg5hknc': 'rtmp://58.200.131.2:1935/livetv/hunantv',
  'stream_2': 'rtmp://58.200.131.2:1935/livetv/cctv1',
  'stream_1': 'rtmp://58.200.131.2:1935/livetv/cctv2'
};

router.post('/start-watching', async (req, res) => {
  try {
    const { channelId, rtmpUrl } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    let finalRtmpUrl = rtmpUrl;
    if (!finalRtmpUrl) {
      finalRtmpUrl = CHANNEL_RTMP_MAP[channelId];
      if (!finalRtmpUrl) {
        return res.status(400).json({
          status: 'error',
          message: 'No RTMP URL found for channelId: ' + channelId
        });
      }
    }
    
    logger.info('Starting stream with channel mapping', { 
      channelId, 
      rtmpUrl: finalRtmpUrl 
    });
    
    const hlsUrl = await streamManager.startWatching(channelId, finalRtmpUrl);
    
    res.json({
      status: 'success',
      message: 'Started watching successfully',
      data: {
        channelId,
        hlsUrl,
        rtmpUrl: finalRtmpUrl
      }
    });
    
  } catch (error) {
    logger.error('Failed to start watching', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to start stream',
      error: error.message
    });
  }
});

router.post('/stop-watching', async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    await streamManager.stopWatching(channelId);
    
    res.json({
      status: 'success',
      message: 'Stopped watching successfully'
    });
    
  } catch (error) {
    logger.error('Failed to stop watching', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to stop stream',
      error: error.message
    });
  }
});

router.post('/heartbeat', async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    const isActive = streamManager.updateHeartbeat(channelId);
    
    res.json({
      status: 'success',
      data: {
        channelId,
        isActive,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Heartbeat failed', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Heartbeat failed',
      error: error.message
    });
  }
});

router.get('/status', (req, res) => {
  try {
    const activeStreams = streamManager.getActiveStreams();
    
    res.json({
      status: 'success',
      data: {
        activeStreams: Array.from(activeStreams.entries()).map(([channelId, info]) => ({
          channelId,
          rtmpUrl: info.rtmpUrl,
          hlsUrl: info.hlsUrl,
          startTime: info.startTime,
          lastHeartbeat: streamManager.getLastHeartbeat(channelId)
        })),
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Failed to get status', { error: error.message });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get status',
      error: error.message
    });
  }
});

module.exports = { router };
EOF

# 4. 设置文件保护
echo "4. 设置文件保护..."
chattr +i /opt/yoyo-transcoder/src/routes/status.js 2>/dev/null || echo "注意：无法设置文件不可变属性"
chattr +i /opt/yoyo-transcoder/src/routes/simple-stream.js 2>/dev/null || echo "注意：无法设置文件不可变属性"

# 5. 重启PM2服务
echo "5. 重启PM2服务..."
cd /opt/yoyo-transcoder
pm2 delete vps-transcoder-api 2>/dev/null || true
pm2 start ecosystem.config.js

# 6. 验证服务状态
echo "6. 验证服务状态..."
sleep 3
pm2 status

echo "✅ VPS代理重连修复完成！"
echo "📝 建议：将此脚本添加到代理重连后的自动执行任务中"
