import { TUNNEL_CONFIG } from '../config/tunnel-config.js';

export class TunnelRouter {
  /**
   * 双维度路由策略 - 前端路径和后端路径独立判断
   */
  static async getOptimalEndpoints(env, request = null) {
    const country = request?.cf?.country;
    console.log('[TunnelRouter] 🔍 双维度路由决策...', { country });
    
    // ✅ 维度1: Workers → VPS (前端路径)
    const tunnelEnabled = await TUNNEL_CONFIG.getTunnelEnabled(env);
    const frontendPath = tunnelEnabled ? 'tunnel' : 'direct';
    const frontendEndpoints = tunnelEnabled ? TUNNEL_CONFIG.TUNNEL_ENDPOINTS : TUNNEL_CONFIG.DIRECT_ENDPOINTS;
    
    console.log(`[TunnelRouter] 📡 前端路径: ${frontendPath}`);
    
    // ✅ 维度2: VPS → RTMP源 (后端路径) - 独立判断
    let backendPath = 'direct';
    let vpsProxyName = null;
    
    try {
      const res = await fetch(`${env.VPS_API_URL}/api/proxy/status`, {
        headers: { 'X-API-Key': env.VPS_API_KEY },
        signal: AbortSignal.timeout(3000)
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.data?.connectionStatus === 'connected') {
          backendPath = 'proxy';
          vpsProxyName = data.data.currentProxy?.name || 'unknown';
          console.log(`[TunnelRouter] 🔗 后端路径: proxy (${vpsProxyName})`);
        }
      }
    } catch (e) {
      console.warn('[TunnelRouter] VPS代理查询失败:', e.message);
    }
    
    if (backendPath === 'direct') {
      console.log('[TunnelRouter] 📡 后端路径: direct');
    }
    
    const routeType = `${frontendPath}+${backendPath}`;
    console.log(`[TunnelRouter] ✅ 最终路由: ${routeType}`);
    
    return {
      type: routeType,
      frontendPath: { mode: frontendPath, endpoints: frontendEndpoints },
      backendPath: { mode: backendPath, proxyName: vpsProxyName },
      endpoints: frontendEndpoints,  // 向后兼容
      reason: this._buildRouteReason(frontendPath, backendPath, vpsProxyName, country)
    };
  }
  
  static _buildRouteReason(frontendPath, backendPath, vpsProxyName, country) {
    const r = [];
    r.push(frontendPath === 'tunnel' ? 'Workers通过Tunnel访问VPS' : 'Workers直连VPS');
    r.push(backendPath === 'proxy' ? `VPS通过${vpsProxyName}代理获取RTMP流` : 'VPS直连RTMP源');
    if (country) r.push(`位置: ${country}`);
    return r.join(' | ');
  }
  
  /**
   * 构造URL - 异步操作，支持地理路由
   */
  static async buildVPSUrl(env, path = '', service = 'API', request = null) {
    const routing = await this.getOptimalEndpoints(env, request);
    const baseUrl = routing.frontendPath.endpoints[service];
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
