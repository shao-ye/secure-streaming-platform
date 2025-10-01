# VPS API路由部署指南

## 问题描述
VPS服务器上缺少 `/api/start-stream` 端点，导致播放请求失败。本地已创建了完整的API路由文件，需要部署到VPS服务器。

## 当前状态
- ✅ VPS服务器运行正常 (https://yoyo-vps.5202021.xyz)
- ✅ VPS_API_KEY配置已修复
- ✅ VPS健康检查返回"healthy"状态
- ❌ 缺少 `/api/start-stream` 端点
- ❌ 本地创建的 `api.js` 路由文件未部署到VPS

## 需要部署的文件
**文件位置**: `D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api\src\routes\api.js`

**目标位置**: VPS服务器上的 `/opt/yoyo-transcoder/src/routes/api.js`

## 手动部署步骤

### 方法1: 通过SSH部署 (推荐)
```bash
# 1. 连接到VPS服务器
ssh -p 52535 root@yoyo-vps.5202021.xyz

# 2. 备份现有文件
cd /opt/yoyo-transcoder/src/routes
cp api.js api.js.backup 2>/dev/null || echo "api.js不存在，将创建新文件"

# 3. 创建新的api.js文件
cat > api.js << 'EOF'
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

# 4. 重启PM2服务
pm2 restart vps-transcoder-api

# 5. 检查服务状态
pm2 status
pm2 logs vps-transcoder-api --lines 20
```

### 方法2: 通过SCP上传文件
```bash
# 从本地上传api.js文件到VPS
scp -P 52535 "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api\src\routes\api.js" root@yoyo-vps.5202021.xyz:/opt/yoyo-transcoder/src/routes/

# 然后SSH连接重启服务
ssh -p 52535 root@yoyo-vps.5202021.xyz "pm2 restart vps-transcoder-api"
```

### 方法3: 通过Web界面 (如果有文件管理器)
1. 登录VPS的Web管理界面
2. 导航到 `/opt/yoyo-transcoder/src/routes/` 目录
3. 上传或创建 `api.js` 文件
4. 重启PM2服务

## 验证部署结果

### 1. 测试API端点可用性
```bash
# 测试start-stream端点
curl -k -X POST https://yoyo-vps.5202021.xyz/api/start-stream \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938" \
  -d '{"streamId":"test_stream","rtmpUrl":"rtmp://test.example.com/live/test"}'
```

### 2. 预期结果
- **成功**: 返回状态码 200 或 400 (参数验证错误)
- **失败**: 返回状态码 404 "Endpoint not found"

### 3. 运行完整测试
```bash
node "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\scripts\simple-test.js"
```

## 故障排除

### 如果部署后仍然404
1. 检查文件权限: `ls -la /opt/yoyo-transcoder/src/routes/api.js`
2. 检查PM2日志: `pm2 logs vps-transcoder-api`
3. 检查Node.js进程: `ps aux | grep node`
4. 手动重启: `pm2 delete vps-transcoder-api && pm2 start ecosystem.config.js`

### 如果SSH连接超时
1. 检查VPS防火墙设置
2. 确认SSH端口52535是否开放
3. 尝试通过VPS提供商的Web控制台连接

## 重要提醒
- 部署前请备份现有文件
- 确保PM2服务正常重启
- 验证所有API端点都正常工作
- 如有问题，可以恢复备份文件

## 联系信息
- VPS域名: yoyo-vps.5202021.xyz
- SSH端口: 52535
- API密钥: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938
- 应用目录: /opt/yoyo-transcoder
