/**
 * 日志工具函数
 */

/**
 * 记录信息日志
 */
export function logInfo(env, message, data = {}) {
  const logEntry = {
    level: 'INFO',
    message,
    data,
    timestamp: new Date().toISOString(),
    service: 'cloudflare-worker'
  };

  console.log(JSON.stringify(logEntry));

  // 在生产环境中可以发送到外部日志服务
  if (env.ENVIRONMENT === 'production') {
    // 例如发送到 Logflare, Datadog 等
  }
}

/**
 * 记录警告日志
 */
export function logWarn(env, message, data = {}) {
  const logEntry = {
    level: 'WARN',
    message,
    data,
    timestamp: new Date().toISOString(),
    service: 'cloudflare-worker'
  };

  console.warn(JSON.stringify(logEntry));
}

/**
 * 记录错误日志
 */
export function logError(env, message, error, data = {}) {
  const logEntry = {
    level: 'ERROR',
    message,
    error: {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    },
    data,
    timestamp: new Date().toISOString(),
    service: 'cloudflare-worker'
  };

  console.error(JSON.stringify(logEntry));

  // 在生产环境中发送错误报告
  if (env.ENVIRONMENT === 'production') {
    // 发送到错误跟踪服务
  }
}

/**
 * 记录API请求日志
 */
export function logApiRequest(env, request, response, duration, extras = {}) {
  const logEntry = {
    level: 'INFO',
    type: 'API_REQUEST',
    method: request.method,
    url: request.url,
    pathname: new URL(request.url).pathname,
    statusCode: response?.status,
    duration: `${duration}ms`,
    userAgent: request.headers.get('User-Agent'),
    cfRay: request.headers.get('CF-Ray'),
    cfConnectingIp: request.headers.get('CF-Connecting-IP'),
    cfCountry: request.headers.get('CF-IPCountry'),
    timestamp: new Date().toISOString(),
    ...extras
  };

  console.log(JSON.stringify(logEntry));
}

/**
 * 记录认证事件
 */
export function logAuthEvent(env, event, username, request, success = true, extras = {}) {
  const logEntry = {
    level: success ? 'INFO' : 'WARN',
    type: 'AUTH_EVENT',
    event,
    username,
    success,
    ip: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent'),
    cfRay: request.headers.get('CF-Ray'),
    cfCountry: request.headers.get('CF-IPCountry'),
    timestamp: new Date().toISOString(),
    ...extras
  };

  console.log(JSON.stringify(logEntry));
}

/**
 * 记录流媒体事件
 */
export function logStreamEvent(env, event, streamId, username, request, extras = {}) {
  const logEntry = {
    level: 'INFO',
    type: 'STREAM_EVENT',
    event,
    streamId,
    username,
    ip: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent'),
    cfRay: request.headers.get('CF-Ray'),
    timestamp: new Date().toISOString(),
    ...extras
  };

  console.log(JSON.stringify(logEntry));
}
