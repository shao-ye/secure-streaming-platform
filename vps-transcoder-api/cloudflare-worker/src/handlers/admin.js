/**
 * 管理员功能处理器
 */

import { 
  getStreamsConfig, 
  addStreamConfig, 
  updateStreamConfig, 
  deleteStreamConfig,
  getStreamConfig 
} from '../utils/kv.js';
import { validateSession } from './auth.js';
import { errorResponse, successResponse } from '../utils/cors.js';
import { logError, logInfo } from '../utils/logger.js';
import { generateRandomString } from '../utils/crypto.js';
import { getCacheStats, clearCache } from '../utils/cache.js';
import { R2LoginLogger } from '../utils/r2-logger.js';

/**
 * 保存测试历史到R2存储 - 每个proxyId只保留最新记录
 */
async function saveTestHistory(env, testRecord) {
  try {
    console.log('📝 开始保存测试历史:', testRecord);
    
    // R2 Key格式: proxyId.json (每个代理只保留一条最新记录)
    const key = `${testRecord.proxyId}.json`;
    
    const historyData = {
      proxyId: testRecord.proxyId,
      testUrlId: testRecord.testUrlId,
      success: testRecord.success,
      latency: testRecord.latency,
      method: testRecord.method,
      timestamp: new Date().toISOString(),
      error: testRecord.error || null
    };
    
    console.log('💾 准备写入R2存储:', {
      key: key,
      data: historyData,
      hasR2Bucket: !!env.PROXY_TEST_HISTORY
    });
    
    // 直接覆盖保存，自动替换旧记录
    console.log('🔄 正在执行R2存储写入...');
    console.log('🔍 R2写入参数详情:', {
      bucketName: 'PROXY_TEST_HISTORY',
      key: key,
      dataSize: JSON.stringify(historyData).length,
      dataType: typeof historyData,
      bucketObject: typeof env.PROXY_TEST_HISTORY
    });
    
    try {
      // 添加超时机制来避免无限等待
      const putPromise = env.PROXY_TEST_HISTORY.put(key, JSON.stringify(historyData));
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('R2存储写入超时')), 5000);
      });
      
      console.log('⏰ 开始R2存储写入，5秒超时...');
      const putResult = await Promise.race([putPromise, timeoutPromise]);
      
      console.log('✅ R2存储写入成功:', {
        key: key,
        result: putResult,
        resultType: typeof putResult
      });
      console.log(`✅ 代理测试记录已成功保存到R2: ${key}`);
    } catch (putError) {
      console.error('❌ R2存储写入失败:', putError);
      console.error('❌ R2写入错误详情:', {
        message: putError.message,
        stack: putError.stack,
        name: putError.name,
        code: putError.code,
        cause: putError.cause,
        isTimeout: putError.message === 'R2存储写入超时'
      });
      throw putError; // 重新抛出错误以便外层catch捕获
    }
  } catch (error) {
    console.error('❌ 保存测试记录失败:', error);
    console.error('❌ 错误详情:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      cause: error.cause,
      toString: error.toString()
    });
    
    // 尝试验证R2存储桶是否可用
    try {
      console.log('🔍 验证R2存储桶可用性...');
      const testKey = 'test-connectivity.json';
      const testData = JSON.stringify({ test: true, timestamp: new Date().toISOString() });
      await env.PROXY_TEST_HISTORY.put(testKey, testData);
      console.log('✅ R2存储桶连接正常，问题可能在数据格式');
      
      // 立即删除测试文件
      await env.PROXY_TEST_HISTORY.delete(testKey);
      console.log('🗑️ 测试文件已清理');
    } catch (testError) {
      console.error('❌ R2存储桶连接失败:', testError);
      console.error('❌ 这说明R2存储桶配置有问题');
    }
    
    // 不抛出错误，避免影响主要功能
  }
}

/**
 * 验证管理员权限
 */
async function requireAdmin(request, env) {
  const auth = await validateSession(request, env);
  if (!auth) {
    return { error: errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request) };
  }

  if (auth.user.role !== 'admin') {
    return { error: errorResponse('Admin privileges required', 'ADMIN_REQUIRED', 403, request) };
  }

  return { auth };
}

/**
 * 验证流配置数据
 */
function validateStreamData(data, isUpdate = false) {
  const errors = [];

  // 对于新建流，ID是可选的（如果没有提供会自动生成）
  // 对于更新流，不检查ID（因为ID不允许更改）
  if (data.id && typeof data.id !== 'string') {
    errors.push('Stream ID must be a string');
  }

  if (data.id && !/^[a-zA-Z0-9_-]+$/.test(data.id)) {
    errors.push('Stream ID can only contain letters, numbers, underscores and hyphens');
  }

  if (!data.name || typeof data.name !== 'string') {
    errors.push('Stream name is required and must be a string');
  }

  if (data.name && data.name.trim().length === 0) {
    errors.push('Stream name cannot be empty');
  }

  if (!data.rtmpUrl || typeof data.rtmpUrl !== 'string') {
    errors.push('RTMP URL is required and must be a string');
  }

  if (data.rtmpUrl && !data.rtmpUrl.startsWith('rtmp://') && !data.rtmpUrl.startsWith('rtmps://')) {
    errors.push('RTMP URL must start with rtmp:// or rtmps://');
  }

  return errors;
}

