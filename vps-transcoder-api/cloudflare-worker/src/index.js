/**
 * YOYO流媒体平台 - Cloudflare Worker
 * 主入口文件
 */

import { Router } from './router.js';
import { handleOptions, getCorsHeaders } from './utils/cors';
import { logError } from './utils/logger';

// 导入路由处理器
import { handleAuth } from './handlers/auth';
import { handleStreams } from './handlers/streams';
import { handleAdmin } from './handlers/admin';
import { handleProxy } from './handlers/proxy';
import { handleProxyManager } from './handlers/proxyManager.js';
import { handlePages } from './handlers/pages';
import { handleVerify } from './handlers/verify';
import { deploymentHandlers } from './handlers/deployment.js';

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
      router.post('/api/login', (req, env, ctx) => handleAuth.login(req, env, ctx));
      router.post('/api/logout', (req, env, ctx) => handleAuth.logout(req, env, ctx));
      router.get('/api/me', (req, env, ctx) => handleAuth.getCurrentUser(req, env, ctx));
      router.get('/api/user', (req, env, ctx) => handleAuth.getCurrentUser(req, env, ctx)); // 前端需要的端点

      // 🚫 调试端点已移除 - 减少KV读取消耗
      // 生产环境不应该暴露调试端点，避免不必要的KV操作

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

      // 初始化所有用户端点（包括管理员和普通用户）
      router.post('/api/init-users', async (req, env, ctx) => {
        try {
          // 导入密码哈希函数
          const { hashPassword, generateRandomString } = await import('./utils/crypto.js');
          
          const results = [];
          
          // 定义所有用户
          const users = [
            { username: 'admin', password: 'admin123', role: 'admin' },
            { username: 'yangyang', password: '123456', role: 'user' },
            { username: '凤凰', password: '123456', role: 'user' }
          ];
          
          for (const userInfo of users) {
            // 检查用户是否已存在
            const existingUser = await env.YOYO_USER_DB.get(`user:${userInfo.username}`);
            
            if (existingUser) {
              const userData = JSON.parse(existingUser);
              // 如果用户存在但缺少密码字段，则重新创建
              if (!userData.hashedPassword || !userData.salt) {
                console.log(`User ${userInfo.username} exists but missing password fields, recreating...`);
              } else {
                results.push({
                  username: userInfo.username,
                  status: 'already_exists',
                  role: userInfo.role
                });
                continue;
              }
            }
            
            // 生成密码哈希和盐值
            const salt = generateRandomString(16);
            const hashedPassword = await hashPassword(userInfo.password, salt);
            
            // 创建用户数据
            const userData = {
              username: userInfo.username,
              role: userInfo.role,
              hashedPassword: hashedPassword,
              salt: salt,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            
            // 存储到KV数据库
            await env.YOYO_USER_DB.put(`user:${userInfo.username}`, JSON.stringify(userData));
            
            results.push({
              username: userInfo.username,
              status: 'created',
              role: userInfo.role,
              createdAt: userData.createdAt
            });
          }
          
          // 初始化空的流配置（如果不存在）
          const existingStreams = await env.YOYO_USER_DB.get('streams:config');
          if (!existingStreams) {
            const initialStreams = [];
            await env.YOYO_USER_DB.put('streams:config', JSON.stringify(initialStreams));
          }
          
          return new Response(JSON.stringify({
            status: 'success',
            message: 'Users initialized successfully',
            data: {
              users: results,
              totalUsers: results.length,
              newUsers: results.filter(u => u.status === 'created').length,
              existingUsers: results.filter(u => u.status === 'already_exists').length
            }
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(req)
            }
          });
          
        } catch (error) {
          console.error('Init users error:', error);
          return new Response(JSON.stringify({
            status: 'error',
            message: 'Failed to initialize users',
            error: error.message
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(req)
            }
          });
        }
      });

      // 初始化管理员用户端点（修复登录页面持续刷新问题）
      router.post('/api/init-admin', async (req, env, ctx) => {
        try {
          console.log('Init admin request received');
          // 导入密码哈希函数
          const { hashPassword, generateRandomString } = await import('./utils/crypto.js');
          
          // 检查是否已存在管理员用户
          const existingUser = await env.YOYO_USER_DB.get('user:admin');
          if (existingUser) {
            const userData = JSON.parse(existingUser);
            // 如果用户存在但缺少密码字段，则重新创建
            if (!userData.hashedPassword || !userData.salt) {
              console.log('Admin user exists but missing password fields, recreating...');
            } else {
              return new Response(JSON.stringify({
                status: 'success',
                message: 'Admin user already exists with complete data',
                data: { username: 'admin', role: 'admin', status: 'already_exists' }
              }), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  ...getCorsHeaders(req)
                }
              });
            }
          }

          // 生成密码哈希和盐值
          const password = 'admin123';
          const salt = generateRandomString(16);
          const hashedPassword = await hashPassword(password, salt);

          // 创建完整的管理员用户数据
          const adminUser = {
            username: 'admin',
            role: 'admin',
            hashedPassword: hashedPassword,
            salt: salt,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          // 存储到KV数据库
          await env.YOYO_USER_DB.put('user:admin', JSON.stringify(adminUser));

          // 初始化空的流配置
          const initialStreams = [];
          await env.YOYO_USER_DB.put('streams:config', JSON.stringify(initialStreams));

          return new Response(JSON.stringify({
            status: 'success',
            message: 'Admin user initialized successfully with password',
            data: {
              username: adminUser.username,
              role: adminUser.role,
              createdAt: adminUser.createdAt,
              hasPassword: true
            }
          }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(req)
            }
          });

        } catch (error) {
          console.error('Init admin user error:', error);
          return new Response(JSON.stringify({
            status: 'error',
            message: 'Failed to initialize admin user',
            error: error.message
          }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(req)
            }
          });
        }
      });

      // 用户功能API
      router.get('/api/streams', (req, env, ctx) => handleStreams.getStreams(req, env, ctx));
      router.post('/api/play/:id', (req, env, ctx) => handleStreams.playStream(req, env, ctx));
      router.post('/api/stop/:id', (req, env, ctx) => handleStreams.stopStream(req, env, ctx));
      router.get('/api/stream/:id/status', (req, env, ctx) => handleStreams.getStreamStatus(req, env, ctx));
      router.get('/api/streams/status', (req, env, ctx) => handleStreams.getAllStreamsStatus(req, env, ctx));

      // 🔥 新增：SimpleStreamManager API路由
      router.post('/api/simple-stream/start-watching', (req, env, ctx) => handleStreams.startWatching(req, env, ctx));
      router.post('/api/simple-stream/stop-watching', (req, env, ctx) => handleStreams.stopWatching(req, env, ctx));
      router.post('/api/simple-stream/heartbeat', (req, env, ctx) => handleStreams.heartbeat(req, env, ctx));
      router.get('/api/simple-stream/system/status', (req, env, ctx) => handleStreams.getSystemStatus(req, env, ctx));

      // 管理员功能API - 注意路由顺序，更具体的路由要放在前面
      router.get('/api/admin/streams', (req, env, ctx) => handleAdmin.getStreams(req, env, ctx));
      router.post('/api/admin/streams', (req, env, ctx) => handleAdmin.createStream(req, env, ctx));
      router.put('/api/admin/streams/:id/sort', (req, env, ctx) => handleAdmin.updateStreamSort(req, env, ctx));
      router.put('/api/admin/streams/:id', (req, env, ctx) => handleAdmin.updateStream(req, env, ctx));
      router.delete('/api/admin/streams/:id', (req, env, ctx) => handleAdmin.deleteStream(req, env, ctx));
      
      // 系统状态相关API - 匹配前端调用路径
      router.get('/api/admin/status', (req, env, ctx) => handleAdmin.getSystemStatus(req, env, ctx));
      router.get('/api/admin/system/status', (req, env, ctx) => handleAdmin.getSystemStatus(req, env, ctx));
      
      // 缓存相关API
      router.get('/api/admin/cache/stats', (req, env, ctx) => handleAdmin.getCacheStats(req, env, ctx));
      router.post('/api/admin/cache/clear', (req, env, ctx) => handleAdmin.clearCache(req, env, ctx));
      
      // VPS健康检查API - 新增
      router.get('/api/admin/vps/health', (req, env, ctx) => handleAdmin.getVpsHealth(req, env, ctx));
      
      // 系统诊断API
      router.get('/api/admin/diagnostics', (req, env, ctx) => handleAdmin.getSystemDiagnostics(req, env, ctx));
      
      // 流量统计API
      router.get('/api/admin/traffic/stats', (req, env, ctx) => handleAdmin.getTrafficStats(req, env, ctx));
      
      // 登录日志API
      router.get('/api/admin/login/logs', (req, env, ctx) => handleAdmin.getLoginLogs(req, env, ctx));
      
      // 用户管理API - 新增
      router.get('/api/users', (req, env, ctx) => handleAdmin.getUsers(req, env, ctx));
      router.post('/api/users', (req, env, ctx) => handleAdmin.createUser(req, env, ctx));
      router.put('/api/users/:id', (req, env, ctx) => handleAdmin.updateUser(req, env, ctx));
      router.delete('/api/users/:id', (req, env, ctx) => handleAdmin.deleteUser(req, env, ctx));
      router.put('/api/users/:id/password', (req, env, ctx) => handleAdmin.changeUserPassword(req, env, ctx));
      router.put('/api/users/:id/status', (req, env, ctx) => handleAdmin.toggleUserStatus(req, env, ctx));
      
      // 代理管理API (已移至proxyManager处理器)
      
      // 隧道管理API路由
      router.get('/api/admin/tunnel/config', (req, env, ctx) => deploymentHandlers.getTunnelConfig(req, env, ctx));
      router.put('/api/admin/tunnel/config', (req, env, ctx) => deploymentHandlers.updateTunnelConfig(req, env, ctx));
      router.get('/api/admin/tunnel/status', (req, env, ctx) => deploymentHandlers.checkTunnelHealth(req, env, ctx));
      
      // 系统验证API - 用于验证KV优化效果和系统功能
      router.get('/api/verify/kv-optimization', (req, env, ctx) => handleVerify.verifyKVOptimization(req, env, ctx));
      router.get('/api/verify/login-function', (req, env, ctx) => handleVerify.verifyLoginFunction(req, env, ctx));
      router.get('/api/verify/system-health', (req, env, ctx) => handleVerify.systemHealthCheck(req, env, ctx));
      router.get('/api/verify/reset-admin', (req, env, ctx) => handleVerify.resetAdminUser(req, env, ctx));
      
      // 其他管理功能
      router.post('/api/admin/streams/reload', (req, env, ctx) => handleAdmin.reloadStreamsConfig(req, env, ctx));

      // HLS代理路由
      router.get('/hls/:streamId/:file', (req, env, ctx) => handleProxy.hlsFile(req, env, ctx));

      // 🔥 代理模式下的HLS流量路由 - 通过代理转发视频流量
      router.get('/tunnel-proxy/hls/:streamId/:file', (req, env, ctx) => handleProxy.hlsFile(req, env, ctx));

      // 代理管理路由 - 使用简化的admin处理器（参照频道管理模式）
      router.get('/api/admin/proxy/config', (req, env, ctx) => handleAdmin.getProxyConfig(req, env, ctx));
      router.post('/api/admin/proxy/config', (req, env, ctx) => handleAdmin.createProxyConfig(req, env, ctx));
      
      // 🔧 新增：全局配置和测试历史API
      router.get('/api/admin/proxy/global-config', (req, env, ctx) => handleAdmin.getGlobalConfig(req, env, ctx));
      router.put('/api/admin/proxy/global-config', (req, env, ctx) => handleAdmin.setGlobalConfig(req, env, ctx));
      router.get('/api/admin/proxy/test-history/:proxyId', (req, env, ctx) => handleAdmin.getProxyTestHistory(req, env, ctx));
      router.post('/api/admin/proxy/test', (req, env, ctx) => handleAdmin.testProxy(req, env, ctx));
      // 临时调试端点
      router.get('/api/admin/debug/r2-storage', (req, env, ctx) => handleAdmin.debugR2Storage(req, env, ctx));
      router.post('/api/admin/debug/r2-write-test', (req, env, ctx) => handleAdmin.testR2Write(req, env, ctx));
      
      // 其他代理功能仍使用ProxyManager处理器
      router.post('/api/admin/proxy/connect', (req, env, ctx) => handleProxyManager.connect(req, env, ctx));
      router.post('/api/admin/proxy/disconnect', (req, env, ctx) => handleProxyManager.disconnect(req, env, ctx));
      router.get('/api/admin/proxy/status', (req, env, ctx) => handleProxyManager.status(req, env, ctx));
      router.put('/api/admin/proxy/config/:id', (req, env, ctx) => handleProxyManager.updateProxy(req, env, ctx));
      router.delete('/api/admin/proxy/config/:id', (req, env, ctx) => handleProxyManager.deleteProxy(req, env, ctx));
      router.put('/api/admin/proxy/settings', (req, env, ctx) => handleProxyManager.updateSettings(req, env, ctx));
      router.post('/api/admin/proxy/control', (req, env, ctx) => handleProxyManager.control(req, env, ctx));

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
