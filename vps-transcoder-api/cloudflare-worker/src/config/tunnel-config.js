// 环境变量配置 - 零KV消耗
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
  // 从环境变量读取配置 (带默认值)
  getTunnelEnabled: async (env) => {
    // 首先检查运行时配置（KV存储）
    try {
      const runtimeConfig = await env.YOYO_USER_DB.get('RUNTIME_TUNNEL_ENABLED');
      if (runtimeConfig !== null) {
        return runtimeConfig === 'true';
      }
    } catch (error) {
      console.warn('Failed to read runtime tunnel config:', error);
    }
    
    // 回退到环境变量配置
    return (env.TUNNEL_ENABLED || 'true') === 'true';
  },
  // 默认配置描述
  DESCRIPTION: '隧道优化功能 - 改善中国大陆用户体验'
};
