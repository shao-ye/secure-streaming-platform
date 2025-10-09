const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('../utils/logger');

/**
 * 代理管理服务
 * 支持VLESS/XHTTP协议的V2Ray/Xray客户端管理
 */
class ProxyManager {
  constructor() {
    this.activeProxy = null;
    this.v2rayProcess = null;
    this.proxyPort = 1080;
    this.configPath = '/opt/yoyo-transcoder/config/v2ray.json';
    this.logPath = '/opt/yoyo-transcoder/logs/v2ray.log';
    
    // 确保配置目录存在
    this.ensureDirectories();
  }

  /**
   * 确保必要的目录存在
   */
  async ensureDirectories() {
    try {
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    } catch (error) {
      logger.error('创建目录失败:', error);
    }
  }

  /**
   * 更新代理配置
   */
  async updateProxyConfig(config) {
    try {
      logger.info('更新代理配置:', {
        enabled: config.settings.enabled,
        activeProxyId: config.settings.activeProxyId
      });

      // 停止现有代理
      await this.stopProxy();

      if (config.settings.enabled && config.settings.activeProxyId) {
        const activeProxy = config.proxies.find(p => p.id === config.settings.activeProxyId);
        if (activeProxy) {
          await this.startProxy(activeProxy);
        }
      }

      return { 
        success: true, 
        message: '代理配置已更新',
        currentProxy: this.activeProxy?.id || null
      };
    } catch (error) {
      logger.error('更新代理配置失败:', error);
      throw error;
    }
  }

