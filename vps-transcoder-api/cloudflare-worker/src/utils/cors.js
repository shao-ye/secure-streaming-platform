/**
 * CORS工具函数
 */

// 允许的域名列表
const ALLOWED_ORIGINS = [
  // 生产环境域名
  'https://yoyo.5202021.xyz',
  
  // Cloudflare Pages部署域名
  'https://yoyo-streaming.pages.dev',
  'https://yoyo-streaming-frontend.pages.dev',
  
  // 自定义域名（如果有）
  'https://streaming.yourdomain.com',
  'https://admin.yourdomain.com',
  
  // 开发环境
  'http://localhost:3000',
  'http://localhost:8080',  // Vue开发服务器默认端口
  'http://localhost:8081',
  'http://localhost:5173',  // Vite开发服务器默认端口
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:5173',
  'https://127.0.0.1:8787',
  'http://127.0.0.1:8787'
];

/**
 * 获取CORS headers
 */
export function getCorsHeaders(request = null) {
  let origin = 'https://yoyo.5202021.xyz'; // 默认使用生产域名，避免通配符

  if (request && request.headers) {
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
      origin = requestOrigin;
    } else if (ALLOWED_ORIGINS.length > 0) {
      // 优先使用生产域名
      origin = 'https://yoyo.5202021.xyz';
    }
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, CF-Connecting-IP, CF-Ray, X-Tunnel-Optimized, X-Client-Type',
    'Access-Control-Expose-Headers': 'Set-Cookie',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400', // 24小时
    'Vary': 'Origin'
  };
}

/**
 * 处理OPTIONS预检请求
 */
export function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  });
}

/**
 * 创建带CORS头的响应
 */
export function createCorsResponse(body, options = {}) {
  const { status = 200, headers = {}, request } = options;

  const corsHeaders = request ? getCorsHeaders(request) : {
    'Access-Control-Allow-Origin': 'https://yoyo.5202021.xyz',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tunnel-Optimized, X-Client-Type',
    'Access-Control-Allow-Credentials': 'true'
  };

  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...headers
    }
  });
}

/**
 * 创建JSON响应（带CORS）
 */
export function jsonResponse(data, options = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return createCorsResponse(body, options);
}

/**
 * 创建错误响应
 */
export function errorResponse(message, code = 'ERROR', status = 500, request = null) {
  const errorData = {
    status: 'error',
    message,
    code,
    timestamp: new Date().toISOString()
  };

  return jsonResponse(errorData, { status, request });
}

/**
 * 创建成功响应
 */
export function successResponse(data, message = 'Success', request = null) {
  const responseData = {
    status: 'success',
    message,
    data,
    timestamp: new Date().toISOString()
  };

  return jsonResponse(responseData, { request });
}
