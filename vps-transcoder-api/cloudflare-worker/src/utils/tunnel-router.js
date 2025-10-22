import { TUNNEL_CONFIG } from '../config/tunnel-config.js';

export class TunnelRouter {
  /**
   * 智能路由策略 - 考虑隧道、代理和地理位置
   */
  static async getOptimalEndpoints(env, request = null) {
    // 检查用户地理位置
    const country = request?.cf?.country;
    const isChina = country === 'CN';
    
    console.log('[TunnelRouter] 开始路由决策...', { country, isChina });
    
    // 1. 首先检查隧道配置
    const tunnelEnabled = await TUNNEL_CONFIG.getTunnelEnabled(env);
    console.log('[TunnelRouter] 隧道状态:', tunnelEnabled);
    
    if (tunnelEnabled) {
      console.log('[TunnelRouter] ✅ 使用隧道模式');
      return {
        type: 'tunnel',
        endpoints: TUNNEL_CONFIG.TUNNEL_ENDPOINTS,
        reason: `隧道已启用 (${country || 'unknown'})`
      };
    }
    
    // 2. 隧道禁用时，检查代理状态
    try {
      const proxyConfig = await env.YOYO_USER_DB.get('proxy-config', 'json');
      console.log('[TunnelRouter] 代理配置原始值:', proxyConfig);
      console.log('[TunnelRouter] 代理配置类型:', typeof proxyConfig);
      console.log('[TunnelRouter] 代理配置JSON:', JSON.stringify(proxyConfig));
      
      if (proxyConfig && proxyConfig.enabled && proxyConfig.activeProxyId) {
        // 代理已启用，使用Workers代理模式（通过直连端点但走代理路径）
        console.log('[TunnelRouter] ✅ 使用代理模式 (enabled:', proxyConfig.enabled, ', activeProxyId:', proxyConfig.activeProxyId, ')');
        return {
          type: 'proxy',
          endpoints: TUNNEL_CONFIG.DIRECT_ENDPOINTS, // 使用直连端点
          reason: `代理已启用 - 透明代理模式 (${country || 'unknown'})`
        };
      } else {
        console.log('[TunnelRouter] 代理未启用或配置不完整');
      }
    } catch (error) {
      console.warn('[TunnelRouter] Failed to check proxy config:', error);
    }
    
    // 3. 隧道和代理都禁用，使用直连
    console.log('[TunnelRouter] ✅ 使用直连模式');
    return {
      type: 'direct',
      endpoints: TUNNEL_CONFIG.DIRECT_ENDPOINTS,
      reason: `直连模式 - 隧道和代理均禁用 (${country || 'unknown'})`
    };
  }
  
  /**
   * 构造URL - 异步操作，支持地理路由
   */
  static async buildVPSUrl(env, path = '', service = 'API', request = null) {
    const routing = await this.getOptimalEndpoints(env, request);
    const baseUrl = routing.endpoints[service];
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    return {
      url: `${baseUrl}${cleanPath}`,
      routing: routing
    };
  }
  
  /**
   * 故障转移到直连
   */
  static getDirectEndpoints() {
    return {
      type: 'direct',
      endpoints: TUNNEL_CONFIG.DIRECT_ENDPOINTS,
      reason: '隧道故障，切换到直连模式'
    };
  }
  
  /**
   * 健康检查
   */
  static async checkTunnelHealth() {
    try {
      const start = Date.now();
      const response = await fetch(`${TUNNEL_CONFIG.TUNNEL_ENDPOINTS.HEALTH}/health`);
      return {
        status: response.ok ? 'healthy' : 'unhealthy',
        latency: Date.now() - start,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}
