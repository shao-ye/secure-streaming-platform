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
    // 🔧 修复：实时查询VPS的v2ray运行状态，而不是只看KV中的配置
    try {
      console.log('[TunnelRouter] 查询VPS实时代理状态...');
      const proxyStatusResponse = await fetch(`${env.VPS_API_URL}/api/proxy/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': env.VPS_API_KEY
        },
        signal: AbortSignal.timeout(3000) // 3秒超时
      });
      
      if (proxyStatusResponse.ok) {
        const proxyStatus = await proxyStatusResponse.json();
        const isVpsProxyConnected = proxyStatus.data?.connectionStatus === 'connected';
        
        console.log('[TunnelRouter] VPS代理状态:', {
          connectionStatus: proxyStatus.data?.connectionStatus,
          currentProxy: proxyStatus.data?.currentProxy?.name || 'none'
        });
        
        if (isVpsProxyConnected) {
          // VPS上的v2ray确实在运行，使用代理模式
          console.log('[TunnelRouter] ✅ 使用代理模式 (VPS v2ray已连接)');
          return {
            type: 'proxy',
            endpoints: TUNNEL_CONFIG.DIRECT_ENDPOINTS,
            reason: `代理已连接 - VPS通过${proxyStatus.data?.currentProxy?.name || 'proxy'}访问RTMP源 (${country || 'unknown'})`
          };
        } else {
          console.log('[TunnelRouter] VPS代理未连接，使用直连模式');
        }
      } else {
        console.warn('[TunnelRouter] 查询VPS代理状态失败:', proxyStatusResponse.status);
      }
    } catch (error) {
      console.warn('[TunnelRouter] 查询VPS代理状态异常:', error.message);
      // 查询失败时，不使用代理模式（安全回退）
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