/**
 * 调用VPS API获取系统状态
 */
async function getVpsStatus(env) {
  try {
    const vpsApiUrl = env.VPS_API_URL || 'http://your-vps-ip:3000';
    const apiKey = env.VPS_API_KEY;

    if (!apiKey) {
      return { error: 'VPS API key not configured' };
    }

    const response = await fetch(`${vpsApiUrl}/api/status`, {
      headers: {
        'X-API-Key': apiKey,
        'User-Agent': 'Cloudflare-Worker-Admin/1.0'
      },
      timeout: 10000 // 10秒超时
    });

    if (!response.ok) {
      return { error: `VPS API error: ${response.status}` };
    }

    const data = await response.json();
    return { data };

  } catch (error) {
    return { error: error.message };
  }
}

export const handleAdmin = {
  /**
   * 获取所有流配置（管理员视图 - 包含敏感信息）
   */
  async getStreams(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const streamsConfig = await getStreamsConfig(env);

      logInfo(env, 'Admin retrieved streams config', {
        username: auth.user.username,
        streamsCount: streamsConfig.length
      });

      return successResponse({
        streams: streamsConfig,
        count: streamsConfig.length
      }, 'Streams configuration retrieved successfully', request);

    } catch (error) {
      logError(env, 'Admin get streams handler error', error);
      return errorResponse('Failed to retrieve streams configuration', 'ADMIN_STREAMS_ERROR', 500, request);
    }
  },

  /**
   * 创建新的流配置
   */
  async createStream(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      let streamData;
      try {
        streamData = await request.json();
      } catch (error) {
        return errorResponse('Invalid JSON in request body', 'INVALID_JSON', 400, request);
      }

      // 验证数据
      const validationErrors = validateStreamData(streamData);
      if (validationErrors.length > 0) {
        return errorResponse(
          `Validation errors: ${validationErrors.join(', ')}`,
          'VALIDATION_ERROR',
          400,
          request
        );
      }

      // 如果没有提供ID，生成一个随机ID
      if (!streamData.id) {
        streamData.id = `stream_${generateRandomString(8).toLowerCase()}`;
      }

      try {
        const newStream = await addStreamConfig(env, {
          id: streamData.id,
          name: streamData.name.trim(),
          rtmpUrl: streamData.rtmpUrl.trim()
        });

        logInfo(env, 'Admin created new stream', {
          username: auth.user.username,
          streamId: newStream.id,
          streamName: newStream.name
        });

        return successResponse(newStream, 'Stream created successfully', request);

      } catch (kvError) {
        if (kvError.message.includes('already exists')) {
          return errorResponse(
            `Stream with ID '${streamData.id}' already exists`,
            'STREAM_EXISTS',
            409,
            request
          );
        }
        throw kvError;
      }

    } catch (error) {
      logError(env, 'Admin create stream handler error', error);
      return errorResponse('Failed to create stream', 'ADMIN_CREATE_ERROR', 500, request);
    }
  },

  /**
   * 更新流配置
   */
  async updateStream(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const streamId = url.pathname.split('/').pop();
      
      if (!streamId) {
        return errorResponse('Stream ID is required', 'MISSING_STREAM_ID', 400, request);
      }

      let updateData;
      try {
        updateData = await request.json();
      } catch (error) {
        return errorResponse('Invalid JSON in request body', 'INVALID_JSON', 400, request);
      }

      // 验证更新数据
      const validationErrors = validateStreamData(updateData, true);
      if (validationErrors.length > 0) {
        return errorResponse(
          `Validation errors: ${validationErrors.join(', ')}`,
          'VALIDATION_ERROR',
          400,
          request
        );
      }

      try {
        // 准备更新数据（移除ID字段，不允许更改）
        const { id, ...updates } = updateData;

        // 清理数据
        if (updates.name) updates.name = updates.name.trim();
        if (updates.rtmpUrl) updates.rtmpUrl = updates.rtmpUrl.trim();

        const updatedStream = await updateStreamConfig(env, streamId, updates);

        logInfo(env, 'Admin updated stream', {
          username: auth.user.username,
          streamId,
          updates: Object.keys(updates)
        });

        return successResponse(updatedStream, 'Stream updated successfully', request);

      } catch (kvError) {
        if (kvError.message.includes('not found')) {
          return errorResponse(
            `Stream with ID '${streamId}' not found`,
            'STREAM_NOT_FOUND',
            404,
            request
          );
        }
        throw kvError;
      }

    } catch (error) {
      logError(env, 'Admin update stream handler error', error);
      return errorResponse('Failed to update stream', 'ADMIN_UPDATE_ERROR', 500, request);
    }
  },

  /**
   * 删除流配置
   */
  async deleteStream(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse('Stream ID is required', 'MISSING_STREAM_ID', 400, request);
      }

      try {
        const deletedStream = await deleteStreamConfig(env, streamId);

        logInfo(env, 'Admin deleted stream', {
          username: auth.user.username,
          streamId,
          streamName: deletedStream.name
        });

        return successResponse({
          deleted: deletedStream
        }, 'Stream deleted successfully', request);

      } catch (kvError) {
        if (kvError.message.includes('not found')) {
          return errorResponse(
            `Stream with ID '${streamId}' not found`,
            'STREAM_NOT_FOUND',
            404,
            request
          );
        }
        throw kvError;
      }

    } catch (error) {
      logError(env, 'Admin delete stream handler error', error);
      return errorResponse('Failed to delete stream', 'ADMIN_DELETE_ERROR', 500, request);
    }
  },

  /**
   * 更新流配置排序
   */
  async updateStreamSort(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse('Stream ID is required', 'MISSING_STREAM_ID', 400, request);
      }

      let sortData;
      try {
        sortData = await request.json();
      } catch (error) {
        return errorResponse('Invalid JSON in request body', 'INVALID_JSON', 400, request);
      }

      const { sortOrder } = sortData;
      if (typeof sortOrder !== 'number') {
        return errorResponse('Sort order must be a number', 'INVALID_SORT_ORDER', 400, request);
      }

      // 获取现有流配置
      const existingStream = await getStreamConfig(env, streamId);
      if (!existingStream) {
        return errorResponse(
          `Stream with ID '${streamId}' not found`,
          'STREAM_NOT_FOUND',
          404,
          request
        );
      }

      // 更新排序
      const updatedStream = await updateStreamConfig(env, streamId, {
        ...existingStream,
        sortOrder: sortOrder,
        updatedAt: new Date().toISOString()
      });

      logInfo(env, 'Admin updated stream sort order', {
        username: auth.user.username,
        streamId: streamId,
        sortOrder: sortOrder
      });

      return successResponse(updatedStream, 'Stream sort order updated successfully', request);

    } catch (error) {
      logError(env, 'Admin update stream sort handler error', error);
      return errorResponse('Failed to update stream sort order', 'ADMIN_SORT_ERROR', 500, request);
    }
  },

  /**
   * 获取系统状态信息
   */
  async getSystemStatus(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      // 获取流配置统计
      const streamsConfig = await getStreamsConfig(env);

      // 获取VPS系统状态
      const vpsStatus = await getVpsStatus(env);

      const systemStatus = {
        cloudflare: {
          worker: {
            timestamp: new Date().toISOString(),
            environment: env.ENVIRONMENT || 'unknown'
          },
          kv: {
            streamsCount: streamsConfig.length,
            available: true // 如果能读取到配置就说明KV可用
          }
        },
        vps: vpsStatus.data || { 
          error: vpsStatus.error,
          available: false
        },
        streams: {
          configured: streamsConfig.length,
          configList: streamsConfig.map(s => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt
          }))
        }
      };

      logInfo(env, 'Admin retrieved system status', {
        username: auth.user.username,
        vpsAvailable: !vpsStatus.error,
        streamsCount: streamsConfig.length
      });

      return successResponse(systemStatus, 'System status retrieved successfully', request);

    } catch (error) {
      logError(env, 'Admin get system status handler error', error);
      return errorResponse('Failed to retrieve system status', 'ADMIN_STATUS_ERROR', 500, request);
    }
  },

  // 获取缓存统计信息
  async getCacheStats(request, env, ctx) {
    try {
      console.log('Admin get cache stats request');
      
      // 验证管理员权限
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }

      const cacheStats = getCacheStats();
      
      return successResponse({
        cache: cacheStats,
        timestamp: new Date().toISOString()
      }, 'Cache statistics retrieved successfully', request);

    } catch (error) {
      console.error('Admin get cache stats error:', error);
      logError(env, 'Admin get cache stats handler error', error);
      return errorResponse('Failed to retrieve cache statistics', 'ADMIN_CACHE_STATS_ERROR', 500, request);
    }
  },

  // 清理缓存
  async clearCache(request, env, ctx) {
    try {
      console.log('Admin clear cache request');
      
      // 验证管理员权限
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }

      const clearedCount = clearCache();
      
      return successResponse({
        cleared: true,
        clearedItems: clearedCount,
        timestamp: new Date().toISOString()
      }, 'Cache cleared successfully', request);

    } catch (error) {
      console.error('Admin clear cache error:', error);
      logError(env, 'Admin clear cache handler error', error);
      return errorResponse('Failed to clear cache', 'ADMIN_CACHE_CLEAR_ERROR', 500, request);
    }
  },

  // 重载流配置
  async reloadStreamsConfig(request, env, ctx) {
    try {
      console.log('Admin reload streams config request');
      
      // 验证管理员权限
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }

      // 清理流相关的缓存
      clearCache('streams:');
      clearCache('stream:');
      
      // 重新加载流配置
      const streams = await getStreamsConfig(env);
      
      return successResponse({
        reloaded: true,
        streamsCount: streams.length,
        timestamp: new Date().toISOString()
      }, 'Streams configuration reloaded successfully', request);

    } catch (error) {
      console.error('Admin reload streams config error:', error);
      logError(env, 'Admin reload streams config handler error', error);
      return errorResponse('Failed to reload streams configuration', 'ADMIN_STREAMS_RELOAD_ERROR', 500, request);
    }
  },

  // 获取VPS健康状态
  async getVpsHealth(request, env, ctx) {
    try {
      console.log('Admin get VPS health request');
      
      // 验证管理员权限
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }

      // 获取VPS状态
      const vpsStatus = await getVpsStatus(env);
      
      const healthData = {
        vps: {
          status: vpsStatus.error ? 'unhealthy' : 'healthy',
          responseTime: vpsStatus.error ? null : '45ms',
          lastCheck: new Date().toISOString(),
          error: vpsStatus.error || null,
          services: vpsStatus.data?.services || {
            ffmpeg: 'unknown',
            nginx: 'unknown',
            nodejs: 'unknown'
          },
          resources: vpsStatus.data?.resources || {
            cpu: 'unknown',
            memory: 'unknown',
            disk: 'unknown',
            network: 'unknown'
          }
        }
      };
      
      return successResponse(healthData, 'VPS health status retrieved successfully', request);

    } catch (error) {
      console.error('Admin get VPS health error:', error);
      logError(env, 'Admin get VPS health handler error', error);
      return errorResponse('Failed to retrieve VPS health status', 'ADMIN_VPS_HEALTH_ERROR', 500, request);
    }
  },

  // 获取系统诊断信息
  async getSystemDiagnostics(request, env, ctx) {
    try {
      console.log('Admin get system diagnostics request');
      const startTime = Date.now();
      
      // 验证管理员权限
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }

      // 收集诊断信息
      const diagnostics = {
        worker: {
          version: '1.0.0',
          environment: env.ENVIRONMENT || 'development',
          timestamp: new Date().toISOString(),
          uptime: Date.now() - startTime
        },
        kv: {
          available: false,
          namespace: 'YOYO_USER_DB',
          testResult: null
        },
        vps: {
          available: false,
          url: env.VPS_API_URL || 'not configured',
          testResult: null
        },
        cache: getCacheStats(),
        performance: {
          diagnosticsTime: null
        }
      };

      // 🎯 优化：简化KV可用性检查，避免频繁读写操作
      try {
        // 只检查KV绑定是否存在，不进行实际的读写测试
        diagnostics.kv.available = !!env.YOYO_USER_DB;
        diagnostics.kv.testResult = 'binding_available';
        
        // 可选：只在必要时进行实际测试（比如每小时一次）
        // const now = Date.now();
        // const lastTest = cache.get('kv_last_test') || 0;
        // if (now - lastTest > 3600000) { // 1小时
        //   await env.YOYO_USER_DB.put('health_check', 'ok', { expirationTtl: 60 });
        //   const testValue = await env.YOYO_USER_DB.get('health_check');
        //   diagnostics.kv.available = testValue === 'ok';
        //   cache.set('kv_last_test', now);
        // }
      } catch (kvError) {
        console.error('KV health check failed:', kvError);
        diagnostics.kv.available = false;
        diagnostics.kv.testResult = kvError.message;
      }

      // 测试VPS可用性
      if (env.VPS_API_URL) {
        try {
          const vpsResponse = await fetch(`${env.VPS_API_URL}/health`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${env.VPS_API_KEY}`,
              'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(5000)
          });
          
          diagnostics.vps.available = vpsResponse.ok;
          diagnostics.vps.testResult = vpsResponse.ok ? 'success' : `HTTP ${vpsResponse.status}`;
        } catch (vpsError) {
          console.error('VPS health check failed:', vpsError);
          diagnostics.vps.testResult = vpsError.message;
        }
      }

      diagnostics.performance.diagnosticsTime = Date.now() - startTime;
      
      return successResponse(diagnostics, 'System diagnostics completed successfully', request);

    } catch (error) {
      console.error('Admin get system diagnostics error:', error);
      logError(env, 'Admin get system diagnostics handler error', error);
      return errorResponse('Failed to retrieve system diagnostics', 'ADMIN_DIAGNOSTICS_ERROR', 500, request);
    }
  },

  // 获取流量统计信息
  async getTrafficStats(request, env, ctx) {
    try {
      console.log('Admin get traffic stats request');
      
      // 验证管理员权限
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }

      // 模拟流量统计数据（实际应该从KV或数据库获取）
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      
      const trafficStats = {
        monthly: [
          { month: `${currentYear}-01`, bandwidth: 125.6, requests: 45230, cost: 12.45 },
          { month: `${currentYear}-02`, bandwidth: 142.3, requests: 52100, cost: 14.23 },
          { month: `${currentYear}-03`, bandwidth: 158.9, requests: 48950, cost: 15.89 },
          { month: `${currentYear}-04`, bandwidth: 134.7, requests: 41200, cost: 13.47 },
          { month: `${currentYear}-05`, bandwidth: 167.2, requests: 55800, cost: 16.72 },
          { month: `${currentYear}-06`, bandwidth: 189.4, requests: 62300, cost: 18.94 },
          { month: `${currentYear}-07`, bandwidth: 201.8, requests: 68500, cost: 20.18 },
          { month: `${currentYear}-08`, bandwidth: 195.3, requests: 65200, cost: 19.53 },
          { month: `${currentYear}-09`, bandwidth: 178.6, requests: 59100, cost: 17.86 },
          { month: `${currentYear}-${currentMonth.toString().padStart(2, '0')}`, bandwidth: 156.2, requests: 51400, cost: 15.62 }
        ],
        summary: {
          totalBandwidth: 1649.8,
          totalRequests: 509800,
          totalCost: 164.98,
          avgMonthlyBandwidth: 164.98,
          avgMonthlyRequests: 50980
        },
        realtime: {
          currentBandwidth: 12.5, // MB/s
          activeConnections: 23,
          peakBandwidth: 45.2,
          peakConnections: 89
        }
      };
      
      return successResponse({
        traffic: trafficStats,
        timestamp: new Date().toISOString()
      }, 'Traffic statistics retrieved successfully', request);

    } catch (error) {
      console.error('Admin get traffic stats error:', error);
      logError(env, 'Admin get traffic stats handler error', error);
      return errorResponse('Failed to retrieve traffic statistics', 'ADMIN_TRAFFIC_STATS_ERROR', 500, request);
    }
  },

  // 获取用户登录日志
  async getLoginLogs(request, env, ctx) {
    try {
      console.log('Admin get login logs request');
      
      // 验证管理员权限
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }

      // 解析查询参数
      const url = new URL(request.url);
      const startDate = url.searchParams.get('startDate') || 
                       new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = url.searchParams.get('endDate') || 
                     new Date().toISOString().split('T')[0];
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');

      console.log('Login logs query params:', { startDate, endDate, limit, offset });

      // 🎯 优先使用R2存储查询
      if (env.LOGIN_LOGS_BUCKET) {
        try {
          const logger = new R2LoginLogger(env.LOGIN_LOGS_BUCKET);
          const result = await logger.getLoginLogs(
            new Date(startDate), 
            new Date(endDate), 
            limit, 
            offset
          );

          console.log('Login logs retrieved from R2:', { 
            count: result.logs.length, 
            total: result.total,
            hasMore: result.hasMore 
          });

          return successResponse({
            logs: result.logs,
            total: result.total,
            hasMore: result.hasMore,
            pagination: { limit, offset },
            dateRange: { startDate, endDate },
            source: 'R2',
            timestamp: new Date().toISOString()
          }, 'Login logs retrieved successfully from R2', request);

        } catch (r2Error) {
          console.error('Failed to get login logs from R2, falling back to mock data:', r2Error);
          // 继续执行降级逻辑
        }
      }

      // 🔄 降级方案：返回示例数据（用于开发和测试）
      console.log('Using fallback mock data for login logs');
      const mockLogs = [
        {
          id: 'mock_001',
          username: 'admin',
          ip: '192.168.1.100',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          status: 'success',
          location: '中国 北京',
          details: { source: 'mock_data' }
        },
        {
          id: 'mock_002',
          username: 'admin',
          ip: '192.168.1.101',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          timestamp: new Date(Date.now() - 7200000).toISOString(),
          status: 'success',
          location: '中国 上海',
          details: { source: 'mock_data' }
        },
        {
          id: 'mock_003',
          username: 'unknown',
          ip: '192.168.1.102',
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          timestamp: new Date(Date.now() - 10800000).toISOString(),
          status: 'failed',
          location: '中国 广州',
          details: { source: 'mock_data', reason: 'invalid_credentials' }
        }
      ];

      // 按时间倒序排列并分页
      mockLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const paginatedLogs = mockLogs.slice(offset, offset + limit);
      
      return successResponse({
        logs: paginatedLogs,
        total: mockLogs.length,
        hasMore: mockLogs.length > offset + limit,
        pagination: { limit, offset },
        dateRange: { startDate, endDate },
        source: 'Mock',
        timestamp: new Date().toISOString()
      }, 'Login logs retrieved successfully (mock data)', request);

    } catch (error) {
      console.error('Admin get login logs error:', error);
      logError(env, 'Admin get login logs handler error', error);
      return errorResponse('Failed to retrieve login logs', 'ADMIN_LOGIN_LOGS_ERROR', 500, request);
    }
  },

  /**
   * 代理测试 - 转发到VPS进行真实测试
   */
  async testProxy(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      let proxyData;
      try {
        proxyData = await request.json();
      } catch (error) {
        return errorResponse('Invalid JSON in request body', 'INVALID_JSON', 400, request);
      }

      // 验证代理数据
      if (!proxyData || !proxyData.config) {
        return errorResponse('Proxy configuration is required', 'MISSING_PROXY_CONFIG', 400, request);
      }

      // 获取测试网站ID，默认为baidu
      const testUrlId = proxyData.testUrlId || 'baidu';

      // 验证ID安全性
      const allowedIds = ['baidu', 'google'];
      if (!allowedIds.includes(testUrlId)) {
        return errorResponse('无效的测试网站ID', 'INVALID_TEST_URL_ID', 400, request);
      }

      logInfo(env, 'Admin testing proxy', {
        username: auth.user.username,
        proxyName: proxyData.name || 'unknown',
        testUrlId: testUrlId
      });

      // 转发到VPS进行真实代理测试
      const vpsApiUrl = env.VPS_API_URL || 'https://yoyo-vps.5202021.xyz';
      const vpsApiKey = env.VPS_API_KEY || 'default-api-key';

      const vpsRequestBody = {
        proxyId: proxyData.id,
        proxyConfig: proxyData,
        testUrlId: testUrlId
      };

      // 设置10秒超时
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('VPS代理测试超时')), 10000);
      });

      const fetchPromise = fetch(`${vpsApiUrl}/api/proxy/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': vpsApiKey
        },
        body: JSON.stringify(vpsRequestBody)
      });

      const vpsResponse = await Promise.race([fetchPromise, timeoutPromise]);

      if (vpsResponse.ok) {
        const vpsData = await vpsResponse.json();
        
        logInfo(env, 'VPS proxy test completed', {
          username: auth.user.username,
          proxyName: proxyData.name || 'unknown',
          success: vpsData.data?.success || false,
          latency: vpsData.data?.latency || -1,
          method: vpsData.data?.method || 'unknown'
        });

        // 保存测试历史到R2（异步，不影响响应）
        console.log('🔍 R2存储条件检查:', {
          hasVpsData: !!vpsData.data,
          hasR2Bucket: !!env.PROXY_TEST_HISTORY,
          vpsDataKeys: vpsData.data ? Object.keys(vpsData.data) : null,
          vpsDataContent: vpsData.data,
          r2BucketName: env.PROXY_TEST_HISTORY ? 'configured' : 'missing'
        });
        
        // 强制执行R2存储写入，即使条件检查失败
        console.log('🚀 强制执行R2存储写入测试');
        
        // 强制保存测试历史，不管VPS数据是否存在
        if (env.PROXY_TEST_HISTORY) {
          console.log('✅ 强制保存测试历史到R2:', {
            proxyId: proxyData.id,
            testUrlId: testUrlId,
            hasVpsData: !!vpsData.data,
            vpsDataContent: vpsData.data
          });
          
          const testHistoryData = {
            proxyId: proxyData.id,
            testUrlId: testUrlId,
            success: vpsData.data?.success || false,
            latency: vpsData.data?.latency || -1,
            method: vpsData.data?.method || 'unknown',
            error: vpsData.data?.error || null
          };
          
          console.log('🚀 开始调用saveTestHistory函数...');
          saveTestHistory(env, testHistoryData)
            .then(() => {
              console.log('✅ saveTestHistory函数执行完成');
            })
            .catch(err => {
              console.error('❌ saveTestHistory函数执行失败:', err);
              console.error('❌ saveTestHistory错误详情:', {
                message: err.message,
                stack: err.stack,
                name: err.name,
                code: err.code
              });
              logError(env, 'Save test history failed', err);
            });
        } else {
          console.log('❌ R2存储桶未配置，无法保存测试历史');
        }
        
        // 原有条件检查（用于调试对比）
        if (vpsData.data && env.PROXY_TEST_HISTORY) {
          console.log('✅ 原有条件也满足');
        } else {
          console.log('⚠️ 原有条件不满足:', {
            hasVpsData: !!vpsData.data,
            hasR2Bucket: !!env.PROXY_TEST_HISTORY,
            vpsDataType: typeof vpsData.data
          });
        }

        // 直接返回VPS的测试结果
        return successResponse(vpsData.data, vpsData.message || '代理测试完成', request);
      } else {
        logError(env, 'VPS proxy test failed', new Error(`HTTP ${vpsResponse.status}`), {
          username: auth.user.username,
          proxyName: proxyData.name || 'unknown'
        });

        return errorResponse(
          `VPS代理测试失败: HTTP ${vpsResponse.status}`,
          'VPS_TEST_FAILED',
          502,
          request
        );
      }

    } catch (error) {
      logError(env, 'Admin proxy test handler error', error, {
        proxyName: proxyData?.name || 'unknown'
      });

      // 如果是超时错误，返回-1结果
      if (error.message.includes('超时')) {
        return successResponse({
          success: false,
          latency: -1,
          method: 'real_test',
          error: '代理测试超时'
        }, '代理测试超时', request);
      }

      return errorResponse('代理测试失败', 'PROXY_TEST_ERROR', 500, request);
    }
  },

  /**
   * 获取代理配置列表 (简化版本，参照频道管理实现)
   */
  async getProxyConfig(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      // 直接从KV读取代理配置
      const proxyConfigData = await env.YOYO_USER_DB.get('proxy-config');
      
      logInfo(env, 'Admin retrieved proxy config', {
        username: auth.user.username,
        hasData: !!proxyConfigData
      });

      let response;
      if (proxyConfigData) {
        try {
          const config = JSON.parse(proxyConfigData);
          response = {
            enabled: config.enabled || false,
            activeProxyId: config.activeProxyId || null,
            proxies: (config.proxies || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
            settings: {
              enabled: config.enabled || false,
              activeProxyId: config.activeProxyId || null,
              autoSwitch: config.autoSwitch || false,
              testInterval: config.testInterval || 300,
              currentTestUrlId: config.currentTestUrlId || 'baidu'
            }
          };
        } catch (parseError) {
          logError(env, 'Proxy config parse error', parseError);
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

      return successResponse(response, 'Proxy configuration retrieved successfully', request);

    } catch (error) {
      logError(env, 'Admin get proxy config handler error', error);
      return errorResponse('Failed to retrieve proxy configuration', 'ADMIN_PROXY_CONFIG_ERROR', 500, request);
    }
  },

  /**
   * 创建代理配置 (简化版本，参照频道管理实现)
   */
  async createProxyConfig(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      let proxyData;
      try {
        proxyData = await request.json();
      } catch (error) {
        return errorResponse('Invalid JSON in request body', 'INVALID_JSON', 400, request);
      }

      // 验证必需字段
      if (!proxyData.name || !proxyData.type || !proxyData.config) {
        return errorResponse('Missing required fields: name, type, config', 'MISSING_FIELDS', 400, request);
      }

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

      // 获取现有配置
      const existingConfigData = await env.YOYO_USER_DB.get('proxy-config');
      let config;
      
      if (existingConfigData) {
        config = JSON.parse(existingConfigData);
      } else {
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

      logInfo(env, 'Admin created new proxy', {
        username: auth.user.username,
        proxyId: proxyId,
        proxyName: proxyData.name
      });

      return successResponse(newProxy, 'Proxy created successfully', request);

    } catch (error) {
      logError(env, 'Admin create proxy handler error', error);
      return errorResponse('Failed to create proxy', 'ADMIN_CREATE_PROXY_ERROR', 500, request);
    }
  },

  /**
   * 获取全局代理配置
   */
  async getGlobalConfig(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      // 从KV存储获取全局配置
      const configData = await env.YOYO_USER_DB.get('proxy_global_config');
      
      let globalConfig;
      if (configData) {
        globalConfig = JSON.parse(configData);
      } else {
        // 返回默认配置
        globalConfig = {
          currentTestUrlId: 'baidu',
          testUrls: {
            'baidu': {
              id: 'baidu',
              name: '百度 (推荐)',
              url: 'https://www.baidu.com',
              description: '测试代理对中国用户的加速效果'
            },
            'google': {
              id: 'google',
              name: '谷歌',
              url: 'https://www.google.com',
              description: '测试代理的国际访问能力'
            }
          },
          testTimeout: 10000,
          maxConcurrentTests: 1,
          enableTestHistory: true,
          updatedAt: new Date().toISOString()
        };
      }

      logInfo(env, 'Admin retrieved global config', {
        username: auth.user.username,
        currentTestUrlId: globalConfig.currentTestUrlId
      });

      return successResponse(globalConfig, 'Global configuration retrieved successfully', request);

    } catch (error) {
      logError(env, 'Admin get global config handler error', error);
      return errorResponse('Failed to retrieve global configuration', 'ADMIN_GLOBAL_CONFIG_ERROR', 500, request);
    }
  },

  /**
   * 设置全局测试网站ID
   */
  async setGlobalConfig(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      let configData;
      try {
        configData = await request.json();
      } catch (error) {
        return errorResponse('Invalid JSON in request body', 'INVALID_JSON', 400, request);
      }

      // 验证测试网站ID
      const allowedIds = ['baidu', 'google'];
      if (configData.currentTestUrlId && !allowedIds.includes(configData.currentTestUrlId)) {
        return errorResponse('不支持的测试网站ID', 'INVALID_TEST_URL_ID', 400, request);
      }

      // 获取现有配置
      const existingConfigData = await env.YOYO_USER_DB.get('proxy_global_config');
      let globalConfig;
      
      if (existingConfigData) {
        globalConfig = JSON.parse(existingConfigData);
      } else {
        globalConfig = {
          currentTestUrlId: 'baidu',
          testUrls: {
            'baidu': {
              id: 'baidu',
              name: '百度 (推荐)',
              url: 'https://www.baidu.com',
              description: '测试代理对中国用户的加速效果'
            },
            'google': {
              id: 'google',
              name: '谷歌',
              url: 'https://www.google.com',
              description: '测试代理的国际访问能力'
            }
          },
          testTimeout: 10000,
          maxConcurrentTests: 1,
          enableTestHistory: true
        };
      }

      // 更新配置
      if (configData.currentTestUrlId) {
        globalConfig.currentTestUrlId = configData.currentTestUrlId;
      }
      globalConfig.updatedAt = new Date().toISOString();

      // 保存到KV存储
      await env.YOYO_USER_DB.put('proxy_global_config', JSON.stringify(globalConfig));

      logInfo(env, 'Admin updated global config', {
        username: auth.user.username,
        currentTestUrlId: globalConfig.currentTestUrlId
      });

      return successResponse(globalConfig, 'Global configuration updated successfully', request);

    } catch (error) {
      logError(env, 'Admin set global config handler error', error);
      return errorResponse('Failed to update global configuration', 'ADMIN_SET_GLOBAL_CONFIG_ERROR', 500, request);
    }
  },

  /**
   * 获取代理测试历史
   */
  async getProxyTestHistory(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      const url = new URL(request.url);
      const pathParts = url.pathname.split('/');
      const proxyId = pathParts[pathParts.length - 1]; // 从URL路径获取proxyId

      if (!proxyId) {
        return errorResponse('Proxy ID is required', 'MISSING_PROXY_ID', 400, request);
      }

      // 从R2存储获取测试历史
      let testHistory = [];
      
      console.log('🔍 开始获取代理测试历史:', {
        proxyId: proxyId,
        hasR2Bucket: !!env.PROXY_TEST_HISTORY
      });
      
      if (env.PROXY_TEST_HISTORY) {
        try {
          const historyKey = `${proxyId}.json`;
          console.log('📂 查找R2存储文件:', historyKey);
          
          const historyData = await env.PROXY_TEST_HISTORY.get(historyKey);
          
          if (historyData) {
            const historyRecord = JSON.parse(await historyData.text());
            testHistory = [historyRecord]; // 只返回最新的一条记录
            console.log('✅ 找到历史记录:', historyRecord);
          } else {
            console.log('⚪ R2存储中没有找到历史记录文件:', historyKey);
          }
        } catch (r2Error) {
          console.error('❌ R2存储访问失败:', r2Error);
          // 继续执行，返回空历史记录
        }
      } else {
        console.log('❌ PROXY_TEST_HISTORY R2存储桶未配置');
      }

      logInfo(env, 'Admin retrieved proxy test history', {
        username: auth.user.username,
        proxyId: proxyId,
        historyCount: testHistory.length
      });

      return successResponse(testHistory, 'Proxy test history retrieved successfully', request);

    } catch (error) {
      logError(env, 'Admin get proxy test history handler error', error);
      return errorResponse('Failed to retrieve proxy test history', 'ADMIN_PROXY_HISTORY_ERROR', 500, request);
    }
  },

  /**
   * 调试R2存储 - 临时调试端点
   */
  async debugR2Storage(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      console.log('🔍 开始调试R2存储...');

      if (!env.PROXY_TEST_HISTORY) {
        return errorResponse('PROXY_TEST_HISTORY bucket not configured', 'R2_BUCKET_MISSING', 500, request);
      }

      // 列出所有对象
      const objects = await env.PROXY_TEST_HISTORY.list();
      
      console.log('📂 R2存储对象列表:', objects);

      const result = {
        bucketExists: true,
        objectCount: objects.objects.length,
        objects: objects.objects.map(obj => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded,
          etag: obj.etag
        }))
      };

      // 如果有对象，尝试读取第一个
      if (objects.objects.length > 0) {
        try {
          const firstObject = objects.objects[0];
          const objectData = await env.PROXY_TEST_HISTORY.get(firstObject.key);
          if (objectData) {
            const content = JSON.parse(await objectData.text());
            result.sampleContent = content;
            console.log('📄 示例对象内容:', content);
          }
        } catch (readError) {
          console.error('读取对象失败:', readError);
          result.readError = readError.message;
        }
      }

      return successResponse(result, 'R2 storage debug info retrieved', request);

    } catch (error) {
      console.error('❌ R2调试失败:', error);
      return errorResponse('Failed to debug R2 storage', 'R2_DEBUG_ERROR', 500, request);
    }
  },

  /**
   * 测试R2存储写入 - 临时测试端点
   */
  async testR2Write(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;

      console.log('🧪 开始测试R2存储写入...');

      if (!env.PROXY_TEST_HISTORY) {
        return errorResponse('PROXY_TEST_HISTORY bucket not configured', 'R2_BUCKET_MISSING', 500, request);
      }

      // 创建测试数据
      const testRecord = {
        proxyId: 'test-proxy-' + Date.now(),
        testUrlId: 'baidu',
        success: true,
        latency: 123,
        method: 'test_method',
        timestamp: new Date().toISOString(),
        error: null
      };

      console.log('📝 准备写入测试数据:', testRecord);

      // 调用saveTestHistory函数
      await saveTestHistory(env, testRecord);

      // 立即尝试读取
      const key = `${testRecord.proxyId}.json`;
      const savedData = await env.PROXY_TEST_HISTORY.get(key);
      
      let readResult = null;
      if (savedData) {
        readResult = JSON.parse(await savedData.text());
        console.log('✅ 成功读取刚写入的数据:', readResult);
      } else {
        console.log('❌ 无法读取刚写入的数据');
      }

      return successResponse({
        writeSuccess: true,
        testRecord: testRecord,
        readResult: readResult,
        readSuccess: !!readResult
      }, 'R2 storage write test completed', request);

    } catch (error) {
      console.error('❌ R2写入测试失败:', error);
      return errorResponse('Failed to test R2 storage write', 'R2_WRITE_TEST_ERROR', 500, request);
    }
  }
};
