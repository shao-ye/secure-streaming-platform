/**
 * Cloudflare KV存储工具函数
 */

import { logError, logInfo } from './logger.js';

/**
 * 🔥 全局缓存：减少KV读取次数
 * Workers的全局变量在请求之间共享（同一Isolate内）
 */
const CACHE = {
  streamsConfig: null,
  streamsConfigExpiry: 0,
  proxyConfig: null,
  proxyConfigExpiry: 0
};

// 缓存过期时间（毫秒）
const CACHE_TTL = {
  STREAMS_CONFIG: 60 * 1000,  // 频道配置缓存60秒
  PROXY_CONFIG: 60 * 1000     // 代理配置缓存60秒
};

/**
 * 获取用户数据
 */
export async function getUser(env, username) {
  try {
    const userKey = `user:${username}`;
    const userData = await env.YOYO_USER_DB.get(userKey, 'json');

    if (!userData) {
      return null;
    }

    // 验证数据完整性
    if (!userData.username || !userData.hashedPassword || !userData.salt) {
      logError(env, 'Invalid user data structure', new Error('Missing required fields'), { username });
      return null;
    }

    return userData;
  } catch (error) {
    logError(env, 'Failed to get user from KV', error, { username });
    return null;
  }
}

/**
 * 创建或更新用户数据
 */
