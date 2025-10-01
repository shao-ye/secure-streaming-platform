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
