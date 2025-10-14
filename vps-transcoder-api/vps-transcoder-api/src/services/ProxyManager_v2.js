const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);
const logger = require('../utils/logger');

/**
 * 代理管理服务 v2.0
 * 实现完整的代理连接和流媒体转发功能
 */
class ProxyManager {
  constructor() {
    this.activeProxy = null;
    this.v2rayProcess = null;
    this.proxyPort = 1080;
    this.configPath = '/opt/yoyo-transcoder/proxy-configs/yoyo-proxy.json';
    this.logPath = '/opt/yoyo-transcoder/logs/yoyo-proxy.log';
    this.connectionStatus = 'disconnected'; // disconnected, connecting, connected, error
    this.statistics = {
      bytesUp: 0,
      bytesDown: 0,
      connectTime: null,
      lastUpdate: new Date().toISOString()
    };
    
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
      logger.info('代理配置目录已创建');
    } catch (error) {
      logger.error('创建目录失败:', error);
    }
  }

  /**
   * 检查V2Ray/Xray是否可用
   */
  async checkProxyClientAvailable() {
    try {
      // 优先检查v2ray
      const v2rayResult = await execAsync('which v2ray');
      if (v2rayResult.stdout.trim()) {
        const versionResult = await execAsync('v2ray version');
        logger.info('V2Ray可用:', versionResult.stdout.split('\n')[0]);
        return { client: 'v2ray', path: v2rayResult.stdout.trim() };
      }
    } catch (error) {
      logger.debug('V2Ray不可用，尝试Xray');
    }

    try {
      // 检查xray
      const xrayResult = await execAsync('which xray');
      if (xrayResult.stdout.trim()) {
        const versionResult = await execAsync('xray version');
        logger.info('Xray可用:', versionResult.stdout.split('\n')[0]);
        return { client: 'xray', path: xrayResult.stdout.trim() };
      }
    } catch (error) {
      logger.error('V2Ray和Xray都不可用');
    }

    return null;
  }

  /**
   * 连接代理
   * @param {Object} proxyConfig - 代理配置
   */
  async connectProxy(proxyConfig) {
    try {
      logger.info('开始连接代理:', proxyConfig.name);
      this.connectionStatus = 'connecting';

      // 检查代理客户端
      const clientInfo = await this.checkProxyClientAvailable();
      if (!clientInfo) {
        throw new Error('V2Ray/Xray客户端不可用，请先安装');
      }

      // 停止现有连接
      await this.disconnectProxy();

      // 生成配置文件
      const config = this.generateProxyConfig(proxyConfig);
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      logger.info('代理配置文件已生成:', this.configPath);

      // 启动代理进程
      this.v2rayProcess = spawn(clientInfo.client, ['-config', this.configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      // 设置进程事件处理
      this.setupProcessHandlers(proxyConfig);

      // 等待代理启动
      await this.waitForProxyReady(5000);

      // 验证代理连接
      const isConnected = await this.verifyProxyConnection();
      if (!isConnected) {
        throw new Error('代理连接验证失败');
      }

      // 设置透明代理规则（用于FFmpeg流量转发）
      await this.setupTransparentProxy();

      // 更新状态
      this.activeProxy = proxyConfig;
      this.connectionStatus = 'connected';
      this.statistics.connectTime = new Date().toISOString();
      this.statistics.lastUpdate = new Date().toISOString();

      logger.info('代理连接成功:', proxyConfig.name);

      return {
        success: true,
        proxyId: proxyConfig.id,
        proxyName: proxyConfig.name,
        connectionStatus: this.connectionStatus,
        proxyPort: this.proxyPort,
        message: '代理连接成功'
      };

    } catch (error) {
      logger.error('连接代理失败:', error);
      this.connectionStatus = 'error';
      this.activeProxy = null;
      
      // 清理失败的进程
      if (this.v2rayProcess) {
        this.v2rayProcess.kill('SIGTERM');
        this.v2rayProcess = null;
      }

      throw error;
    }
  }

  /**
   * 断开代理连接
   */
  async disconnectProxy() {
    try {
      logger.info('断开代理连接');

      // 清理透明代理规则
      await this.cleanupTransparentProxy();

      // 停止代理进程
      if (this.v2rayProcess) {
        this.v2rayProcess.kill('SIGTERM');
        
        // 等待进程退出
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            if (this.v2rayProcess) {
              this.v2rayProcess.kill('SIGKILL');
            }
            resolve();
          }, 3000);

          this.v2rayProcess.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        this.v2rayProcess = null;
      }

      // 重置状态
      this.activeProxy = null;
      this.connectionStatus = 'disconnected';
      this.statistics = {
        bytesUp: 0,
        bytesDown: 0,
        connectTime: null,
        lastUpdate: new Date().toISOString()
      };

      logger.info('代理连接已断开');

      return {
        success: true,
        message: '代理连接已断开'
      };

    } catch (error) {
      logger.error('断开代理失败:', error);
      throw error;
    }
  }

  /**
   * 设置进程事件处理
   */
  setupProcessHandlers(proxyConfig) {
    if (!this.v2rayProcess) return;

    this.v2rayProcess.on('error', (error) => {
      logger.error('代理进程错误:', error);
      this.connectionStatus = 'error';
      this.activeProxy = null;
    });

    this.v2rayProcess.on('exit', (code, signal) => {
      logger.warn('代理进程退出:', { code, signal, proxy: proxyConfig.name });
      this.connectionStatus = 'disconnected';
      this.activeProxy = null;
      this.v2rayProcess = null;
    });

    // 记录输出日志
    this.v2rayProcess.stdout.on('data', (data) => {
      const output = data.toString();
      logger.debug('代理进程输出:', output);
      
      // 解析统计信息（如果有的话）
      this.parseProxyStatistics(output);
    });

    this.v2rayProcess.stderr.on('data', (data) => {
      const error = data.toString();
      logger.warn('代理进程错误输出:', error);
      
      // 检查是否是致命错误
      if (error.includes('failed to') || error.includes('error')) {
        this.connectionStatus = 'error';
      }
    });
  }

  /**
   * 等待代理准备就绪
   */
  async waitForProxyReady(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkReady = async () => {
        try {
          // 检查SOCKS5端口是否可用 (优先使用ss命令，fallback到netstat)
          let result;
          try {
            result = await execAsync(`ss -tlnp | grep :${this.proxyPort}`);
          } catch (ssError) {
            result = await execAsync(`netstat -tlnp | grep :${this.proxyPort}`);
          }
          
          if (result.stdout.includes(`:${this.proxyPort}`)) {
            logger.info('代理端口已就绪:', this.proxyPort);
            resolve();
            return;
          }
        } catch (error) {
          // 端口未就绪，继续等待
        }

        // 检查超时
        if (Date.now() - startTime > timeout) {
          reject(new Error('代理启动超时'));
          return;
        }

        // 继续检查
        setTimeout(checkReady, 500);
      };

      checkReady();
    });
  }

  /**
   * 验证代理连接
   */
  async verifyProxyConnection() {
    try {
      // 使用curl通过SOCKS5代理测试连接
      const testCommand = `curl -x socks5://127.0.0.1:${this.proxyPort} -s -o /dev/null -w "%{http_code}" --connect-timeout 10 https://www.baidu.com`;
      const result = await execAsync(testCommand);
      
      const httpCode = parseInt(result.stdout.trim());
      const isSuccess = httpCode >= 200 && httpCode < 400;
      
      logger.info('代理连接验证:', { httpCode, success: isSuccess });
      return isSuccess;
      
    } catch (error) {
      logger.error('代理连接验证失败:', error);
      return false;
    }
  }

  /**
   * 设置透明代理（用于FFmpeg流量转发）
   */
  async setupTransparentProxy() {
    try {
      logger.info('设置透明代理规则');

      // 创建iptables规则，将特定流量转发到SOCKS5代理
      // 🔥 关键修复：排除本地回环地址，避免影响VPS自身服务
      const rules = [
        // 为FFmpeg创建特殊的路由规则，但排除本地服务
        `iptables -t nat -A OUTPUT -p tcp --dport 1935 ! -d 127.0.0.0/8 -j REDIRECT --to-port ${this.proxyPort + 1}`,
        `iptables -t nat -A OUTPUT -p tcp --dport 80 ! -d 127.0.0.0/8 ! -d 142.171.75.220 -j REDIRECT --to-port ${this.proxyPort + 1}`,
        `iptables -t nat -A OUTPUT -p tcp --dport 443 ! -d 127.0.0.0/8 ! -d 142.171.75.220 -j REDIRECT --to-port ${this.proxyPort + 1}`
      ];

      for (const rule of rules) {
        try {
          await execAsync(rule);
          logger.debug('iptables规则已添加:', rule);
        } catch (error) {
          logger.warn('添加iptables规则失败:', rule, error.message);
        }
      }

      logger.info('透明代理规则设置完成');

    } catch (error) {
      logger.error('设置透明代理失败:', error);
      // 不抛出错误，因为透明代理是可选功能
    }
  }

  /**
   * 清理透明代理规则
   */
  async cleanupTransparentProxy() {
    try {
      logger.info('清理透明代理规则');

      // 删除之前添加的iptables规则
      const rules = [
        `iptables -t nat -D OUTPUT -p tcp --dport 1935 ! -d 127.0.0.0/8 -j REDIRECT --to-port ${this.proxyPort + 1}`,
        `iptables -t nat -D OUTPUT -p tcp --dport 80 ! -d 127.0.0.0/8 ! -d 142.171.75.220 -j REDIRECT --to-port ${this.proxyPort + 1}`,
        `iptables -t nat -D OUTPUT -p tcp --dport 443 ! -d 127.0.0.0/8 ! -d 142.171.75.220 -j REDIRECT --to-port ${this.proxyPort + 1}`
      ];

      for (const rule of rules) {
        try {
          await execAsync(rule);
          logger.debug('iptables规则已删除:', rule);
        } catch (error) {
          // 忽略删除失败的错误，规则可能不存在
        }
      }

      logger.info('透明代理规则清理完成');

    } catch (error) {
      logger.error('清理透明代理失败:', error);
    }
  }

  /**
   * 生成代理配置
   */
  generateProxyConfig(proxyConfig) {
    const parsed = this.parseProxyUrl(proxyConfig.config);

    const config = {
      "log": {
        "loglevel": "info",
        "access": this.logPath.replace('.log', '-access.log'),
        "error": this.logPath
      },
      "api": {
        "tag": "api",
        "services": ["StatsService"]
      },
      "stats": {},
      "inbounds": [{
        "port": this.proxyPort,
        "protocol": "socks",
        "settings": {
          "auth": "noauth",
          "udp": true
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
    
    throw new Error(`不支持的代理协议: ${proxyUrl.substring(0, 20)}...`);
  }

  /**
   * 解析VLESS URL (支持Reality和XHTTP)
   */
  parseVlessUrl(vlessUrl) {
    try {
      const url = new URL(vlessUrl);
      const params = new URLSearchParams(url.search);

      const parsed = {
        protocol: 'vless',
        uuid: url.username,
        address: url.hostname,
        port: parseInt(url.port) || 443,
        encryption: params.get('encryption') || 'none',
        security: params.get('security') || 'none',
        type: params.get('type') || 'tcp',
        host: params.get('host') || '',
        path: decodeURIComponent(params.get('path') || '/'),
        mode: params.get('mode') || '',
        serviceName: params.get('serviceName') || '',
        alpn: params.get('alpn') || '',
        fp: params.get('fp') || '',
        pbk: params.get('pbk') || '',
        sid: params.get('sid') || '',
        spx: params.get('spx') || '',
        flow: params.get('flow') || '',
        sni: params.get('sni') || ''
      };

      logger.info('解析VLESS配置:', {
        address: parsed.address,
        port: parsed.port,
        type: parsed.type,
        security: parsed.security
      });

      return parsed;
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
              "encryption": parsed.encryption,
              "flow": parsed.flow || ""
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
   * 生成流设置
   */
  generateStreamSettings(parsed) {
    const streamSettings = {
      "network": parsed.type || "tcp"
    };

    // XHTTP传输设置
    if (parsed.type === 'xhttp') {
      streamSettings.xhttpSettings = {
        "path": parsed.path || "/",
        "host": parsed.host || ""
      };
    }

    // WebSocket设置
    if (parsed.type === 'ws') {
      streamSettings.wsSettings = {
        "path": parsed.path || "/",
        "headers": parsed.host ? { "Host": parsed.host } : {}
      };
    }

    // gRPC设置
    if (parsed.type === 'grpc') {
      streamSettings.grpcSettings = {
        "serviceName": parsed.serviceName || "",
        "multiMode": parsed.mode === 'multi'
      };
    }

    // TLS/Reality设置
    if (parsed.security === 'tls') {
      streamSettings.security = "tls";
      streamSettings.tlsSettings = {
        "serverName": parsed.host || parsed.address,
        "alpn": parsed.alpn ? parsed.alpn.split(',') : []
      };
    } else if (parsed.security === 'reality') {
      streamSettings.security = "reality";
      streamSettings.realitySettings = {
        "serverName": parsed.sni || parsed.host || parsed.address,
        "fingerprint": parsed.fp || "chrome",
        "publicKey": parsed.pbk || "",
        "shortId": parsed.sid || "",
        "spiderX": parsed.spx || ""
      };
    }

    return streamSettings;
  }

  /**
   * 解析代理统计信息
   */
  parseProxyStatistics(output) {
    try {
      // 尝试解析V2Ray的统计输出
      if (output.includes('uplink') || output.includes('downlink')) {
        // 更新统计信息
        this.statistics.lastUpdate = new Date().toISOString();
      }
    } catch (error) {
      // 忽略解析错误
    }
  }

  /**
   * 获取代理状态
   */
  getProxyStatus() {
    return {
      connectionStatus: this.connectionStatus,
      currentProxy: this.activeProxy ? {
        id: this.activeProxy.id,
        name: this.activeProxy.name,
        type: this.activeProxy.type
      } : null,
      proxyPort: this.proxyPort,
      statistics: this.statistics,
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * 真实代理延迟测试 - 类似v2ray客户端的连接测试
   */
  async testProxyLatency(proxyConfig, testUrlId = 'baidu') {
    const startTime = Date.now();
    let tempConfigPath = null;
    let tempProcess = null;
    
    try {
      logger.info(`开始真实代理延迟测试: ${proxyConfig.name}`);
      
      // 检查V2Ray/Xray客户端
      const clientInfo = await this.checkProxyClientAvailable();
      if (!clientInfo) {
        return {
          success: false,
          latency: -1,
          method: 'real_test',
          error: 'V2Ray/Xray客户端不可用'
        };
      }
      
      // 生成测试网站URL
      const testUrls = {
        'baidu': 'https://www.baidu.com',
        'google': 'https://www.google.com'
      };
      const testUrl = testUrls[testUrlId] || testUrls['baidu'];
      
      logger.info(`使用测试网站: ${testUrl}`);
      
      // 1. 生成临时V2Ray配置文件
      tempConfigPath = `/tmp/v2ray_test_${Date.now()}.json`;
      const v2rayConfig = await this.generateV2rayConfig(proxyConfig);
      
      await fs.writeFile(tempConfigPath, JSON.stringify(v2rayConfig, null, 2));
      logger.info(`临时配置文件已生成: ${tempConfigPath}`);
      
      // 2. 启动临时V2Ray进程
      logger.info('启动临时V2Ray进程...');
      tempProcess = spawn(clientInfo.command, ['-config', tempConfigPath], {
        stdio: 'pipe',
        detached: false
      });
      
      // 等待V2Ray启动
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('V2Ray启动超时'));
        }, 5000);
        
        let output = '';
        tempProcess.stdout.on('data', (data) => {
          output += data.toString();
          if (output.includes('started') || output.includes('listening')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        
        tempProcess.stderr.on('data', (data) => {
          const errorOutput = data.toString();
          logger.warn('V2Ray stderr:', errorOutput);
          if (errorOutput.includes('started') || errorOutput.includes('listening')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        
        tempProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        
        tempProcess.on('exit', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`V2Ray进程异常退出，代码: ${code}`));
          }
        });
      });
      
      logger.info('V2Ray进程启动成功，等待稳定...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒确保稳定
      
      // 3. 通过代理测试网站连接
      const testStartTime = Date.now();
      logger.info(`开始通过代理访问: ${testUrl}`);
      
      try {
        // 使用curl通过SOCKS5代理访问测试网站
        const curlCommand = `curl -x socks5://127.0.0.1:1080 --connect-timeout 10 --max-time 15 -s -o /dev/null -w "%{http_code},%{time_total}" "${testUrl}"`;
        logger.info(`执行curl命令: ${curlCommand}`);
        
        const { stdout } = await execAsync(curlCommand);
        const [httpCode, timeTotal] = stdout.trim().split(',');
        const realLatency = Math.round(parseFloat(timeTotal) * 1000); // 转换为毫秒
        
        logger.info(`代理测试完成: HTTP ${httpCode}, 延迟: ${realLatency}ms`);
        
        if (httpCode === '200' || httpCode === '301' || httpCode === '302') {
          return {
            success: true,
            latency: realLatency,
            method: 'real_test',
            message: `通过代理成功访问 ${testUrl}`
          };
        } else {
          return {
            success: false,
            latency: -1,
            method: 'real_test',
            error: `HTTP响应异常: ${httpCode}`
          };
        }
        
      } catch (curlError) {
        logger.error('curl测试失败:', curlError.message);
        return {
          success: false,
          latency: -1,
          method: 'real_test',
          error: `代理连接测试失败: ${curlError.message}`
        };
      }
      
    } catch (error) {
      logger.error('真实代理延迟测试异常:', error);
      return {
        success: false,
        latency: -1,
        method: 'real_test',
        error: `测试异常: ${error.message}`
      };
    } finally {
      // 4. 清理资源
      try {
        if (tempProcess && !tempProcess.killed) {
          logger.info('终止临时V2Ray进程...');
          tempProcess.kill('SIGTERM');
          
          // 等待进程退出
          await new Promise((resolve) => {
            tempProcess.on('exit', resolve);
            setTimeout(() => {
              if (!tempProcess.killed) {
                tempProcess.kill('SIGKILL');
              }
              resolve();
            }, 3000);
          });
        }
        
        if (tempConfigPath) {
          await fs.unlink(tempConfigPath);
          logger.info('临时配置文件已删除');
        }
      } catch (cleanupError) {
        logger.warn('资源清理失败:', cleanupError.message);
      }
    }
  }

  /**
   * 生成V2Ray配置文件
   */
  async generateV2rayConfig(proxyConfig) {
    try {
      if (proxyConfig.type === 'vless') {
        return await this.generateVlessConfig(proxyConfig.config);
      } else if (proxyConfig.type === 'vmess') {
        return await this.generateVmessConfig(proxyConfig.config);
      } else {
        throw new Error(`不支持的代理类型: ${proxyConfig.type}`);
      }
    } catch (error) {
      logger.error('生成V2Ray配置失败:', error);
      throw error;
    }
  }

  /**
   * 生成VLESS配置
   */
  async generateVlessConfig(vlessUrl) {
    try {
      const url = new URL(vlessUrl);
      const uuid = url.username;
      const hostname = url.hostname;
      const port = parseInt(url.port) || 443;
      const params = new URLSearchParams(url.search);
      
      // 基础配置
      const config = {
        log: {
          loglevel: "warning"
        },
        inbounds: [{
          tag: "socks",
          port: 1080,
          listen: "127.0.0.1",
          protocol: "socks",
          settings: {
            auth: "noauth",
            udp: true
          }
        }],
        outbounds: [{
          tag: "proxy",
          protocol: "vless",
          settings: {
            vnext: [{
              address: hostname,
              port: port,
              users: [{
                id: uuid,
                encryption: params.get('encryption') || 'none'
              }]
            }]
          },
          streamSettings: {
            network: params.get('type') || 'tcp'
          }
        }]
      };

      // 处理不同的传输协议
      const network = params.get('type') || 'tcp';
      const security = params.get('security') || 'none';

      if (network === 'tcp') {
        config.outbounds[0].streamSettings.tcpSettings = {};
      } else if (network === 'xhttp') {
        config.outbounds[0].streamSettings.xhttpSettings = {
          host: params.get('host') || hostname,
          path: params.get('path') || '/',
          mode: params.get('mode') || 'auto'
        };
      }

      // 处理安全设置
      if (security === 'tls') {
        config.outbounds[0].streamSettings.security = 'tls';
        config.outbounds[0].streamSettings.tlsSettings = {
          serverName: params.get('sni') || hostname,
          allowInsecure: false
        };
      } else if (security === 'reality') {
        config.outbounds[0].streamSettings.security = 'reality';
        config.outbounds[0].streamSettings.realitySettings = {
          serverName: params.get('sni') || hostname,
          fingerprint: params.get('fp') || 'chrome',
          publicKey: params.get('pbk') || ''
        };
      }

      // 处理flow
      const flow = params.get('flow');
      if (flow) {
        config.outbounds[0].settings.vnext[0].users[0].flow = flow;
      }

      logger.info('生成VLESS配置成功:', { hostname, port, network, security });
      return config;
    } catch (error) {
      logger.error('生成VLESS配置失败:', error);
      throw new Error(`VLESS配置生成失败: ${error.message}`);
    }
  }

  /**
   * 生成VMess配置
   */
  async generateVmessConfig(vmessUrl) {
    try {
      // VMess URL解析和配置生成
      const base64Data = vmessUrl.replace('vmess://', '');
      const configData = JSON.parse(Buffer.from(base64Data, 'base64').toString());
      
      const config = {
        log: {
          loglevel: "warning"
        },
        inbounds: [{
          tag: "socks",
          port: 1080,
          listen: "127.0.0.1",
          protocol: "socks",
          settings: {
            auth: "noauth",
            udp: true
          }
        }],
        outbounds: [{
          tag: "proxy",
          protocol: "vmess",
          settings: {
            vnext: [{
              address: configData.add,
              port: parseInt(configData.port),
              users: [{
                id: configData.id,
                alterId: parseInt(configData.aid) || 0,
                security: configData.scy || 'auto'
              }]
            }]
          },
          streamSettings: {
            network: configData.net || 'tcp'
          }
        }]
      };

      logger.info('生成VMess配置成功:', { address: configData.add, port: configData.port });
      return config;
    } catch (error) {
      logger.error('生成VMess配置失败:', error);
      throw new Error(`VMess配置生成失败: ${error.message}`);
    }
  }

  /**
   * 测试代理配置（用于测试按钮）
   */
  async testProxyConfig(proxyConfig, testUrlId = 'baidu') {
    try {
      logger.info('测试代理配置:', proxyConfig.name);

      // 检查代理客户端
      const clientInfo = await this.checkProxyClientAvailable();
      if (!clientInfo) {
        return {
          success: false,
          latency: -1,
          method: 'real_test',
          error: 'V2Ray/Xray客户端不可用'
        };
      }

      // 简化的配置验证
      const parsed = this.parseProxyUrl(proxyConfig.config);
      logger.info('配置解析结果:', { address: parsed.address, port: parsed.port });
      
      if (!parsed.address || !parsed.port) {
        logger.error('配置解析失败:', parsed);
        return {
          success: false,
          latency: -1,
          method: 'real_test',
          error: '代理配置格式错误'
        };
      }

      // 真实代理连接延迟测试
      logger.info('开始调用testProxyLatency方法');
      try {
        const result = await this.testProxyLatency(proxyConfig, testUrlId);
        logger.info('testProxyLatency方法返回结果:', result);
        return result;
      } catch (error) {
        logger.error('testProxyLatency方法执行异常:', error);
        return {
          success: false,
          latency: -1,
          method: 'real_test',
          error: `testProxyLatency执行失败: ${error.message}`
        };
      }

    } catch (error) {
      logger.error('测试代理配置失败:', error);
      return {
        success: false,
        latency: -1,
        method: 'real_test',
        error: error.message
      };
    }
  }
}

module.exports = ProxyManager;
