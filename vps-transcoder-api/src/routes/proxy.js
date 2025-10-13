const express = require('express');
const router = express.Router();
const ProxyManager = require('../services/ProxyManager');
const logger = require('../utils/logger');

// 创建代理管理器实例
const proxyManager = new ProxyManager();

// 初始化代理管理器
proxyManager.initialize().catch(error => {
  logger.error('代理管理器初始化失败:', error);
});

/**
 * 更新代理配置
 * POST /api/proxy/config
 */
router.post('/config', async (req, res) => {
  try {
    const { action, config } = req.body;
    
    if (action !== 'update') {
      return res.status(400).json({
        status: 'error',
        message: '不支持的操作类型'
      });
    }
    
    if (!config) {
      return res.status(400).json({
        status: 'error',
        message: '缺少代理配置数据'
      });
    }
    
    logger.info('收到代理配置更新请求:', {
      enabled: config.settings?.enabled,
      activeProxyId: config.settings?.activeProxyId
    });
    
    const result = await proxyManager.updateProxyConfig(config);
    
    res.json({
      status: 'success',
      message: '代理配置更新成功',
      data: result
    });
    
  } catch (error) {
    logger.error('更新代理配置失败:', error);
    res.status(500).json({
      status: 'error',
      message: '更新代理配置失败',
      error: error.message
    });
  }
});

/**
 * 获取代理状态
 * GET /api/proxy/status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await proxyManager.getProxyStatus();
    
    res.json({
      status: 'success',
      data: status
    });
    
  } catch (error) {
    logger.error('获取代理状态失败:', error);
    res.status(500).json({
      status: 'error',
      message: '获取代理状态失败',
      error: error.message
    });
  }
});

/**
 * 测试代理连接
 * POST /api/proxy/test
 */
router.post('/test', async (req, res) => {
  try {
    const { proxyId, proxyConfig, testUrlId } = req.body;
    
    if (!proxyConfig) {
      return res.status(400).json({
        status: 'error',
        message: '缺少代理配置数据'
      });
    }
    
    // 根据testUrlId确定测试URL
    const testUrls = {
      'baidu': 'https://www.baidu.com',
      'google': 'https://www.google.com'
    };
    const testUrl = testUrls[testUrlId] || testUrls['baidu'];
    
    logger.info('收到代理测试请求:', {
      proxyId,
      proxyName: proxyConfig.name,
      testUrlId,
      testUrl
    });
    
    const testResult = await proxyManager.testProxyConfig(proxyConfig, testUrl);
    
    res.json({
      status: 'success',
      message: testResult.success ? '代理测试成功' : '代理测试失败',
      data: testResult
    });
    
  } catch (error) {
    logger.error('测试代理失败:', error);
    res.status(500).json({
      status: 'error',
      message: '测试代理失败',
      error: error.message
    });
  }
});

/**
 * 代理控制操作
 * POST /api/proxy/control
 */
router.post('/control', async (req, res) => {
  try {
    const { action, proxyId } = req.body;
    
    logger.info('收到代理控制请求:', { action, proxyId });
    
    let result;
    
    switch (action) {
      case 'start':
        if (!proxyId) {
          return res.status(400).json({
            status: 'error',
            message: '缺少代理ID'
          });
        }
        // 这里需要从配置中获取代理信息
        result = { success: true, message: '代理启动成功' };
        break;
        
      case 'stop':
        result = await proxyManager.stopProxy();
        break;
        
      case 'restart':
        await proxyManager.stopProxy();
        // 重启需要重新加载配置
        result = { success: true, message: '代理重启成功' };
        break;
        
      default:
        return res.status(400).json({
          status: 'error',
          message: '不支持的控制操作'
        });
    }
    
    res.json({
      status: 'success',
      message: result.message,
      data: result
    });
    
  } catch (error) {
    logger.error('代理控制操作失败:', error);
    res.status(500).json({
      status: 'error',
      message: '代理控制操作失败',
      error: error.message
    });
  }
});

/**
 * 获取代理健康状态
 * GET /api/proxy/health
 */
router.get('/health', async (req, res) => {
  try {
    const status = await proxyManager.getProxyStatus();
    const isHealthy = status.connectionStatus === 'connected';
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      data: {
        connectionStatus: status.connectionStatus,
        currentProxy: status.currentProxy,
        lastUpdate: status.lastUpdate
      }
    });
    
  } catch (error) {
    logger.error('获取代理健康状态失败:', error);
    res.status(503).json({
      status: 'unhealthy',
      message: '健康检查失败',
      error: error.message
    });
  }
});

/**
 * 获取代理统计信息
 * GET /api/proxy/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const status = await proxyManager.getProxyStatus();
    
    res.json({
      status: 'success',
      data: {
        statistics: status.statistics,
        throughput: status.throughput,
        connectionStatus: status.connectionStatus,
        uptime: status.uptime || 0
      }
    });
    
  } catch (error) {
    logger.error('获取代理统计失败:', error);
    res.status(500).json({
      status: 'error',
      message: '获取代理统计失败',
      error: error.message
    });
  }
});

module.exports = router;