export async function setUser(env, userData) {
  try {
    const userKey = `user:${userData.username}`;

    const userRecord = {
      username: userData.username,
      hashedPassword: userData.hashedPassword,
      salt: userData.salt,
      role: userData.role || 'user',
      createdAt: userData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await env.YOYO_USER_DB.put(userKey, JSON.stringify(userRecord));
    logInfo(env, 'User data saved to KV', { username: userData.username, role: userRecord.role });

    return userRecord;
  } catch (error) {
    logError(env, 'Failed to save user to KV', error, { username: userData.username });
    throw error;
  }
}

/**
 * 创建会话
 */
export async function createSession(env, sessionId, username, expirationMs = 86400000) {
  try {
    const sessionKey = `session:${sessionId}`;
    const expiresAt = Date.now() + expirationMs;
    const sessionData = {
      sessionId,
      username,
      createdAt: new Date().toISOString(),
      expiresAt
    };

    // 设置TTL（秒）
    const ttlSeconds = Math.floor(expirationMs / 1000);
    await env.YOYO_USER_DB.put(sessionKey, JSON.stringify(sessionData), {
      expirationTtl: ttlSeconds
    });

    logInfo(env, 'Session created', { sessionId, username, expiresAt: new Date(expiresAt).toISOString() });

    return sessionData;
  } catch (error) {
    logError(env, 'Failed to create session', error, { sessionId, username });
    throw error;
  }
}

/**
 * 获取会话数据
 */
export async function getSession(env, sessionId) {
  try {
    const sessionKey = `session:${sessionId}`;
    const sessionData = await env.YOYO_USER_DB.get(sessionKey, 'json');

    if (!sessionData) {
      return null;
    }

    // 检查会话是否过期
    if (sessionData.expiresAt && Date.now() > sessionData.expiresAt) {
      // 会话已过期，删除它
      await deleteSession(env, sessionId);
      return null;
    }

    return sessionData;
  } catch (error) {
    logError(env, 'Failed to get session from KV', error, { sessionId });
    return null;
  }
}

/**
 * 删除会话
 */
export async function deleteSession(env, sessionId) {
  try {
    const sessionKey = `session:${sessionId}`;
    await env.YOYO_USER_DB.delete(sessionKey);
    logInfo(env, 'Session deleted', { sessionId });
  } catch (error) {
    logError(env, 'Failed to delete session', error, { sessionId });
  }
}

/**
 * 获取流配置（带缓存优化）
 * 🔥 优化：添加60秒缓存，大幅减少KV读取次数
 */
export async function getStreamsConfig(env) {
  try {
    const now = Date.now();
    
    // 🎯 检查缓存是否有效
    if (CACHE.streamsConfig && now < CACHE.streamsConfigExpiry) {
      // console.log('✅ 使用缓存的频道配置，避免KV读取');
      return CACHE.streamsConfig;
    }
    
    // 🔄 缓存过期或不存在，从KV读取
    console.log('🔄 缓存过期，从KV读取频道配置');
    const streamsData = await env.YOYO_USER_DB.get('streams_config', 'json');
    const config = streamsData || [];
    
    // 更新缓存
    CACHE.streamsConfig = config;
    CACHE.streamsConfigExpiry = now + CACHE_TTL.STREAMS_CONFIG;
    
    return config;
  } catch (error) {
    logError(env, 'Failed to get streams config from KV', error);
    // 即使出错，也返回缓存的数据（如果有）
    return CACHE.streamsConfig || [];
  }
}

/**
 * 获取代理配置（带缓存优化）
 * 🔥 优化：添加60秒缓存，减少KV读取次数
 */
export async function getProxyConfig(env) {
  try {
    const now = Date.now();
    const defaultConfig = {
      enabled: false,
      activeProxyId: null,
      proxies: [],
      settings: {
        enabled: false,
        activeProxyId: null,
        autoSwitch: false,
        testInterval: 300
      }
    };
    
    // 🎯 检查缓存是否有效
    if (CACHE.proxyConfig && now < CACHE.proxyConfigExpiry) {
      return CACHE.proxyConfig;
    }
    
    // 🔄 从KV读取
    const proxyData = await env.YOYO_USER_DB.get('proxy_config', 'json');
    const config = proxyData || defaultConfig;
    
    // 更新缓存
    CACHE.proxyConfig = config;
    CACHE.proxyConfigExpiry = now + CACHE_TTL.PROXY_CONFIG;
    
    return config;
  } catch (error) {
    logError(env, 'Failed to get proxy config from KV', error);
    return CACHE.proxyConfig || {
      enabled: false,
      activeProxyId: null,
      proxies: [],
      settings: {
        enabled: false,
        activeProxyId: null,
        autoSwitch: false,
        testInterval: 300
      }
    };
  }
}

/**
 * 保存流配置
 * 🔥 优化：保存后清除缓存，确保下次读取最新数据
 */
export async function setStreamsConfig(env, streamsConfig) {
  try {
    await env.YOYO_USER_DB.put('streams_config', JSON.stringify(streamsConfig));
    
    // 清除缓存，确保下次读取最新数据
    CACHE.streamsConfig = null;
    CACHE.streamsConfigExpiry = 0;
    
    logInfo(env, 'Streams config saved to KV and cache cleared', { count: streamsConfig.length });
    return streamsConfig;
  } catch (error) {
    logError(env, 'Failed to save streams config to KV', error);
    throw error;
  }
}

/**
 * 保存代理配置
 * 🔥 优化：保存后清除缓存
 */
export async function setProxyConfig(env, proxyConfig) {
  try {
    await env.YOYO_USER_DB.put('proxy_config', JSON.stringify(proxyConfig));
    
    // 清除缓存
    CACHE.proxyConfig = null;
    CACHE.proxyConfigExpiry = 0;
    
    logInfo(env, 'Proxy config saved to KV and cache cleared', { 
      enabled: proxyConfig.enabled,
      proxyCount: proxyConfig.proxies?.length || 0,
      activeProxyId: proxyConfig.activeProxyId
    });
    return proxyConfig;
  } catch (error) {
    logError(env, 'Failed to save proxy config to KV', error);
    throw error;
  }
}

/**
 * 添加流配置
 */
export async function addStreamConfig(env, streamConfig) {
  try {
    const streamsConfig = await getStreamsConfig(env);

    // 检查ID是否已存在
    if (streamsConfig.find(stream => stream.id === streamConfig.id)) {
      throw new Error(`Stream with ID '${streamConfig.id}' already exists`);
    }

    // 计算默认排序值（当前最大排序值+1）
    const maxSortOrder = streamsConfig.reduce((max, stream) => {
      return Math.max(max, stream.sortOrder || 0);
    }, 0);

    const newStream = {
      id: streamConfig.id,
      name: streamConfig.name,
      rtmpUrl: streamConfig.rtmpUrl,
      sortOrder: streamConfig.sortOrder !== undefined ? streamConfig.sortOrder : maxSortOrder + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    streamsConfig.push(newStream);
    await setStreamsConfig(env, streamsConfig);

    logInfo(env, 'Stream config added', { streamId: streamConfig.id, streamName: streamConfig.name });

    return newStream;
  } catch (error) {
    logError(env, 'Failed to add stream config', error, { streamId: streamConfig.id });
    throw error;
  }
}

/**
 * 更新流配置
 */
export async function updateStreamConfig(env, streamId, updates) {
  try {
    const streamsConfig = await getStreamsConfig(env);
    const streamIndex = streamsConfig.findIndex(stream => stream.id === streamId);

    if (streamIndex === -1) {
      throw new Error(`Stream with ID '${streamId}' not found`);
    }

    // 更新流配置
    streamsConfig[streamIndex] = {
      ...streamsConfig[streamIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await setStreamsConfig(env, streamsConfig);

    logInfo(env, 'Stream config updated', { streamId, updates });

    return streamsConfig[streamIndex];
  } catch (error) {
    logError(env, 'Failed to update stream config', error, { streamId, updates });
    throw error;
  }
}

/**
 * 删除流配置
 */
export async function deleteStreamConfig(env, streamId) {
  try {
    const streamsConfig = await getStreamsConfig(env);
    const streamIndex = streamsConfig.findIndex(stream => stream.id === streamId);

    if (streamIndex === -1) {
      throw new Error(`Stream with ID '${streamId}' not found`);
    }

    const deletedStream = streamsConfig.splice(streamIndex, 1)[0];
    await setStreamsConfig(env, streamsConfig);

    logInfo(env, 'Stream config deleted', { streamId, streamName: deletedStream.name });

    return deletedStream;
  } catch (error) {
    logError(env, 'Failed to delete stream config', error, { streamId });
    throw error;
  }
}

/**
 * 获取特定流配置
 */
export async function getStreamConfig(env, streamId) {
  try {
    const streamsConfig = await getStreamsConfig(env);
    return streamsConfig.find(stream => stream.id === streamId) || null;
  } catch (error) {
    logError(env, 'Failed to get stream config', error, { streamId });
    return null;
  }
}

/**
 * 批量操作：清理过期会话
 */
export async function cleanupExpiredSessions(env) {
  try {
    // 由于KV的限制，这里只能记录清理请求
    // 实际的清理由TTL自动处理
    logInfo(env, 'Session cleanup task executed (TTL-based cleanup active)');
  } catch (error) {
    logError(env, 'Failed to cleanup expired sessions', error);
  }
}
