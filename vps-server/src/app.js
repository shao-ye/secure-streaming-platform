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

// 信任代理配置 - 因为VPS前面有Cloudflare代理，必须启用
app.set('trust proxy', true);

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
        version: process.env.npm_package_version || '2.1.0'
    });
});

// API路由 - 每个路由独立加载，避免相互影响
// 🔥 新增：集成流媒体服务API（简化版）
try {
  const { router: integratedStreamingRoutes } = require('./routes/integrated-streaming-simple');
  app.use('/api/integrated-streaming', integratedStreamingRoutes);
  logger.info('✅ 集成流媒体服务API路由已加载（简化版）');
} catch (error) {
  logger.warn('集成流媒体服务API加载失败:', error.message);
}

// 使用新的简化流管理API（向后兼容）
let streamManager = null;
let preloadScheduler = null;  // 🆕 保存到外部作用域，供服务器启动回调使用
let preloadHealthCheck = null;
let recordScheduler = null;

try {
  logger.info('开始加载简化流管理模块...');
  const simpleStreamModule = require('./routes/simple-stream');
  logger.info('模块加载成功，开始初始化组件...');
  streamManager = simpleStreamModule.streamManager;
  preloadScheduler = simpleStreamModule.preloadScheduler;
  preloadHealthCheck = simpleStreamModule.preloadHealthCheck;
  recordScheduler = simpleStreamModule.recordScheduler;
  logger.info('组件初始化完成，注册路由...');
  
  app.use('/api/simple-stream', simpleStreamModule.router);
  logger.info('路由注册完成');
  
  // 🆕 将workdayChecker注册到app，供其他路由访问
  if (preloadScheduler && preloadScheduler.workdayChecker) {
    app.set('workdayChecker', preloadScheduler.workdayChecker);
    logger.info('✅ WorkdayChecker registered to app');
  }
  
  logger.info('✅ 简化流管理API路由已加载');
} catch (error) {
  logger.error('简化流管理API路由加载失败:', error.message);
  logger.error('错误堆栈:', error.stack);
}

// 🆕 预加载管理API路由
try {
  const preloadRoutes = require('./routes/preload');
  app.use('/api/preload', preloadRoutes);
  logger.info('✅ 预加载管理API路由已加载');
} catch (error) {
  logger.error('预加载管理API路由加载失败:', error.message);
}

// 🆕 中国移动云盘API路由
try {
  const cloudDriveRoutes = require('./routes/cloud-drive');
  app.use('/api/cloud-drive', cloudDriveRoutes);
  logger.info('✅ 中国移动云盘API路由已加载');
} catch (error) {
  logger.error('中国移动云盘API路由加载失败:', error.message);
}

// 🆕 视频清理服务
let videoCleanupScheduler = null;
let recoveryService = null;  // 🆕 录制文件恢复服务全局引用
try {
  const VideoCleanupScheduler = require('./services/VideoCleanupScheduler');
  videoCleanupScheduler = new VideoCleanupScheduler();
  
  // 启动清理调度器
  videoCleanupScheduler.start()
    .then(() => {
      logger.info('✅ 视频清理调度器已启动');
    })
    .catch((error) => {
      logger.error('视频清理调度器启动失败:', error.message);
    });
  
  // 手动触发清理API端点
  app.post('/api/admin/cleanup/execute', async (req, res) => {
    try {
      // API Key验证
      const apiKey = req.headers['x-api-key'];
      if (!apiKey || apiKey !== process.env.VPS_API_KEY) {
        return res.status(401).json({
          status: 'error',
          message: 'Unauthorized'
        });
      }
      
      const result = await videoCleanupScheduler.executeCleanup();
      
      res.json({
        status: 'success',
        data: result
      });
    } catch (error) {
      logger.error('手动清理执行失败:', error);
      res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  });
  
  logger.info('✅ 视频清理API端点已注册');
} catch (error) {
  logger.error('视频清理服务加载失败:', error.message);
}

// 🆕 录制文件恢复手动触发API端点
app.post('/api/admin/recovery/execute', async (req, res) => {
  try {
    // API Key验证
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.VPS_API_KEY) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized'
      });
    }
    
    if (!recoveryService) {
      return res.status(503).json({
        status: 'error',
        message: 'Recovery service not initialized'
      });
    }
    
    // 手动触发恢复
    logger.info('🔧 手动触发录制文件恢复...');
    await recoveryService.runRecovery();
    
    res.json({
      status: 'success',
      message: 'Recovery completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('手动恢复执行失败:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});
logger.info('✅ 录制文件恢复API端点已注册');

