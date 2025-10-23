import { TUNNEL_CONFIG } from '../config/tunnel-config.js';

/**
 * 双维度智能路由 - 前端路径和后端路径独立决策
 * 
 * 维度1: Workers → VPS (tunnel/direct) - 前端路径
 * 维度2: VPS → RTMP源 (proxy/direct) - 后端路径
 */
export class TunnelRouter {
  /**
   * 获取前端路径路由 (Workers → VPS)
   * 只根据隧道开关和地理位置决策，不混入VPS代理状态
   */
  static async getWorkersToVPSRoute(env, request = null) {
    const tunnelEnabled = await TUNNEL_CONFIG.getTunnelEnabled(env);
    const country = request?.cf?.country;
    const isChina = country === 'CN';
    
    console.log('[TunnelRouter] 前端路径决策:', { tunnelEnabled, country, isChina });
    
    // 只根据隧道开关和地理位置决策
    if (tunnelEnabled && isChina) {
      console.log('[TunnelRouter] ✅ 前端路径: tunnel (中国用户)');
      return {
        type: 'tunnel',
        endpoints: TUNNEL_CONFIG.TUNNEL_ENDPOINTS,
        reason: `隧道优化 - 中国用户 (${country})`
      };
    }
    
    console.log('[TunnelRouter] ✅ 前端路径: direct');
    return {
      type: 'direct',
      endpoints: TUNNEL_CONFIG.DIRECT_ENDPOINTS,
      reason: tunnelEnabled 
        ? `直连 - 海外用户无需隧道 (${country || 'unknown'})`
        : `直连 - 隧道未启用 (${country || 'unknown'})`
    };
  }
  
  /**
   * 查询VPS代理状态 (VPS → RTMP源)
   * 仅用于信息展示，不影响路由决策
   */
  static async getVPSProxyStatus(env) {
    try {
      console.log('[TunnelRouter] 查询VPS代理状态...');
      const response = await fetch(`${env.VPS_API_URL}/api/proxy/status`, {
        method: 'GET',
        headers: { 'X-API-Key': env.VPS_API_KEY },
        signal: AbortSignal.timeout(3000)
      });
      
      if (response.ok) {
        const data = await response.json();
        const enabled = data.data?.connectionStatus === 'connected';
        const proxyName = data.data?.currentProxy?.name || null;
        
        console.log('[TunnelRouter] VPS代理状态:', { enabled, proxyName });
        
        return {
          enabled,
          proxyName,
          reason: enabled 
            ? `VPS通过${proxyName}访问RTMP源`
            : 'VPS直连RTMP源'
        };
      }
    } catch (error) {
      console.warn('[TunnelRouter] VPS代理状态查询失败:', error.message);
    }
    
    return { 
      enabled: false, 
      proxyName: null, 
      reason: 'VPS直连RTMP源' 
    };
  }
  
  /**
   * 构造VPS URL (简化版，只处理前端路径)
   */
  static async buildVPSUrl(env, path = '', service = 'API', request = null) {
    const workersRoute = await this.getWorkersToVPSRoute(env, request);
    const baseUrl = workersRoute.endpoints[service];
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    return {
      url: `${baseUrl}${cleanPath}`,
      workersRoute: workersRoute
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
