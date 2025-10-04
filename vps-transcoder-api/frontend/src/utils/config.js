/**
 * 应用配置管理
 * 统一管理环境变量和应用配置
 */

// 获取环境变量，提供默认值
const getEnvVar = (key, defaultValue = '') => {
  return import.meta.env[key] || defaultValue
}

// 应用基础配置
export const config = {
  // 应用信息
  app: {
    title: getEnvVar('VITE_APP_TITLE', 'YOYO流媒体平台'),
    version: getEnvVar('VITE_APP_VERSION', '1.0.0'),
    environment: getEnvVar('VITE_ENVIRONMENT', 'development'),
  },

  // API配置
  api: {
    baseURL: getEnvVar('VITE_API_BASE_URL', 'http://localhost:8787'),
    timeout: 30000, // 增加到30秒，适应FFmpeg启动时间
    withCredentials: true,
  },

  // HLS配置
  hls: {
    proxyURL: getEnvVar('VITE_HLS_PROXY_URL', 'http://localhost:8787/hls'),
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 90,
  },

  // Cloudflare Worker配置
  worker: {
    url: getEnvVar('VITE_WORKER_URL', 'https://your-worker.your-subdomain.workers.dev'),
  },

  // 调试配置
  debug: {
    enabled: getEnvVar('VITE_DEBUG', 'false') === 'true',
    logLevel: getEnvVar('VITE_LOG_LEVEL', 'info'),
  },

  // 视频播放器配置
  player: {
    autoplay: true,
    muted: true,
    controls: true,
    playsinline: true,
    maxRetries: 3,
    retryDelay: 2000,
  },

  // 缓存配置
  cache: {
    streamListTTL: 5 * 60 * 1000, // 5分钟
    userInfoTTL: 30 * 60 * 1000,  // 30分钟
  },

  // UI配置
  ui: {
    theme: 'light',
    locale: 'zh-CN',
    pageSize: 20,
    debounceDelay: 300,
  }
}

// 开发环境检查
export const isDevelopment = () => {
  return config.app.environment === 'development'
}

// 生产环境检查
export const isProduction = () => {
  return config.app.environment === 'production'
}

// 调试日志
export const debugLog = (...args) => {
  if (config.debug.enabled) {
    console.log('[DEBUG]', ...args)
  }
}

// 错误日志
export const errorLog = (...args) => {
  console.error('[ERROR]', ...args)
}

// 警告日志
export const warnLog = (...args) => {
  if (config.debug.logLevel !== 'error') {
    console.warn('[WARN]', ...args)
  }
}

// 信息日志
export const infoLog = (...args) => {
  if (['debug', 'info'].includes(config.debug.logLevel)) {
    console.info('[INFO]', ...args)
  }
}

// 导出默认配置
export default config
