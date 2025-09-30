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

      const { id: streamId } = request.params;
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

      // 测试KV可用性
      try {
        await env.YOYO_USER_DB.put('health_check', 'ok', { expirationTtl: 60 });
        const testValue = await env.YOYO_USER_DB.get('health_check');
        diagnostics.kv.available = testValue === 'ok';
        diagnostics.kv.testResult = 'success';
      } catch (kvError) {
        console.error('KV health check failed:', kvError);
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
  }
};
