/**
 * 频道配置统一处理器
 * 一次性更新预加载和录制配置，避免分开更新导致的竞争条件
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
 * 获取频道完整配置
 */
async function getChannelConfig(env, channelId) {
  try {
    const channelKey = `channel:${channelId}`;
    const channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
    
    if (!channelData) {
      return {
        status: 'error',
        message: 'Channel not found'
      };
    }
    
    const mergedRecordConfig = {
      enabled: false,
      startTime: '08:00',
      endTime: '17:00',
      workdaysOnly: false,
      storagePath: '/var/www/recordings',
      upload: getDefaultUploadConfig(),
      ...(channelData.recordConfig || {}),
      upload: {
        ...getDefaultUploadConfig(),
        ...(channelData.recordConfig?.upload || {})
      }
    };

    return {
      status: 'success',
      data: {
        channelId: channelData.id,
        channelName: channelData.name,
        preloadConfig: channelData.preloadConfig || {
          enabled: false,
          startTime: '07:00',
          endTime: '17:30',
          workdaysOnly: false
        },
        recordConfig: mergedRecordConfig,
        videoAspectRatio: channelData.videoAspectRatio || 'original'  // 🆕 返回视频比例配置
      }
    };
  } catch (error) {
    console.error('Failed to get channel config:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}

async function notifyVpsPreloadReload(env, channelId, config = null) {
  try {
    console.log('🔔 Notifying VPS preload reload...', {
      url: env.VPS_API_URL,
      channelId,
      hasConfig: !!config
    });
    
    const response = await fetch(`${env.VPS_API_URL}/api/simple-stream/preload/reload-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.VPS_API_KEY
      },
      body: JSON.stringify({
        channelId,
        config
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('VPS response failed:', {
        status: response.status,
        errorText
      });
      throw new Error(`VPS responded with ${response.status}`);
    }
    
    return { success: true };
  } catch (error) {
    console.error('VPS preload notification error:', error);
    throw error;
  }
}

/**
 * 更新频道完整配置（一次性更新预加载和录制配置）
 */
async function updateChannelConfig(env, ctx, channelId, data, username) {
  console.log('🔧 [updateChannelConfig] Starting...', { channelId, username });
  
  try {
    const channelKey = `channel:${channelId}`;
    
    // 读取当前频道数据
    console.log('📖 [updateChannelConfig] Reading channel from KV:', channelKey);
    let channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
    
    if (!channelData) {
      console.error('❌ [updateChannelConfig] Channel not found:', channelKey);
      throw new Error('Channel not found');
    }
    
    console.log('✅ [updateChannelConfig] Channel found:', {
      id: channelData.id,
      name: channelData.name,
      oldPreloadConfig: channelData.preloadConfig,
      oldRecordConfig: channelData.recordConfig
    });
    
    const now = new Date().toISOString();
    
    // 🔥 同时更新两个配置
    if (data.preloadConfig) {
      channelData.preloadConfig = {
        enabled: data.preloadConfig.enabled === true,
        startTime: data.preloadConfig.startTime,
        endTime: data.preloadConfig.endTime,
        workdaysOnly: data.preloadConfig.workdaysOnly === true,
        updatedAt: now,
        updatedBy: username
      };
      console.log('✅ [updateChannelConfig] PreloadConfig updated');
    }
    
    if (data.recordConfig) {
      const uploadConfig = {
        ...getDefaultUploadConfig(),
        ...(data.recordConfig.upload || {}),
        enabled: data.recordConfig.upload?.enabled === true,
        destinationType: data.recordConfig.upload?.destinationType || 'cloudFile',
        selectorMode: data.recordConfig.upload?.selectorMode || 'manual',
        targetName: data.recordConfig.upload?.targetName || '',
        groupId: data.recordConfig.upload?.groupId || '',
        albumId: data.recordConfig.upload?.albumId || '',
        catalogId: data.recordConfig.upload?.catalogId || '',
        manualPath: data.recordConfig.upload?.manualPath || '',
        resolvedPath: data.recordConfig.upload?.resolvedPath || '',
        uploadTrigger: 'after_finalize',
        retryTimes: Math.max(0, parseInt(data.recordConfig.upload?.retryTimes) || 3),
        status: data.recordConfig.upload?.status || 'idle',
        updatedAt: now,
        updatedBy: username
      };

      channelData.recordConfig = {
        enabled: data.recordConfig.enabled === true,
        startTime: data.recordConfig.startTime,
        endTime: data.recordConfig.endTime,
        workdaysOnly: data.recordConfig.workdaysOnly === true,
        storagePath: data.recordConfig.storagePath || '/var/www/recordings',
        upload: uploadConfig,
        updatedAt: now,
        updatedBy: username
      };
      console.log('✅ [updateChannelConfig] RecordConfig updated');
    }
    
    // 🆕 更新视频比例配置
    if (data.videoAspectRatio) {
      const validRatios = ['original', '4:3', '16:9'];
      if (!validRatios.includes(data.videoAspectRatio)) {
        throw new Error(`Invalid videoAspectRatio: ${data.videoAspectRatio}`);
      }
      
      channelData.videoAspectRatio = data.videoAspectRatio;
      console.log('✅ [updateChannelConfig] VideoAspectRatio updated:', data.videoAspectRatio);
    }
    
    // 更新频道的整体时间戳
    channelData.updatedAt = now;
    
    console.log('💾 [updateChannelConfig] Writing to KV...', {
      key: channelKey,
      dataSize: JSON.stringify(channelData).length
    });
    
    // 🔥 一次性写入 KV
    await env.YOYO_USER_DB.put(channelKey, JSON.stringify(channelData));
    
    console.log('✅ [updateChannelConfig] KV write completed successfully');
    
    // 通知 VPS 重载预加载调度
    let vpsPreloadNotifyResult = null;
    if (data.preloadConfig) {
      try {
        const fullConfig = {
          channelId: channelData.id,
          channelName: channelData.name,
          rtmpUrl: channelData.rtmpUrl,
          ...channelData.preloadConfig
        };
        
        console.log('📞 [updateChannelConfig] Notifying VPS preload reload...', { fullConfig });
        vpsPreloadNotifyResult = await notifyVpsPreloadReload(env, channelId, fullConfig);
        console.log('✅ [updateChannelConfig] VPS preload notification successful');
      } catch (error) {
        console.error('⚠️ [updateChannelConfig] VPS preload notification failed (config saved)', {
          error: error.message
        });
        vpsPreloadNotifyResult = { error: error.message };
      }
    }
    
    // 通知 VPS 重载录制调度
    let vpsRecordNotifyResult = null;
    if (data.recordConfig) {
      try {
        const fullConfig = {
          channelId: channelData.id,
          channelName: channelData.name,
          rtmpUrl: channelData.rtmpUrl,
          ...channelData.recordConfig
        };
        
        console.log('📞 [updateChannelConfig] Notifying VPS...', { fullConfig });
        vpsRecordNotifyResult = await notifyVpsReload(env, channelId, fullConfig);
        console.log('✅ [updateChannelConfig] VPS notification successful');
      } catch (error) {
        console.error('⚠️ [updateChannelConfig] VPS notification failed (config saved)', {
          error: error.message
        });
        vpsRecordNotifyResult = { error: error.message };
      }
    }
    
    const response = {
      status: 'success',
      message: 'Channel config updated successfully',
      data: {
        preloadConfig: channelData.preloadConfig,
        recordConfig: channelData.recordConfig,
        videoAspectRatio: channelData.videoAspectRatio  // 🆕 返回保存的值
      },
      debug: {
        vpsNotified: vpsRecordNotifyResult?.success || false,
        vpsError: vpsRecordNotifyResult?.error || null,
        vpsPreloadNotified: vpsPreloadNotifyResult?.success || false,
        vpsPreloadError: vpsPreloadNotifyResult?.error || null,
        vpsRecordNotified: vpsRecordNotifyResult?.success || false,
        vpsRecordError: vpsRecordNotifyResult?.error || null
      }
    };
    
    console.log('🎉 [updateChannelConfig] Completed successfully', response);
    return response;
  } catch (error) {
    console.error('❌ [updateChannelConfig] Failed:', {
      error: error.message,
      stack: error.stack,
      channelId
    });
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * 通知VPS重新加载录制调度
 */
async function notifyVpsReload(env, channelId, config = null) {
  try {
    console.log('🔔 Notifying VPS reload...', {
      url: env.VPS_API_URL,
      channelId,
      hasConfig: !!config
    });
    
    const response = await fetch(`${env.VPS_API_URL}/api/simple-stream/record/reload-schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.VPS_API_KEY
      },
      body: JSON.stringify({
        channelId,
        config
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('VPS response failed:', {
        status: response.status,
        errorText
      });
      throw new Error(`VPS responded with ${response.status}`);
    }
    
    return { success: true };
  } catch (error) {
    console.error('VPS notification error:', error);
    throw error;
  }
}

/**
 * 频道配置 API 处理器
 */
async function handleChannelConfigAPI(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;
  
  try {
    // 从 cookie 获取用户信息
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
    
    // GET /api/channel/:channelId/config - 获取频道配置
    if (method === 'GET' && pathname.match(/^\/api\/channel\/[\w-]+\/config$/)) {
      const channelId = pathname.split('/')[3];
      const result = await getChannelConfig(env, channelId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // PUT /api/channel/:channelId/config - 更新频道配置
    if (method === 'PUT' && pathname.match(/^\/api\/channel\/[\w-]+\/config$/)) {
      const channelId = pathname.split('/')[3];
      const data = await request.json();
      const result = await updateChannelConfig(env, ctx, channelId, data, username);
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
    console.error('Channel config API error:', error);
    return new Response(JSON.stringify({
      status: 'error',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export { handleChannelConfigAPI };
