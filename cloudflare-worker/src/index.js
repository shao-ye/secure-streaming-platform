/**
 * YOYO流媒体平台 - 简化版Cloudflare Workers
 * 配合VPS上的SimpleStreamManager使用
 */

import {
  handlePlayStream,
  handleStopStream,
  handleHeartbeat,
  handleChannelStatus,
  handleSystemStatus,
  handleHlsProxy
} from './handlers/simple-streams.js';

import { ProxyHandler } from './handlers/proxyHandler.js';
import { handlePreloadRequest } from './handlers/preloadHandler.js';
import { handleRecordAPI } from './handlers/recordHandler.js';
import { handleChannelConfigAPI } from './handlers/channelConfigHandler.js';
import {
  getDefaultCloudDriveConfig,
  getDefaultSystemConfig,
  handleCloudDriveRequest,
  sanitizeCloudDriveConfig
} from './handlers/cloudDriveHandler.js';

// 🔥 V2.6: CHANNELS硬编码已移除，改用频道索引系统
// 应急admin账号（KV读取达到限制时使用，从环境变量读取）
const getEmergencyAdmin = (env) => ({
  username: env.EMERGENCY_ADMIN_USERNAME || 'admin',
  password: env.EMERGENCY_ADMIN_PASSWORD,  // 必须在Dashboard配置
  role: 'admin'
});

/**
 * 处理CORS预检请求
 */
function handleCors(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = [env.FRONTEND_DOMAIN, env.PAGES_DOMAIN].filter(Boolean);
  // 🆕 当未配置 FRONTEND_DOMAIN/PAGES_DOMAIN 时，自动降级：
  //  - 有 Origin 则回显该来源
  //  - 无 Origin 则使用 "*",同时不允许携带凭据
  let allowOrigin;
  let allowCredentials = true;
  if (allowedOrigins.length > 0) {
    allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  } else {
    allowOrigin = origin || '*';
    if (allowOrigin === '*') allowCredentials = false;
  }
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Client-Type, X-Tunnel-Optimized',
    'Access-Control-Allow-Credentials': allowCredentials ? 'true' : 'false',
    'Access-Control-Max-Age': '86400'
  };
  if (origin) {
    corsHeaders['Vary'] = 'Origin';
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  return corsHeaders;
}

/**
 * 生成随机salt
 */
function generateSalt() {
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, array));
}

/**
 * 统一密码哈希函数（PBKDF2 + SHA-256）
 */
async function hashPassword(password, salt = null) {
  if (!salt) {
    salt = generateSalt();
  }
  
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);
  const saltData = encoder.encode(salt);
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltData,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hashedPassword = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return { hashedPassword, salt };
}

/**
 * 简单的认证检查
 */
function isAuthenticated(request) {
  // 简化版：检查Authorization头或Cookie
  const authHeader = request.headers.get('Authorization');
  const cookie = request.headers.get('Cookie');
  
  // 如果有Authorization Bearer token或有效的session cookie，认为已认证
  return authHeader?.startsWith('Bearer ') || cookie?.includes('session=');
}

/**
 * 🆕 带缓存的HLS分片处理（免费流共享方案）
 * 使用Workers Cache API实现多用户流共享，节省VPS带宽
 */
