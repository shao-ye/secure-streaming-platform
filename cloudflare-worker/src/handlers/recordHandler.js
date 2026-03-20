/**
 * 录制配置管理处理器
 * 管理频道定时录制配置
 */

/**
 * 获取默认的录制自动上传配置
 * @returns {Object} 默认上传配置
 */
function getDefaultUploadConfig() {
  return {
    enabled: false,
    destinationType: 'cloudFile',
    selectorMode: 'manual',
    targetName: '',
    groupId: '',
    albumId: '',
    catalogId: '',
    manualPath: '',
    resolvedPath: '',
    uploadTrigger: 'after_finalize',
    retryTimes: 3,
    status: 'idle',
    updatedAt: '',
    updatedBy: ''
  };
}

/**
 * 获取单个频道的录制配置
 */
async function getRecordConfig(env, channelId) {
  try {
    const channelKey = `channel:${channelId}`;
    const channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });

    const mergedRecordConfig = {
      enabled: false,
      startTime: '07:40',
      endTime: '17:25',
      workdaysOnly: false,
      storagePath: '/var/www/recordings',
      upload: getDefaultUploadConfig(),
      ...(channelData?.recordConfig || {}),
      upload: {
        ...getDefaultUploadConfig(),
        ...(channelData?.recordConfig?.upload || {})
      }
    };
    
    if (channelData?.recordConfig) {
      return {
        status: 'success',
        data: {
          channelId,
          channelName: channelData.name,
          ...mergedRecordConfig
        }
      };
    }
    
    // 返回默认配置
    return {
      status: 'success',
      data: {
        channelId,
        channelName: channelData?.name || '',
        ...mergedRecordConfig
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
async function updateRecordConfig(env, ctx, channelId, data, username) {
  console.log('🔧 [updateRecordConfig] Starting...', { channelId, data, username });
  
  try {
    const channelKey = `channel:${channelId}`;
    console.log('📖 [updateRecordConfig] Reading channel from KV:', channelKey);
    let channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
    
    if (!channelData) {
      console.error('❌ [updateRecordConfig] Channel not found:', channelKey);
      throw new Error('Channel not found');
    }
    
    console.log('✅ [updateRecordConfig] Channel found:', { 
      id: channelData.id, 
      name: channelData.name,
      oldRecordConfig: channelData.recordConfig 
    });
    
    // 🔧 重新读取最新数据，避免并发写入冲突
    console.log('🔄 [updateRecordConfig] Re-reading latest data to avoid race condition...');
    const latestChannelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
    
    if (!latestChannelData) {
      throw new Error('Channel disappeared during update');
    }
    
    // 更新recordConfig字段（使用最新数据）
    latestChannelData.recordConfig = {
      enabled: data.enabled === true,
      startTime: data.startTime,
      endTime: data.endTime,
      workdaysOnly: data.workdaysOnly === true,
      storagePath: data.storagePath || '/var/www/recordings',
      updatedAt: new Date().toISOString(),
      updatedBy: username
    };
    
    console.log('💾 [updateRecordConfig] Writing to KV...', { 
      key: channelKey, 
      newRecordConfig: latestChannelData.recordConfig,
      dataSize: JSON.stringify(latestChannelData).length 
    });
    
    await env.YOYO_USER_DB.put(channelKey, JSON.stringify(latestChannelData));
    
    // 更新返回数据
    channelData = latestChannelData;
    
    console.log('✅ [updateRecordConfig] KV write completed successfully');
    
    // 🔧 同步通知VPS重载调度，直接传递最新配置
    // ✅ 避免KV最终一致性问题：不让VPS重新读取KV，而是直接传递刚保存的配置
    let vpsNotifyResult = null;
    try {
      // 构造完整配置对象传递给VPS
      const fullConfig = {
        channelId: channelData.id,
        channelName: channelData.name,
        rtmpUrl: channelData.rtmpUrl,
        ...channelData.recordConfig
      };
      console.log('📞 [updateRecordConfig] Notifying VPS...', { fullConfig });
      vpsNotifyResult = await notifyVpsReload(env, channelId, fullConfig);
      console.log('✅ [updateRecordConfig] VPS notification successful', { result: vpsNotifyResult });
    } catch (error) {
      console.error('⚠️ [updateRecordConfig] VPS notification failed (config saved)', { 
        channelId, 
        error: error.message,
        stack: error.stack
      });
      vpsNotifyResult = { error: error.message };
      // 即使通知失败，配置也已保存，VPS定时重载会生效
    }
    
    const response = {
      status: 'success',
      message: 'Record config updated successfully',
      data: channelData.recordConfig,
      debug: {
        vpsNotified: vpsNotifyResult?.success || false,
        vpsError: vpsNotifyResult?.error || null
      }
    };
    
    console.log('🎉 [updateRecordConfig] Completed successfully', response);
    return response;
  } catch (error) {
    console.error('❌ [updateRecordConfig] Failed:', { 
      error: error.message, 
      stack: error.stack,
      channelId,
      data
    });
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 通知VPS重新加载录制调度
 * @param {Object} config - 可选：直接传递最新配置，避免KV延迟
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function notifyVpsReload(env, channelId, config = null) {
  try {
    console.log('🔔 正在通知VPS重载录制调度...', { 
      url: env.VPS_API_URL, 
      channelId,
      hasConfig: !!config,
      configEnabled: config?.enabled,
      hasApiKey: !!env.VPS_API_KEY
    });
    
    // 🔧 修复：直接传递配置，避免VPS重新读取KV导致的延迟问题
    const response = await fetch(`${env.VPS_API_URL}/api/simple-stream/record/reload-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.VPS_API_KEY
      },
      body: JSON.stringify({ 
        channelId,
        config  // 🆕 直接传递配置对象
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('VPS响应失败:', { status: response.status, statusText: response.statusText, errorText });
      throw new Error(`VPS returned ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ VPS录制调度已成功重载', { channelId, result });
    return { success: true };
  } catch (error) {
    console.error('通知VPS失败:', { error: error.message, stack: error.stack });
    throw error;  // 抛出错误，让调用者处理
  }
}

/**
 * 录制配置API处理器
 * 参考preloadHandler的实现模式
 */
async function handleRecordAPI(request, env, ctx) {
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
      const result = await updateRecordConfig(env, ctx, channelId, data, username);
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
