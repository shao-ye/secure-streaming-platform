/**
 * 缓存工具函数
 * 用于优化API响应性能
 */

import { logInfo, logError } from './logger.js';

/**
 * 内存缓存（Worker生命周期内有效）
 */
const memoryCache = new Map();

/**
 * 缓存配置
 */
const CACHE_CONFIG = {
  streams: {
    ttl: 30000, // 30秒
    key: 'streams_list'
  },
  vpsHealth: {
    ttl: 10000, // 10秒
    key: 'vps_health'
  },
  systemStatus: {
    ttl: 60000, // 60秒
    key: 'system_status'
  }
};

/**
 * 设置缓存
 */
export function setCache(key, data, ttl = 30000) {
  try {
    const cacheItem = {
      data,
      timestamp: Date.now(),
      ttl
    };

    memoryCache.set(key, cacheItem);

    // 设置自动清理
    setTimeout(() => {
      memoryCache.delete(key);
    }, ttl);

    return true;
  } catch (error) {
    console.error('Cache set error:', error);
    return false;
  }
}

/**
 * 获取缓存
 */
export function getCache(key) {
  try {
    const cacheItem = memoryCache.get(key);

    if (!cacheItem) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - cacheItem.timestamp > cacheItem.ttl) {
      memoryCache.delete(key);
      return null;
    }

    return cacheItem.data;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

/**
 * 清除缓存
 */
export function clearCache(key = null) {
  try {
    if (key) {
      memoryCache.delete(key);
    } else {
      memoryCache.clear();
    }
    return true;
  } catch (error) {
    console.error('Cache clear error:', error);
    return false;
  }
}

/**
 * 获取缓存统计
 */
export function getCacheStats() {
  const stats = {
    totalItems: memoryCache.size,
    items: []
  };

  for (const [key, item] of memoryCache.entries()) {
    const age = Date.now() - item.timestamp;
    const remaining = Math.max(0, item.ttl - age);

    stats.items.push({
      key,
      age: `${Math.round(age / 1000)}s`,
      remaining: `${Math.round(remaining / 1000)}s`,
      expired: remaining <= 0
    });
  }

  return stats;
}

/**
 * 缓存装饰器函数
 */
export function withCache(cacheKey, ttl = 30000) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      // 尝试从缓存获取
      const cached = getCache(cacheKey);
      if (cached) {
        return cached;
      }

      // 执行原函数
      const result = await originalMethod.apply(this, args);

      // 缓存结果
      setCache(cacheKey, result, ttl);

      return result;
    };

    return descriptor;
  };
}

/**
 * 智能缓存管理
 */
export class CacheManager {
  constructor(env) {
    this.env = env;
  }

  /**
   * 缓存流配置列表
   */
  async cacheStreams(streamsData) {
    const cacheKey = CACHE_CONFIG.streams.key;
    const ttl = CACHE_CONFIG.streams.ttl;

    setCache(cacheKey, streamsData, ttl);

    logInfo(this.env, 'Streams data cached', {
      cacheKey,
      ttl: `${ttl / 1000}s`,
      itemCount: streamsData.length
    });
  }

  /**
   * 获取缓存的流配置
   */
  getCachedStreams() {
    return getCache(CACHE_CONFIG.streams.key);
  }

  /**
   * 缓存VPS健康状态
   */
  async cacheVpsHealth(healthData) {
    const cacheKey = CACHE_CONFIG.vpsHealth.key;
    const ttl = CACHE_CONFIG.vpsHealth.ttl;

    setCache(cacheKey, healthData, ttl);

    logInfo(this.env, 'VPS health data cached', {
      cacheKey,
      ttl: `${ttl / 1000}s`,
      available: healthData.available
    });
  }

  /**
   * 获取缓存的VPS健康状态
   */
  getCachedVpsHealth() {
    return getCache(CACHE_CONFIG.vpsHealth.key);
  }

  /**
   * 缓存系统状态
   */
  async cacheSystemStatus(statusData) {
    const cacheKey = CACHE_CONFIG.systemStatus.key;
    const ttl = CACHE_CONFIG.systemStatus.ttl;

    setCache(cacheKey, statusData, ttl);

    logInfo(this.env, 'System status cached', {
      cacheKey,
      ttl: `${ttl / 1000}s`
    });
  }

  /**
   * 获取缓存的系统状态
   */
  getCachedSystemStatus() {
    return getCache(CACHE_CONFIG.systemStatus.key);
  }

  /**
   * 清除所有相关缓存
   */
  clearAllCache() {
    clearCache();
    logInfo(this.env, 'All cache cleared');
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return getCacheStats();
  }
}