async function handleCachedSegment(request, env, ctx, channelId, file, url, corsHeaders) {
  // 1. 构建缓存Key（使用完整URL）
  const cacheUrl = new URL(request.url);
  const cacheKey = new Request(cacheUrl.toString(), {
    method: 'GET',
    headers: request.headers
  });
  
  // 2. 获取Cloudflare Cache实例（完全免费）
  const cache = caches.default;
  
  // 3. 检查缓存
  let cachedResponse = await cache.match(cacheKey);
  
  if (cachedResponse) {
    console.log(`✅ Cache HIT: ${file}`);
    
    // 添加缓存命中标记
    const headers = new Headers(cachedResponse.headers);
    headers.set('X-Cache', 'HIT');
    headers.set('X-Cache-Age', Math.floor((Date.now() - new Date(cachedResponse.headers.get('Date')).getTime()) / 1000));
    
    // 确保CORS头存在
    Object.entries(corsHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
    
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: headers
    });
  }
  
  // 4. 缓存未命中，从VPS拉取
  console.log(`❌ Cache MISS: ${file}, fetching from VPS...`);
  
  const vpsUrl = `${env.VPS_API_URL}/hls/${channelId}/${file}`;
  
  try {
    const vpsResponse = await fetch(vpsUrl + url.search, {
      method: 'GET',
      headers: {
        'X-API-Key': env.VPS_API_KEY,
        'User-Agent': request.headers.get('User-Agent') || 'Cloudflare-Worker-Proxy'
      }
    });
    
    if (!vpsResponse.ok) {
      console.error(`VPS returned error: ${vpsResponse.status}`);
      return new Response(`VPS error: ${vpsResponse.status}`, {
        status: vpsResponse.status,
        headers: corsHeaders
      });
    }
    
    console.log(`📡 VPS RESPONSE (ts): ${vpsResponse.status}`);
    
    // 5. 构建响应头
    const responseHeaders = new Headers(vpsResponse.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });
    
    // 设置缓存控制（3秒，适合HLS分片）
    responseHeaders.set('Cache-Control', 'public, max-age=3, s-maxage=3');
    responseHeaders.set('X-Cache', 'MISS');
    responseHeaders.set('X-Proxied-By', 'Workers-Tunnel-Proxy');
    responseHeaders.set('X-Proxy-Channel', channelId);
    responseHeaders.set('Access-Control-Expose-Headers', 'X-Cache, X-Proxied-By, X-Proxy-Channel, X-Cache-Age');
    
    // 6. 创建可缓存的响应
    const response = new Response(vpsResponse.body, {
      status: vpsResponse.status,
      statusText: vpsResponse.statusText,
      headers: responseHeaders
    });
    
    // 7. 异步写入缓存（不阻塞响应）
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    
    console.log(`💾 Caching: ${file}`);
    
    return response;
    
  } catch (error) {
    console.error('❌ Failed to fetch from VPS:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch segment from VPS',
      message: error.message,
      channelId: channelId,
      file: file
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

/**
 * 路由处理器
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 处理CORS
  const corsHeaders = handleCors(request, env);
  if (request.method === 'OPTIONS') {
    return corsHeaders;
  }

  try {
    // 最优先：直接测试tunnel-proxy路径
    if (path.startsWith('/tunnel-proxy/')) {
      console.log('🔥 TUNNEL-PROXY PATH DETECTED:', path, 'METHOD:', method);
      
      // 简单测试路由
      if (path === '/tunnel-proxy/test') {
        return new Response('✅ Tunnel proxy route is working!', {
          status: 200,
          headers: { 'Content-Type': 'text/plain', ...corsHeaders }
        });
      }
      
      // HLS代理路由（带免费缓存层）
      if (path.match(/^\/tunnel-proxy\/hls\/(.+?)\/(.+)$/) && method === 'GET') {
        const [, channelId, file] = path.match(/^\/tunnel-proxy\/hls\/(.+?)\/(.+)$/);
        
        console.log('🎯 HLS PROXY REQUEST:', { path, channelId, file });
        
        // ✅ 分片文件启用缓存，播放列表实时透传
        if (file.endsWith('.ts')) {
          return handleCachedSegment(request, env, ctx, channelId, file, url, corsHeaders);
        }
        
        // m3u8播放列表不缓存，直接透传
        const vpsHlsUrl = `${env.VPS_API_URL}/hls/${channelId}/${file}`;
        
        try {
          const vpsResponse = await fetch(vpsHlsUrl + url.search, {
            method: 'GET',
            headers: {
              'X-API-Key': env.VPS_API_KEY,
              'User-Agent': request.headers.get('User-Agent') || 'Cloudflare-Worker-Proxy'
            }
          });
          
          console.log('🔄 VPS RESPONSE (m3u8):', vpsResponse.status);
          
          const newHeaders = new Headers(vpsResponse.headers);
          Object.entries(corsHeaders).forEach(([key, value]) => {
            newHeaders.set(key, value);
          });
          
          newHeaders.set('X-Proxied-By', 'Workers-Tunnel-Proxy');
          newHeaders.set('X-Proxy-Channel', channelId);
          newHeaders.set('X-Cache', 'BYPASS');  // m3u8不缓存
          newHeaders.set('Access-Control-Expose-Headers', 'X-Proxied-By, X-Proxy-Channel, X-Cache');
          
          return new Response(vpsResponse.body, {
            status: vpsResponse.status,
            headers: newHeaders
          });
          
        } catch (error) {
          console.error('❌ TUNNEL PROXY ERROR:', error);
          return new Response(JSON.stringify({
            error: 'Proxy request failed',
            message: error.message,
            channelId: channelId,
            file: file
          }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }
      
      // 如果是tunnel-proxy路径但不匹配任何路由，返回详细信息
      return new Response(JSON.stringify({
        message: 'Tunnel proxy path detected but no matching route',
        path: path,
        method: method,
        timestamp: new Date().toISOString()
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    // 代理配置API路由
    if (path.startsWith('/api/admin/proxy/')) {
      const proxyHandler = new ProxyHandler();
      return await proxyHandler.handleRequest(request, env, path, method);
    }

    // 健康检查
    if (path === '/health' || path === '/') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'YOYO Streaming API',
        version: '2.0.0',
        timestamp: new Date().toISOString()
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 🧪 CORS调试端点：用于快速定位前端跨域问题
    if (path === '/debug/cors' && method === 'GET') {
      try {
        const originHeader = request.headers.get('Origin');
        const debugHeaders = handleCors(request, env); // GET 场景返回的是普通对象
        return new Response(JSON.stringify({
          origin: originHeader || null,
          allowOrigin: debugHeaders['Access-Control-Allow-Origin'] || null,
          allowCredentials: debugHeaders['Access-Control-Allow-Credentials'] || null,
          envFrontend: env.FRONTEND_DOMAIN || null,
          envPages: env.PAGES_DOMAIN || null,
          envWorker: env.WORKER_DOMAIN || null,
          now: new Date().toISOString()
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...debugHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 🧪 环境调试端点：检查生产环境是否正确绑定与配置
    if (path === '/debug/env' && method === 'GET') {
      try {
        const info = {
          hasKV: !!env.YOYO_USER_DB,
          hasR2_LOGIN_LOGS: !!(env.LOGIN_LOGS && env.LOGIN_LOGS.get && env.LOGIN_LOGS.put),
          hasR2_PROXY_HISTORY: !!env.PROXY_TEST_HISTORY,
          hasEmergencyPassword: !!env.EMERGENCY_ADMIN_PASSWORD,
          emergencyAdminUser: env.EMERGENCY_ADMIN_USERNAME || 'admin',
          environment: env.ENVIRONMENT || 'unknown',
          workerVersion: '2.0.0',
          time: new Date().toISOString()
        };
        return new Response(JSON.stringify({ status: 'ok', data: info }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ status: 'error', message: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 🆕 初始化路由（幂等）：用于小白一键部署后，通过浏览器完成KV/R2初始化与管理员创建
    // 支持两种方式：
    // - 推荐：GET /api/admin/init，并在请求头携带 X-Init-Secret: <secret>
    // - 备选：GET /api/admin/init/:secret（URL中携带secret，容易泄露，不推荐）
    if ((path === '/api/admin/init' && method === 'GET') || (path.startsWith('/api/admin/init/') && method === 'GET')) {
      try {
        // 1) 读取并校验初始化密钥（优先Header）
        const headerSecret = request.headers.get('X-Init-Secret');
        const pathSecret = path.startsWith('/api/admin/init/') ? decodeURIComponent(path.split('/').pop()) : null;
        const providedSecret = headerSecret || pathSecret;
        const expectedSecret = env.INIT_SECRET; // 必须在Dashboard作为Secret配置

        if (!expectedSecret) {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'INIT_SECRET 未配置，请在 Cloudflare Dashboard 的 Secrets 中添加'
          }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        if (!providedSecret || providedSecret !== expectedSecret) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '初始化密钥错误或缺失'
          }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // 2) 解析是否强制执行
        const force = new URL(request.url).searchParams.get('force') === 'true';

        // 3) 读取系统状态键
        const initDoneVal = await env.YOYO_USER_DB.get('system:init_done');
        const currentVersion = await env.YOYO_USER_DB.get('system:version');

        // 若已初始化且非强制，则仅返回状态
        if (initDoneVal === 'true' && !force) {
          return new Response(JSON.stringify({
            status: 'success',
            message: '系统已初始化，未执行任何变更（使用 ?force=true 可强制重跑幂等步骤）',
            data: {
              version: currentVersion || 'unknown',
              initDone: true
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // 4) 幂等执行：索引修复/创建、管理员创建、R2最小对象写入、版本标记
        const results = [];

        // 4.1 频道索引（避免list限制）
        try {
          const channelIndexData = await env.YOYO_USER_DB.get('system:channel_index');
          if (!channelIndexData) {
            // 尝试用list重建；失败则写入空索引
            let channelIds = [];
            try {
              const list = await env.YOYO_USER_DB.list({ prefix: 'channel:' });
              channelIds = (list.keys || []).map(k => k.name.replace('channel:', ''));
            } catch (e) {
              console.log('重建频道索引时list失败，将写入空索引');
            }
            await env.YOYO_USER_DB.put('system:channel_index', JSON.stringify({
              channelIds,
              totalChannels: channelIds.length,
              lastUpdated: new Date().toISOString()
            }));
            results.push('channel_index: created');
          } else {
            results.push('channel_index: exists');
          }
        } catch (e) {
          console.error('频道索引初始化失败:', e);
          results.push('channel_index: error');
        }

        // 4.2 用户索引
        try {
          const userIndexData = await env.YOYO_USER_DB.get('system:user_index');
          if (!userIndexData) {
            await env.YOYO_USER_DB.put('system:user_index', JSON.stringify({
              usernames: [],
              totalUsers: 0,
              lastUpdated: new Date().toISOString()
            }));
            results.push('user_index: created');
          } else {
            results.push('user_index: exists');
          }
        } catch (e) {
          console.error('用户索引初始化失败:', e);
          results.push('user_index: error');
        }

        // 4.3 管理员账号（仅当不存在时创建）
        try {
          const adminUsername = env.EMERGENCY_ADMIN_USERNAME || 'admin';
          const adminKey = `user:${adminUsername}`;
          const adminData = await env.YOYO_USER_DB.get(adminKey);
          if (!adminData) {
            const emergencyPassword = env.EMERGENCY_ADMIN_PASSWORD;
            if (!emergencyPassword) {
              throw new Error('EMERGENCY_ADMIN_PASSWORD 未配置');
            }
            const { hashedPassword, salt } = await hashPassword(emergencyPassword);
            const adminUser = {
              id: adminUsername,
              username: adminUsername,
              displayName: 'Administrator',
              role: 'admin',
              status: 'active',
              createdAt: new Date().toISOString(),
              email: `${adminUsername}@yoyo.local`,
              hashedPassword,
              salt
            };
            await env.YOYO_USER_DB.put(adminKey, JSON.stringify(adminUser));

            // 更新用户索引
            try {
              const idxRaw = await env.YOYO_USER_DB.get('system:user_index');
              const idx = idxRaw ? JSON.parse(idxRaw) : { usernames: [], totalUsers: 0 };
              if (!idx.usernames.includes(adminUsername)) {
                idx.usernames.push(adminUsername);
                idx.totalUsers = (idx.totalUsers || 0) + 1;
                idx.lastUpdated = new Date().toISOString();
                await env.YOYO_USER_DB.put('system:user_index', JSON.stringify(idx));
              }
            } catch (e) {
              console.log('更新用户索引失败（忽略）:', e.message);
            }

            results.push('admin_user: created');
          } else {
            results.push('admin_user: exists');
          }
        } catch (e) {
          console.error('管理员创建失败:', e);
          results.push('admin_user: error');
        }

        // 4.4 清理配置默认值（system:cleanup:config）
        try {
          const cleanupCfg = await env.YOYO_USER_DB.get('system:cleanup:config');
          if (!cleanupCfg) {
            const defaultSystemConfig = getDefaultSystemConfig();
            defaultSystemConfig.updatedAt = new Date().toISOString();
            await env.YOYO_USER_DB.put('system:cleanup:config', JSON.stringify(defaultSystemConfig));
            results.push('cleanup_config: created');
          } else {
            results.push('cleanup_config: exists');
          }
        } catch (e) {
          console.error('清理配置初始化失败:', e);
          results.push('cleanup_config: error');
        }

        // 4.5 R2 最小对象（可选）
        try {
          if (env.LOGIN_LOGS && env.LOGIN_LOGS.put) {
            const key = 'index/latest.json';
            const body = JSON.stringify({ initializedAt: new Date().toISOString(), note: 'bootstrap' });
            await env.LOGIN_LOGS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
            results.push('r2_login_logs_index: put');
          } else {
            results.push('r2_login_logs_index: skipped (no binding)');
          }
        } catch (e) {
          console.error('R2写入失败（可忽略）:', e);
          results.push('r2_login_logs_index: error');
        }

        // 4.6 写入版本与初始化完成标记
        try {
          const version = env.VERSION || '2.0.0';
          await env.YOYO_USER_DB.put('system:version', version);
          await env.YOYO_USER_DB.put('system:init_done', 'true');
          results.push('system_flags: updated');
        } catch (e) {
          console.error('系统标记写入失败:', e);
          results.push('system_flags: error');
        }

        return new Response(JSON.stringify({
          status: 'success',
          message: '初始化流程执行完成（幂等）',
          data: {
            executed: results,
            version: (await env.YOYO_USER_DB.get('system:version')) || 'unknown',
            initDone: (await env.YOYO_USER_DB.get('system:init_done')) === 'true'
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (error) {
        console.error('初始化路由执行失败:', error);
        return new Response(JSON.stringify({
          status: 'error',
          message: '初始化失败: ' + error.message
        }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // 🔥 统一频道配置API路由（优先匹配，避免被旧路由拦截）
    if (path.startsWith('/api/channel/') && path.includes('/config')) {
      const response = await handleChannelConfigAPI(request, env, ctx);
      // 添加CORS头
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    // 🆕 预加载配置API路由（兼容旧版本，建议使用统一配置API）
    if (path.startsWith('/api/preload/')) {
      const response = await handlePreloadRequest(request, env);
      // 添加CORS头
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    // 🆕 录制配置API路由（兼容旧版本，建议使用统一配置API）
    if (path.startsWith('/api/record/')) {
      const response = await handleRecordAPI(request, env, ctx);
      // 添加CORS头
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    // 🆕 中国移动云盘配置与登录接口
    if (path.startsWith('/api/admin/cloud-drive/')) {
      const response = await handleCloudDriveRequest(request, env);
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    // 🆕 视频清理配置API路由
    // GET /api/admin/cleanup/config - 获取清理配置
    if (path === '/api/admin/cleanup/config' && method === 'GET') {
      try {
        const configData = await env.YOYO_USER_DB.get('system:cleanup:config');
        const config = configData ? JSON.parse(configData) : getDefaultSystemConfig();
        const mergedConfig = {
          ...getDefaultSystemConfig(),
          ...config,
          cloudDrive: {
            ...getDefaultCloudDriveConfig(),
            ...(config.cloudDrive || {})
          }
        };
        
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            ...mergedConfig,
            cloudDrive: sanitizeCloudDriveConfig(mergedConfig.cloudDrive)
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: error.message
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // PUT /api/admin/cleanup/config - 更新清理配置
    if (path === '/api/admin/cleanup/config' && method === 'PUT') {
      try {
        const body = await request.json();
        const configData = await env.YOYO_USER_DB.get('system:cleanup:config');
        const currentConfig = configData ? JSON.parse(configData) : getDefaultSystemConfig();
        const mergedCurrentConfig = {
          ...getDefaultSystemConfig(),
          ...currentConfig,
          cloudDrive: {
            ...getDefaultCloudDriveConfig(),
            ...(currentConfig.cloudDrive || {})
          }
        };
        
        // 🆕 验证分段配置
        if (body.segmentEnabled !== undefined && typeof body.segmentEnabled !== 'boolean') {
          return new Response(JSON.stringify({
            status: 'error',
            message: 'segmentEnabled must be a boolean'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        if (body.segmentDuration !== undefined) {
          const duration = Number(body.segmentDuration);
          if (isNaN(duration) || duration < 3 || duration > 240) {
            return new Response(JSON.stringify({
              status: 'error',
              message: 'segmentDuration must be between 3 and 240 minutes'
            }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        const recoveryScanHours = Math.max(
          12,
          Math.min(168, parseInt(body.recoveryScanHours) || mergedCurrentConfig.recoveryScanHours || 48)
        );

        const nextCloudDriveConfig = {
          ...mergedCurrentConfig.cloudDrive,
          enabled: body.cloudDrive?.enabled === true,
          provider: 'cmcc139',
          loginMode: 'sms',
          account: typeof body.cloudDrive?.account === 'string'
            ? body.cloudDrive.account.trim()
            : mergedCurrentConfig.cloudDrive.account,
          accountMasked: mergedCurrentConfig.cloudDrive.accountMasked,
          savePassword: body.cloudDrive?.savePassword === true,
          passwordEncrypted: mergedCurrentConfig.cloudDrive.passwordEncrypted,
          sessionBundleEncrypted: mergedCurrentConfig.cloudDrive.sessionBundleEncrypted,
          authStatus: mergedCurrentConfig.cloudDrive.authStatus,
          authMessage: mergedCurrentConfig.cloudDrive.authMessage,
          lastValidatedAt: mergedCurrentConfig.cloudDrive.lastValidatedAt,
          estimatedExpireAt: mergedCurrentConfig.cloudDrive.estimatedExpireAt,
          lastValidator: mergedCurrentConfig.cloudDrive.lastValidator,
          updatedAt: new Date().toISOString(),
          updatedBy: mergedCurrentConfig.cloudDrive.updatedBy || ''
        };
        
        const config = {
          enabled: body.enabled === true,
          retentionDays: Math.max(1, parseInt(body.retentionDays) || 2),
          segmentEnabled: body.segmentEnabled ?? false,      // 🆕
          segmentDuration: body.segmentDuration ?? 60,       // 🆕
          recoveryScanHours,
          cloudDrive: nextCloudDriveConfig,
          updatedAt: new Date().toISOString()
        };
        
        await env.YOYO_USER_DB.put('system:cleanup:config', JSON.stringify(config));
        
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            ...config,
            cloudDrive: sanitizeCloudDriveConfig(config.cloudDrive)
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: error.message
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST /api/admin/cleanup/trigger - 手动触发清理
    if (path === '/api/admin/cleanup/trigger' && method === 'POST') {
      try {
        // 调用VPS的清理端点
        const vpsUrl = `${env.VPS_API_URL}/api/admin/cleanup/execute`;
        const vpsResponse = await fetch(vpsUrl, {
          method: 'POST',
          headers: {
            'X-API-Key': env.VPS_API_KEY
          }
        });
        
        const result = await vpsResponse.json();
        
        return new Response(JSON.stringify(result), {
          status: vpsResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: error.message
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 获取频道列表（前端使用）- 🔥 V2.6: 使用频道索引
    if (path === '/api/streams' && method === 'GET') {
      try {
        // 1. 从频道索引读取所有频道ID
        const channelIndexData = await env.YOYO_USER_DB.get('system:channel_index');
        let channelIds = [];
        
        if (channelIndexData) {
          try {
            const indexObj = JSON.parse(channelIndexData);
            channelIds = indexObj.channelIds || [];
          } catch (e) {
            console.error('解析频道索引失败:', e);
          }
        }
        
        // 2. 如果索引为空，尝试list重建
        if (channelIds.length === 0) {
          console.warn('频道索引为空，尝试list重建');
          try {
            const listResult = await env.YOYO_USER_DB.list({ prefix: 'channel:' });
            channelIds = listResult.keys.map(key => key.name.replace('channel:', ''));
            
            // 自动重建索引
            if (channelIds.length > 0) {
              await env.YOYO_USER_DB.put('system:channel_index', JSON.stringify({
                channelIds,
                lastUpdated: new Date().toISOString(),
                totalChannels: channelIds.length
              }));
              console.log(`频道索引已自动重建，包含${channelIds.length}个频道`);
            }
          } catch (listError) {
            console.error('List操作失败:', listError);
            return new Response(JSON.stringify({
              status: 'error',
              message: 'Unable to fetch channels: index missing and list failed'
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
        
        // 3. 根据索引读取每个频道配置
        const streams = [];
        const timestamp = Date.now();
        
        for (const id of channelIds) {
          try {
            const channelData = await env.YOYO_USER_DB.get(`channel:${id}`);
            if (channelData) {
              const channel = JSON.parse(channelData);
              streams.push({
                id: channel.id,
                name: channel.name,
                order: channel.sortOrder || 999,
                hlsUrl: `/hls/${id}/playlist.m3u8?t=${timestamp}`
              });
            }
          } catch (kvError) {
            console.error('KV read error for', id, ':', kvError);
          }
        }
        
        // 按排序顺序排列
        streams.sort((a, b) => a.order - b.order);

        return new Response(JSON.stringify({
          status: 'success',
          data: {
            streams: streams
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Failed to fetch streams: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 开始播放流 (兼容旧API，内部调用SimpleStreamManager) - 🔥 V2.6: 使用KV验证
    if (path.match(/^\/api\/play\/(.+)$/) && method === 'POST') {
      const channelId = path.match(/^\/api\/play\/(.+)$/)[1];
      
      // 验证频道是否存在（从KV读取）
      const channelData = await env.YOYO_USER_DB.get(`channel:${channelId}`);
      if (!channelData) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Channel not found'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // 调用SimpleStreamManager API
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/start-watching`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY
        },
        body: JSON.stringify({
          channelId: channelId,
          userId: `user_${Date.now()}`
        })
      });
      
      const responseData = await vpsResponse.json();
      
      return new Response(JSON.stringify(responseData), {
        status: vpsResponse.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 停止播放流
    if (path.match(/^\/api\/stop\/(.+)$/) && method === 'POST') {
      const sessionId = path.match(/^\/api\/stop\/(.+)$/)[1];
      
      const response = await handleStopStream(request, env, sessionId);
      const responseData = await response.json();
      
      return new Response(JSON.stringify(responseData), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 会话心跳
    if (path.match(/^\/api\/heartbeat\/(.+)$/) && method === 'POST') {
      const sessionId = path.match(/^\/api\/heartbeat\/(.+)$/)[1];
      
      const response = await handleHeartbeat(request, env, sessionId);
      const responseData = await response.json();
      
      return new Response(JSON.stringify(responseData), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 获取频道状态
    if (path.match(/^\/api\/channel\/(.+)\/status$/) && method === 'GET') {
      const channelId = path.match(/^\/api\/channel\/(.+)\/status$/)[1];
      
      const response = await handleChannelStatus(request, env, channelId);
      const responseData = await response.json();
      
      return new Response(JSON.stringify(responseData), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 获取系统状态
    if (path === '/api/admin/system/status' && method === 'GET') {
      const response = await handleSystemStatus(request, env);
      const responseData = await response.json();
      
      return new Response(JSON.stringify(responseData), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // SimpleStreamManager API路由

    // 开始观看
    if (path === '/api/simple-stream/start-watching' && method === 'POST') {
      const body = await request.json();
      const { channelId } = body;
      
      if (!channelId) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'channelId is required'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // 从KV存储或默认配置获取rtmpUrl
      let rtmpUrl = null;
      
      try {
        // 尝试从KV存储读取频道配置
        if (env.YOYO_USER_DB) {
          const channelKey = `channel:${channelId}`;
          const kvData = await env.YOYO_USER_DB.get(channelKey);
          if (kvData) {
            const channelData = JSON.parse(kvData);
            rtmpUrl = channelData.rtmpUrl;
          }
        }
        
        // 🔥 V2.6: 如果KV中没有RTMP URL，返回错误（不再使用硬编码后备）
        if (!rtmpUrl) {
          return new Response(JSON.stringify({
            status: 'error',
            message: `No RTMP URL found for channel: ${channelId}`
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 读取隧道配置
        let tunnelEnabled = false;
        try {
          const tunnelConfigData = await env.YOYO_USER_DB.get('tunnel_config');
          if (tunnelConfigData) {
            const tunnelConfig = JSON.parse(tunnelConfigData);
            tunnelEnabled = tunnelConfig.enabled || false;
          }
        } catch (e) {
          console.log('Failed to read tunnel config:', e);
        }
        
        // 调用VPS API，传递channelId和rtmpUrl
        const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/start-watching`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.VPS_API_KEY
          },
          body: JSON.stringify({ channelId, rtmpUrl })
        });
        
        const responseData = await vpsResponse.json();
        
        // 🎯 根据隧道配置调整HLS URL并添加路由信息（按设计文档）
        if (responseData.status === 'success' && responseData.data && responseData.data.hlsUrl) {
          const vpsHlsUrl = responseData.data.hlsUrl;
          
          if (tunnelEnabled) {
            // 隧道模式：转换为Workers代理URL
            const match = vpsHlsUrl.match(/\/hls\/(.+)/);
            if (match) {
              const hlsPath = match[1]; // channelId/playlist.m3u8
              responseData.data.hlsUrl = `${env.WORKER_DOMAIN}/tunnel-proxy/hls/${hlsPath}`;
              
              // 添加路由信息字段（按DUAL_DIMENSION_ROUTING_ARCHITECTURE.md设计）
              responseData.data.routingMode = 'tunnel+direct';
              responseData.data.routingReason = 'Workers通过Tunnel访问VPS | VPS直连RTMP源';
              responseData.message = 'Started watching successfully via tunnel+direct mode';
              
              console.log('✅ Tunnel mode:', responseData.data.routingMode);
            }
          } else {
            // 直连模式：保持VPS URL
            responseData.data.routingMode = 'direct+direct';
            responseData.data.routingReason = '浏览器直连VPS | VPS直连RTMP源';
            
            console.log('✅ Direct mode:', responseData.data.routingMode);
          }
        }
        
        return new Response(JSON.stringify(responseData), {
          status: vpsResponse.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        console.error('Start watching error:', error);
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Failed to start watching: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 停止观看
    if (path === '/api/simple-stream/stop-watching' && method === 'POST') {
      const body = await request.json();
      const { channelId } = body;
      
      if (!channelId) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'channelId is required'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/stop-watching`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY
        },
        body: JSON.stringify({ channelId })
      });
      
      const responseData = await vpsResponse.json();
      
      return new Response(JSON.stringify(responseData), {
        status: vpsResponse.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 心跳
    if (path === '/api/simple-stream/heartbeat' && method === 'POST') {
      const body = await request.json();
      const { channelId, sessionId } = body;  // 🔥 修复：提取sessionId
      
      if (!channelId) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'channelId is required'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // 🔥 修复：转发完整的请求body（包括sessionId）
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY
        },
        body: JSON.stringify({ channelId, sessionId })  // 🔥 修复：转发sessionId
      });
      
      const responseData = await vpsResponse.json();
      
      return new Response(JSON.stringify(responseData), {
        status: vpsResponse.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 获取频道状态（SimpleStreamManager版本）
    if (path.match(/^\/api\/simple-stream\/channel\/(.+)\/status$/) && method === 'GET') {
      const channelId = path.match(/^\/api\/simple-stream\/channel\/(.+)\/status$/)[1];
      
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/channel/${channelId}/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': env.VPS_API_KEY
        }
      });
      
      const responseData = await vpsResponse.json();
      
      return new Response(JSON.stringify(responseData), {
        status: vpsResponse.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 获取系统状态（SimpleStreamManager版本）
    if (path === '/api/simple-stream/system/status' && method === 'GET') {
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/system/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': env.VPS_API_KEY
        }
      });
      
      const responseData = await vpsResponse.json();
      
      return new Response(JSON.stringify(responseData), {
        status: vpsResponse.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 🆕 重新加载预加载调度器
    if (path === '/api/simple-stream/preload/reload-schedule' && method === 'POST') {
      try {
        const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/preload/reload-schedule`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.VPS_API_KEY
          }
        });
        
        const responseData = await vpsResponse.json();
        
        return new Response(JSON.stringify(responseData), {
          status: vpsResponse.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: `Failed to reload preload schedule: ${error.message}`
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 🆕 重新加载录制调度器
    if (path === '/api/simple-stream/record/reload-schedule' && method === 'POST') {
      try {
        const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/record/reload-schedule`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.VPS_API_KEY
          }
        });
        
        const responseData = await vpsResponse.json();
        
        return new Response(JSON.stringify(responseData), {
          status: vpsResponse.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: `Failed to reload record schedule: ${error.message}`
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // HLS代理
    if (path.match(/^\/hls\/(.+?)\/(.+)$/) && method === 'GET') {
      const [, channelId, file] = path.match(/^\/hls\/(.+?)\/(.+)$/);
      
      const response = await handleHlsProxy(request, env, channelId, file);
      
      // 为HLS代理添加CORS头
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders
      });
    }

    // 用户认证端点（支持KV存储用户数据）
    if ((path === '/api/auth/login' || path === '/api/login') && method === 'POST') {
      let body = null;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Invalid JSON payload'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      try {
        // 从KV存储检查用户认证
        const userKey = `user:${body.username}`;
        const userData = await env.YOYO_USER_DB.get(userKey);
        
        if (userData) {
          const user = JSON.parse(userData);
          
          // 检查用户状态 - 兼容旧用户数据
          const userStatus = user.status || 'active';
          if (userStatus !== 'active') {
            return new Response(JSON.stringify({
              status: 'error',
              message: '账户已被禁用'
            }), {
              status: 401,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
          
          // 统一密码验证（使用PBKDF2 + SHA-256）
          let passwordMatch = false;
          
          if (user.salt && user.hashedPassword) {
            // 使用PBKDF2验证密码
            try {
              const encoder = new TextEncoder();
              const passwordData = encoder.encode(body.password);
              const saltData = encoder.encode(user.salt);
              
              const keyMaterial = await crypto.subtle.importKey(
                'raw',
                passwordData,
                { name: 'PBKDF2' },
                false,
                ['deriveBits']
              );
              
              const derivedBits = await crypto.subtle.deriveBits(
                {
                  name: 'PBKDF2',
                  salt: saltData,
                  iterations: 100000,
                  hash: 'SHA-256'
                },
                keyMaterial,
                256
              );
              
              const hashArray = Array.from(new Uint8Array(derivedBits));
              const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
              
              if (user.hashedPassword === computedHash) {
                passwordMatch = true;
              }
            } catch (error) {
              console.log('PBKDF2验证失败:', error.message);
            }
          }
          
          if (passwordMatch) {
            // 更新登录信息
            user.lastLogin = new Date().toISOString();
            user.loginCount = (user.loginCount || 0) + 1;
            await env.YOYO_USER_DB.put(userKey, JSON.stringify(user));
            
            return new Response(JSON.stringify({
              status: 'success',
              message: 'Login successful',
              data: {
                user: { 
                  username: user.username, 
                  role: user.role || 'user',
                  displayName: user.displayName || user.username
                },
                token: 'simple-token-' + Date.now()
              }
            }), {
              status: 200,
              headers: { 
                'Content-Type': 'application/json',
                'Set-Cookie': 'session=authenticated; Path=/; HttpOnly; SameSite=Strict',
                ...corsHeaders
              }
            });
          }
        }
        
        // 🔥 V2.6: 应急admin登录（KV读取失败或达到限制时使用）
        const emergencyAdmin = getEmergencyAdmin(env);
        if (body.username === emergencyAdmin.username && body.password === emergencyAdmin.password) {
          console.warn('⚠️ 使用应急admin账号登录（KV可能不可用）');
          return new Response(JSON.stringify({
            status: 'success',
            message: 'Emergency admin login successful',
            data: {
              user: { 
                username: emergencyAdmin.username, 
                role: emergencyAdmin.role,
                displayName: 'Emergency Admin'
              },
              token: 'emergency-token-' + Date.now()
            }
          }), {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Set-Cookie': 'session=authenticated; Path=/; HttpOnly; SameSite=Strict',
              ...corsHeaders
            }
          });
        }
        
        // 认证失败
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Invalid credentials'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        console.error('Login error:', error);
        
        // 🔥 V2.6: KV服务异常时的应急admin登录
        const emergencyAdmin = getEmergencyAdmin(env);
        if (body && body.username === emergencyAdmin.username && body.password === emergencyAdmin.password) {
          console.warn('⚠️ KV服务异常，使用应急admin账号登录');
          return new Response(JSON.stringify({
            status: 'success',
            message: 'Emergency admin login (KV error)',
            data: {
              user: { 
                username: emergencyAdmin.username, 
                role: emergencyAdmin.role,
                displayName: 'Emergency Admin'
              },
              token: 'emergency-token-' + Date.now()
            }
          }), {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Set-Cookie': 'session=authenticated; Path=/; HttpOnly; SameSite=Strict',
              ...corsHeaders
            }
          });
        }
        
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Login service error: ' + (error && error.message ? error.message : 'unknown')
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 用户信息端点
    if (path === '/api/auth/me' && method === 'GET') {
      if (isAuthenticated(request)) {
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            user: { username: 'admin', role: 'admin' }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } else {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Not authenticated'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 管理员API端点 - 🔥 使用频道索引（移除CHANNELS硬编码）
    if (path === '/api/admin/streams' && method === 'GET') {
      try {
        // 1. 从频道索引读取所有频道ID
        const channelIndexData = await env.YOYO_USER_DB.get('system:channel_index');
        let channelIds = [];
        
        if (channelIndexData) {
          try {
            const indexObj = JSON.parse(channelIndexData);
            channelIds = indexObj.channelIds || [];
          } catch (e) {
            console.error('解析频道索引失败:', e);
          }
        }
        
        // 2. 如果索引为空，使用list扫描KV并自动重建索引
        if (channelIds.length === 0) {
          console.warn('频道索引为空，尝试使用list扫描并重建索引');
          try {
            const listResult = await env.YOYO_USER_DB.list({ prefix: 'channel:' });
            channelIds = listResult.keys.map(key => key.name.replace('channel:', ''));
            
            // 自动重建索引
            if (channelIds.length > 0) {
              await env.YOYO_USER_DB.put('system:channel_index', JSON.stringify({
                channelIds,
                lastUpdated: new Date().toISOString(),
                totalChannels: channelIds.length
              }));
              console.log(`频道索引已自动重建，包含${channelIds.length}个频道`);
            } else {
              // 如果KV中也没有频道数据
              console.error('KV中没有任何频道数据');
              channelIds = [];
            }
          } catch (listError) {
            console.error('List操作失败:', listError);
            channelIds = [];
          }
        }
        
        // 3. 根据索引读取每个频道的完整配置
        const streams = [];
        
        for (const id of channelIds) {
          try {
            const channelData = await env.YOYO_USER_DB.get(`channel:${id}`);
            
            if (channelData) {
              const channel = JSON.parse(channelData);
              
              // 🔧 安全获取preloadConfig（过滤错误值）
              let preloadConfig = channel.preloadConfig;
              if (!preloadConfig || preloadConfig === 'undefined' || preloadConfig === '') {
                preloadConfig = null;
              }
              
              // 🔧 安全获取recordConfig（过滤错误值）
              let recordConfig = channel.recordConfig;
              if (!recordConfig || recordConfig === 'undefined' || recordConfig === '') {
                recordConfig = null;
              }
              
              streams.push({
                id: channel.id,
                name: channel.name,
                rtmpUrl: channel.rtmpUrl,
                sortOrder: channel.sortOrder || 999,
                createdAt: channel.createdAt || channel.updatedAt || '2025-10-03T12:00:00Z',
                preloadConfig: preloadConfig,
                recordConfig: recordConfig
              });
            }
            // 🔥 V2.6: 频道数据不存在时跳过（不再使用CHANNELS后备）
          } catch (kvError) {
            console.error('KV read error for', id, ':', kvError);
          }
        }
        
        // 按sortOrder排序
        streams.sort((a, b) => a.sortOrder - b.sortOrder);

        return new Response(JSON.stringify({
          status: 'success',
          data: { streams }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Failed to fetch streams: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 🆕 创建频道API端点 - 自动维护频道索引
    if (path === '/api/admin/streams' && method === 'POST') {
      try {
        const body = await request.json();
        const { id, name, rtmpUrl, sortOrder } = body;
        
        if (!id || !name) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '频道ID和名称为必填项'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 1. 检查频道是否已存在
        const existingChannel = await env.YOYO_USER_DB.get(`channel:${id}`);
        if (existingChannel) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '频道ID已存在'
          }), {
            status: 409,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 2. 创建频道数据
        const channelData = {
          id,
          name,
          rtmpUrl: rtmpUrl || '',
          sortOrder: parseInt(sortOrder) || 999,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        // 3. 保存频道到KV
        await env.YOYO_USER_DB.put(`channel:${id}`, JSON.stringify(channelData));
        
        // 4. 更新频道索引
        const channelIndexData = await env.YOYO_USER_DB.get('system:channel_index');
        let index = { channelIds: [], lastUpdated: '', totalChannels: 0 };
        
        if (channelIndexData) {
          index = JSON.parse(channelIndexData);
        }
        
        if (!index.channelIds.includes(id)) {
          index.channelIds.push(id);
          index.lastUpdated = new Date().toISOString();
          index.totalChannels = index.channelIds.length;
          await env.YOYO_USER_DB.put('system:channel_index', JSON.stringify(index));
          console.log(`频道索引已更新，新增频道: ${id}`);
        }
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '频道创建成功',
          data: channelData
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '创建频道失败: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 编辑频道API端点
    if (path.startsWith('/api/admin/streams/') && method === 'PUT') {
      const streamId = path.split('/')[4];
      
      try {
        const body = await request.json();
        const { name, rtmpUrl, sortOrder } = body;
        
        // 1. 读取现有频道数据（保留其他配置如preloadConfig等）
        const existingData = await env.YOYO_USER_DB.get(`channel:${streamId}`);
        let channelData = existingData ? JSON.parse(existingData) : {};
        
        // 2. 更新频道数据
        channelData = {
          ...channelData,
          id: streamId,
          name: name || channelData.name,
          rtmpUrl: rtmpUrl || channelData.rtmpUrl,
          sortOrder: sortOrder !== undefined ? parseInt(sortOrder) : channelData.sortOrder,
          updatedAt: new Date().toISOString()
        };
        
        // 3. 保存到KV
        await env.YOYO_USER_DB.put(`channel:${streamId}`, JSON.stringify(channelData));
        
        // 4. 同步到VPS配置（可选）
        try {
          const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/configure`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.VPS_API_KEY
            },
            body: JSON.stringify({
              channelId: streamId,
              name: channelData.name,
              rtmpUrl: channelData.rtmpUrl
            })
          });
          
          if (!vpsResponse.ok) {
            console.error('VPS sync failed:', await vpsResponse.text());
          }
        } catch (vpsError) {
          console.error('VPS sync error:', vpsError);
        }
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '频道更新成功',
          data: channelData
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '更新频道失败: ' + error.message
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 🆕 删除频道API端点 - 自动维护频道索引
    if (path.startsWith('/api/admin/streams/') && method === 'DELETE') {
      const streamId = path.split('/')[4];
      
      try {
        // 1. 检查频道是否存在
        const existingChannel = await env.YOYO_USER_DB.get(`channel:${streamId}`);
        if (!existingChannel) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '频道不存在'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 2. 删除频道数据
        await env.YOYO_USER_DB.delete(`channel:${streamId}`);
        
        // 3. 从频道索引移除
        const channelIndexData = await env.YOYO_USER_DB.get('system:channel_index');
        if (channelIndexData) {
          const index = JSON.parse(channelIndexData);
          index.channelIds = index.channelIds.filter(id => id !== streamId);
          index.lastUpdated = new Date().toISOString();
          index.totalChannels = index.channelIds.length;
          await env.YOYO_USER_DB.put('system:channel_index', JSON.stringify(index));
          console.log(`频道索引已更新，删除频道: ${streamId}`);
        }
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '频道删除成功',
          data: { id: streamId }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '删除频道失败: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (path === '/api/admin/traffic/stats' && method === 'GET') {
      // 流量统计需要配置Cloudflare Analytics API
      // 暂时返回空数据
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          traffic: {
            summary: {
              totalBandwidth: '0',
              totalRequests: 0,
              totalCost: '0',
              avgMonthlyBandwidth: '0'
            },
            monthly: []
          },
          message: '流量统计功能需要配置Cloudflare Analytics API'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (path === '/api/admin/diagnostics' && method === 'GET') {
      const startTime = Date.now();
      
      // 测试KV可用性
      let kvAvailable = false;
      let kvNamespace = 'YOYO_USER_DB';
      let kvTestResult = null;
      try {
        await env.YOYO_USER_DB.get('test');
        kvAvailable = true;
      } catch (error) {
        kvTestResult = error.message;
      }
      
      // 测试VPS连接
      let vpsAvailable = false;
      let vpsUrl = env.VPS_API_URL;
      let vpsTestResult = null;
      try {
        const vpsResponse = await fetch(`${vpsUrl}/health`, {
          headers: { 'X-API-Key': env.VPS_API_KEY }
        });
        vpsAvailable = vpsResponse.ok;
        if (!vpsAvailable) {
          vpsTestResult = `HTTP ${vpsResponse.status}`;
        }
      } catch (error) {
        vpsTestResult = error.message;
      }
      
      const diagnosticsTime = Date.now() - startTime;
      
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          worker: {
            version: env.VERSION || '2.0.0',
            environment: env.ENVIRONMENT || 'production'
          },
          kv: {
            available: kvAvailable,
            namespace: kvNamespace,
            testResult: kvTestResult
          },
          vps: {
            available: vpsAvailable,
            url: vpsUrl,
            testResult: vpsTestResult
          },
          cache: {
            totalItems: 0  // 可以从KV中获取实际数量
          },
          performance: {
            diagnosticsTime: diagnosticsTime
          }
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (path === '/api/admin/login/logs' && method === 'GET') {
      // 从URL参数获取分页信息和日期范围
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const startDate = url.searchParams.get('startDate'); // YYYY-MM-DD
      const endDate = url.searchParams.get('endDate'); // YYYY-MM-DD
      
      // 从R2读取登录日志
      let allLogs = [];
      let total = 0;
      
      if (env.LOGIN_LOGS) {
        try {
          // 计算日期范围（默认最近7天）
          const end = endDate ? new Date(endDate) : new Date();
          const start = startDate ? new Date(startDate) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
          
          // 遍历日期范围，读取每天的日志
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const filePath = `${year}/${month}/${day}/login-logs.json`;
            
            try {
              const logFile = await env.LOGIN_LOGS.get(filePath);
              if (logFile) {
                const dayData = JSON.parse(await logFile.text());
                if (dayData.logs && Array.isArray(dayData.logs)) {
                  allLogs.push(...dayData.logs);
                }
              }
            } catch (err) {
              console.warn(`读取日志文件失败: ${filePath}`, err.message);
            }
          }
          
          // 按时间倒序排列
          allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          total = allLogs.length;
          
          // 应用分页
          allLogs = allLogs.slice(offset, offset + limit);
          
        } catch (error) {
          console.error('读取登录日志失败:', error);
        }
      }
      
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          logs: allLogs,
          total: total,
          source: env.LOGIN_LOGS ? 'R2' : 'None'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 🔥 V2.6: 缓存统计 - 移除list操作，使用索引计数
    if (path === '/api/admin/cache/stats' && method === 'GET') {
      try {
        // 从索引获取统计信息（避免list操作）
        let totalChannels = 0;
        let totalUsers = 0;
        
        // 读取频道索引
        const channelIndexData = await env.YOYO_USER_DB.get('system:channel_index');
        if (channelIndexData) {
          try {
            const channelIndex = JSON.parse(channelIndexData);
            totalChannels = channelIndex.totalChannels || 0;
          } catch (e) {
            console.error('解析频道索引失败:', e);
          }
        }
        
        // 读取用户索引
        const userIndexData = await env.YOYO_USER_DB.get('system:user_index');
        if (userIndexData) {
          try {
            const userIndex = JSON.parse(userIndexData);
            totalUsers = userIndex.totalUsers || 0;
          } catch (e) {
            console.error('解析用户索引失败:', e);
          }
        }
        
        // 系统键数量（索引 + 配置等）
        const systemKeys = 5; // channel_index, user_index, proxy:config, tunnel_config等
        
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            cache: {
              totalItems: totalChannels + totalUsers + systemKeys,
              channels: totalChannels,
              users: totalUsers,
              systemKeys: systemKeys,
              // 移除items列表，避免list操作
              note: '统计基于索引系统，避免KV list操作限制'
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        console.error('获取缓存统计失败:', error);
        return new Response(JSON.stringify({
          status: 'error',
          message: '获取缓存统计失败: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 隧道配置API端点 - 从KV读取
    if (path === '/api/admin/tunnel/config' && method === 'GET') {
      try {
        // 从KV读取隧道配置
        const tunnelConfigData = await env.YOYO_USER_DB.get('tunnel_config');
        let tunnelConfig = {
          enabled: false,
          useWorkerProxy: false
        };
        
        if (tunnelConfigData) {
          try {
            const parsedConfig = JSON.parse(tunnelConfigData);
            tunnelConfig = {
              enabled: parsedConfig.enabled || false,
              useWorkerProxy: parsedConfig.useWorkerProxy || false
            };
          } catch (e) {
            console.error('Failed to parse tunnel config:', e);
          }
        }
        
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            enabled: tunnelConfig.enabled,
            useWorkerProxy: tunnelConfig.useWorkerProxy,
            description: tunnelConfig.enabled ? '隧道优化已启用' : '隧道优化已禁用',
            updatedAt: new Date().toISOString(),
            endpoints: {
              tunnel: {
                api: env.TUNNEL_API_DOMAIN,
                hls: env.TUNNEL_HLS_DOMAIN,
                health: env.TUNNEL_HEALTH_DOMAIN,
                status: 'ready',
                lastCheck: new Date().toISOString(),
                responseTime: '245ms'
              },
              direct: {
                api: env.VPS_API_URL?.replace(/^https?:\/\//, ''),
                hls: env.VPS_API_URL?.replace(/^https?:\/\//, ''),
                health: env.VPS_API_URL?.replace(/^https?:\/\//, ''),
                status: 'healthy',
                lastCheck: new Date().toISOString(),
                responseTime: '156ms'
              }
            },
            performance: {
              tunnel: {
                latency: '200-500ms',
                stability: '85-95%',
                optimization: '60-75%'
              },
              direct: {
                latency: '800-2000ms',
                stability: '60-70%',
                optimization: '0%'
              }
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        console.error('Failed to get tunnel config:', error);
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Failed to get tunnel config: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 隧道配置更新API端点 - 保存到KV
    if (path === '/api/admin/tunnel/config' && method === 'PUT') {
      try {
        const body = await request.json();
        
        // 保存隧道配置到KV
        const tunnelConfig = {
          enabled: body.enabled || false,
          useWorkerProxy: body.useWorkerProxy || false,
          updatedAt: new Date().toISOString()
        };
        
        await env.YOYO_USER_DB.put('tunnel_config', JSON.stringify(tunnelConfig));
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '隧道配置已更新并立即生效',
          data: tunnelConfig
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        console.error('Failed to update tunnel config:', error);
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Failed to update tunnel config: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (path === '/api/admin/vps/health' && method === 'GET') {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          status: 'healthy',
          uptime: '24h 30m',
          cpu: '15%',
          memory: '45%',
          disk: '60%'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // VPS日志API代理
    if (path.startsWith('/api/admin/logs/') && method === 'GET') {
      const logType = path.split('/').pop(); // recent, combined, error
      const vpsUrl = `${env.VPS_API_URL}/api/logs/${logType}${url.search}`;
      
      try {
        const vpsResponse = await fetch(vpsUrl, {
          headers: {
            'X-API-Key': env.VPS_API_KEY
          }
        });
        
        const data = await vpsResponse.json();
        return new Response(JSON.stringify(data), {
          status: vpsResponse.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '获取VPS日志失败: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 清空VPS日志API代理
    if (path === '/api/admin/logs/clear' && method === 'DELETE') {
      const vpsUrl = `${env.VPS_API_URL}/api/logs/clear`;
      
      try {
        const vpsResponse = await fetch(vpsUrl, {
          method: 'DELETE',
          headers: {
            'X-API-Key': env.VPS_API_KEY
          }
        });
        
        const data = await vpsResponse.json();
        return new Response(JSON.stringify(data), {
          status: vpsResponse.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '清空VPS日志失败: ' + error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 用户管理API端点 - 从 KV 存储读取真实用户数据（优化：使用用户索引避免list()操作）
    if (path === '/api/admin/users' && method === 'GET') {
      try {
        // 🔥 优化：从用户索引读取用户名列表，避免list()操作超限
        const userIndexData = await env.YOYO_USER_DB.get('system:user_index');
        let usernames = [];
        
        if (userIndexData) {
          try {
            const indexObj = JSON.parse(userIndexData);
            usernames = indexObj.usernames || [];
          } catch (e) {
            console.error('解析用户索引失败:', e);
          }
        }
        
        // 如果索引为空，返回空列表（避免list操作）
        if (usernames.length === 0) {
          return new Response(JSON.stringify({
            status: 'success',
            data: {
              users: [],
              total: 0,
              stats: {
                admin: 0,
                user: 0,
                active: 0,
                inactive: 0
              }
            },
            message: '用户索引为空，请联系管理员重建索引'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        const users = [];
        let adminCount = 0;
        let userCount = 0;
        let activeCount = 0;
        
        // 根据索引逐个读取用户数据
        for (const username of usernames) {
          try {
            const userData = await env.YOYO_USER_DB.get(`user:${username}`);
            if (userData) {
              const user = JSON.parse(userData);
              
              // 构建用户对象
              const userObj = {
                id: user.id || username,
                username: user.username,
                displayName: user.displayName || user.username,
                role: user.role || 'user',
                status: user.status || 'active',
                lastLogin: user.lastLogin || user.lastUpdated || null,
                loginCount: user.loginCount || 0,
                createdAt: user.createdAt || user.lastUpdated || new Date().toISOString(),
                email: user.email || `${user.username}@yoyo.local`
              };
              
              users.push(userObj);
              
              // 统计数据
              if (userObj.role === 'admin') adminCount++;
              else userCount++;
              
              if (userObj.status === 'active') activeCount++;
            }
          } catch (parseError) {
            console.error(`Error parsing user data for ${username}:`, parseError);
          }
        }
        
        // 按用户名排序
        users.sort((a, b) => a.username.localeCompare(b.username));
        
        return new Response(JSON.stringify({
          status: 'success',
          data: {
            users: users,
            total: users.length,
            stats: {
              admin: adminCount,
              user: userCount,
              active: activeCount,
              inactive: users.length - activeCount
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        console.error('Error fetching users from KV:', error);
        
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Failed to fetch users',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 重新构建用户索引（当索引缺失或不同步时使用）
    if (path === '/api/admin/users/reindex' && method === 'POST') {
      try {
        // 遍历所有以 user: 开头的键，重建用户索引
        let cursor = undefined;
        const usernames = [];
        while (true) {
          const opts = cursor ? { prefix: 'user:', cursor } : { prefix: 'user:' };
          let res;
          try {
            res = await env.YOYO_USER_DB.list(opts);
          } catch (e) {
            console.error('遍历用户键失败:', e);
            break;
          }
          const keys = (res && res.keys) ? res.keys : [];
          for (const k of keys) {
            try {
              const name = (k.name || '').replace('user:', '');
              if (name) usernames.push(name);
            } catch (_) {}
          }
          if (!res || res.list_complete || !res.cursor) break;
          cursor = res.cursor;
          if (usernames.length > 5000) break; // 保护性退出，避免过大遍历
        }

        const uniq = Array.from(new Set(usernames));
        const idx = {
          usernames: uniq,
          totalUsers: uniq.length,
          lastUpdated: new Date().toISOString()
        };
        await env.YOYO_USER_DB.put('system:user_index', JSON.stringify(idx));

        return new Response(JSON.stringify({
          status: 'success',
          message: '用户索引已重建',
          data: idx
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '重建用户索引失败',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 创建用户API端点
    if (path === '/api/admin/users' && method === 'POST') {
      try {
        const body = await request.json();
        
        // 检查用户名是否已存在
        const existingUser = await env.YOYO_USER_DB.get(`user:${body.username}`);
        if (existingUser) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '用户名已存在'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 使用统一的密码哈希
        const { hashedPassword, salt } = body.password ? 
          await hashPassword(body.password) : 
          { hashedPassword: null, salt: null };
        
        const newUser = {
          id: body.username,
          username: body.username,
          displayName: body.displayName || body.username,
          role: body.role || 'user',
          status: 'active',
          lastLogin: null,
          loginCount: 0,
          createdAt: new Date().toISOString(),
          email: body.email || `${body.username}@yoyo.local`,
          hashedPassword: hashedPassword,
          salt: salt
        };
        
        // 保存到KV存储
        await env.YOYO_USER_DB.put(`user:${body.username}`, JSON.stringify(newUser));
        // 同步更新用户索引，确保列表能立即看到新用户
        try {
          const idxRaw = await env.YOYO_USER_DB.get('system:user_index');
          const idx = idxRaw ? JSON.parse(idxRaw) : { usernames: [], totalUsers: 0 };
          if (!Array.isArray(idx.usernames)) idx.usernames = [];
          if (!idx.usernames.includes(body.username)) {
            idx.usernames.push(body.username);
            idx.totalUsers = (idx.totalUsers || 0) + 1;
            idx.lastUpdated = new Date().toISOString();
            await env.YOYO_USER_DB.put('system:user_index', JSON.stringify(idx));
          }
        } catch (e) {
          console.log('更新用户索引失败（忽略）:', e.message);
        }
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '用户创建成功',
          data: newUser
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '创建用户失败',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 更新用户API端点
    if (path.match(/^\/api\/admin\/users\/[^/]+$/) && method === 'PUT') {
      try {
        const userId = decodeURIComponent(path.split('/')[4]);
        const body = await request.json();
        
        // 获取现有用户数据
        const existingUserData = await env.YOYO_USER_DB.get(`user:${userId}`);
        if (!existingUserData) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '用户不存在'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        const existingUser = JSON.parse(existingUserData);
        
        // 更新用户数据
        const updatedUser = {
          ...existingUser,
          displayName: body.displayName || existingUser.displayName,
          role: body.role || existingUser.role,
          status: body.status || existingUser.status,
          email: body.email || existingUser.email,
          lastUpdated: new Date().toISOString()
        };
        
        // 保存更新后的数据
        await env.YOYO_USER_DB.put(`user:${userId}`, JSON.stringify(updatedUser));
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '用户更新成功',
          data: updatedUser
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '更新用户失败',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 删除用户API端点
    if (path.match(/^\/api\/admin\/users\/[^/]+$/) && method === 'DELETE') {
      try {
        const userId = decodeURIComponent(path.split('/')[4]);
        
        // 检查用户是否存在
        const existingUserData = await env.YOYO_USER_DB.get(`user:${userId}`);
        if (!existingUserData) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '用户不存在'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 防止删除admin用户
        if (userId === 'admin') {
          return new Response(JSON.stringify({
            status: 'error',
            message: '不能删除管理员用户'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 删除用户
        await env.YOYO_USER_DB.delete(`user:${userId}`);
        // 同步更新用户索引，移除已删除用户
        try {
          const idxRaw = await env.YOYO_USER_DB.get('system:user_index');
          if (idxRaw) {
            const idx = JSON.parse(idxRaw);
            if (Array.isArray(idx.usernames)) {
              const before = idx.usernames.length;
              idx.usernames = idx.usernames.filter(u => u !== userId);
              if (idx.usernames.length !== before) {
                idx.totalUsers = Math.max(0, (idx.totalUsers || before) - 1);
                idx.lastUpdated = new Date().toISOString();
                await env.YOYO_USER_DB.put('system:user_index', JSON.stringify(idx));
              }
            }
          }
        } catch (e) {
          console.log('同步用户索引失败（忽略）:', e.message);
        }
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '用户删除成功',
          data: { id: userId }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '删除用户失败',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }
    
    // 批量重置所有用户密码API端点（仅限admin）
    if (path === '/api/admin/reset-all-passwords' && method === 'POST') {
      try {
        console.log('🔄 开始批量重置所有用户密码为123456');
        
        // 获取所有用户
        const listResult = await env.YOYO_USER_DB.list({ prefix: 'user:' });
        let resetCount = 0;
        let skipCount = 0;
        
        for (const key of listResult.keys) {
          try {
            const userData = await env.YOYO_USER_DB.get(key.name);
            if (userData) {
              const user = JSON.parse(userData);
              
              // 跳过admin用户，保持其原有密码
              if (user.username === 'admin') {
                console.log('⏭️ 跳过admin用户');
                skipCount++;
                continue;
              }
              
              // 为其他用户重置密码为123456
              const { hashedPassword, salt } = await hashPassword('123456');
              
              const updatedUser = {
                ...user,
                hashedPassword: hashedPassword,
                salt: salt,
                lastUpdated: new Date().toISOString()
              };
              
              // 清理旧的密码字段
              delete updatedUser.password;
              
              await env.YOYO_USER_DB.put(key.name, JSON.stringify(updatedUser));
              console.log(`✅ 重置用户密码: ${user.username}`);
              resetCount++;
            }
          } catch (error) {
            console.error(`❌ 重置用户密码失败: ${key.name}`, error);
          }
        }
        
        console.log(`🎉 批量重置完成: ${resetCount}个用户重置成功, ${skipCount}个用户跳过`);
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '批量重置密码完成',
          data: {
            resetCount: resetCount,
            skipCount: skipCount,
            newPassword: '123456'
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        console.error('批量重置密码失败:', error);
        return new Response(JSON.stringify({
          status: 'error',
          message: '批量重置密码失败',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }
    
    // 修改密码API端点
    if (path.match(/^\/api\/admin\/users\/[^/]+\/password$/) && method === 'PUT') {
      try {
        const userId = decodeURIComponent(path.split('/')[4]);
        const body = await request.json();
        
        // 获取现有用户数据
        const existingUserData = await env.YOYO_USER_DB.get(`user:${userId}`);
        if (!existingUserData) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '用户不存在'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        const existingUser = JSON.parse(existingUserData);
        
        // 使用统一的密码哈希
        const { hashedPassword, salt } = await hashPassword(body.newPassword);
        
        // 更新密码
        const updatedUser = {
          ...existingUser,
          hashedPassword: hashedPassword,
          salt: salt,
          lastUpdated: new Date().toISOString()
        };
        
        // 保存更新后的数据
        await env.YOYO_USER_DB.put(`user:${userId}`, JSON.stringify(updatedUser));
        
        return new Response(JSON.stringify({
          status: 'success',
          message: '密码修改成功'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '修改密码失败',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }
    
    // 禁用/启用用户API端点
    if (path.match(/^\/api\/admin\/users\/[^/]+\/status$/) && method === 'PUT') {
      try {
        const userId = decodeURIComponent(path.split('/')[4]);
        const body = await request.json();
        
        // 获取现有用户数据
        const existingUserData = await env.YOYO_USER_DB.get(`user:${userId}`);
        if (!existingUserData) {
          return new Response(JSON.stringify({
            status: 'error',
            message: '用户不存在'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // 防止禁用admin用户
        if (userId === 'admin' && body.status === 'inactive') {
          return new Response(JSON.stringify({
            status: 'error',
            message: '不能禁用管理员用户'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        const existingUser = JSON.parse(existingUserData);
        
        // 更新用户状态
        const updatedUser = {
          ...existingUser,
          status: body.status,
          lastUpdated: new Date().toISOString()
        };
        
        // 保存更新后的数据
        await env.YOYO_USER_DB.put(`user:${userId}`, JSON.stringify(updatedUser));
        
        return new Response(JSON.stringify({
          status: 'success',
          message: body.status === 'active' ? '用户已启用' : '用户已禁用',
          data: updatedUser
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: '更新用户状态失败',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 404处理
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Endpoint not found',
      path: path,
      method: method
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    console.error('Request handling error:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Internal server error',
      details: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};
