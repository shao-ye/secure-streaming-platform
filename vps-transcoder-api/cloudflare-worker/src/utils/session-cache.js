/**
 * 会话缓存工具 - 减少HLS请求的KV读取
 * 专门用于优化视频播放时的会话验证性能
 */

/**
 * 内存会话缓存
 * 注意：Cloudflare Workers的内存在请求间不共享，但在单个请求内有效
 */
class SessionCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 100; // 最大缓存100个会话
    this.ttl = 300000; // 5分钟TTL
  }

  /**
   * 生成缓存键
   */
  getCacheKey(sessionId) {
    return `session:${sessionId}`;
  }

  /**
   * 获取缓存的会话
   */
  get(sessionId) {
    const key = this.getCacheKey(sessionId);
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }
    
    // 检查是否过期
    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  /**
   * 设置会话缓存
   */
  set(sessionId, sessionData) {
    const key = this.getCacheKey(sessionId);
    
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data: sessionData,
      expiry: Date.now() + this.ttl,
      timestamp: Date.now()
    });
  }

  /**
   * 删除会话缓存
   */
  delete(sessionId) {
    const key = this.getCacheKey(sessionId);
    this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl
    };
  }
}

// 全局缓存实例（在Worker实例生命周期内有效）
let globalSessionCache = null;

/**
 * 获取全局会话缓存实例
 */
export function getSessionCache() {
  if (!globalSessionCache) {
    globalSessionCache = new SessionCache();
  }
  return globalSessionCache;
}

/**
 * 优化的会话验证函数 - 带缓存
 * 专门用于HLS请求，减少KV读取
 */
export async function validateSessionWithCache(request, env) {
  const cache = getSessionCache();
  
  try {
    // 从请求中提取会话ID
    const sessionId = getSessionIdFromRequest(request);
    if (!sessionId) {
      return null;
    }

    // 先尝试从缓存获取
    const cachedSession = cache.get(sessionId);
    if (cachedSession) {
      console.log(`🎯 会话缓存命中: ${sessionId.substring(0, 8)}...`);
      return cachedSession;
    }

    // 缓存未命中，从KV获取
    console.log(`📡 会话缓存未命中，查询KV: ${sessionId.substring(0, 8)}...`);
    
    const session = await getSession(env, sessionId);
    if (!session) {
      return null;
    }

    // 获取用户详细信息
    const user = await getUser(env, session.username);
    if (!user) {
      // 会话存在但用户不存在，删除无效会话
      await deleteSession(env, sessionId);
      return null;
    }

    const sessionData = {
      session,
      user: {
        username: user.username,
        role: user.role,
        createdAt: user.createdAt
      }
    };

    // 存入缓存
    cache.set(sessionId, sessionData);
    console.log(`💾 会话已缓存: ${sessionId.substring(0, 8)}...`);

    return sessionData;

  } catch (error) {
    console.error('Session validation with cache failed:', error);
    return null;
  }
}

/**
 * 从请求中提取会话ID（复制自auth.js）
 */
function getSessionIdFromRequest(request) {
  if (!request || !request.headers) {
    return null;
  }
  
  // 优先从Authorization header获取token
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // 从查询参数获取token（用于HLS文件请求）
  const url = new URL(request.url);
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) {
    return tokenFromQuery;
  }
  
  // 如果没有Authorization header和查询参数，则从Cookie获取
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {});

  return cookies.session || cookies.sessionId;
}

/**
 * 导入KV操作函数（需要从其他模块导入）
 */
async function getSession(env, sessionId) {
  const { getSession: kvGetSession } = await import('./kv.js');
  return await kvGetSession(env, sessionId);
}

async function getUser(env, username) {
  const { getUser: kvGetUser } = await import('./kv.js');
  return await kvGetUser(env, username);
}

async function deleteSession(env, sessionId) {
  const { deleteSession: kvDeleteSession } = await import('./kv.js');
  return await kvDeleteSession(env, sessionId);
}