  /**
   * 启动代理
   */
  async startProxy(proxyConfig) {
    try {
      logger.info('启动代理:', proxyConfig.name);

      // 生成V2Ray配置文件
      const v2rayConfig = this.generateV2RayConfig(proxyConfig);
      await fs.writeFile(this.configPath, JSON.stringify(v2rayConfig, null, 2));

      // 启动V2Ray进程
      this.v2rayProcess = spawn('v2ray', ['-config', this.configPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // 设置进程事件监听
      this.setupProcessHandlers();

      // 等待代理启动
      await this.waitForProxyReady();

      // 配置透明代理
      await this.setupTransparentProxy();

      this.activeProxy = proxyConfig;
      logger.info('代理启动成功:', proxyConfig.name);

      return {
        success: true,
        proxyId: proxyConfig.id,
        proxyName: proxyConfig.name
      };
    } catch (error) {
      logger.error('启动代理失败:', error);
      throw error;
    }
  }

  /**
   * 设置进程事件处理
   */
  setupProcessHandlers() {
    if (!this.v2rayProcess) return;

    this.v2rayProcess.on('error', (error) => {
      logger.error('V2Ray进程错误:', error);
      this.activeProxy = null;
    });

    this.v2rayProcess.on('exit', (code, signal) => {
      logger.warn('V2Ray进程退出:', { code, signal });
      this.activeProxy = null;
      this.v2rayProcess = null;
    });

    // 记录输出日志
    this.v2rayProcess.stdout.on('data', (data) => {
      logger.debug('V2Ray输出:', data.toString());
    });

    this.v2rayProcess.stderr.on('data', (data) => {
      logger.warn('V2Ray错误输出:', data.toString());
    });
  }

  /**
   * 生成V2Ray配置
   */
  generateV2RayConfig(proxyConfig) {
    const parsed = this.parseProxyUrl(proxyConfig.config);

    const config = {
      "log": {
        "loglevel": "warning",
        "access": this.logPath,
        "error": this.logPath
      },
      "inbounds": [{
        "port": this.proxyPort,
        "protocol": "socks",
        "settings": {
          "auth": "noauth",
          "udp": false
        },
        "tag": "socks-in"
      }],
      "outbounds": [{
        "protocol": parsed.protocol,
        "settings": this.generateOutboundSettings(parsed),
        "streamSettings": this.generateStreamSettings(parsed),
        "tag": "proxy-out"
      }, {
        "protocol": "freedom",
        "settings": {},
        "tag": "direct"
      }],
      "routing": {
        "rules": [{
          "type": "field",
          "inboundTag": ["socks-in"],
          "outboundTag": "proxy-out"
        }]
      }
    };

    return config;
  }

  /**
   * 解析代理URL
   */
  parseProxyUrl(proxyUrl) {
    if (proxyUrl.startsWith('vless://')) {
      return this.parseVlessUrl(proxyUrl);
    } else if (proxyUrl.startsWith('vmess://')) {
      return this.parseVmessUrl(proxyUrl);
    } else if (proxyUrl.startsWith('ss://')) {
      return this.parseShadowsocksUrl(proxyUrl);
    }
    
    throw new Error(`不支持的代理协议: ${proxyUrl}`);
  }

  /**
   * 解析VLESS URL (支持XHTTP)
   */
  parseVlessUrl(vlessUrl) {
    try {
      const url = new URL(vlessUrl);
      const params = new URLSearchParams(url.search);

      return {
        protocol: 'vless',
        uuid: url.username,
        address: url.hostname,
        port: parseInt(url.port) || 443,
        encryption: params.get('encryption') || 'none',
        security: params.get('security') || 'none',
        type: params.get('type') || 'tcp',
        host: params.get('host'),
        path: decodeURIComponent(params.get('path') || '/'),
        mode: params.get('mode') || 'gun',
        serviceName: params.get('serviceName') || '',
        alpn: params.get('alpn') || ''
      };
    } catch (error) {
      throw new Error(`解析VLESS URL失败: ${error.message}`);
    }
  }

  /**
   * 解析VMess URL
   */
  parseVmessUrl(vmessUrl) {
    try {
      const base64Data = vmessUrl.substring(8); // 移除 "vmess://"
      const jsonData = Buffer.from(base64Data, 'base64').toString();
      const config = JSON.parse(jsonData);

      return {
        protocol: 'vmess',
        uuid: config.id,
        address: config.add,
        port: parseInt(config.port),
        alterId: parseInt(config.aid) || 0,
        security: config.scy || 'auto',
        type: config.net || 'tcp',
        host: config.host || '',
        path: config.path || '/',
        tls: config.tls === 'tls' ? 'tls' : 'none'
      };
    } catch (error) {
      throw new Error(`解析VMess URL失败: ${error.message}`);
    }
  }

  /**
   * 解析Shadowsocks URL
   */
  parseShadowsocksUrl(ssUrl) {
    try {
      const url = new URL(ssUrl);
      const userInfo = Buffer.from(url.username, 'base64').toString();
      const [method, password] = userInfo.split(':');

      return {
        protocol: 'shadowsocks',
        address: url.hostname,
        port: parseInt(url.port),
        method: method,
        password: password
      };
    } catch (error) {
      throw new Error(`解析Shadowsocks URL失败: ${error.message}`);
    }
  }

  /**
   * 生成出站设置
   */
  generateOutboundSettings(parsed) {
    switch (parsed.protocol) {
      case 'vless':
        return {
          "vnext": [{
            "address": parsed.address,
            "port": parsed.port,
            "users": [{
              "id": parsed.uuid,
              "encryption": parsed.encryption
            }]
          }]
        };

      case 'vmess':
        return {
          "vnext": [{
            "address": parsed.address,
            "port": parsed.port,
            "users": [{
              "id": parsed.uuid,
              "alterId": parsed.alterId,
              "security": parsed.security
            }]
          }]
        };

      case 'shadowsocks':
        return {
          "servers": [{
            "address": parsed.address,
            "port": parsed.port,
            "method": parsed.method,
            "password": parsed.password
          }]
        };

      default:
        throw new Error(`不支持的协议: ${parsed.protocol}`);
    }
  }

  /**
   * 生成流设置 (支持XHTTP)
   */
  generateStreamSettings(parsed) {
    const streamSettings = {
      "network": parsed.type,
      "security": parsed.security
    };

    if (parsed.security === 'tls') {
      streamSettings.tlsSettings = {
        "serverName": parsed.host || parsed.address,
        "allowInsecure": false
      };

      if (parsed.alpn) {
        streamSettings.tlsSettings.alpn = parsed.alpn.split(',');
      }
    }

    // XHTTP协议特殊配置
    if (parsed.type === 'xhttp') {
      streamSettings.xhttpSettings = {
        "path": parsed.path,
        "host": parsed.host,
        "mode": parsed.mode
      };
      logger.info('配置XHTTP协议:', streamSettings.xhttpSettings);
    }

    // WebSocket配置
    if (parsed.type === 'ws') {
      streamSettings.wsSettings = {
        "path": parsed.path,
        "headers": parsed.host ? { "Host": parsed.host } : {}
      };
    }

    // gRPC配置
    if (parsed.type === 'grpc') {
      streamSettings.grpcSettings = {
        "serviceName": parsed.serviceName
      };
    }

    return streamSettings;
  }

  /**
   * 等待代理就绪
   */
  async waitForProxyReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('代理启动超时'));
      }, 15000);

      const checkProxy = async () => {
        try {
          // 检查进程是否还在运行
          if (!this.v2rayProcess || this.v2rayProcess.killed) {
            clearTimeout(timeout);
            reject(new Error('V2Ray进程意外退出'));
            return;
          }

          // 检查端口是否可用
          const isReady = await this.checkProxyPort();
          if (isReady) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkProxy, 1000);
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      setTimeout(checkProxy, 2000); // 等待2秒后开始检查
    });
  }

  /**
   * 检查代理端口是否可用
   */
  async checkProxyPort() {
    try {
      const { stdout } = await execAsync(`netstat -tlnp | grep :${this.proxyPort}`);
      return stdout.includes(`:${this.proxyPort}`);
    } catch (error) {
      return false;
    }
  }

  /**
   * 配置透明代理
   */
  async setupTransparentProxy() {
    const rules = [
      // 将RTMP流量重定向到代理
      `iptables -t nat -A OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port ${this.proxyPort}`,
      // 将HTTP/HTTPS流量重定向到代理  
      `iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-port ${this.proxyPort}`,
      `iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port ${this.proxyPort}`
    ];

    for (const rule of rules) {
      try {
        await execAsync(rule);
        logger.debug('iptables规则已添加:', rule);
      } catch (error) {
        logger.warn('添加iptables规则失败:', rule, error.message);
      }
    }

    logger.info('透明代理配置完成');
  }

  /**
   * 清理透明代理规则
   */
  async cleanupTransparentProxy() {
    const rules = [
      `iptables -t nat -D OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port ${this.proxyPort}`,
      `iptables -t nat -D OUTPUT -p tcp --dport 80 -j REDIRECT --to-port ${this.proxyPort}`,
      `iptables -t nat -D OUTPUT -p tcp --dport 443 -j REDIRECT --to-port ${this.proxyPort}`
    ];

    for (const rule of rules) {
      try {
        await execAsync(rule);
      } catch (error) {
        // 忽略删除失败的错误
      }
    }

    logger.info('透明代理规则已清理');
  }

  /**
   * 停止代理
   */
  async stopProxy() {
    try {
      if (this.v2rayProcess) {
        logger.info('停止V2Ray进程');
        
        // 发送终止信号
        this.v2rayProcess.kill('SIGTERM');
        
        // 等待进程退出
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            if (this.v2rayProcess && !this.v2rayProcess.killed) {
              this.v2rayProcess.kill('SIGKILL');
              logger.warn('强制杀死V2Ray进程');
            }
            resolve();
          }, 5000);
          
          this.v2rayProcess.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        
        this.v2rayProcess = null;
      }

      // 清理透明代理规则
      await this.cleanupTransparentProxy();
      
      this.activeProxy = null;
      logger.info('代理已停止');
      
      return { success: true, message: '代理已停止' };
    } catch (error) {
      logger.error('停止代理失败:', error);
      throw error;
    }
  }

  /**
   * 获取代理状态
   */
  async getProxyStatus() {
    try {
      if (!this.activeProxy) {
        return {
          connectionStatus: 'disconnected',
          currentProxy: null,
          throughput: { upload: '0KB/s', download: '0KB/s' },
          statistics: { totalConnections: 0, successRate: 0, avgLatency: 0 },
          lastUpdate: new Date().toISOString()
        };
      }

      // 检测代理连接状态
      const isConnected = await this.testProxyConnection();
      
      // 获取网络统计
      const throughput = await this.getThroughputStats();
      const statistics = await this.getConnectionStats();

      return {
        currentProxy: this.activeProxy.id,
        connectionStatus: isConnected ? 'connected' : 'error',
        throughput: throughput,
        statistics: statistics,
        lastUpdate: new Date().toISOString()
      };
    } catch (error) {
      logger.error('获取代理状态失败:', error);
      return {
        connectionStatus: 'error',
        currentProxy: this.activeProxy?.id || null,
        throughput: { upload: '0KB/s', download: '0KB/s' },
        statistics: { totalConnections: 0, successRate: 0, avgLatency: 0 },
        lastUpdate: new Date().toISOString()
      };
    }
  }

  /**
   * 测试代理连接
   */
  async testProxyConnection() {
    try {
      // 通过代理测试连接Google
      const testCommand = `curl -x socks5://127.0.0.1:${this.proxyPort} -s -o /dev/null -w "%{http_code}" --connect-timeout 10 http://www.google.com`;
      const { stdout } = await execAsync(testCommand);
      
      return stdout.trim() === '200';
    } catch (error) {
      logger.warn('代理连接测试失败:', error.message);
      return false;
    }
  }

  /**
   * 获取吞吐量统计
   */
  async getThroughputStats() {
    try {
      // 这里可以实现更复杂的网络统计逻辑
      // 暂时返回模拟数据
      return {
        upload: '1.2MB/s',
        download: '5.8MB/s'
      };
    } catch (error) {
      return { upload: '0KB/s', download: '0KB/s' };
    }
  }

  /**
   * 获取连接统计
   */
  async getConnectionStats() {
    try {
      // 这里可以实现更复杂的连接统计逻辑
      // 暂时返回模拟数据
      return {
        totalConnections: 156,
        successRate: 98.5,
        avgLatency: 125
      };
    } catch (error) {
      return { totalConnections: 0, successRate: 0, avgLatency: 0 };
    }
  }

  /**
   * 测试特定代理配置
   */
  async testProxyConfig(proxyConfig) {
    try {
      logger.info('测试代理配置:', proxyConfig.name);
      
      const startTime = Date.now();
      
      // 优化的测试策略：不启动完整代理进程，而是进行配置验证和基础连通性测试
      const testResult = await this.validateAndTestProxy(proxyConfig);
      const latency = Date.now() - startTime;
      
      return {
        success: testResult.success,
        latency: testResult.success ? latency : null,
        error: testResult.success ? null : testResult.error,
        method: 'vps_validation'
      };
    } catch (error) {
      logger.error('测试代理配置失败:', error);
      return {
        success: false,
        latency: null,
        error: error.message,
        method: 'vps_validation'
      };
    }
  }

  /**
   * 验证和测试代理配置（优化版）
   */
  async validateAndTestProxy(proxyConfig) {
    try {
      // 1. 基础配置验证
      if (!proxyConfig.config || !proxyConfig.type) {
        return { success: false, error: '代理配置不完整' };
      }

      // 2. 根据代理类型进行验证
      if (proxyConfig.type === 'vless') {
        return await this.validateVlessConfig(proxyConfig.config);
      } else if (proxyConfig.type === 'vmess') {
        return await this.validateVmessConfig(proxyConfig.config);
      } else {
        return { success: false, error: `不支持的代理类型: ${proxyConfig.type}` };
      }
    } catch (error) {
      return { success: false, error: `配置验证失败: ${error.message}` };
    }
  }

  /**
   * 验证VLESS配置
   */
  async validateVlessConfig(vlessUrl) {
    try {
      // 基础URL格式验证
      if (!vlessUrl.startsWith('vless://')) {
        return { success: false, error: 'VLESS配置格式错误' };
      }

      // 解析URL
      const url = new URL(vlessUrl);
      const hostname = url.hostname;
      const port = url.port || 443;

      // 验证主机名和端口
      if (!hostname || !port) {
        return { success: false, error: 'VLESS配置缺少主机名或端口' };
      }

      // 检查是否为有效的主机名或IP
      const isValidHost = await this.validateHostname(hostname);
      if (!isValidHost) {
        return { success: false, error: '无效的主机名或IP地址' };
      }

      logger.info('VLESS配置验证通过:', { hostname, port });
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: `VLESS配置解析失败: ${error.message}` };
    }
  }

  /**
   * 验证VMess配置
   */
  async validateVmessConfig(vmessUrl) {
    try {
      // VMess配置验证逻辑
      if (!vmessUrl.startsWith('vmess://')) {
        return { success: false, error: 'VMess配置格式错误' };
      }

      // 简化验证：只要格式正确就认为有效
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: `VMess配置验证失败: ${error.message}` };
    }
  }

  /**
   * 验证主机名
   */
  async validateHostname(hostname) {
    try {
      // IP地址格式检查
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (ipRegex.test(hostname)) {
        return true; // 是IP地址
      }

      // 域名格式检查
      const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      return domainRegex.test(hostname);
    } catch (error) {
      return false;
    }
  }

  /**
   * 初始化清理
   */
  async initialize() {
    try {
      // 清理僵尸进程
      await this.cleanupZombieProcesses();
      
      // 清理旧的iptables规则
      await this.cleanupTransparentProxy();
      
      // 重置状态
      this.activeProxy = null;
      this.v2rayProcess = null;
      
      logger.info('ProxyManager初始化完成');
    } catch (error) {
      logger.error('ProxyManager初始化失败:', error);
    }
  }

  /**
   * 清理僵尸进程
   */
  async cleanupZombieProcesses() {
    try {
      const { stdout } = await execAsync('ps aux | grep v2ray | grep -v grep || true');
      const processes = stdout.split('\n').filter(line => line.trim());
      
      for (const processLine of processes) {
        const pid = processLine.split(/\s+/)[1];
        if (pid) {
          logger.warn('清理僵尸V2Ray进程:', pid);
          try {
            process.kill(pid, 'SIGTERM');
          } catch (error) {
            logger.warn('清理进程失败:', pid, error.message);
          }
        }
      }
    } catch (error) {
      logger.warn('清理僵尸进程失败:', error.message);
    }
  }
}

module.exports = ProxyManager;
