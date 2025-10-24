/**
 * 流媒体相关处理器
 */

import { getStreamsConfig, getStreamConfig } from '../utils/kv.js';
import { validateSession } from './auth.js';
import { errorResponse, successResponse, getCorsHeaders } from '../utils/cors.js';
import { logStreamEvent, logError, logInfo } from '../utils/logger.js';
import { TunnelRouter } from '../utils/tunnel-router.js';

/**
 * 调用VPS转码API
 */
async function callTranscoderAPI(env, endpoint, method = 'GET', data = null) {
  try {
    // 🚀 使用隧道路由构建API URL，支持地理路由
    const { url, routing } = await TunnelRouter.buildVPSUrl(env, `/api/${endpoint}`, 'API');
    const apiKey = env.VPS_API_KEY;

    if (!apiKey) {
      throw new Error('VPS API key not configured');
    }

    console.log(`🌐 API调用路由: ${routing.type} - ${routing.reason}`);

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'User-Agent': 'YOYO-Tunnel-API/1.0',
        'X-Route-Type': routing.type,
        'X-Tunnel-Optimized': routing.type === 'tunnel' ? 'true' : 'false'
      }
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    logInfo(env, 'Calling VPS transcoder API', {
      url,
      method,
      endpoint,
      routeType: routing.type,
      hasData: !!data
    });

    // API调用 (带故障转移)
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      // 故障转移到直连
      console.warn(`⚠️ API主路由失败，切换直连: ${error.message}`);
      const directRouting = TunnelRouter.getDirectEndpoints();
      const directUrl = `${directRouting.endpoints.API}/api/${endpoint}`;
      
      const fallbackOptions = {
        ...options,
        headers: {
          ...options.headers,
          'User-Agent': 'YOYO-Fallback-API/1.0',
          'X-Route-Type': 'direct-fallback',
          'X-Failover': 'true'
        }
      };
      
      response = await fetch(directUrl, fallbackOptions);
    }
    const responseText = await response.text();

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Invalid JSON response from VPS API: ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(`VPS API error (${response.status}): ${responseData.message || responseText}`);
    }

    logInfo(env, 'VPS transcoder API call successful', {
      endpoint,
      method,
      status: response.status,
      responseStatus: responseData.status
    });

    return responseData;

  } catch (error) {
    logError(env, 'VPS transcoder API call failed', error, { endpoint, method });
    throw error;
  }
}

/**
 * 🚀 智能路由：根据当前系统模式调用VPS
 */
async function callVPSWithIntelligentRouting(env, requestData, request = null) {
  console.log('🚀 [智能路由] 开始处理请求:', JSON.stringify(requestData));
  
  try {
    // 1. 获取当前系统路由模式
    console.log('🔍 [智能路由] 获取路由模式...');
    const routingInfo = await TunnelRouter.getOptimalEndpoints(env, request);
    
    console.log(`🎯 [智能路由] 路由选择: ${routingInfo.type} - ${routingInfo.reason}`);
    console.log('🔍 [智能路由] 路由详情:', JSON.stringify(routingInfo));
    
    // 2. 根据模式调用VPS API
    let vpsResponse;
    console.log(`🔄 [智能路由] 开始${routingInfo.type}模式调用...`);
    
    switch(routingInfo.type) {
      case 'direct':
        vpsResponse = await callVPSDirectly(env, requestData, routingInfo);
        break;
      case 'proxy':
        vpsResponse = await callVPSThroughProxy(env, requestData, routingInfo);
        break;
      case 'tunnel':
        vpsResponse = await callVPSThroughTunnel(env, requestData, routingInfo);
        break;
      default:
        throw new Error(`Unknown routing type: ${routingInfo.type}`);
    }
    
    console.log('✅ [智能路由] VPS调用成功:', JSON.stringify(vpsResponse));
    return { vpsResponse, routingInfo };
    
  } catch (error) {
    console.error('智能路由调用失败:', error);
    
    // 故障转移到直连模式
    console.warn('🔄 故障转移到直连模式');
    const directRouting = TunnelRouter.getDirectEndpoints();
    const vpsResponse = await callVPSDirectly(env, requestData, directRouting);
    
    return { 
      vpsResponse, 
      routingInfo: { 
        ...directRouting, 
        reason: `故障转移: ${error.message}` 
      } 
    };
  }
}