// 🆕 录制文件恢复服务 - 在app启动后初始化
let RecordingRecoveryService = null;
try {
  RecordingRecoveryService = require('./services/RecordingRecoveryService');
  logger.info('📦 RecordingRecoveryService模块加载成功');
} catch (error) {
  logger.error('❌ RecordingRecoveryService模块加载失败', { 
    error: error.message,
    stack: error.stack,
    code: error.code
  });
}

// 代理管理API路由
try {
  const proxyRoutes = require('./routes/proxy');
  app.use('/api/proxy', proxyRoutes);
  logger.info('✅ 代理管理API路由已加载');
} catch (error) {
  logger.error('代理管理API路由加载失败:', error.message);
}

// 日志管理API路由
try {
  const logsRoutes = require('./routes/logs');
  app.use('/api/logs', logsRoutes);
  logger.info('✅ 日志管理API路由已加载');
} catch (error) {
  logger.error('日志管理API路由加载失败:', error.message);
}

// 部署管理API路由
try {
  const deploymentRoutes = require('./routes/deployment');
  app.use('/api/deployment', deploymentRoutes);
  logger.info('✅ 部署管理API路由已加载');
} catch (error) {
  logger.error('部署管理API路由加载失败:', error.message);
}

// 保留原有API路由（向后兼容）
try {
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

// 声明videoCleanupScheduler（在外部作用域，供gracefulShutdown访问）
// videoCleanupScheduler在上面的try块中已初始化

// 优雅退出处理
const gracefulShutdown = async (signal) => {
    logger.info(`${signal} received, shutting down gracefully...`);

    try {
        // 停止所有流
        await processManager.stopAllStreams();
        logger.info('All streams stopped');
        
        // 停止视频清理调度器
        if (videoCleanupScheduler) {
            await videoCleanupScheduler.stop();
            logger.info('Video cleanup scheduler stopped');
        }
        
        logger.info('Graceful shutdown completed, exiting process');
        process.exit(0);
    } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
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
    app.listen(PORT, '0.0.0.0', async () => {
        logger.info(`🚀 VPS Transcoder API Server is running on port ${PORT}`);
        logger.info(`📊 Environment: ${NODE_ENV}`);
        logger.info(`📁 HLS Output Directory: ${hlsDir}`);
        logger.info(`🔐 API Security: ${process.env.ENABLE_IP_WHITELIST === 'true' ? 'Enabled' : 'Disabled'}`);
        
        // 🆕 启动PreloadScheduler（在服务器启动后，确保单次执行）
        if (preloadScheduler) {
          try {
            logger.info('🔄 Starting PreloadScheduler...');
            await preloadScheduler.start();
            logger.info('✅ PreloadScheduler started successfully');
            
            // 启动健康检查
            if (preloadHealthCheck) {
              preloadHealthCheck.start();
              logger.info('✅ PreloadHealthCheck started successfully');
            }
          } catch (error) {
            logger.error('❌ Failed to start PreloadScheduler', { 
              error: error.message,
              stack: error.stack 
            });
          }
        }
        
        // 🆕 启动RecordScheduler
        if (recordScheduler) {
          try {
            logger.info('🔄 Starting RecordScheduler...');
            await recordScheduler.start();
            logger.info('✅ RecordScheduler started successfully');
          } catch (error) {
            logger.error('❌ Failed to start RecordScheduler', { 
              error: error.message,
              stack: error.stack 
            });
          }
        }
        
        // 🆕 服务启动后初始化Recovery Service
        if (RecordingRecoveryService && streamManager) {
          try {
            // 使用默认配置（或从环境变量读取）
            const systemConfig = {
              recoveryScanHours: parseInt(process.env.RECOVERY_SCAN_HOURS) || 48
            };
            
            // 🔥 保存到全局变量，供手动触发API使用
            recoveryService = new RecordingRecoveryService(streamManager, systemConfig);
            recoveryService.startup();
            
            logger.info('✅ 录制文件恢复服务已启动', {
              scanRecentHours: systemConfig.recoveryScanHours,
              recordingsPath: process.env.RECORDINGS_PATH || '/srv/filebrowser/yoyo-k'
            });
          } catch (error) {
            logger.error('录制文件恢复服务启动失败:', error.message, error.stack);
          }
        } else {
          if (!RecordingRecoveryService) {
            logger.warn('⚠️ RecordingRecoveryService模块未加载');
          }
          if (!streamManager) {
            logger.warn('⚠️ StreamManager未初始化，跳过录制文件恢复服务');
          }
        }
    });
}

module.exports = app;
