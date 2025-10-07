import { TUNNEL_CONFIG } from '../config/tunnel-config.js';

export class TunnelRouter {
  /**
   * 智能地理路由策略 - 中国大陆自动启用隧道
   */
  static async getOptimalEndpoints(env, request = null) {
    // 检查用户地理位置
    const country = request?.cf?.country;
    const isChina = country === 'CN';
    
    // 中国大陆用户强制使用隧道优化
    if (isChina) {
      return {
        type: 'tunnel',
        endpoints: TUNNEL_CONFIG.TUNNEL_ENDPOINTS,
        reason: `中国大陆用户自动启用隧道优化 (${country})`
      };
    }
    
    // 其他地区根据管理员配置
    const tunnelEnabled = await TUNNEL_CONFIG.getTunnelEnabled(env);
    
    if (tunnelEnabled) {
      return {
        type: 'tunnel',
        endpoints: TUNNEL_CONFIG.TUNNEL_ENDPOINTS,
        reason: `管理员已启用隧道优化 - 全球用户 (${country || 'unknown'})`
      };
    } else {
      return {
        type: 'direct',
        endpoints: TUNNEL_CONFIG.DIRECT_ENDPOINTS,
        reason: `管理员已禁用隧道优化 - 直连模式 (${country || 'unknown'})`
      };
    }
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
