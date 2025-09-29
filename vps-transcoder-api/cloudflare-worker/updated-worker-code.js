/**
 * YOYO流媒体平台 - Cloudflare Worker (手动部署版本)
 * 修复了CORS问题和添加了缺少的API端点
 */

// CORS工具函数
const ALLOWED_ORIGINS = [
  'https://yoyo.5202021.xyz',
  'https://yoyo-streaming.pages.dev',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:5173'
];

function getCorsHeaders(request = null) {
  let origin = '*';
  
  if (request && request.headers) {
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
      origin = requestOrigin;
    }
  }
  
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  };
}

function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  });
}

// 简单路由器
class Router {
  constructor() {
    this.routes = [];
  }
  
  get(path, handler) {
    this.routes.push({ method: 'GET', path, handler });
  }
  
  post(path, handler) {
    this.routes.push({ method: 'POST', path, handler });
  }
  
  async handle(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    
    for (const route of this.routes) {
      if (route.method === method && this.matchPath(route.path, url.pathname)) {
        return await route.handler(request, env, ctx);
      }
    }
    
    return null;
  }
  
  matchPath(routePath, urlPath) {
    if (routePath === urlPath) return true;
    
    const routeParts = routePath.split('/');
    const urlParts = urlPath.split('/');
    
    if (routeParts.length !== urlParts.length) return false;
    
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) continue;
      if (routeParts[i] !== urlParts[i]) return false;
    }
    
    return true;
  }
}

// 主要处理函数
export default {
  async fetch(request, env, ctx) {
    try {
      const router = new Router();
      
      // 处理CORS预检请求
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }
      
      // API状态端点
      router.get('/api/status', (req, env, ctx) => {
        return new Response(
          JSON.stringify({
            status: 'ok',
            message: 'YOYO Streaming Platform API v2 is running',
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            project: 'yoyo-api-v2'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(request)
            }
          }
        );
      });
      
      // 用户登录端点
      router.post('/login', async (req, env, ctx) => {
        try {
          const body = await req.json();
          const { username, password } = body;
          
          // 简单的用户验证（实际项目中应该使用数据库）
          if (username === 'admin' && password === 'admin123') {
            return new Response(
              JSON.stringify({
                status: 'success',
                message: 'Login successful',
                data: {
                  user: {
                    id: 1,
                    username: 'admin',
                    role: 'admin',
                    name: '管理员'
                  },
                  token: 'mock-jwt-token-' + Date.now()
                }
              }),
              {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  ...getCorsHeaders(request)
                }
              }
            );
          } else {
            return new Response(
              JSON.stringify({
                status: 'error',
                message: 'Invalid username or password'
              }),
              {
                status: 401,
                headers: {
                  'Content-Type': 'application/json',
                  ...getCorsHeaders(request)
                }
              }
            );
          }
        } catch (error) {
          return new Response(
            JSON.stringify({
              status: 'error',
              message: 'Invalid request body'
            }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...getCorsHeaders(request)
              }
            }
          );
        }
      });
      
      // 用户信息端点 (前端需要的)
      router.get('/api/user', (req, env, ctx) => {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              user: {
                id: 1,
                username: 'admin',
                role: 'admin',
                name: '管理员',
                email: 'admin@yoyo.com'
              }
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(request)
            }
          }
        );
      });
      
      // 用户信息端点 (备用)
      router.get('/api/me', (req, env, ctx) => {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              user: {
                id: 1,
                username: 'admin',
                role: 'admin',
                name: '管理员',
                email: 'admin@yoyo.com'
              }
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(request)
            }
          }
        );
      });
      
      // 流列表端点
      router.get('/api/streams', (req, env, ctx) => {
        return new Response(
          JSON.stringify({
            status: 'success',
            data: {
              streams: [
                {
                  id: 'stream1',
                  name: '测试频道1',
                  status: 'active',
                  url: 'https://example.com/stream1.m3u8'
                },
                {
                  id: 'stream2',
                  name: '测试频道2',
                  status: 'inactive',
                  url: 'https://example.com/stream2.m3u8'
                }
              ]
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(request)
            }
          }
        );
      });
      
      // 处理请求
      const response = await router.handle(request, env, ctx);
      
      if (response) {
        return response;
      }
      
      // 404处理
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Endpoint not found',
          path: new URL(request.url).pathname
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request)
          }
        }
      );
      
    } catch (error) {
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request)
          }
        }
      );
    }
  }
};
