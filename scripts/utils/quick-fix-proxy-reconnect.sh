#!/bin/bash

# 代理重连后视频播放失败 - 快速修复脚本
# 基于之前的经验，专门解决代理重连导致的问题

echo "🔧 代理重连后视频播放失败 - 快速修复"
echo "执行时间: $(date)"

# 1. 检查并删除问题备份文件
echo "1. 清理问题备份文件..."
rm -f /opt/yoyo-transcoder/src/routes/status.js.backup
rm -f /opt/yoyo-transcoder/src/routes/status.js.broken  
rm -f /opt/yoyo-transcoder/src/routes/simple-stream.js.backup
rm -f /opt/yoyo-transcoder/src/routes/simple-stream.js.broken

# 2. 检查关键文件内容
echo "2. 检查关键文件..."

# 检查simple-stream.js是否包含CHANNEL_RTMP_MAP
if ! grep -q "CHANNEL_RTMP_MAP" /opt/yoyo-transcoder/src/routes/simple-stream.js; then
    echo "❌ simple-stream.js缺少CHANNEL_RTMP_MAP，正在修复..."
    
    # 重写simple-stream.js
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

router.get('/system/status', (req, res) => {
  try {
    const activeStreams = streamManager.getActiveStreams();
    
    res.json({
      status: 'success',
      data: {
        activeStreams: activeStreams.size,
        totalSessions: Array.from(activeStreams.values()).reduce((total, stream) => total + (stream.sessions || 0), 0),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to get system status', { error: error.message });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get system status',
      error: error.message
    });
  }
});

module.exports = { router };
EOF
    echo "✅ simple-stream.js已修复"
else
    echo "✅ simple-stream.js内容正确"
fi

# 检查status.js是否使用safeLogger
if ! grep -q "safeLogger" /opt/yoyo-transcoder/src/routes/status.js; then
    echo "❌ status.js未使用safeLogger，正在修复..."
    
    # 重写status.js
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
    echo "✅ status.js已修复"
else
    echo "✅ status.js内容正确"
fi

# 3. 重启PM2服务
echo "3. 重启PM2服务..."
pm2 restart vps-transcoder-api
sleep 3

# 4. 快速验证
echo "4. 快速验证..."

# 测试健康检查
health_status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "$health_status" = "200" ]; then
    echo "✅ 健康检查正常"
else
    echo "❌ 健康检查异常 (HTTP $health_status)"
fi

# 测试simple-stream状态
stream_status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/simple-stream/system/status)
if [ "$stream_status" = "200" ]; then
    echo "✅ simple-stream端点正常"
else
    echo "❌ simple-stream端点异常 (HTTP $stream_status)"
fi

echo ""
echo "🎉 快速修复完成！"
echo "如果问题仍然存在，请："
echo "1. 检查浏览器控制台的详细错误信息"
echo "2. 确认前端已部署最新版本"
echo "3. 检查认证token是否有效"
echo "4. 尝试清除浏览器缓存后重新登录"
