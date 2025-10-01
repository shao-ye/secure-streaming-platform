# VPS转码API完整重新部署指南

## 🎯 部署目标
修复VPS服务器上缺失的API端点，确保RTMP转码功能正常工作。

## 📋 当前问题
- ✅ VPS服务器运行正常 (https://yoyo-vps.5202021.xyz)
- ✅ 健康检查端点 `/health` 工作正常
- ❌ 所有 `/api/*` 端点返回404错误
- ❌ 缺少关键端点：`/api/start-stream`, `/api/stop-stream`, `/api/streams`

## 🔧 部署步骤

### 步骤1: 连接到VPS服务器
```bash
ssh -p 52535 root@yoyo-vps.5202021.xyz
```

### 步骤2: 检查当前服务状态
```bash
# 检查PM2进程状态
pm2 status

# 查看应用日志
pm2 logs vps-transcoder-api --lines 20

# 检查应用目录
cd /opt/yoyo-transcoder
ls -la src/routes/
```

### 步骤3: 备份现有文件
```bash
cd /opt/yoyo-transcoder
cp -r src/routes src/routes.backup.$(date +%Y%m%d_%H%M%S)
```

### 步骤4: 创建缺失的API路由文件

#### 4.1 创建主API路由文件
```bash
cat > src/routes/api.js << 'EOF'
/**
 * VPS Transcoder API Routes
 * 整合所有API端点的主路由文件
 */

const express = require('express');
const router = express.Router();

// 导入子路由
const streamRoutes = require('./stream');
const statusRoutes = require('./status');

// API密钥验证中间件
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedApiKey = process.env.API_KEY;

  // 如果配置了API密钥，则进行验证
  if (expectedApiKey && apiKey !== expectedApiKey) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or missing API key',
      code: 'UNAUTHORIZED'
    });
  }

  next();
};

// 客户端IP记录中间件
const clientIpMiddleware = (req, res, next) => {
  req.clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
                 (req.connection.socket ? req.connection.socket.remoteAddress : null);
  next();
};

// 应用中间件
router.use(clientIpMiddleware);
router.use(apiKeyAuth);

// 基础状态端点
router.get('/status', (req, res) => {
  res.json({
    status: 'running',
    message: 'VPS Transcoder API is operational',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// 挂载子路由
router.use('/', streamRoutes);  // 流处理路由: /api/start-stream, /api/stop-stream, /api/streams
router.use('/', statusRoutes);  // 系统状态路由: /api/system/status 等

module.exports = router;
EOF
```

#### 4.2 验证stream.js文件存在且完整
```bash
# 检查stream.js文件
ls -la src/routes/stream.js

# 查看文件内容（应该包含start-stream, stop-stream等端点）
head -50 src/routes/stream.js
```

如果stream.js文件不完整，请创建：
```bash
cat > src/routes/stream.js << 'EOF'
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

    // 启动转码流
    const result = await processManager.startStream(streamId, rtmpUrl);

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
EOF
```

### 步骤5: 检查依赖服务和文件

#### 5.1 验证ProcessManager服务
```bash
ls -la src/services/ProcessManager.js
```

#### 5.2 验证logger工具
```bash
ls -la src/utils/logger.js
```

#### 5.3 检查环境变量配置
```bash
cat .env
```

确保包含以下配置：
```
API_KEY=85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938
HLS_OUTPUT_DIR=/var/www/hls
LOG_DIR=/var/log/transcoder
NODE_ENV=production
```

### 步骤6: 重启服务
```bash
# 重启PM2服务
pm2 restart vps-transcoder-api

# 等待服务启动
sleep 5

# 检查服务状态
pm2 status

# 查看启动日志
pm2 logs vps-transcoder-api --lines 20
```

### 步骤7: 验证API端点

#### 7.1 测试健康检查
```bash
curl -k https://yoyo-vps.5202021.xyz/health
```

#### 7.2 测试API状态端点
```bash
curl -k -H "X-API-Key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938" \
  https://yoyo-vps.5202021.xyz/api/status
```

#### 7.3 测试start-stream端点
```bash
curl -k -X POST https://yoyo-vps.5202021.xyz/api/start-stream \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938" \
  -d '{"streamId":"test_stream","rtmpUrl":"rtmp://test.example.com/live/test"}'
```

#### 7.4 测试streams列表端点
```bash
curl -k -H "X-API-Key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938" \
  https://yoyo-vps.5202021.xyz/api/streams
```

## 🔍 故障排除

### 如果API端点仍然返回404
1. **检查文件权限**：
   ```bash
   chmod 644 src/routes/api.js
   chmod 644 src/routes/stream.js
   ```

2. **检查Node.js模块加载**：
   ```bash
   cd /opt/yoyo-transcoder
   node -e "console.log(require('./src/routes/api'))"
   ```

3. **重新安装依赖**：
   ```bash
   npm install
   ```

4. **完全重启应用**：
   ```bash
   pm2 delete vps-transcoder-api
   pm2 start ecosystem.config.js
   ```

### 如果ProcessManager报错
1. **检查FFmpeg安装**：
   ```bash
   which ffmpeg
   ffmpeg -version
   ```

2. **检查HLS输出目录权限**：
   ```bash
   ls -la /var/www/hls
   chmod 755 /var/www/hls
   ```

3. **检查日志目录权限**：
   ```bash
   ls -la /var/log/transcoder
   chmod 755 /var/log/transcoder
   ```

## ✅ 验证成功标准

部署成功后，您应该看到：

1. **健康检查正常**：
   ```json
   {"status":"healthy","timestamp":"...","uptime":...}
   ```

2. **API状态正常**：
   ```json
   {"status":"running","message":"VPS Transcoder API is operational"}
   ```

3. **start-stream端点响应**（即使参数错误也应该返回400而不是404）：
   ```json
   {"status":"error","message":"...","code":"INVALID_RTMP_URL_FORMAT"}
   ```

4. **streams列表正常**：
   ```json
   {"status":"success","message":"Running streams retrieved successfully","data":{"count":0,"streams":[]}}
   ```

## 📞 联系信息

部署完成后，请运行以下测试脚本验证：
```bash
node "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\scripts\simple-test.js"
```

如果所有API端点都返回200或400状态码（而不是404），说明部署成功！

## 🚨 重要提醒

- **备份重要**：部署前一定要备份现有文件
- **权限检查**：确保所有文件和目录权限正确
- **服务重启**：修改代码后必须重启PM2服务
- **日志监控**：部署后持续监控PM2日志确保无错误

完成VPS部署后，我将负责完成Cloudflare Pages和Workers的部署配置！
