/**
 * VPS Transcoder API Main Application
 */

// 环境变量加载
require('dotenv').config();

// 核心模块导入
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// 内部模块导入
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const ProcessManager = require('./services/ProcessManager');

// 创建Express应用
const app = express();

// 环境变量
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// 创建必要的目录
const hlsDir = process.env.HLS_OUTPUT_DIR || './hls';
const logsDir = process.env.LOG_DIR || './logs';

if (!fs.existsSync(hlsDir)) {
    fs.mkdirSync(hlsDir, { recursive: true });
    logger.info(`Created HLS output directory: ${hlsDir}`);
}

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    logger.info(`Created logs directory: ${logsDir}`);
}

// 安全中间件
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false
}));

// 信任代理配置 - 在VPS直连环境下禁用，避免rate limiting安全警告
app.set('trust proxy', false);

// CORS配置
app.use(cors({
    origin: NODE_ENV === 'development' ? true : process.env.ALLOWED_ORIGINS?.split(',') || [],
    credentials: true
}));

// 请求解析中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 日志中间件
if (NODE_ENV !== 'test') {
    app.use(morgan('combined', {
        stream: {
            write: (message) => logger.info(message.trim())
        }
    }));
}

// 速率限制 - 临时禁用以排除配置问题
// const limiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15分钟
//     max: NODE_ENV === 'development' ? 1000 : 100,
//     message: {
//         error: 'Too many requests from this IP, please try again later.'
//     },
//     standardHeaders: true,
//     legacyHeaders: false,
//     trustProxy: false,
//     skip: (req) => {
//         const clientIp = req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip;
//         return clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
//     }
// });

// app.use('/api/', limiter);

// 静态文件服务 - HLS文件
app.use('/hls', express.static(hlsDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.m3u8')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.ts')) {
            res.setHeader('Content-Type', 'video/mp2t');
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: NODE_ENV,
        version: process.env.npm_package_version || '1.0.0'
    });
});

// API路由
try {
    // 🔥 新增：集成流媒体服务API（简化版）
    try {
      const { router: integratedStreamingRoutes } = require('./routes/integrated-streaming-simple');
      app.use('/api/integrated-streaming', integratedStreamingRoutes);
      logger.info('✅ 集成流媒体服务API路由已加载（简化版）');
    } catch (error) {
      logger.warn('集成流媒体服务API加载失败，使用基础API:', error.message);
    }
    
    // 使用新的简化流管理API（向后兼容）
    const { router: simpleStreamRoutes } = require('./routes/simple-stream');
    app.use('/api/simple-stream', simpleStreamRoutes);
    logger.info('✅ 简化流管理API路由已加载');
    
    // 代理管理API路由
    const proxyRoutes = require('./routes/proxy');
    app.use('/api/proxy', proxyRoutes);
    logger.info('✅ 代理管理API路由已加载');
    
    // 部署管理API路由
    const deploymentRoutes = require('./routes/deployment');
    app.use('/api/deployment', deploymentRoutes);
    logger.info('✅ 部署管理API路由已加载');
    
    // 保留原有API路由（向后兼容）
    const apiRoutes = require('./routes/api');
    app.use('/api', apiRoutes);
    logger.info('✅ 基础API路由已加载');
} catch (error) {
    logger.warn('API routes not found, creating basic structure...', error.message);

    // 基础API端点
    app.get('/api/status', (req, res) => {
        res.json({
            status: 'running',
            message: 'VPS Transcoder API is operational',
            timestamp: new Date().toISOString(),
            version: '2.0.0'
        });
    });
}

// 404处理
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        message: `${req.method} ${req.originalUrl} is not a valid endpoint`
    });
});

// 错误处理中间件
app.use(errorHandler);

// 创建ProcessManager实例
const processManager = new ProcessManager();

// 优雅退出处理
const gracefulShutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully...`);

    processManager.stopAllStreams()
        .then(() => {
            logger.info('All streams stopped, exiting process');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('Error stopping streams during shutdown:', error);
            process.exit(1);
        });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 未捕获异常处理
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// 启动服务器
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`🚀 VPS Transcoder API Server is running on port ${PORT}`);
        logger.info(`📊 Environment: ${NODE_ENV}`);
        logger.info(`📁 HLS Output Directory: ${hlsDir}`);
        logger.info(`🔐 API Security: ${process.env.ENABLE_IP_WHITELIST === 'true' ? 'Enabled' : 'Disabled'}`);
    });
}

module.exports = app;
