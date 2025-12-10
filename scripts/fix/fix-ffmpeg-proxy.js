/**
 * 修复FFmpeg代理连接问题
 * 在SimpleStreamManager中添加代理支持
 */

// 需要在SimpleStreamManager.js中修改的部分

// 1. 在构造函数中添加代理管理器引用
constructor() {
  // ... 现有代码 ...
  
  // 添加代理管理器引用
  this.proxyManager = null;
  this.initProxyManager();
}

// 2. 初始化代理管理器
async initProxyManager() {
  try {
    const ProxyManager = require('./ProxyManager_v2');
    this.proxyManager = new ProxyManager();
    logger.info('ProxyManager initialized for SimpleStreamManager');
  } catch (error) {
    logger.warn('Failed to initialize ProxyManager', { error: error.message });
  }
}

// 3. 修改spawnFFmpegProcess方法，添加代理支持
async spawnFFmpegProcess(channelId, rtmpUrl) {
  // ... 现有的目录创建代码 ...
  
  // 检查代理状态并设置环境变量
  const env = { ...process.env };
  
  if (this.proxyManager) {
    try {
      const proxyStatus = this.proxyManager.getProxyStatus();
      if (proxyStatus.connectionStatus === 'connected') {
        // 设置代理环境变量
        env.http_proxy = 'socks5://127.0.0.1:1080';
        env.https_proxy = 'socks5://127.0.0.1:1080';
        env.HTTP_PROXY = 'socks5://127.0.0.1:1080';
        env.HTTPS_PROXY = 'socks5://127.0.0.1:1080';
        
        logger.info('FFmpeg will use proxy for RTMP connection', { 
          channelId, 
          proxyStatus: proxyStatus.connectionStatus,
          proxyConfig: proxyStatus.currentProxy?.name 
        });
      } else {
        logger.info('FFmpeg will use direct connection (no proxy)', { 
          channelId, 
          proxyStatus: proxyStatus.connectionStatus 
        });
      }
    } catch (error) {
      logger.warn('Failed to get proxy status, using direct connection', { 
        channelId, 
        error: error.message 
      });
    }
  }
  
  // ... 现有的FFmpeg参数构建代码 ...
  
  // 启动FFmpeg进程时传入环境变量
  const ffmpegProcess = spawn(this.ffmpegPath, ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: env  // 添加环境变量
  });
  
  // ... 其余代码保持不变 ...
}

// 4. 添加代理状态变化监听（可选）
onProxyStatusChange() {
  // 当代理状态变化时，可以记录日志或采取其他行动
  logger.info('Proxy status changed, new FFmpeg processes will use updated proxy settings');
}

module.exports = {
  // 导出修复说明
  description: 'FFmpeg代理连接修复方案',
  changes: [
    '1. 在SimpleStreamManager构造函数中初始化ProxyManager',
    '2. 在spawnFFmpegProcess中检查代理状态',
    '3. 根据代理状态设置FFmpeg进程的环境变量',
    '4. 添加详细的代理连接日志'
  ],
  implementation: 'Apply these changes to /opt/yoyo-transcoder/src/services/SimpleStreamManager.js'
};