/**
 * 直连模式调用VPS
 */
async function callVPSDirectly(env, requestData, routingInfo) {
  const url = `${routingInfo.endpoints.API}/api/simple-stream/start-watching`;
  const apiKey = env.VPS_API_KEY;
  
  console.log('🔗 [直连模式] 调用URL:', url);
  console.log('🔑 [直连模式] API Key存在:', !!apiKey);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'User-Agent': 'YOYO-Direct-API/1.0',
      'X-Route-Type': 'direct'
    },
    body: JSON.stringify(requestData)
  });
  
  console.log('📡 [直连模式] 响应状态:', response.status, response.statusText);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ [直连模式] 错误响应:', errorText);
    throw new Error(`VPS API调用失败: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const result = await response.json();
  console.log('✅ [直连模式] 成功响应:', JSON.stringify(result));
  return result;
}

/**
 * 代理模式调用VPS
 * 🔧 修复：复用直连模式的调用方式，移除超时限制，确保稳定性
 */
async function callVPSThroughProxy(env, requestData, routingInfo) {
  console.log('🔄 [代理模式] 开始调用VPS，复用直连模式逻辑');
  console.log('🔄 [代理模式] 请求数据:', JSON.stringify(requestData));
  
  // 🔧 修复：直接复用直连模式的调用逻辑，只改变User-Agent和Route-Type标识
  const url = `${routingInfo.endpoints.API}/api/simple-stream/start-watching`;
  const apiKey = env.VPS_API_KEY;
  
  console.log('🔄 [代理模式] 调用URL:', url);
  console.log('🔑 [代理模式] API Key存在:', !!apiKey);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'User-Agent': 'YOYO-Proxy-API/1.0',
      'X-Route-Type': 'proxy'
    },
    body: JSON.stringify(requestData)
    // 🔧 移除超时控制，和直连模式保持一致
  });
  
  console.log('📡 [代理模式] 响应状态:', response.status, response.statusText);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ [代理模式] 错误响应:', errorText);
    throw new Error(`VPS代理API调用失败: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const result = await response.json();
  console.log('✅ [代理模式] 成功响应:', JSON.stringify(result));
  return result;
}

/**
 * 隧道模式调用VPS
 */
async function callVPSThroughTunnel(env, requestData, routingInfo) {
  const url = `${routingInfo.endpoints.API}/api/simple-stream/start-watching`;
  const apiKey = env.VPS_API_KEY;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'User-Agent': 'YOYO-Tunnel-API/1.0',
      'X-Route-Type': 'tunnel',
      'X-Tunnel-Optimized': 'true'
    },
    body: JSON.stringify(requestData)
  });
  
  if (!response.ok) {
    throw new Error(`VPS隧道API调用失败: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 🎯 URL包装：根据当前模式生成适配的HLS播放地址
 */
function wrapHlsUrlForCurrentMode(baseHlsUrl, routingInfo, env, userToken) {
  if (!baseHlsUrl) {
    throw new Error('Base HLS URL is required');
  }
  
  // 获取认证token - 优先使用用户token，否则使用环境变量或默认值
  const token = userToken || env.VIDEO_TOKEN || 'default-token';
  
  // 如果baseHlsUrl已经是完整URL，提取路径部分
  let hlsPath;
  if (baseHlsUrl.startsWith('http')) {
    const url = new URL(baseHlsUrl);
    hlsPath = url.pathname;
  } else {
    hlsPath = baseHlsUrl.startsWith('/') ? baseHlsUrl : `/${baseHlsUrl}`;
  }
  
  // 根据路由模式包装URL
  switch(routingInfo.type) {
    case 'direct':
      return `https://yoyoapi.5202021.xyz${hlsPath}?token=${token}`;
    case 'proxy':
      return `https://yoyoapi.5202021.xyz/tunnel-proxy${hlsPath}?token=${token}`;
    case 'tunnel':
      return `https://tunnel-hls.yoyo-vps.5202021.xyz${hlsPath}?token=${token}`;
    default:
      // 默认使用直连模式
      console.warn(`未知路由类型 ${routingInfo.type}，使用直连模式`);
      return `https://yoyoapi.5202021.xyz${hlsPath}?token=${token}`;
  }
}

