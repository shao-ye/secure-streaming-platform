/**
 * VPS服务端统一配置管理
 * 所有配置从环境变量读取，无默认值
 * 配置缺失时立即报错，强制显式配置
 */

class Config {
  constructor() {
    this.loadConfig();
    this.validateConfig();
  }

  /**
   * 加载所有配置
   */
  loadConfig() {
    // ========================================
    // 基础配置
    // ========================================
    this.port = parseInt(process.env.PORT);
    this.nodeEnv = process.env.NODE_ENV;
    
    // ========================================
    // 域名配置（必需）
    // ========================================
    this.vpsBaseUrl = process.env.VPS_BASE_URL;
    this.workersApiUrl = process.env.WORKERS_API_URL;
    this.tunnelBaseUrl = process.env.TUNNEL_BASE_URL;
    
    // ========================================
    // API密钥配置（必需）
    // ========================================
    this.vpsApiKey = process.env.VPS_API_KEY;
    this.workersApiKey = process.env.WORKERS_API_KEY;
    
    // ========================================
    // 第三方服务配置（可选）
    // ========================================
    this.holidayApiUrl = process.env.HOLIDAY_API_URL;
    
    // ========================================
    // 测试配置（可选）
    // ========================================
    this.proxyTestBaidu = process.env.PROXY_TEST_BAIDU;
    this.proxyTestGoogle = process.env.PROXY_TEST_GOOGLE;
    this.proxyTestDefault = process.env.PROXY_TEST_DEFAULT;
    
    // ========================================
    // 端口配置（可选）
    // ========================================
    this.socks5Port = process.env.SOCKS5_PORT ? parseInt(process.env.SOCKS5_PORT) : undefined;
    
    // ========================================
    // CORS配置
    // ========================================
    this.allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || [];
    
    // ========================================
    // 路径配置（必需）
    // ========================================
    this.hlsOutputDir = process.env.HLS_OUTPUT_DIR;
    this.logDir = process.env.LOG_DIR;
  }

  /**
   * 验证必需配置
   */
  validateConfig() {
    // 必需的配置项
    const required = {
      'PORT': this.port,
      'NODE_ENV': this.nodeEnv,
      'VPS_BASE_URL': this.vpsBaseUrl,
      'WORKERS_API_URL': this.workersApiUrl,
      'VPS_API_KEY': this.vpsApiKey,
      'HLS_OUTPUT_DIR': this.hlsOutputDir,
      'LOG_DIR': this.logDir
    };

    const missing = [];
    const invalid = [];

    // 检查缺失的配置
    for (const [key, value] of Object.entries(required)) {
      if (value === undefined || value === null || value === '') {
        missing.push(key);
      }
    }

    // 验证PORT
    if (this.port && (isNaN(this.port) || this.port <= 0 || this.port > 65535)) {
      invalid.push('PORT must be a number between 1 and 65535');
    }

    // 验证NODE_ENV
    if (this.nodeEnv && !['development', 'production', 'test', 'staging'].includes(this.nodeEnv)) {
      invalid.push('NODE_ENV must be one of: development, production, test, staging');
    }

    // 验证URL格式
    const urlFields = [
      { key: 'VPS_BASE_URL', value: this.vpsBaseUrl },
      { key: 'WORKERS_API_URL', value: this.workersApiUrl },
      { key: 'TUNNEL_BASE_URL', value: this.tunnelBaseUrl }
    ];

    for (const { key, value } of urlFields) {
      if (value && !value.startsWith('http://') && !value.startsWith('https://')) {
        invalid.push(`${key} must start with http:// or https://`);
      }
    }

    // 报告错误
    const errors = [];

    if (missing.length > 0) {
      errors.push('❌ Missing required environment variables:');
      missing.forEach(key => errors.push(`  - ${key}`));
    }

    if (invalid.length > 0) {
      errors.push('❌ Invalid configuration:');
      invalid.forEach(msg => errors.push(`  - ${msg}`));
    }

    if (errors.length > 0) {
      const errorMessage = '\n' + errors.join('\n') + '\n\n' +
        '💡 Please check your .env file or environment variables.\n' +
        '📄 See .env.example for reference.\n';
      
      console.error(errorMessage);
      throw new Error('Configuration validation failed');
    }

    console.log('✅ Configuration validated successfully');
  }

  /**
   * 打印配置信息（隐藏敏感信息）
   */
  printConfig() {
    const maskSecret = (value) => {
      if (!value) return '(not set)';
      if (value.length <= 8) return '***';
      return '***' + value.slice(-4);
    };

    console.log('\n📋 Current Configuration:');
    console.log('  🔧 Basic:');
    console.log(`    - Port: ${this.port}`);
    console.log(`    - Environment: ${this.nodeEnv}`);
    console.log('  🌐 Domains:');
    console.log(`    - VPS Base URL: ${this.vpsBaseUrl}`);
    console.log(`    - Workers API URL: ${this.workersApiUrl}`);
    console.log(`    - Tunnel Base URL: ${this.tunnelBaseUrl || '(not set)'}`);
    console.log('  🔑 API Keys:');
    console.log(`    - VPS API Key: ${maskSecret(this.vpsApiKey)}`);
    console.log(`    - Workers API Key: ${maskSecret(this.workersApiKey)}`);
    console.log('  🌍 Third-party:');
    console.log(`    - Holiday API: ${this.holidayApiUrl || '(not set)'}`);
    console.log('  🧪 Testing:');
    console.log(`    - Test Baidu: ${this.proxyTestBaidu || '(not set)'}`);
    console.log(`    - Test Google: ${this.proxyTestGoogle || '(not set)'}`);
    console.log('  📁 Paths:');
    console.log(`    - HLS Output: ${this.hlsOutputDir}`);
    console.log(`    - Logs: ${this.logDir}`);
    console.log('  🔌 Ports:');
    console.log(`    - SOCKS5: ${this.socks5Port || 1080}`);
    console.log('');
  }

  /**
   * 获取可选配置的默认值
   * 仅用于可选配置项
   */
  getOptionalValue(value, defaultValue) {
    return value !== undefined && value !== null && value !== '' ? value : defaultValue;
  }
}

// 创建单例
let configInstance = null;

function getConfig() {
  if (!configInstance) {
    configInstance = new Config();
    
    // 仅在非生产环境打印配置
    if (configInstance.nodeEnv !== 'production') {
      configInstance.printConfig();
    }
  }
  return configInstance;
}

module.exports = getConfig();
