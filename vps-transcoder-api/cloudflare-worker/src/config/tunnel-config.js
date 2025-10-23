// 🔥 全局缓存：减少隧道配置的KV读取次数
const TUNNEL_CACHE = {
  enabled: null,
  expiry: 0
};

// 缓存过期时间（30秒）
// ⚠️ 注意：管理员修改隧道配置后，最多30秒生效
const TUNNEL_CACHE_TTL = 30 * 1000;

// 环境变量配置 - 优化KV读取
export const TUNNEL_CONFIG = {
  // 隧道端点 (主要)
  TUNNEL_ENDPOINTS: {
    API: 'https://tunnel-api.yoyo-vps.5202021.xyz',
    HLS: 'https://tunnel-hls.yoyo-vps.5202021.xyz',
    HEALTH: 'https://tunnel-health.yoyo-vps.5202021.xyz'
  },
  // 直连端点 (备用)
  DIRECT_ENDPOINTS: {
    API: 'https://yoyo-vps.5202021.xyz',
    HLS: 'https://yoyo-vps.5202021.xyz',
    HEALTH: 'https://yoyo-vps.5202021.xyz'
  },
  // 统一从管理后台配置读取 (KV存储) - 带缓存优化
  getTunnelEnabled: async (env) => {
    try {
      const now = Date.now();
      
      // 🎯 检查缓存是否有效
      if (TUNNEL_CACHE.enabled !== null && now < TUNNEL_CACHE.expiry) {
        // 使用缓存，避免KV读取
        return TUNNEL_CACHE.enabled;
      }
      
      // 🔄 缓存过期或不存在，从KV读取
      const runtimeConfig = await env.YOYO_USER_DB.get('RUNTIME_TUNNEL_ENABLED');
      const enabled = runtimeConfig === 'true';
      
      // 更新缓存
      TUNNEL_CACHE.enabled = enabled;
      TUNNEL_CACHE.expiry = now + TUNNEL_CACHE_TTL;
      
      console.log(`🔄 隧道配置已缓存: ${enabled ? '启用' : '禁用'} (TTL: ${TUNNEL_CACHE_TTL/1000}秒)`);
      
      return enabled;
    } catch (error) {
      console.warn('Failed to read tunnel config from KV:', error);
      // KV读取失败时，如果有缓存就用缓存，否则默认禁用
      return TUNNEL_CACHE.enabled !== null ? TUNNEL_CACHE.enabled : false;
    }
  },
  // 清除缓存（管理员修改配置时调用）
  clearCache: () => {
    TUNNEL_CACHE.enabled = null;
    TUNNEL_CACHE.expiry = 0;
    console.log('🗑️ 隧道配置缓存已清除');
  },
  // 默认配置描述
  DESCRIPTION: '隧道优化功能 - 改善中国大陆用户体验'
};