/**
 * 检查VPS服务器连通性
 */
async function checkVpsHealth(env) {
  try {
    const vpsApiUrl = env.VPS_API_URL || 'https://yoyo-vps.5202021.xyz';
    const apiKey = env.VPS_API_KEY;

    if (!apiKey) {
      return { available: false, error: 'VPS API key not configured' };
    }

    const response = await fetch(`${vpsApiUrl}/health`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'User-Agent': 'Cloudflare-Worker-Health/1.0'
      },
      signal: AbortSignal.timeout(5000) // 5秒超时
    });

    if (response.ok) {
      const data = await response.json();
      return { available: true, data };
    } else {
      return { available: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { available: false, error: error.message };
  }
}

export const handleStreams = {
  /**
   * 获取所有可用的流列表（用户视图）
   */
  async getStreams(request, env, ctx) {
    console.log('🔍 [getStreams] 测试日志输出 - 这个API被调用了');
    
    try {
      const startTime = Date.now();
      
      // 验证用户认证
      console.log('🔐 [getStreams] 验证用户会话...');
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      // 获取流配置
      const streamsConfig = await getStreamsConfig(env);

      // 按排序字段排序，然后只返回用户需要的信息（隐藏敏感的RTMP URL）
      const sortedStreams = streamsConfig.sort((a, b) => {
        const orderA = a.sortOrder || 0;
        const orderB = b.sortOrder || 0;
        return orderA - orderB;
      });

      const publicStreams = sortedStreams.map(stream => ({
        id: stream.id,
        name: stream.name,
        createdAt: stream.createdAt,
        sortOrder: stream.sortOrder || 0
      }));

      logInfo(env, 'Streams list retrieved', {
        username: auth.user.username,
        streamsCount: publicStreams.length
      });

      // 获取路由信息用于响应头，支持地理路由
      const routing = await TunnelRouter.getOptimalEndpoints(env, request);
      
      return new Response(JSON.stringify({
        status: 'success',
        message: 'Streams retrieved successfully',
        data: {
          streams: publicStreams,
          count: publicStreams.length
        },
        timestamp: new Date().toISOString()
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Route-Via': routing.type,
          'X-Tunnel-Optimized': routing.type === 'tunnel' ? 'true' : 'false',
          'X-Response-Time': `${Date.now() - startTime}ms`,
          ...getCorsHeaders(request)
        }
      });

    } catch (error) {
      logError(env, 'Get streams handler error', error);
      return errorResponse('Failed to retrieve streams', 'STREAMS_ERROR', 500, request);
    }
  },

  /**
   * 请求播放指定流 - 使用按需转码API
   */
  async playStream(request, env, ctx) {
    try {
      const startTime = Date.now();

      // 验证用户认证
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse('Stream ID is required', 'MISSING_STREAM_ID', 400, request);
      }

      // 获取流配置
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, 'STREAM_NOT_FOUND', 404, request);
      }

      logStreamEvent(env, 'play_request', streamId, auth.user.username, request);

      try {
        // 检查VPS服务器连通性
        const vpsHealth = await checkVpsHealth(env);
        if (!vpsHealth.available) {
          return errorResponse('VPS server is not available', 'VPS_UNAVAILABLE', 503, request);
        }

        // 步骤1：配置频道（如果尚未配置）
        try {
          await callTranscoderAPI(env, 'ondemand/configure-channel', 'POST', {
            channelId: streamId,
            name: streamConfig.name,
            rtmpUrl: streamConfig.rtmpUrl
          });
        } catch (configError) {
          // 如果频道已配置，忽略错误继续
          logInfo(env, 'Channel configuration result', {
            streamId,
            error: configError.message
          });
        }

        // 步骤2：开始观看（按需启动转码）
        const watchResponse = await callTranscoderAPI(env, 'ondemand/start-watching', 'POST', {
          channelId: streamId,
          userId: auth.user.username,
          clientInfo: {
            userAgent: request.headers.get('User-Agent') || 'Unknown',
            ip: request.headers.get('CF-Connecting-IP') || 'Unknown'
          }
        });

        const responseTime = Date.now() - startTime;

        logStreamEvent(env, 'play_success_ondemand', streamId, auth.user.username, request, {
          responseTime: `${responseTime}ms`,
          sessionId: watchResponse.data?.sessionId,
          isFirstViewer: watchResponse.data?.isFirstViewer
        });

        // 返回HLS播放地址和观看会话信息
        const hlsUrl = `/hls/${streamId}/playlist.m3u8`;

        return successResponse({
          streamId,
          streamName: streamConfig.name,
          hlsUrl,
          onDemandInfo: {
            sessionId: watchResponse.data?.sessionId,
            isFirstViewer: watchResponse.data?.isFirstViewer,
            viewerCount: watchResponse.data?.viewerCount,
            status: watchResponse.status
          },
          responseTime
        }, `Stream '${streamConfig.name}' started successfully (on-demand)`, request);

      } catch (transcoderError) {
        logStreamEvent(env, 'play_failed_ondemand', streamId, auth.user.username, request, {
          error: transcoderError.message,
          responseTime: Date.now() - startTime
        });

        // 根据错误类型返回相应的错误信息
        if (transcoderError.message.includes('timeout')) {
          return errorResponse(
            'Stream startup timeout. Please try again.',
            'STREAM_TIMEOUT',
            504,
            request
          );
        } else if (transcoderError.message.includes('Connection')) {
          return errorResponse(
            'Unable to connect to stream source. Please check the stream configuration.',
            'STREAM_CONNECTION_ERROR',
            502,
            request
          );
        } else {
          return errorResponse(
            `Failed to start stream: ${transcoderError.message}`,
            'STREAM_START_ERROR',
            500,
            request
          );
        }
      }

    } catch (error) {
      logError(env, 'Play stream handler error', error, { streamId: request.params?.id });
      return errorResponse('Failed to start stream playback', 'PLAY_ERROR', 500, request);
    }
  },

  /**
   * 停止指定流 - 使用按需转码API
   */
  async stopStream(request, env, ctx) {
    try {
      // 验证用户认证
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse('Stream ID is required', 'MISSING_STREAM_ID', 400, request);
      }

      // 检查流是否存在
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, 'STREAM_NOT_FOUND', 404, request);
      }

      logStreamEvent(env, 'stop_request', streamId, auth.user.username, request);

      try {
        // 检查VPS服务器连通性
        const vpsHealth = await checkVpsHealth(env);
        if (!vpsHealth.available) {
          return errorResponse('VPS server is not available', 'VPS_UNAVAILABLE', 503, request);
        }

        // 调用按需转码API停止观看
        const transcoderResponse = await callTranscoderAPI(env, 'ondemand/stop-watching', 'POST', {
          channelId: streamId,
          userId: auth.user.username,
          clientInfo: {
            userAgent: request.headers.get('User-Agent') || 'Unknown',
            ip: request.headers.get('CF-Connecting-IP') || 'Unknown'
          }
        });

        logStreamEvent(env, 'stop_success_ondemand', streamId, auth.user.username, request, {
          sessionId: transcoderResponse.data?.sessionId,
          remainingViewers: transcoderResponse.data?.remainingViewers
        });

        return successResponse({
          streamId,
          streamName: streamConfig.name,
          onDemandInfo: {
            sessionId: transcoderResponse.data?.sessionId,
            remainingViewers: transcoderResponse.data?.remainingViewers,
            status: transcoderResponse.status
          }
        }, `Stream '${streamConfig.name}' stopped successfully (on-demand)`, request);

      } catch (transcoderError) {
        logStreamEvent(env, 'stop_failed_ondemand', streamId, auth.user.username, request, {
          error: transcoderError.message
        });

        return errorResponse(
          `Failed to stop stream: ${transcoderError.message}`,
          'STREAM_STOP_ERROR',
          500,
          request
        );
      }

    } catch (error) {
      logError(env, 'Stop stream handler error', error, { streamId: request.params?.id });
      return errorResponse('Failed to stop stream', 'STOP_ERROR', 500, request);
    }
  },

  /**
   * 🔥 新增：SimpleStreamManager API - 开始观看
   */
  async startWatching(request, env, ctx) {
    console.log('🎬 [startWatching] === 函数开始执行 ===');
    console.log('🎬 [startWatching] 请求URL:', request.url);
    console.log('🎬 [startWatching] 请求方法:', request.method);
    
    let channelId; // 在外部声明，方便catch块使用
    
    try {
      logInfo(env, '🎬 [startWatching] 开始处理观看请求', { timestamp: new Date().toISOString() });
      
      // 验证用户会话
      console.log('🔐 [startWatching] 开始验证用户会话...');
      const auth = await validateSession(request, env);
      if (!auth) {
        console.log('❌ [startWatching] 用户认证失败');
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }
      console.log('✅ [startWatching] 用户认证成功:', auth.user.username);

      // 解析请求体
      console.log('📝 [startWatching] 解析请求体...');
      const body = await request.json();
      channelId = body.channelId; // 赋值给外部变量
      console.log('📋 [startWatching] 请求参数:', JSON.stringify(body));

      if (!channelId) {
        console.log('❌ [startWatching] 缺少channelId参数');
        return errorResponse('channelId is required', 'MISSING_CHANNEL_ID', 400, request);
      }

      // 🔥 修复：从完整的streams配置获取频道信息（包含rtmpUrl）
      console.log('📺 [startWatching] 获取频道配置...');
      const streamsConfig = await getStreamsConfig(env);
      console.log('📺 [startWatching] 频道配置数量:', streamsConfig ? streamsConfig.length : 0);
      
      // 确保streamsConfig是数组
      if (!Array.isArray(streamsConfig)) {
        console.error('❌ [startWatching] streamsConfig不是数组:', typeof streamsConfig);
        return errorResponse('Failed to load channel configurations', 'CONFIG_ERROR', 500, request);
      }
      
      const streamConfig = streamsConfig.find(stream => stream.id === channelId);
      if (!streamConfig) {
        console.log('❌ [startWatching] 频道未找到:', channelId);
        return errorResponse('Channel not found', 'CHANNEL_NOT_FOUND', 404, request);
      }
      console.log('✅ [startWatching] 找到频道配置:', streamConfig.name);
      
      // 确保rtmpUrl存在
      if (!streamConfig.rtmpUrl) {
        return errorResponse('Channel RTMP URL not configured', 'RTMP_URL_MISSING', 400, request);
      }

      // 🔧 修复：使用callTranscoderAPI，与其他SimpleStream API保持一致
      logInfo(env, '🔄 [startWatching] 调用VPS SimpleStreamManager API', { channelId });
      const vpsResponse = await callTranscoderAPI(env, 'simple-stream/start-watching', 'POST', {
        channelId: channelId,
        rtmpUrl: streamConfig.rtmpUrl
      });

      // 获取路由信息用于URL包装
      const routingInfo = await TunnelRouter.getOptimalEndpoints(env, request);
      
      // 🎯 URL包装：根据当前模式生成适配的HLS播放地址
      const wrappedHlsUrl = wrapHlsUrlForCurrentMode(
        vpsResponse.data?.hlsUrl, 
        routingInfo, 
        env,
        auth.session.sessionId  // 传递用户会话ID作为token
      );

      logStreamEvent(env, 'start_watching_success', channelId, auth.user.username, request, {
        hlsUrl: wrappedHlsUrl,
        routingMode: routingInfo.type,
        routingReason: routingInfo.reason
      });

      return successResponse({
        channelId,
        channelName: streamConfig.name,
        hlsUrl: wrappedHlsUrl,
        routingMode: routingInfo.type,
        routingReason: routingInfo.reason,
        timestamp: vpsResponse.data?.timestamp,
        debug: {
          originalHlsUrl: vpsResponse.data?.hlsUrl,
          routingType: routingInfo.type,
          country: request?.cf?.country
        }
      }, `Started watching successfully via ${routingInfo.type} mode`, request);

    } catch (error) {
      console.error('❌ [startWatching] 捕获异常:', error);
      logError(env, 'Start watching error', error, { channelId: channelId || 'unknown' });
      return errorResponse(
        `Failed to start watching: ${error.message}`, 
        'START_WATCHING_ERROR', 
        500, 
        request
      );
    }
  },

  /**
   * 🔥 新增：SimpleStreamManager API - 停止观看
   */
  async stopWatching(request, env, ctx) {
    try {
      // 验证用户会话
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      // 解析请求体
      const body = await request.json();
      const { channelId } = body;

      if (!channelId) {
        return errorResponse('channelId is required', 'MISSING_CHANNEL_ID', 400, request);
      }

      // 调用VPS SimpleStreamManager API
      const vpsResponse = await callTranscoderAPI(env, 'simple-stream/stop-watching', 'POST', {
        channelId: channelId
      });

      logStreamEvent(env, 'stop_watching_success', channelId, auth.user.username, request);

      return successResponse({
        channelId,
        message: vpsResponse.message
      }, 'Stopped watching successfully', request);

    } catch (error) {
      logError(env, 'Stop watching error', error, { channelId: body?.channelId });
      return errorResponse('Failed to stop watching', 'STOP_WATCHING_ERROR', 500, request);
    }
  },

  /**
   * 🔥 优化：SimpleStreamManager API - 心跳（无KV验证）
   */
  async heartbeat(request, env, ctx) {
    try {
      // 🎯 优化：不在Workers层验证会话，直接转发给VPS处理
      // VPS层面已经有自己的会话管理机制，避免不必要的KV读取
      
      // 解析请求体
      const body = await request.json();
      const { channelId } = body;

      if (!channelId) {
        return errorResponse('channelId is required', 'MISSING_CHANNEL_ID', 400, request);
      }

      // 直接转发给VPS，让VPS处理会话验证和心跳记录
      const vpsResponse = await callTranscoderAPI(env, 'simple-stream/heartbeat', 'POST', {
        channelId: channelId,
        timestamp: Date.now()
      });

      return successResponse({
        channelId,
        timestamp: Date.now(),
        vpsResponse: vpsResponse.data
      }, 'Heartbeat sent successfully', request);

    } catch (error) {
      logError(env, 'Heartbeat error', error, { channelId: body?.channelId });
      return errorResponse('Failed to send heartbeat', 'HEARTBEAT_ERROR', 500, request);
    }
  },

  /**
   * 🔥 新增：SimpleStreamManager API - 系统状态
   */
  async getSystemStatus(request, env, ctx) {
    try {
      // 验证用户会话
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      // 调用VPS SimpleStreamManager API
      const vpsResponse = await callTranscoderAPI(env, 'simple-stream/system/status', 'GET');

      return successResponse(vpsResponse.data, 'System status retrieved successfully', request);

    } catch (error) {
      logError(env, 'Get system status error', error);
      return errorResponse('Failed to get system status', 'SYSTEM_STATUS_ERROR', 500, request);
    }
  }
};
