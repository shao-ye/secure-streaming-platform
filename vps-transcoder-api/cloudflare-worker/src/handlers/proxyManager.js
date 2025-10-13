/**
 * 代理管理处理器
 * 处理代理连接、断开、测试等功能
 */

import { validateSession } from './auth.js';
import { errorResponse, successResponse } from '../utils/cors.js';
import { logError, logInfo } from '../utils/logger.js';
import { getProxyConfig, setProxyConfig } from '../utils/kv.js';

/**
 * 验证管理员权限
 */
async function requireAdmin(request, env) {
  const auth = await validateSession(request, env);
  if (!auth || !auth.user) {
    return { error: errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request) };
  }

  if (auth.user.role !== 'admin') {
    return { error: errorResponse('Admin privileges required', 'ADMIN_REQUIRED', 403, request) };
  }

  return { auth };
}

export const handleProxyManager = {
  /**
   * 连接代理
   * POST /api/admin/proxy/connect
   */
  async connect(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const { proxyConfig } = await request.json();
      
      if (!proxyConfig || !proxyConfig.id) {
        return errorResponse('缺少代理配置数据', 'MISSING_PROXY_CONFIG', 400, request);
      }

      logInfo('管理员请求连接代理', { 
        admin: auth.user.username, 
        proxyId: proxyConfig.id,
        proxyName: proxyConfig.name 
      });

      // 转发到VPS
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/proxy/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY
        },
        body: JSON.stringify({ proxyConfig })
      });

      if (!vpsResponse.ok) {
        const errorText = await vpsResponse.text();
        logError('VPS代理连接失败', { 
          status: vpsResponse.status, 
          error: errorText,
          proxyId: proxyConfig.id 
        });
        return errorResponse('代理连接失败', 'VPS_CONNECT_FAILED', 502, request);
      }

      const result = await vpsResponse.json();
      
      logInfo('代理连接成功', { 
        proxyId: proxyConfig.id, 
        proxyName: proxyConfig.name,
        connectionStatus: result.data?.connectionStatus 
      });

      return successResponse(result.data, '代理连接成功', request);

    } catch (error) {
      logError('连接代理异常', error);
      return errorResponse('连接代理异常', 'PROXY_CONNECT_ERROR', 500, request);
    }
  },

  /**
   * 断开代理
   * POST /api/admin/proxy/disconnect
   */
  async disconnect(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      logInfo('管理员请求断开代理', { admin: auth.user.username });

      // 转发到VPS
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/proxy/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY
        }
      });

      if (!vpsResponse.ok) {
        const errorText = await vpsResponse.text();
        logError('VPS代理断开失败', { 
          status: vpsResponse.status, 
          error: errorText 
        });
        return errorResponse('代理断开失败', 'VPS_DISCONNECT_FAILED', 502, request);
      }

      const result = await vpsResponse.json();
      
      logInfo('代理断开成功', { 
        connectionStatus: result.data?.connectionStatus 
      });

      return successResponse(result.data, '代理连接已断开', request);

    } catch (error) {
      logError('断开代理异常', error);
      return errorResponse('断开代理异常', 'PROXY_DISCONNECT_ERROR', 500, request);
    }
  },

  /**
   * 获取代理状态
   * GET /api/admin/proxy/status
   */
  async status(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      // 从VPS获取状态
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/proxy/status`, {
        method: 'GET',
        headers: {
          'X-API-Key': env.VPS_API_KEY
        }
      });

      if (!vpsResponse.ok) {
        logError('获取VPS代理状态失败', { status: vpsResponse.status });
        return errorResponse('获取代理状态失败', 'VPS_STATUS_FAILED', 502, request);
      }

      const result = await vpsResponse.json();
      return successResponse(result.data, '代理状态获取成功', request);

    } catch (error) {
      logError('获取代理状态异常', error);
      return errorResponse('获取代理状态异常', 'PROXY_STATUS_ERROR', 500, request);
    }
  },

  /**
   * 测试代理
   * POST /api/admin/proxy/test
   */
  async test(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const requestData = await request.json();
      
      // 支持两种格式：{ proxyConfig: {...} } 或直接 { id, name, type, config, ... }
      let proxyConfig;
      let testUrlId = 'baidu';
      
      if (requestData.proxyConfig) {
        // 格式1: { proxyConfig: {...}, testUrlId: 'baidu' }
        proxyConfig = requestData.proxyConfig;
        testUrlId = requestData.testUrlId || 'baidu';
      } else if (requestData.id && requestData.config) {
        // 格式2: { id, name, type, config, testUrlId }
        proxyConfig = requestData;
        testUrlId = requestData.testUrlId || 'baidu';
      } else {
        return errorResponse('缺少代理配置数据', 'MISSING_PROXY_CONFIG', 400, request);
      }

      // 验证测试网站ID
      const allowedIds = ['baidu', 'google'];
      if (!allowedIds.includes(testUrlId)) {
        return errorResponse('无效的测试网站ID', 'INVALID_TEST_URL_ID', 400, request);
      }

      logInfo('管理员请求测试代理', { 
        admin: auth.user.username,
        proxyId: proxyConfig.id,
        proxyName: proxyConfig.name,
        testUrlId 
      });

      // 转发到VPS进行测试
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/proxy/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY
        },
        body: JSON.stringify({ 
          proxyConfig,
          testUrlId 
        })
      });

      if (!vpsResponse.ok) {
        logError('VPS代理测试失败', { 
          status: vpsResponse.status,
          proxyId: proxyConfig.id 
        });
        return errorResponse('代理测试失败', 'VPS_TEST_FAILED', 502, request);
      }

      const result = await vpsResponse.json();
      
      logInfo('代理测试完成', { 
        proxyId: proxyConfig.id,
        success: result.data?.success,
        latency: result.data?.latency,
        method: result.data?.method
      });

      return successResponse(result.data, result.message, request);

    } catch (error) {
      logError('测试代理异常', error);
      return errorResponse('测试代理异常', 'PROXY_TEST_ERROR', 500, request);
    }
  },

  /**
   * 获取代理配置列表
   * GET /api/admin/proxy/config
   */
  async getConfig(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) {
        logError('🚨 代理配置获取失败 - 认证错误', { 
          errorCode: error.status,
          errorMessage: error.body ? JSON.parse(error.body).message : 'Unknown auth error',
          url: request.url,
          method: request.method,
          timestamp: new Date().toISOString()
        });
        return error;
      }

      // 添加详细调试信息
      logInfo('🔍 开始获取代理配置', { 
        admin: auth.user.username,
        timestamp: new Date().toISOString(),
        requestUrl: request.url,
        requestMethod: request.method
      });

      // 使用统一存储格式从proxy-config读取
      const proxyConfigData = await env.YOYO_USER_DB.get('proxy-config');
      
      // 添加KV读取调试信息
      logInfo('📦 KV读取结果', { 
        hasData: !!proxyConfigData,
        dataLength: proxyConfigData ? proxyConfigData.length : 0,
        dataType: typeof proxyConfigData,
        kvKey: 'proxy-config'
      });

      // 如果有数据，记录原始数据的前100个字符用于调试
      if (proxyConfigData) {
        logInfo('📄 KV原始数据预览', {
          dataPreview: proxyConfigData.substring(0, 200) + (proxyConfigData.length > 200 ? '...' : ''),
          totalLength: proxyConfigData.length
        });
      }
      
      let response;
      if (proxyConfigData) {
        try {
          const config = JSON.parse(proxyConfigData);
          
          // 添加配置解析调试信息
          logInfo('🔧 配置解析成功', { 
            hasProxies: !!config.proxies,
            proxiesCount: config.proxies ? config.proxies.length : 0,
            configKeys: Object.keys(config),
            enabled: config.enabled,
            activeProxyId: config.activeProxyId
          });

          // 如果有代理列表，记录每个代理的基本信息
          if (config.proxies && Array.isArray(config.proxies) && config.proxies.length > 0) {
            logInfo('📋 代理列表详情', {
              proxies: config.proxies.map(p => ({
                id: p.id,
                name: p.name,
                type: p.type,
                createdAt: p.createdAt,
                isActive: p.isActive
              }))
            });
          }
          
          response = {
            enabled: config.enabled || false,
            activeProxyId: config.activeProxyId || null,
            proxies: (config.proxies || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
            settings: {
              enabled: config.enabled || false,
              activeProxyId: config.activeProxyId || null,
              autoSwitch: config.autoSwitch || false,
              testInterval: config.testInterval || 300,
              currentTestUrlId: config.currentTestUrlId || config.settings?.currentTestUrlId || 'baidu'
            }
          };
        } catch (parseError) {
          logError('❌ 配置解析失败', {
            error: parseError.message,
            stack: parseError.stack,
            rawData: proxyConfigData.substring(0, 500)
          });
          // 解析失败时返回默认配置
          response = {
            enabled: false,
            activeProxyId: null,
            proxies: [],
            settings: {
              enabled: false,
              activeProxyId: null,
              autoSwitch: false,
              testInterval: 300,
              currentTestUrlId: 'baidu'
            }
          };
        }
      } else {
        logInfo('📭 未找到代理配置数据，返回默认配置');
        // 返回默认配置
        response = {
          enabled: false,
          activeProxyId: null,
          proxies: [],
          settings: {
            enabled: false,
            activeProxyId: null,
            autoSwitch: false,
            testInterval: 300,
            currentTestUrlId: 'baidu'
          }
        };
      }
      
      logInfo('✅ 代理配置获取成功', { 
        admin: auth.user.username,
        proxyCount: response.proxies.length,
        enabled: response.enabled,
        activeProxyId: response.activeProxyId,
        finalResponse: {
          proxiesCount: response.proxies.length,
          hasSettings: !!response.settings,
          responseSize: JSON.stringify(response).length
        }
      });

      return successResponse(response, '代理配置获取成功', request);

    } catch (error) {
      logError('💥 获取代理配置异常', {
        error: error.message,
        stack: error.stack,
        url: request.url,
        method: request.method,
        timestamp: new Date().toISOString()
      });
      return errorResponse('获取代理配置异常', 'PROXY_CONFIG_ERROR', 500, request);
    }
  },

  /**
   * 获取所有代理配置（适配现有KV格式）
   */
  async getAllProxyConfigs(env) {
    try {
      // 先尝试分布式存储格式
      const { keys } = await env.YOYO_USER_DB.list({ prefix: 'proxy_config_' });
      let proxies = [];
      
      for (const key of keys) {
        try {
          const proxyData = await env.YOYO_USER_DB.get(key.name);
          if (proxyData) {
            proxies.push(JSON.parse(proxyData));
          }
        } catch (parseError) {
          logError('解析代理配置失败', { key: key.name, error: parseError });
        }
      }
      
      // 如果分布式存储没有数据，尝试从现有的proxy-config中获取
      if (proxies.length === 0) {
        const existingConfig = await env.YOYO_USER_DB.get('proxy-config');
        if (existingConfig) {
          const config = JSON.parse(existingConfig);
          if (config.proxies && Array.isArray(config.proxies)) {
            proxies = config.proxies;
            logInfo('从现有proxy-config格式加载代理列表', { count: proxies.length });
          }
        }
      }
      
      return proxies;
    } catch (error) {
      logError('获取代理配置列表失败', error);
      return [];
    }
  },

  /**
   * 获取全局配置（适配现有KV格式）
   */
  async getGlobalConfig(env) {
    try {
      // 先尝试新格式
      let globalConfigData = await env.YOYO_USER_DB.get('proxy_global_config');
      
      // 如果新格式不存在，尝试从现有的proxy-config中提取
      if (!globalConfigData) {
        const existingConfig = await env.YOYO_USER_DB.get('proxy-config');
        if (existingConfig) {
          const config = JSON.parse(existingConfig);
          // 从现有配置中提取全局设置
          return {
            enabled: config.enabled || false,
            activeProxyId: config.activeProxyId || null,
            autoSwitch: config.autoSwitch || false,
            testInterval: config.testInterval || 300,
            currentTestUrlId: config.currentTestUrlId || 'baidu',
            testUrls: {
              "baidu": {
                id: "baidu",
                name: "百度 (推荐)",
                url: "https://www.baidu.com",
                description: "测试代理对中国用户的加速效果"
              },
              "google": {
                id: "google", 
                name: "谷歌",
                url: "https://www.google.com",
                description: "测试代理的国际访问能力"
              }
            }
          };
        }
      } else {
        return JSON.parse(globalConfigData);
      }
      
      // 返回默认配置
      return {
        enabled: false,
        activeProxyId: null,
        autoSwitch: false,
        testInterval: 300,
        currentTestUrlId: 'baidu',
        testUrls: {
          "baidu": {
            id: "baidu",
            name: "百度 (推荐)",
            url: "https://www.baidu.com",
            description: "测试代理对中国用户的加速效果"
          },
          "google": {
            id: "google", 
            name: "谷歌",
            url: "https://www.google.com",
            description: "测试代理的国际访问能力"
          }
        }
      };
    } catch (error) {
      logError('获取全局配置失败', error);
      return {
        enabled: false,
        activeProxyId: null,
        autoSwitch: false,
        testInterval: 300,
        currentTestUrlId: 'baidu'
      };
    }
  },

  /**
   * 创建/更新代理配置
   * POST /api/admin/proxy/config
   */
  async updateConfig(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const requestData = await request.json();
      
      // 检查是否是创建单个代理的请求（前端直接发送代理数据）
      if (requestData.name && requestData.type && requestData.config) {
        // 这是创建单个代理的请求
        return await this.createSingleProxy(request, env, auth, requestData);
      }
      
      // 检查是否是更新整个配置的请求
      const { action, config } = requestData;
      if (action !== 'update' || !config) {
        return errorResponse('无效的请求参数', 'INVALID_PARAMS', 400, request);
      }

      logInfo('管理员更新代理配置', { 
        admin: auth.user.username,
        enabled: config.settings?.enabled,
        activeProxyId: config.settings?.activeProxyId
      });

      // 使用KV工具函数保存配置
      await setProxyConfig(env, config);

      // 同步到VPS
      const vpsResponse = await fetch(`${env.VPS_API_URL}/api/proxy/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.VPS_API_KEY
        },
        body: JSON.stringify({ action, config })
      });

      if (!vpsResponse.ok) {
        logError('VPS代理配置同步失败', { status: vpsResponse.status });
        // 不返回错误，因为KV已保存成功
      }

      return successResponse({ success: true }, '代理配置更新成功', request);

    } catch (error) {
      logError('更新代理配置异常', error);
      return errorResponse('更新代理配置异常', 'PROXY_CONFIG_UPDATE_ERROR', 500, request);
    }
  },

  /**
   * 创建单个代理（统一存储格式）
   */
  async createSingleProxy(request, env, auth, proxyData) {
    try {
      // 生成代理ID
      const proxyId = `proxy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建代理对象
      const newProxy = {
        id: proxyId,
        name: proxyData.name,
        type: proxyData.type,
        config: proxyData.config,
        isActive: false,
        latency: -1,
        lastTestTime: null,
        lastTestMethod: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      logInfo('管理员创建代理', { 
        admin: auth.user.username,
        proxyId: proxyId,
        proxyName: proxyData.name,
        proxyType: proxyData.type
      });

      // 获取现有配置
      const existingConfigData = await env.YOYO_USER_DB.get('proxy-config');
      let config;
      
      if (existingConfigData) {
        config = JSON.parse(existingConfigData);
      } else {
        // 创建默认配置结构
        config = {
          enabled: false,
          activeProxyId: null,
          proxies: [],
          autoSwitch: false,
          testInterval: 300,
          currentTestUrlId: 'baidu',
          settings: {
            enabled: false,
            activeProxyId: null,
            autoSwitch: false,
            testInterval: 300,
            currentTestUrlId: 'baidu'
          }
        };
      }
      
      // 添加新代理到列表
      if (!config.proxies) {
        config.proxies = [];
      }
      config.proxies.push(newProxy);
      config.updatedAt = new Date().toISOString();

      // 保存更新后的配置
      await env.YOYO_USER_DB.put('proxy-config', JSON.stringify(config));

      return successResponse(newProxy, '代理创建成功', request);

    } catch (error) {
      logError('创建代理异常', error);
      return errorResponse('创建代理异常', 'PROXY_CREATE_ERROR', 500, request);
    }
  },

  /**
   * 更新代理设置（统一存储格式）
   * PUT /api/admin/proxy/settings
   */
  async updateSettings(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const settings = await request.json();
      
      logInfo('管理员更新代理设置', { 
        admin: auth.user.username,
        settings
      });

      // 获取现有配置
      const existingConfigData = await env.YOYO_USER_DB.get('proxy-config');
      let config;
      
      if (existingConfigData) {
        config = JSON.parse(existingConfigData);
      } else {
        // 如果没有现有配置，记录警告并创建最小默认结构
        logError('警告: proxy-config不存在，可能导致数据丢失');
        config = {
          enabled: false,
          activeProxyId: null,
          proxies: [],
          autoSwitch: false,
          testInterval: 300,
          currentTestUrlId: 'baidu'
        };
      }
      
      // 确保必要字段存在，但保护现有数据
      if (!config.proxies) config.proxies = [];
      if (!config.settings) config.settings = {};
      
      // 更新顶级设置
      if (settings.enabled !== undefined) config.enabled = settings.enabled;
      if (settings.activeProxyId !== undefined) config.activeProxyId = settings.activeProxyId;
      if (settings.autoSwitch !== undefined) config.autoSwitch = settings.autoSwitch;
      if (settings.testInterval !== undefined) config.testInterval = settings.testInterval;
      if (settings.currentTestUrlId !== undefined) config.currentTestUrlId = settings.currentTestUrlId;
      
      // 更新settings对象（保持兼容性）
      if (!config.settings) config.settings = {};
      if (settings.enabled !== undefined) config.settings.enabled = settings.enabled;
      if (settings.activeProxyId !== undefined) config.settings.activeProxyId = settings.activeProxyId;
      if (settings.autoSwitch !== undefined) config.settings.autoSwitch = settings.autoSwitch;
      if (settings.testInterval !== undefined) config.settings.testInterval = settings.testInterval;
      if (settings.currentTestUrlId !== undefined) config.settings.currentTestUrlId = settings.currentTestUrlId;
      
      config.updatedAt = new Date().toISOString();

      // 保存更新后的配置
      await env.YOYO_USER_DB.put('proxy-config', JSON.stringify(config));

      return successResponse({ success: true }, '代理设置更新成功', request);

    } catch (error) {
      logError('更新代理设置异常', error);
      return errorResponse('更新代理设置异常', 'PROXY_SETTINGS_UPDATE_ERROR', 500, request);
    }
  },

  /**
   * 删除代理
   * DELETE /api/admin/proxy/config/:id
   */
  async deleteProxy(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const proxyId = url.pathname.split('/').pop();
      
      if (!proxyId) {
        return errorResponse('缺少代理ID', 'MISSING_PROXY_ID', 400, request);
      }

      logInfo('管理员删除代理', { 
        admin: auth.user.username,
        proxyId: proxyId
      });

      // 🔧 修复：从统一存储格式中删除代理
      const existingConfigData = await env.YOYO_USER_DB.get('proxy-config');
      if (!existingConfigData) {
        return errorResponse('代理配置不存在', 'PROXY_CONFIG_NOT_FOUND', 404, request);
      }

      const config = JSON.parse(existingConfigData);
      if (!config.proxies || !Array.isArray(config.proxies)) {
        return errorResponse('代理列表不存在', 'PROXY_LIST_NOT_FOUND', 404, request);
      }

      // 查找要删除的代理
      const proxyIndex = config.proxies.findIndex(p => p.id === proxyId);
      if (proxyIndex === -1) {
        return errorResponse('代理不存在', 'PROXY_NOT_FOUND', 404, request);
      }

      // 从列表中删除代理
      const deletedProxy = config.proxies.splice(proxyIndex, 1)[0];
      config.updatedAt = new Date().toISOString();

      // 检查是否是当前活跃代理，如果是则清除
      if (config.activeProxyId === proxyId) {
        config.activeProxyId = null;
        config.enabled = false;
        if (config.settings) {
          config.settings.activeProxyId = null;
          config.settings.enabled = false;
        }
      }

      // 保存更新后的配置
      await env.YOYO_USER_DB.put('proxy-config', JSON.stringify(config));

      logInfo('代理删除成功', { 
        admin: auth.user.username,
        proxyId: proxyId,
        proxyName: deletedProxy.name,
        remainingProxies: config.proxies.length
      });

      return successResponse({ 
        success: true, 
        deletedProxy: deletedProxy,
        remainingCount: config.proxies.length 
      }, '代理删除成功', request);

    } catch (error) {
      logError('删除代理异常', error);
      return errorResponse('删除代理异常', 'PROXY_DELETE_ERROR', 500, request);
    }
  },

  /**
   * 更新单个代理
   * PUT /api/admin/proxy/config/:id
   */
  async updateProxy(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const proxyId = url.pathname.split('/').pop();
      const updateData = await request.json();
      
      if (!proxyId) {
        return errorResponse('缺少代理ID', 'MISSING_PROXY_ID', 400, request);
      }

      logInfo('管理员更新代理', { 
        admin: auth.user.username,
        proxyId: proxyId,
        updateData: updateData
      });

      // 🔧 修复：从统一存储格式中更新代理
      const existingConfigData = await env.YOYO_USER_DB.get('proxy-config');
      if (!existingConfigData) {
        return errorResponse('代理配置不存在', 'PROXY_CONFIG_NOT_FOUND', 404, request);
      }

      const config = JSON.parse(existingConfigData);
      if (!config.proxies || !Array.isArray(config.proxies)) {
        return errorResponse('代理列表不存在', 'PROXY_LIST_NOT_FOUND', 404, request);
      }

      // 查找要更新的代理
      const proxyIndex = config.proxies.findIndex(p => p.id === proxyId);
      if (proxyIndex === -1) {
        return errorResponse('代理不存在', 'PROXY_NOT_FOUND', 404, request);
      }

      const existingProxy = config.proxies[proxyIndex];
      
      // 更新代理配置
      const updatedProxy = {
        ...existingProxy,
        ...updateData,
        id: proxyId, // 确保ID不被修改
        updatedAt: new Date().toISOString()
      };

      // 更新数组中的代理
      config.proxies[proxyIndex] = updatedProxy;
      config.updatedAt = new Date().toISOString();

      // 保存更新后的配置
      await env.YOYO_USER_DB.put('proxy-config', JSON.stringify(config));

      logInfo('代理更新成功', { 
        admin: auth.user.username,
        proxyId: proxyId,
        proxyName: updatedProxy.name,
        updatedFields: Object.keys(updateData)
      });

      return successResponse(updatedProxy, '代理更新成功', request);

    } catch (error) {
      logError('更新代理异常', error);
      return errorResponse('更新代理异常', 'PROXY_UPDATE_ERROR', 500, request);
    }
  },

  /**
   * 代理控制操作
   * POST /api/admin/proxy/control
   */
  async control(request, env, ctx) {
    try {
      // 验证管理员权限
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const { action, proxyId, ...data } = await request.json();
      
      logInfo('管理员代理控制操作', { 
        admin: auth.user.username,
        action,
        proxyId
      });

      // 根据不同操作处理
      switch (action) {
        case 'enable':
          // 🔧 修复：获取完整的代理配置信息
          const configData = await env.YOYO_USER_DB.get('proxy-config');
          if (!configData) {
            return errorResponse('代理配置不存在', 'PROXY_CONFIG_NOT_FOUND', 404, request);
          }
          
          const config = JSON.parse(configData);
          const targetProxy = config.proxies?.find(p => p.id === proxyId);
          
          if (!targetProxy) {
            return errorResponse('指定的代理不存在', 'PROXY_NOT_FOUND', 404, request);
          }
          
          logInfo('启用代理', {
            admin: auth.user.username,
            proxyId: proxyId,
            proxyName: targetProxy.name,
            proxyType: targetProxy.type
          });
          
          // 启用代理 - 转发完整配置到VPS
          const enableResponse = await fetch(`${env.VPS_API_URL}/api/proxy/connect`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.VPS_API_KEY
            },
            body: JSON.stringify({ 
              proxyConfig: {
                id: targetProxy.id,
                name: targetProxy.name,
                type: targetProxy.type,
                config: targetProxy.config
              }
            })
          });
          
          if (!enableResponse.ok) {
            const errorText = await enableResponse.text();
            logError('VPS代理连接失败', {
              status: enableResponse.status,
              error: errorText,
              proxyId: proxyId
            });
            return errorResponse('启用代理失败', 'PROXY_ENABLE_FAILED', 502, request);
          }
          
          const enableResult = await enableResponse.json();
          
          // 更新本地配置中的活跃代理ID
          config.activeProxyId = proxyId;
          config.updatedAt = new Date().toISOString();
          await env.YOYO_USER_DB.put('proxy-config', JSON.stringify(config));
          
          return successResponse(enableResult.data, '代理启用成功', request);

        case 'disable':
          // 禁用代理 - 转发到VPS
          const disableResponse = await fetch(`${env.VPS_API_URL}/api/proxy/disconnect`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.VPS_API_KEY
            }
          });
          
          if (!disableResponse.ok) {
            return errorResponse('禁用代理失败', 'PROXY_DISABLE_FAILED', 502, request);
          }
          
          const disableResult = await disableResponse.json();
          return successResponse(disableResult.data, '代理禁用成功', request);

        default:
          return errorResponse('不支持的操作', 'UNSUPPORTED_ACTION', 400, request);
      }

    } catch (error) {
      logError('代理控制操作异常', error);
      return errorResponse('代理控制操作异常', 'PROXY_CONTROL_ERROR', 500, request);
    }
  }
};
