/**
 * 代理配置管理处理器
 * 支持VLESS/XHTTP协议的代理配置管理
 */

export class ProxyHandler {
  constructor() {
    this.PROXY_CONFIG_KEY = 'proxy:config';
    this.PROXY_STATUS_KEY = 'proxy:status';
  }

  /**
   * 路由处理入口
   */
  async handleRequest(request, env, path, method) {
    // 正确的CORS配置，支持withCredentials
    const origin = request.headers.get('Origin');
    const allowedOrigins = ['https://yoyo.5202021.xyz', 'https://secure-streaming-platform.pages.dev'];
    const allowOrigin = allowedOrigins.includes(origin) ? origin : 'https://yoyo.5202021.xyz';
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Allow-Credentials': 'true'
    };

    // 处理预检请求
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 权限验证 - 只有admin用户可以访问
    const authResult = await this.verifyAdminAuth(request, env);
    if (!authResult.success) {
      return new Response(JSON.stringify({
        status: 'error',
        message: '权限不足，需要管理员权限'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      // 路由分发
      if (path === '/api/admin/proxy/config' && method === 'GET') {
        return await this.getProxyConfig(env, corsHeaders);
      }
      
      if (path === '/api/admin/proxy/config' && method === 'POST') {
        return await this.createProxy(request, env, corsHeaders);
      }
      
      if (path.match(/^\/api\/admin\/proxy\/config\/[^/]+$/) && method === 'PUT') {
        return await this.updateProxy(request, env, path, corsHeaders);
      }
      
      if (path.match(/^\/api\/admin\/proxy\/config\/[^/]+$/) && method === 'DELETE') {
        return await this.deleteProxy(env, path, corsHeaders);
      }
      
      if (path === '/api/admin/proxy/settings' && method === 'PUT') {
        return await this.updateSettings(request, env, corsHeaders);
      }
      
      if (path === '/api/admin/proxy/status' && method === 'GET') {
        return await this.getProxyStatus(env, corsHeaders);
      }
      
      if (path === '/api/admin/proxy/test' && method === 'POST') {
        return await this.testProxy(request, env, corsHeaders);
      }
      
      if (path.match(/^\/api\/admin\/proxy\/test\/[^/]+$/) && method === 'POST') {
        return await this.testProxyById(env, path, corsHeaders);
      }
      
      if (path === '/api/admin/proxy/control' && method === 'POST') {
        return await this.controlProxy(request, env, corsHeaders);
      }

      // 路由不匹配
      return new Response(JSON.stringify({
        status: 'error',
        message: '接口不存在'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('代理API处理错误:', error);
      return new Response(JSON.stringify({
        status: 'error',
        message: '服务器内部错误',
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  /**
   * 验证管理员权限
   */
  async verifyAdminAuth(request, env) {
    try {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { success: false, message: '缺少认证令牌' };
      }

      const token = authHeader.substring(7);
      const sessionData = await env.YOYO_USER_DB.get(`session:${token}`);
      
      if (!sessionData) {
        return { success: false, message: '无效的认证令牌' };
      }

      const session = JSON.parse(sessionData);
      if (session.role !== 'admin') {
        return { success: false, message: '需要管理员权限' };
      }

      return { success: true, user: session };
    } catch (error) {
      return { success: false, message: '认证验证失败' };
    }
  }

  /**
   * 获取代理配置
   */
  async getProxyConfig(env, corsHeaders) {
    try {
      const configData = await env.YOYO_USER_DB.get(this.PROXY_CONFIG_KEY);
      
      let config = {
        settings: {
          enabled: false,
          activeProxyId: null,
          autoSwitch: true,
          healthCheckInterval: 30000,
          fallbackMode: 'tunnel'
        },
        proxies: []
      };

      if (configData) {
        const storedConfig = JSON.parse(configData);
        config = { ...config, ...storedConfig };
      }

      return new Response(JSON.stringify({
        success: true,
        status: 'success',
        data: config
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        status: 'error',
        message: `获取代理配置失败: ${error.message}`
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  /**
   * 创建代理
   */
  async createProxy(request, env, corsHeaders) {
    try {
      const body = await request.json();
      
      // 验证代理配置
      const validatedProxy = await this.validateProxyConfig(body);
      
      // 获取现有配置
      const configData = await env.YOYO_USER_DB.get(this.PROXY_CONFIG_KEY);
      let config = configData ? JSON.parse(configData) : { settings: {}, proxies: [] };
      
      // 生成代理ID
      const proxyId = `proxy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建新代理
      const newProxy = {
        id: proxyId,
        name: validatedProxy.name,
        type: validatedProxy.type,
        config: validatedProxy.config,
        priority: validatedProxy.priority || config.proxies.length + 1,
        status: 'inactive',
        latency: null,
        lastCheck: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // 添加到配置
      config.proxies.push(newProxy);
      
      // 保存配置
      await env.YOYO_USER_DB.put(this.PROXY_CONFIG_KEY, JSON.stringify(config));
      
      return new Response(JSON.stringify({
        status: 'success',
        message: '代理创建成功',
        data: newProxy
      }), {
        status: 201,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        status: 'error',
        message: `创建代理失败: ${error.message}`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  /**
   * 测试代理连接
   */
  async testProxy(request, env, corsHeaders) {
    try {
      const proxyData = await request.json();
      
      // 调用VPS测试代理
      const testResult = await this.callVPSProxyTest(env, proxyData);
      
      return new Response(JSON.stringify({
        status: 'success',
        message: '代理测试完成',
        data: testResult
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        status: 'error',
        message: `代理测试失败: ${error.message}`
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  /**
   * 更新代理设置
   */
  async updateSettings(request, env, corsHeaders) {
    try {
      const body = await request.json();
      
      // 获取现有配置
      const configData = await env.YOYO_USER_DB.get(this.PROXY_CONFIG_KEY);
      let config = configData ? JSON.parse(configData) : { settings: {}, proxies: [] };
      
      // 更新设置
      config.settings = {
        ...config.settings,
        ...body,
        updatedAt: new Date().toISOString()
      };
      
      // 保存配置
      await env.YOYO_USER_DB.put(this.PROXY_CONFIG_KEY, JSON.stringify(config));
      
      // 如果启用了代理，同步到VPS
      if (config.settings.enabled && config.settings.activeProxyId) {
        try {
          await this.syncConfigToVPS(config, env);
        } catch (syncError) {
          console.warn('VPS同步失败:', syncError);
        }
      }
      
      return new Response(JSON.stringify({
        success: true,
        status: 'success',
        message: '代理设置更新成功',
        data: config.settings
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        status: 'error',
        message: `更新代理设置失败: ${error.message}`
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  /**
   * 获取代理状态
   */
  async getProxyStatus(env, corsHeaders) {
    try {
      // 从VPS获取实时状态
      const vpsStatus = await this.fetchVPSProxyStatus(env);
      
      // 获取本地状态数据
      const statusData = await env.YOYO_USER_DB.get(this.PROXY_STATUS_KEY);
      let status = {
        connectionStatus: 'disconnected',
        currentProxy: null,
        throughput: { upload: '0KB/s', download: '0KB/s' },
        statistics: { totalConnections: 0, successRate: 0, avgLatency: 0 },
        lastUpdate: null
      };
      
      if (statusData) {
        status = { ...status, ...JSON.parse(statusData) };
      }
      
      // 合并VPS实时状态
      if (vpsStatus) {
        status = { ...status, ...vpsStatus, lastUpdate: new Date().toISOString() };
        // 保存更新后的状态
        await env.YOYO_USER_DB.put(this.PROXY_STATUS_KEY, JSON.stringify(status));
      }
      
      return new Response(JSON.stringify({
        success: true,
        status: 'success',
        data: status
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        status: 'error',
        message: `获取代理状态失败: ${error.message}`,
        data: {
          connectionStatus: 'disconnected',
          currentProxy: null,
          lastUpdate: new Date().toISOString()
        }
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  /**
   * 按ID测试代理连接
   */
  async testProxyById(env, path, corsHeaders) {
    try {
      const proxyId = decodeURIComponent(path.split('/')[5]);
      
      // 获取代理配置
      const configData = await env.YOYO_USER_DB.get(this.PROXY_CONFIG_KEY);
      if (!configData) {
        throw new Error('代理配置不存在');
      }
      
      const config = JSON.parse(configData);
      const proxy = config.proxies.find(p => p.id === proxyId);
      
      if (!proxy) {
        throw new Error('代理不存在');
      }
      
      // 调用VPS测试代理
      const testResult = await this.callVPSProxyTest(env, proxy);
      
      // 更新代理状态
      proxy.status = testResult.success ? 'active' : 'error';
      proxy.latency = testResult.latency;
      proxy.lastCheck = new Date().toISOString();
      
      // 保存更新后的配置
      await env.YOYO_USER_DB.put(this.PROXY_CONFIG_KEY, JSON.stringify(config));
      
      return new Response(JSON.stringify({
        status: 'success',
        message: testResult.success ? '代理测试成功' : '代理测试失败',
        data: testResult
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      throw new Error(`测试代理失败: ${error.message}`);
    }
  }

  /**
   * 代理控制操作
   */
  async controlProxy(request, env, corsHeaders) {
    try {
      const body = await request.json();
      const { action, proxyId } = body;
      
      switch (action) {
        case 'switch':
          return await this.switchProxy(env, proxyId, corsHeaders);
        case 'restart':
          return await this.restartProxy(env, corsHeaders);
        case 'stop':
          return await this.stopProxy(env, corsHeaders);
        default:
          throw new Error('不支持的操作类型');
      }
    } catch (error) {
      throw new Error(`代理控制操作失败: ${error.message}`);
    }
  }

  /**
   * 切换代理
   */
  async switchProxy(env, proxyId, corsHeaders) {
    const configData = await env.YOYO_USER_DB.get(this.PROXY_CONFIG_KEY);
    if (!configData) {
      throw new Error('代理配置不存在');
    }
    
    const config = JSON.parse(configData);
    const proxy = config.proxies.find(p => p.id === proxyId);
    
    if (!proxy) {
      throw new Error('代理不存在');
    }
    
    // 更新活跃代理
    config.settings.activeProxyId = proxyId;
    config.settings.enabled = true;
    
    // 保存配置
    await env.YOYO_USER_DB.put(this.PROXY_CONFIG_KEY, JSON.stringify(config));
    
    // 同步到VPS
    await this.syncConfigToVPS(config, env);
    
    return new Response(JSON.stringify({
      status: 'success',
      message: `已切换到代理: ${proxy.name}`,
      data: { currentProxy: proxyId }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  /**
   * 同步配置到VPS
   */
  async syncConfigToVPS(config, env) {
    try {
      const vpsEndpoint = `${env.VPS_API_BASE || 'https://yoyo-vps.5202021.xyz'}/api/proxy/config`;
      
      const response = await fetch(vpsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY || 'default-api-key'
        },
        body: JSON.stringify({
          action: 'update',
          config: config
        })
      });
      
      if (!response.ok) {
        throw new Error(`VPS同步失败: ${response.statusText}`);
      }
      
      console.log('代理配置已同步到VPS');
    } catch (error) {
      console.error('VPS同步失败:', error);
      throw error;
    }
  }

  /**
   * 从VPS获取代理状态
   */
  async fetchVPSProxyStatus(env) {
    try {
      const vpsEndpoint = `${env.VPS_API_BASE || 'https://yoyo-vps.5202021.xyz'}/api/proxy/status`;
      
      const response = await fetch(vpsEndpoint, {
        method: 'GET',
        headers: {
          'X-API-Key': env.VPS_API_KEY || 'default-api-key'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.data;
      }
    } catch (error) {
      console.warn('获取VPS代理状态失败:', error);
    }
    
    return null;
  }

  /**
   * 调用VPS测试代理
   */
  async callVPSProxyTest(env, proxy) {
    try {
      const vpsEndpoint = `${env.VPS_API_BASE || 'https://yoyo-vps.5202021.xyz'}/api/proxy/test`;
      
      const response = await fetch(vpsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY || 'default-api-key'
        },
        body: JSON.stringify({
          proxyId: proxy.id,
          proxyConfig: proxy
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.data;
      } else {
        return { success: false, error: '测试请求失败', latency: null };
      }
    } catch (error) {
      console.warn('VPS代理测试失败:', error);
      return { success: false, error: error.message, latency: null };
    }
  }

  /**
   * 验证代理配置
   */
  async validateProxyConfig(config) {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error('代理名称不能为空');
    }
    
    if (!config.type || !['vless', 'vmess', 'ss', 'http'].includes(config.type)) {
      throw new Error('不支持的代理类型');
    }
    
    if (!config.config || config.config.trim().length === 0) {
      throw new Error('代理配置不能为空');
    }
    
    // 验证VLESS配置格式
    if (config.type === 'vless') {
      const vlessRegex = /^vless:\/\/[a-f0-9-]{36}@[\w.-]+:\d+\?.*$/i;
      if (!vlessRegex.test(config.config)) {
        throw new Error('无效的VLESS配置格式');
      }
      
      // 验证XHTTP协议支持
      if (config.config.includes('type=xhttp')) {
        console.log('检测到XHTTP协议，完全支持');
      }
    }
    
    return {
      name: config.name.trim(),
      type: config.type,
      config: config.config.trim(),
      priority: parseInt(config.priority) || 1
    };
  }
}
