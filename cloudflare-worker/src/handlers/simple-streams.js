/**
 * 简化流管理处理器
 * 配合VPS上的SimpleStreamManager使用
 */

const VPS_API_BASE = 'https://yoyo-vps.5202021.xyz';
const VPS_API_KEY = '85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938';

/**
 * 调用VPS API的通用函数
 */
async function callVpsApi(endpoint, method = 'GET', data = null) {
  const url = `${VPS_API_BASE}/api/simple-stream${endpoint}`;
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': VPS_API_KEY
    }
  };
  
  if (data && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(data);
  }
  
  try {
    const response = await fetch(url, options);
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.message || `VPS API error (${response.status})`);
    }
    
    return result;
  } catch (error) {
    console.error('VPS API call failed:', error);
    throw new Error(`VPS API error: ${error.message}`);
  }
}

/**
 * 开始播放流
 * POST /api/play/:channelId
 */
export async function handlePlayStream(request, env, channelId) {
  try {
    // 从请求中获取用户信息
    const body = await request.json().catch(() => ({}));
    const userId = body.userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 调用VPS API开始观看
    const result = await callVpsApi('/start-watching', 'POST', {
      channelId,
      userId
    });
    
    return new Response(JSON.stringify({
      status: 'success',
      message: 'Stream started successfully',
      data: {
        sessionId: result.data.sessionId,
        channelId: result.data.channelId,
        channelName: result.data.channelName,
        hlsUrl: result.data.hlsUrl,
        isFirstViewer: result.data.isFirstViewer,
        totalViewers: result.data.totalViewers
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Failed to start stream:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: `Failed to start stream: ${error.message}`,
      code: 'STREAM_START_ERROR',
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 停止播放流
 * POST /api/stop/:sessionId
 */
export async function handleStopStream(request, env, sessionId) {
  try {
    // 调用VPS API停止观看
    const result = await callVpsApi('/stop-watching', 'POST', {
      sessionId
    });
    
    return new Response(JSON.stringify({
      status: 'success',
      message: 'Stream stopped successfully',
      data: result.data
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Failed to stop stream:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: `Failed to stop stream: ${error.message}`,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 会话心跳
 * POST /api/heartbeat/:sessionId
 */
export async function handleHeartbeat(request, env, sessionId) {
  try {
    // 调用VPS API更新会话活动
    await callVpsApi('/heartbeat', 'POST', {
      sessionId
    });
    
    return new Response(JSON.stringify({
      status: 'success',
      message: 'Heartbeat updated'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Failed to update heartbeat:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: `Failed to update heartbeat: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 获取频道状态
 * GET /api/channel/:channelId/status
 */
export async function handleChannelStatus(request, env, channelId) {
  try {
    const result = await callVpsApi(`/channel/${channelId}/status`);
    
    return new Response(JSON.stringify({
      status: 'success',
      data: result.data
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Failed to get channel status:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: `Failed to get channel status: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 获取系统状态
 * GET /api/system/status
 */
export async function handleSystemStatus(request, env) {
  try {
    const result = await callVpsApi('/system/status');
    
    return new Response(JSON.stringify({
      status: 'success',
      data: {
        vps: { status: 'running' },
        streams: {
          active: result.data.activeStreams,
          configured: 8 // 固定8个频道
        },
        sessions: {
          total: result.data.totalSessions
        },
        cloudflare: {
          worker: {
            timestamp: new Date().toISOString(),
            version: '2.0.0'
          }
        }
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Failed to get system status:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: `Failed to get system status: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * HLS代理 - 代理VPS的HLS文件并添加CORS头
 * GET /hls/:channelId/:file
 */
export async function handleHlsProxy(request, env, channelId, file) {
  try {
    const hlsUrl = `${VPS_API_BASE}/hls/${channelId}/${file}`;
    
    const response = await fetch(hlsUrl, {
      headers: {
        'X-API-Key': VPS_API_KEY
      }
    });
    
    if (!response.ok) {
      throw new Error(`HLS file not found: ${response.status}`);
    }
    
    const content = await response.arrayBuffer();
    
    // 设置正确的CORS和缓存头
    const headers = new Headers();
    
    if (file.endsWith('.m3u8')) {
      headers.set('Content-Type', 'application/vnd.apple.mpegurl');
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (file.endsWith('.ts')) {
      headers.set('Content-Type', 'video/mp2t');
      headers.set('Cache-Control', 'public, max-age=60');
    }
    
    // 添加CORS头
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    
    return new Response(content, {
      status: 200,
      headers
    });
    
  } catch (error) {
    console.error('HLS proxy error:', error);
    
    return new Response(JSON.stringify({
      status: 'error',
      message: `HLS proxy error: ${error.message}`
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
