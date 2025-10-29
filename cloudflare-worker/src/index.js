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

// 频道配置 - 与VPS上的配置保持一致
const CHANNELS = {
  'stream_ensxma2g': { name: '二楼教室1', order: 1 },
  'stream_gkg5hknc': { name: '二楼教室2', order: 2 },
  'stream_kcwxuedx': { name: '国际班', order: 3 },
  'stream_kil0lecb': { name: 'C班', order: 4 },
  'stream_noyoostd': { name: '三楼舞蹈室', order: 5 },
  'stream_3blyhqh3': { name: '多功能厅', order: 6 },
  'stream_8zf48z6g': { name: '操场1', order: 7 },
  'stream_cpa2czoo': { name: '操场2', order: 8 }
};

/**
 * 处理CORS预检请求
 */
function handleCors(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = ['https://yoyo.5202021.xyz', 'https://secure-streaming-platform.pages.dev'];
  const allowOrigin = allowedOrigins.includes(origin) ? origin : 'https://yoyo.5202021.xyz';
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Client-Type, X-Tunnel-Optimized',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  };

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
 * 路由处理器
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 处理CORS
  const corsHeaders = handleCors(request);
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
      
      // HLS代理路由
      if (path.match(/^\/tunnel-proxy\/hls\/(.+?)\/(.+)$/) && method === 'GET') {
        const [, channelId, file] = path.match(/^\/tunnel-proxy\/hls\/(.+?)\/(.+)$/);
        
        console.log('🎯 HLS PROXY REQUEST:', { path, channelId, file });
        
        // 构建VPS的真实HLS URL
        const vpsHlsUrl = `${env.VPS_API_URL}/hls/${channelId}/${file}`;
        
        try {
          // 转发请求到VPS，保持原始查询参数
          const vpsResponse = await fetch(vpsHlsUrl + url.search, {
            method: 'GET',
            headers: {
              'X-API-Key': env.VPS_API_KEY,
              'User-Agent': request.headers.get('User-Agent') || 'Cloudflare-Worker-Proxy'
            }
          });
          
          console.log('🔄 VPS RESPONSE:', vpsResponse.status);
          
          // 复制VPS响应头并添加CORS头
          const newHeaders = new Headers(vpsResponse.headers);
          Object.entries(corsHeaders).forEach(([key, value]) => {
            newHeaders.set(key, value);
          });
          
          // 添加代理标识头（按DUAL_DIMENSION_ROUTING_ARCHITECTURE.md标准）
          newHeaders.set('X-Proxied-By', 'Workers-Tunnel-Proxy');  // 设计文档标准字段
          newHeaders.set('X-Proxy-Channel', channelId);
          newHeaders.set('Access-Control-Expose-Headers', 'X-Proxied-By, X-Proxy-Channel');
          
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
            file: file,
            vpsUrl: vpsHlsUrl
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

    // 🆕 预加载配置API路由
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

    // 🆕 录制配置API路由
    if (path.startsWith('/api/record/')) {
      const response = await handleRecordAPI(request, env);
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

    // 🆕 视频清理配置API路由
    // GET /api/admin/cleanup/config - 获取清理配置
    if (path === '/api/admin/cleanup/config' && method === 'GET') {
      try {
        const configData = await env.YOYO_USER_DB.get('system:cleanup:config');
        const config = configData ? JSON.parse(configData) : {
          enabled: true,
          retentionDays: 2
        };
        
        return new Response(JSON.stringify({
          status: 'success',
          data: config
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
        
        const config = {
          enabled: body.enabled === true,
          retentionDays: Math.max(1, parseInt(body.retentionDays) || 2)
        };
        
        await env.YOYO_USER_DB.put('system:cleanup:config', JSON.stringify(config));
        
        return new Response(JSON.stringify({
          status: 'success',
          data: config
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
        const vpsUrl = 'https://yoyo-vps.5202021.xyz/api/admin/cleanup/execute';
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

    // 获取频道列表（前端使用，需要包含KV更新的数据）
    if (path === '/api/streams' && method === 'GET') {
      try {
        const streams = [];
        
        for (const [id, config] of Object.entries(CHANNELS)) {
          // 尝试从KV存储读取更新的配置
          const channelKey = `channel:${id}`;
          let channelData = null;
          
          try {
            if (env.YOYO_USER_DB) {
              const kvData = await env.YOYO_USER_DB.get(channelKey);
              if (kvData) {
                channelData = JSON.parse(kvData);
              }
            }
          } catch (kvError) {
            console.error('KV read error for', id, ':', kvError);
          }
          
          // 使用KV数据或默认配置，添加时间戳防止缓存
          const timestamp = Date.now();
          streams.push({
            id,
            name: channelData?.name || config.name,
            order: channelData?.sortOrder || config.order,
            hlsUrl: `/hls/${id}/playlist.m3u8?t=${timestamp}`
          });
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

    // 开始播放流 (兼容旧API，内部调用SimpleStreamManager)
    if (path.match(/^\/api\/play\/(.+)$/) && method === 'POST') {
      const channelId = path.match(/^\/api\/play\/(.+)$/)[1];
      
      if (!CHANNELS[channelId]) {
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
        
        // 如果KV中没有，使用默认配置
        if (!rtmpUrl && CHANNELS[channelId]) {
          const defaultRtmpUrls = {
            'stream_ensxma2g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
            'stream_gkg5hknc': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
            'stream_kcwxuedx': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
            'stream_kil0lecb': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
            'stream_noyoostd': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
            'stream_3blyhqh3': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
            'stream_8zf48z6g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
            'stream_cpa2czoo': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b'
          };
          rtmpUrl = defaultRtmpUrls[channelId];
        }
        
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
              responseData.data.hlsUrl = `https://yoyoapi.5202021.xyz/tunnel-proxy/hls/${hlsPath}`;
              
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
      
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/simple-stream/heartbeat`, {
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
      const body = await request.json();
      
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
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Login service error'
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

    // 管理员API端点
    if (path === '/api/admin/streams' && method === 'GET') {
      try {
        // 默认的RTMP源配置
        const defaultRtmpUrls = {
          'stream_ensxma2g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
          'stream_gkg5hknc': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
          'stream_kcwxuedx': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
          'stream_kil0lecb': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
          'stream_noyoostd': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
          'stream_3blyhqh3': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
          'stream_8zf48z6g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
          'stream_cpa2czoo': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b'
        };

        // 构建频道列表，优先使用KV存储中的更新数据
        const streams = [];
        
        for (const [id, config] of Object.entries(CHANNELS)) {
          // 只读取频道配置（已包含预加载配置）
          const channelKey = `channel:${id}`;
          let channelData = null;
          
          try {
            if (env.YOYO_USER_DB) {
              const kvData = await env.YOYO_USER_DB.get(channelKey);
              if (kvData) {
                channelData = JSON.parse(kvData);
              }
            }
          } catch (kvError) {
            console.error('KV read error for', id, ':', kvError);
          }
          
          // 🔧 安全获取preloadConfig（过滤错误值）
          let preloadConfig = channelData?.preloadConfig;
          // 过滤无效值：undefined、字符串"undefined"、空字符串
          if (!preloadConfig || preloadConfig === 'undefined' || preloadConfig === '') {
            preloadConfig = null;
          }
          
          // 🔧 安全获取recordConfig（过滤错误值）
          let recordConfig = channelData?.recordConfig;
          // 过滤无效值：undefined、字符串"undefined"、空字符串
          if (!recordConfig || recordConfig === 'undefined' || recordConfig === '') {
            recordConfig = null;
          }
          
          // 使用KV数据或默认配置
          streams.push({
            id,
            name: channelData?.name || config.name,
            rtmpUrl: channelData?.rtmpUrl || defaultRtmpUrls[id] || `rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b`,
            sortOrder: channelData?.sortOrder || config.order,
            createdAt: channelData?.updatedAt || '2025-10-03T12:00:00Z',
            preloadConfig: preloadConfig,  // ✨ 直接从频道配置读取（已过滤错误值）
            recordConfig: recordConfig      // 🆕 添加录制配置
          });
        }

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

    // 编辑频道API端点
    if (path.startsWith('/api/admin/streams/') && method === 'PUT') {
      const streamId = path.split('/')[4];
      
      try {
        const body = await request.json();
        const { name, rtmpUrl, sortOrder } = body;
        
        // 1. 准备频道数据
        const channelData = {
          id: streamId,
          name,
          rtmpUrl,
          sortOrder: parseInt(sortOrder) || 1,
          updatedAt: new Date().toISOString()
        };
        
        // 尝试更新KV存储（如果可用）
        try {
          if (env.YOYO_USER_DB) {
            const channelKey = `channel:${streamId}`;
            await env.YOYO_USER_DB.put(channelKey, JSON.stringify(channelData));
          }
        } catch (kvError) {
          console.error('KV update failed:', kvError);
          // 继续执行，不因KV失败而中断
        }
        
        // 2. 同步到VPS配置
        const vpsApiUrl = `${env.VPS_API_URL}/api/simple-stream/configure`;
        const vpsHeaders = {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY  // 使用环境变量，与预加载/录制保持一致
        };
        
        const vpsData = {
          channelId: streamId,
          name,
          rtmpUrl
        };
        
        try {
          const vpsResponse = await fetch(vpsApiUrl, {
            method: 'POST',
            headers: vpsHeaders,
            body: JSON.stringify(vpsData)
          });
          
          if (!vpsResponse.ok) {
            console.error('VPS sync failed:', await vpsResponse.text());
          }
        } catch (vpsError) {
          console.error('VPS sync error:', vpsError);
          // 继续执行，不因VPS同步失败而中断
        }
        
        return new Response(JSON.stringify({
          status: 'success',
          message: 'Stream updated successfully',
          data: channelData
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: 'error',
          message: 'Invalid request body: ' + error.message
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (path === '/api/admin/traffic/stats' && method === 'GET') {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          totalStreams: Object.keys(CHANNELS).length,
          activeUsers: 1,
          activeStreams: 0
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (path === '/api/admin/diagnostics' && method === 'GET') {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          vps: { status: 'running' },
          streams: { configured: Object.keys(CHANNELS).length },
          cloudflare: { worker: { timestamp: new Date().toISOString() } }
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (path === '/api/admin/login/logs' && method === 'GET') {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          logs: [
            {
              timestamp: new Date().toISOString(),
              username: 'admin',
              ip: '127.0.0.1',
              success: true
            }
          ]
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (path === '/api/admin/cache/stats' && method === 'GET') {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          hitRate: 95.5,
          totalRequests: 1000,
          cacheHits: 955,
          cacheMisses: 45
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
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
                api: 'tunnel-api.yoyo-vps.5202021.xyz',
                hls: 'tunnel-hls.yoyo-vps.5202021.xyz',
                health: 'tunnel-health.yoyo-vps.5202021.xyz',
                status: 'ready',
                lastCheck: new Date().toISOString(),
                responseTime: '245ms'
              },
              direct: {
                api: 'yoyo-vps.5202021.xyz',
                hls: 'yoyo-vps.5202021.xyz',
                health: 'yoyo-vps.5202021.xyz',
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

    // 用户管理API端点 - 从 KV 存储读取真实用户数据
    if (path === '/api/users' && method === 'GET') {
      try {
        // 获取所有以 'user:' 开头的键
        const userKeys = [];
        const listResult = await env.YOYO_USER_DB.list({ prefix: 'user:' });
        
        const users = [];
        let adminCount = 0;
        let userCount = 0;
        let activeCount = 0;
        
        // 逐个获取用户数据
        for (const key of listResult.keys) {
          try {
            const userData = await env.YOYO_USER_DB.get(key.name);
            if (userData) {
              const user = JSON.parse(userData);
              
              // 构建用户对象
              const userObj = {
                id: user.id || key.name.replace('user:', ''),
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
            console.error(`Error parsing user data for ${key.name}:`, parseError);
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

    // 创建用户API端点
    if (path === '/api/users' && method === 'POST') {
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
    if (path.match(/^\/api\/users\/[^/]+$/) && method === 'PUT') {
      try {
        const userId = decodeURIComponent(path.split('/')[3]);
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
    if (path.match(/^\/api\/users\/[^/]+$/) && method === 'DELETE') {
      try {
        const userId = decodeURIComponent(path.split('/')[3]);
        
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
    if (path.match(/^\/api\/users\/[^/]+\/password$/) && method === 'PUT') {
      try {
        const userId = decodeURIComponent(path.split('/')[3]);
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
    if (path.match(/^\/api\/users\/[^/]+\/status$/) && method === 'PUT') {
      try {
        const userId = decodeURIComponent(path.split('/')[3]);
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
