/**
 * 录制配置管理处理器
 * 管理频道定时录制配置
 */

/**
 * 获取单个频道的录制配置
 */
async function getRecordConfig(env, channelId) {
  try {
    const channelKey = `channel:${channelId}`;
    const channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
    
    if (channelData?.recordConfig) {
      return {
        status: 'success',
        data: {
          channelId,
          channelName: channelData.name,
          ...channelData.recordConfig
        }
      };
    }
    
    // 返回默认配置
    return {
      status: 'success',
      data: {
        channelId,
        channelName: channelData?.name || '',
        enabled: false,
        startTime: '07:40',
        endTime: '17:25',
        workdaysOnly: false,
        storagePath: '/var/www/recordings'
      }
    };
  } catch (error) {
    console.error('Failed to get record config:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 获取所有启用录制的频道配置（供VPS调度器调用）
 * 🔥 V2.7: 改用频道索引，避免list()操作超限
 */
async function getAllRecordConfigs(env) {
  try {
    // 🔥 从频道索引获取所有频道ID列表
    const channelIndexData = await env.YOYO_USER_DB.get('system:channel_index', { type: 'json' });
    
    console.log('[getAllRecordConfigs] Channel index:', JSON.stringify(channelIndexData));
    
    // 🔥 修复：字段名应该是 channelIds，不是 channels
    if (!channelIndexData || !channelIndexData.channelIds || channelIndexData.channelIds.length === 0) {
      console.warn('[getAllRecordConfigs] Channel index is empty or not found');
      return {
        status: 'success',
        data: []
      };
    }
    
    const configs = [];
    // 遍历索引中的所有频道
    for (const channelId of channelIndexData.channelIds) {
      console.log(`[getAllRecordConfigs] Checking channel: ${channelId}`);
      const channelData = await env.YOYO_USER_DB.get(`channel:${channelId}`, { type: 'json' });
      
      if (!channelData) {
        console.warn(`[getAllRecordConfigs] Channel data not found for: ${channelId}`);
        continue;
      }
      
      console.log(`[getAllRecordConfigs] Channel ${channelId} recordConfig:`, JSON.stringify(channelData.recordConfig));
      
      // 检查频道是否启用录制
      if (channelData?.recordConfig?.enabled) {
        const config = {
          channelId: channelData.id,
          channelName: channelData.name,  // 从顶层name获取
          rtmpUrl: channelData.rtmpUrl,   // 提供RTMP URL
          ...channelData.recordConfig
        };
        console.log(`[getAllRecordConfigs] Adding config for ${channelId}:`, JSON.stringify(config));
        configs.push(config);
      }
    }
    
    console.log(`[getAllRecordConfigs] Found ${configs.length} channels with recording enabled`);
    
    return {
      status: 'success',
      data: configs
    };
  } catch (error) {
    console.error('[getAllRecordConfigs] Failed to get all record configs:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 更新频道的录制配置
 */
async function updateRecordConfig(env, channelId, data, username) {
  try {
    const channelKey = `channel:${channelId}`;
    let channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
    
    if (!channelData) {
      throw new Error('Channel not found');
    }
    
    // 更新recordConfig字段
    channelData.recordConfig = {
      enabled: data.enabled === true,
      startTime: data.startTime,
      endTime: data.endTime,
      workdaysOnly: data.workdaysOnly === true,
      storagePath: data.storagePath || '/var/www/recordings',
      updatedAt: new Date().toISOString(),
      updatedBy: username
    };
    
    await env.YOYO_USER_DB.put(channelKey, JSON.stringify(channelData));
    
    // 🔧 异步通知VPS重载调度（不等待响应，避免死锁）
    // 使用 event.waitUntil 或直接fire-and-forget
    notifyVpsReload(env, channelId).catch(err => {
      console.error('VPS reload notification failed (non-blocking):', err.message);
    });
    
    return {
      status: 'success',
      message: 'Record config updated successfully',
      data: channelData.recordConfig
    };
  } catch (error) {
    console.error('Failed to update record config:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 通知VPS重新加载录制调度
 */
async function notifyVpsReload(env, channelId) {
  try {
    // 🔧 修复：使用正确的路由前缀 /api/simple-stream/record/reload-schedule
    const response = await fetch(`${env.VPS_API_URL}/api/simple-stream/record/reload-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.VPS_API_KEY
      },
      body: JSON.stringify({ channelId })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn('Failed to notify VPS reload:', response.statusText, errorText);
    } else {
      console.log('✅ VPS录制调度已成功重载', { channelId });
    }
  } catch (error) {
    console.error('Failed to notify VPS:', error);
    // 不抛出错误，避免影响配置保存
  }
}

/**
 * 录制配置API处理器
 * 参考preloadHandler的实现模式
 */
async function handleRecordAPI(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;
  
  try {
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
    
    // GET /api/record/configs - 获取所有启用录制的频道配置（供VPS调度器调用）
    if (method === 'GET' && pathname === '/api/record/configs') {
      const result = await getAllRecordConfigs(env);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // GET /api/record/config/:channelId - 获取单个频道录制配置
    if (method === 'GET' && pathname.match(/^\/api\/record\/config\/[\w-]+$/)) {
      const channelId = pathname.split('/').pop();
      const result = await getRecordConfig(env, channelId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // PUT /api/record/config/:channelId - 更新频道录制配置
    if (method === 'PUT' && pathname.match(/^\/api\/record\/config\/[\w-]+$/)) {
      const channelId = pathname.split('/').pop();
      const data = await request.json();
      const result = await updateRecordConfig(env, channelId, data, username);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 未匹配的路由
    return new Response(JSON.stringify({
      status: 'error',
      message: 'API endpoint not found'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Record API error:', error);
    return new Response(JSON.stringify({
      status: 'error',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export { handleRecordAPI };
