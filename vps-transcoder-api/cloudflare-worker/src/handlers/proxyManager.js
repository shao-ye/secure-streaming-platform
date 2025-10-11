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

      const { proxyConfig, testUrlId = 'baidu' } = await request.json();
      
      if (!proxyConfig) {
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
      if (error) return error;

      // 根据设计文档使用分布式存储方式读取
      const proxies = await this.getAllProxyConfigs(env);
      const globalConfig = await this.getGlobalConfig(env);
      
      const response = {
        enabled: globalConfig.enabled || false,
        activeProxyId: globalConfig.activeProxyId || null,
        proxies: proxies.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        settings: {
          enabled: globalConfig.enabled || false,
          activeProxyId: globalConfig.activeProxyId || null,
          autoSwitch: globalConfig.autoSwitch || false,
          testInterval: globalConfig.testInterval || 300,
          currentTestUrlId: globalConfig.currentTestUrlId || 'baidu'
        }
      };
      
      logInfo('代理配置获取成功', { 
        admin: auth.user.username,
        proxyCount: proxies.length,
        enabled: response.enabled,
        activeProxyId: response.activeProxyId
      });

      return successResponse(response, '代理配置获取成功', request);

    } catch (error) {
      logError('获取代理配置异常', error);
      return errorResponse('获取代理配置异常', 'PROXY_CONFIG_ERROR', 500, request);
    }
  },

  /**
   * 获取所有代理配置（分布式存储）
   */
  async getAllProxyConfigs(env) {
    try {
      const { keys } = await env.YOYO_USER_DB.list({ prefix: 'proxy_config_' });
      const proxies = [];
      
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
      
      return proxies;
    } catch (error) {
      logError('获取代理配置列表失败', error);
      return [];
    }
  },

  /**
   * 获取全局配置
   */
  async getGlobalConfig(env) {
    try {
      const globalConfigData = await env.YOYO_USER_DB.get('proxy_global_config');
      if (globalConfigData) {
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
   * 创建单个代理（分布式存储）
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

      // 使用分布式存储保存代理配置
      const proxyKey = `proxy_config_${proxyId}`;
      await env.YOYO_USER_DB.put(proxyKey, JSON.stringify(newProxy));

      return successResponse(newProxy, '代理创建成功', request);

    } catch (error) {
      logError('创建代理异常', error);
      return errorResponse('创建代理异常', 'PROXY_CREATE_ERROR', 500, request);
    }
  },

  /**
   * 更新代理设置（全局配置）
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

      // 获取现有全局配置
      const existingConfig = await this.getGlobalConfig(env);
      
      // 更新全局配置
      const updatedConfig = {
        ...existingConfig,
        ...settings,
        updatedAt: new Date().toISOString()
      };

      // 保存全局配置
      await env.YOYO_USER_DB.put('proxy_global_config', JSON.stringify(updatedConfig));

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

      // 删除代理配置
      const proxyKey = `proxy_config_${proxyId}`;
      await env.YOYO_USER_DB.delete(proxyKey);

      // 检查是否是当前活跃代理，如果是则清除
      const globalConfig = await this.getGlobalConfig(env);
      if (globalConfig.activeProxyId === proxyId) {
        globalConfig.activeProxyId = null;
        globalConfig.enabled = false;
        globalConfig.updatedAt = new Date().toISOString();
        await env.YOYO_USER_DB.put('proxy_global_config', JSON.stringify(globalConfig));
      }

      return successResponse({ success: true }, '代理删除成功', request);

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
        proxyId: proxyId
      });

      // 获取现有代理配置
      const proxyKey = `proxy_config_${proxyId}`;
      const existingData = await env.YOYO_USER_DB.get(proxyKey);
      
      if (!existingData) {
        return errorResponse('代理不存在', 'PROXY_NOT_FOUND', 404, request);
      }

      const existingProxy = JSON.parse(existingData);
      
      // 更新代理配置
      const updatedProxy = {
        ...existingProxy,
        ...updateData,
        id: proxyId, // 确保ID不被修改
        updatedAt: new Date().toISOString()
      };

      // 保存更新后的配置
      await env.YOYO_USER_DB.put(proxyKey, JSON.stringify(updatedProxy));

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
          // 启用代理 - 转发到VPS
          const enableResponse = await fetch(`${env.VPS_API_URL}/api/proxy/connect`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': env.VPS_API_KEY
            },
            body: JSON.stringify({ proxyConfig: { id: proxyId, ...data } })
          });
          
          if (!enableResponse.ok) {
            return errorResponse('启用代理失败', 'PROXY_ENABLE_FAILED', 502, request);
          }
          
          const enableResult = await enableResponse.json();
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
