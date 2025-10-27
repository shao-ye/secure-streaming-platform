/**
 * 预加载配置管理处理器
 * 管理频道预加载时间配置
 */

/**
 * 获取单个频道的预加载配置
 */
async function getPreloadConfig(env, channelId) {
  try {
    const key = `PRELOAD_CONFIG:${channelId}`;
    const config = await env.YOYO_USER_DB.get(key, { type: 'json' });
    
    if (!config) {
      return {
        status: 'success',
        data: {
          channelId,
          enabled: false,
          startTime: '07:00',
          endTime: '17:30'
        }
      };
    }
    
    return {
      status: 'success',
      data: config
    };
  } catch (error) {
    console.error('Failed to get preload config:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 获取所有频道的预加载配置（批量）
 */
async function getAllPreloadConfigs(env) {
  try {
    // 列出所有PRELOAD_CONFIG:*的键
    const listResult = await env.YOYO_USER_DB.list({ prefix: 'PRELOAD_CONFIG:' });
    
    const configs = [];
    for (const key of listResult.keys) {
      const config = await env.YOYO_USER_DB.get(key.name, { type: 'json' });
      if (config && config.enabled) {
        configs.push(config);
      }
    }
    
    return {
      status: 'success',
      data: configs
    };
  } catch (error) {
    console.error('Failed to get all preload configs:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 更新频道的预加载配置
 */
async function updatePreloadConfig(env, channelId, data, username) {
  try {
    const { enabled, startTime, endTime } = data;
    
    // 验证时间格式
    if (!isValidTimeFormat(startTime) || !isValidTimeFormat(endTime)) {
      return {
        status: 'error',
        message: '时间格式错误，应为 HH:MM 格式'
      };
    }
    
    const config = {
      channelId,
      enabled: enabled === true,
      startTime,
      endTime,
      updatedAt: new Date().toISOString(),
      updatedBy: username || 'unknown'
    };
    
    const key = `PRELOAD_CONFIG:${channelId}`;
    await env.YOYO_USER_DB.put(key, JSON.stringify(config));
    
    // 🆕 通知VPS重新加载调度器（可选，如果VPS API可用）
    try {
      await notifyVpsReload(env);
    } catch (error) {
      // 通知失败不影响配置保存
      console.error('Failed to notify VPS:', error);
    }
    
    return {
      status: 'success',
      data: config
    };
  } catch (error) {
    console.error('Failed to update preload config:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 获取预加载状态（从VPS）
 */
async function getPreloadStatus(env) {
  try {
    const vpsUrl = `${env.VPS_API_URL}/api/simple-stream/preload/vps-status`;
    const response = await fetch(vpsUrl, {
      headers: {
        'X-API-Key': env.VPS_API_KEY
      }
    });
    
    if (!response.ok) {
      throw new Error(`VPS API responded with status ${response.status}`);
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to get preload status from VPS:', error);
    return {
      status: 'error',
      message: 'Failed to connect to VPS: ' + error.message
    };
  }
}

/**
 * 通知VPS重新加载调度器
 */
async function notifyVpsReload(env) {
  const vpsUrl = `${env.VPS_API_URL}/api/simple-stream/preload/reload-schedule`;
  const response = await fetch(vpsUrl, {
    method: 'POST',
    headers: {
      'X-API-Key': env.VPS_API_KEY,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`VPS reload API responded with status ${response.status}`);
  }
  
  return await response.json();
}

/**
 * 验证时间格式 (HH:MM)
 */
function isValidTimeFormat(time) {
  if (typeof time !== 'string') return false;
  const regex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return regex.test(time);
}

/**
 * 主处理函数
 */
export async function handlePreloadRequest(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const pathname = url.pathname;
  
  // 从cookie获取用户信息（用于记录操作者）
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('='))
  );
  const sessionToken = cookies.session_token;
  let username = 'unknown';
  
  if (sessionToken) {
    try {
      const sessionKey = `SESSION:${sessionToken}`;
      const session = await env.YOYO_USER_DB.get(sessionKey, { type: 'json' });
      if (session && session.username) {
        username = session.username;
      }
    } catch (error) {
      console.error('Failed to get session:', error);
    }
  }
  
  // GET /api/preload/config/:channelId - 获取单个配置
  if (method === 'GET' && pathname.match(/^\/api\/preload\/config\/[\w-]+$/)) {
    const channelId = pathname.split('/').pop();
    const result = await getPreloadConfig(env, channelId);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // GET /api/preload/configs - 获取所有配置（批量）
  if (method === 'GET' && pathname === '/api/preload/configs') {
    const result = await getAllPreloadConfigs(env);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // PUT /api/preload/config/:channelId - 更新配置
  if (method === 'PUT' && pathname.match(/^\/api\/preload\/config\/[\w-]+$/)) {
    const channelId = pathname.split('/').pop();
    const data = await request.json();
    const result = await updatePreloadConfig(env, channelId, data, username);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // GET /api/preload/status - 获取预加载状态
  if (method === 'GET' && pathname === '/api/preload/status') {
    const result = await getPreloadStatus(env);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // 404
  return new Response(JSON.stringify({
    status: 'error',
    message: 'Not found'
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}
