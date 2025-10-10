const express = require('express');
const router = express.Router();
const ProcessManager = require('../services/ProcessManager');
const logger = require('../utils/logger');
const fs = require('fs');
const os = require('os');

// 创建ProcessManager实例
const processManager = new ProcessManager();

/**
 * GET /api/status
 * 获取系统状态信息
 */
router.get('/status', async (req, res) => {
  try {
    // 获取系统基本信息
    const systemStatus = processManager.getSystemStatus();

    // 获取系统资源信息
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // 获取系统负载信息
    const loadAverage = os.loadavg();

    // 获取磁盘空间信息（HLS目录）
    let diskInfo = null;
    try {
      const stats = fs.statSync(systemStatus.hlsOutputDir);
      diskInfo = {
        hlsDirectory: systemStatus.hlsOutputDir,
        exists: true,
        isDirectory: stats.isDirectory(),
        permissions: stats.mode.toString(8)
      };
    } catch (error) {
      diskInfo = {
        hlsDirectory: systemStatus.hlsOutputDir,
        exists: false,
        error: error.message
      };
    }

    const statusData = {
      service: {
        name: 'VPS Transcoder API',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        startTime: new Date(Date.now() - process.uptime() * 1000).toISOString()
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        hostname: os.hostname(),
        loadAverage: {
          '1min': loadAverage[0],
          '5min': loadAverage[1],
          '15min': loadAverage[2]
        },
        cpu: {
          count: os.cpus().length,
          usage: cpuUsage
        }
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        process: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers
        }
      },
      streams: {
        total: systemStatus.totalStreams,
        running: systemStatus.runningStreams,
        hlsOutputDir: systemStatus.hlsOutputDir,
        disk: diskInfo
      },
      ffmpeg: {
        path: systemStatus.ffmpegPath
      },
      timestamp: new Date().toISOString()
    };

    logger.info('System status requested', {
      totalStreams: systemStatus.totalStreams,
      uptime: process.uptime(),
      memoryUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: 'System status retrieved successfully',
      data: statusData
    });

  } catch (error) {
    logger.error('Failed to retrieve system status', {
      error: error.message,
      stack: error.stack,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve system status',
      code: 'STATUS_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/health
 * 健康检查端点（详细版本，需要认证）
 */
router.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();

    // 检查FFmpeg是否可用
    let ffmpegAvailable = false;
    try {
      const { spawn } = require('child_process');
      const ffmpegProcess = spawn(processManager.ffmpegPath || 'ffmpeg', ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ffmpegProcess.kill();
          reject(new Error('FFmpeg check timeout'));
        }, 5000);

        ffmpegProcess.on('exit', (code) => {
          clearTimeout(timeout);
          ffmpegAvailable = (code === 0);
          resolve();
        });

        ffmpegProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      logger.warn('FFmpeg availability check failed', error);
    }

    // 检查HLS输出目录
    let hlsDirectoryWritable = false;
    try {
      const testFile = `${processManager.hlsOutputDir}/health-check-${Date.now()}.tmp`;
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      hlsDirectoryWritable = true;
    } catch (error) {
      logger.warn('HLS directory write check failed', error);
    }

    const responseTime = Date.now() - startTime;
    const runningStreams = processManager.getRunningStreams();

    // 确定整体健康状态
    const isHealthy = ffmpegAvailable && hlsDirectoryWritable;
    const status = isHealthy ? 'healthy' : 'unhealthy';

    const healthData = {
      status: status,
      checks: {
        ffmpeg: {
          available: ffmpegAvailable,
          path: processManager.ffmpegPath
        },
        hlsDirectory: {
          writable: hlsDirectoryWritable,
          path: processManager.hlsOutputDir
        },
        streams: {
          total: runningStreams.length,
          healthy: runningStreams.filter(s => s.status === 'running').length
        }
      },
      uptime: process.uptime(),
      responseTime: responseTime,
      timestamp: new Date().toISOString()
    };
const express = require('express');
const router = express.Router();
const ProcessManager = require('../services/ProcessManager');
const logger = require('../utils/logger');
const fs = require('fs');
const os = require('os');

// 创建ProcessManager实例
const processManager = new ProcessManager();

/**
 * GET /api/status
 * 获取系统状态信息
 */
router.get('/status', async (req, res) => {
  try {
    // 获取系统基本信息
    const systemStatus = processManager.getSystemStatus();

    // 获取系统资源信息
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // 获取系统负载信息
    const loadAverage = os.loadavg();

    // 获取磁盘空间信息（HLS目录）
    let diskInfo = null;
    try {
      const stats = fs.statSync(systemStatus.hlsOutputDir);
      diskInfo = {
        hlsDirectory: systemStatus.hlsOutputDir,
        exists: true,
        isDirectory: stats.isDirectory(),
        permissions: stats.mode.toString(8)
      };
    } catch (error) {
      diskInfo = {
        hlsDirectory: systemStatus.hlsOutputDir,
        exists: false,
        error: error.message
      };
    }

    const statusData = {
      service: {
        name: 'VPS Transcoder API',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        startTime: new Date(Date.now() - process.uptime() * 1000).toISOString()
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        hostname: os.hostname(),
        loadAverage: {
          '1min': loadAverage[0],
          '5min': loadAverage[1],
          '15min': loadAverage[2]
        },
        cpu: {
          count: os.cpus().length,
          usage: cpuUsage
        }
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        process: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers
        }
      },
      streams: {
        total: systemStatus.totalStreams,
        running: systemStatus.runningStreams,
        hlsOutputDir: systemStatus.hlsOutputDir,
        disk: diskInfo
      },
      ffmpeg: {
        path: systemStatus.ffmpegPath
      },
      timestamp: new Date().toISOString()
    };

    logger.info('System status requested', {
      totalStreams: systemStatus.totalStreams,
      uptime: process.uptime(),
      memoryUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      clientIp: req.clientIp
    });

    res.json({
      status: 'success',
      message: 'System status retrieved successfully',
      data: statusData
    });

  } catch (error) {
    logger.error('Failed to retrieve system status', {
      error: error.message,
      stack: error.stack,
      clientIp: req.clientIp
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve system status',
      code: 'STATUS_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/health
 * 健康检查端点（详细版本，需要认证）
 */
router.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();

    // 检查FFmpeg是否可用
    let ffmpegAvailable = false;
    try {
      const { spawn } = require('child_process');
      const ffmpegProcess = spawn(processManager.ffmpegPath || 'ffmpeg', ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      });

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ffmpegProcess.kill();
          reject(new Error('FFmpeg check timeout'));
        }, 5000);

        ffmpegProcess.on('exit', (code) => {
          clearTimeout(timeout);
          ffmpegAvailable = (code === 0);
          resolve();
        });

        ffmpegProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      logger.warn('FFmpeg availability check failed', error);
    }

    // 检查HLS输出目录
    let hlsDirectoryWritable = false;
    try {
      const testFile = `${processManager.hlsOutputDir}/health-check-${Date.now()}.tmp`;
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      hlsDirectoryWritable = true;
    } catch (error) {
      logger.warn('HLS directory write check failed', error);
    }

    const responseTime = Date.now() - startTime;
    const runningStreams = processManager.getRunningStreams();

    // 确定整体健康状态
    const isHealthy = ffmpegAvailable && hlsDirectoryWritable;
    const status = isHealthy ? 'healthy' : 'unhealthy';

    const healthData = {
      status: status,
      checks: {
        ffmpeg: {
          available: ffmpegAvailable,
          path: processManager.ffmpegPath
        },
        hlsDirectory: {
          writable: hlsDirectoryWritable,
          path: processManager.hlsOutputDir
        },
        streams: {
          total: runningStreams.length,
          healthy: runningStreams.filter(s => s.status === 'running').length
        }
      },
      uptime: process.uptime(),
      responseTime: responseTime,
      timestamp: new Date().toISOString()
    };

    logger.info('Health check performed', {
      status,
      ffmpegAvailable,
      hlsDirectoryWritable,
      runningStreams: runningStreams.length,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.status(isHealthy ? 200 : 503).json({
      status: 'success',
      message: `Service is ${status}`,
      data: healthData
    });

  } catch (error) {
    logger.error('Health check failed', {
      error: error.message,
      stack: error.stack,
      clientIp: req.clientIp
    });

    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
      code: 'HEALTH_CHECK_ERROR',
      data: {
        status: 'unhealthy',
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
    logger.info('Health check performed', {
      status,
      ffmpegAvailable,
      hlsDirectoryWritable,
      runningStreams: runningStreams.length,
      responseTime: `${responseTime}ms`,
      clientIp: req.clientIp
    });

    res.status(isHealthy ? 200 : 503).json({
      status: 'success',
      message: `Service is ${status}`,
      data: healthData
    });

  } catch (error) {
    logger.error('Health check failed', {
      error: error.message,
      stack: error.stack,
      clientIp: req.clientIp
    });

    res.status(503).json({
      status: 'error',
      message: 'Health check failed',
      code: 'HEALTH_CHECK_ERROR',
      data: {
        status: 'unhealthy',
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;
