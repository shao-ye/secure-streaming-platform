/**
 * YOYO流媒体平台 - Cloudflare Worker
 * 主入口文件
 */

import { Router } from './router';
import { handleOptions, getCorsHeaders } from './utils/cors';
import { logError } from './utils/logger';

// 导入路由处理器
import { handleAuth } from './handlers/auth';
import { handleStreams } from './handlers/streams';
import { handleAdmin } from './handlers/admin';
import { handleProxy } from './handlers/proxy';
import { handlePages } from './handlers/pages';

export default {
  async fetch(request, env, ctx) {
    try {
      // 创建路由器实例
      const router = new Router();

      // 处理CORS预检请求
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }

      // 注册路由处理器

      // 页面路由（静态页面）
      router.get('/', (req, env, ctx) => handlePages.dashboard(req, env, ctx));
      router.get('/login', (req, env, ctx) => handlePages.login(req, env, ctx));
      router.get('/admin', (req, env, ctx) => handlePages.admin(req, env, ctx));

      // 认证相关API
      router.post('/login', (req, env, ctx) => handleAuth.login(req, env, ctx));
      router.post('/logout', (req, env, ctx) => handleAuth.logout(req, env, ctx));
      router.get('/api/me', (req, env, ctx) => handleAuth.getCurrentUser(req, env, ctx));
      router.get('/api/user', (req, env, ctx) => handleAuth.getCurrentUser(req, env, ctx)); // 前端需要的端点

      // 系统状态API（通用）
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

      // 用户功能API
      router.get('/api/streams', (req, env, ctx) => handleStreams.getStreams(req, env, ctx));
      router.post('/api/play/:id', (req, env, ctx) => handleStreams.playStream(req, env, ctx));
      router.post('/api/stop/:id', (req, env, ctx) => handleStreams.stopStream(req, env, ctx));
      router.get('/api/stream/:id/status', (req, env, ctx) => handleStreams.getStreamStatus(req, env, ctx));
      router.get('/api/streams/status', (req, env, ctx) => handleStreams.getAllStreamsStatus(req, env, ctx));

      // 管理员功能API
      router.get('/api/admin/streams', (req, env, ctx) => handleAdmin.getStreams(req, env, ctx));
      router.post('/api/admin/streams', (req, env, ctx) => handleAdmin.createStream(req, env, ctx));
      router.put('/api/admin/streams/:id', (req, env, ctx) => handleAdmin.updateStream(req, env, ctx));
      router.delete('/api/admin/streams/:id', (req, env, ctx) => handleAdmin.deleteStream(req, env, ctx));
      router.get('/api/admin/status', (req, env, ctx) => handleAdmin.getSystemStatus(req, env, ctx));
      router.get('/api/admin/cache/stats', (req, env, ctx) => handleAdmin.getCacheStats(req, env, ctx));
      router.post('/api/admin/cache/clear', (req, env, ctx) => handleAdmin.clearCache(req, env, ctx));
      router.post('/api/admin/streams/reload', (req, env, ctx) => handleAdmin.reloadStreamsConfig(req, env, ctx));
      router.get('/api/admin/diagnostics', (req, env, ctx) => handleAdmin.getSystemDiagnostics(req, env, ctx));

      // HLS代理路由
      router.get('/hls/:streamId/:file', (req, env, ctx) => handleProxy.hlsFile(req, env, ctx));

      // 静态资源路由（用于前端资源）
      router.get('/static/*', (req, env, ctx) => handlePages.static(req, env, ctx));

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
      // 全局错误处理
      await logError(env, 'Global error handler', error, {
        url: request.url,
        method: request.method,
        userAgent: request.headers.get('User-Agent'),
        cfRay: request.headers.get('CF-Ray'),
        cfConnectingIp: request.headers.get('CF-Connecting-IP')
      });

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
  },

  // 定时任务处理器（可选）
  async scheduled(controller, env, ctx) {
    try {
      // 清理过期会话
      console.log('Running scheduled task: cleanup expired sessions');
      // 实现会话清理逻辑

    } catch (error) {
      await logError(env, 'Scheduled task error', error);
    }
  }
};
