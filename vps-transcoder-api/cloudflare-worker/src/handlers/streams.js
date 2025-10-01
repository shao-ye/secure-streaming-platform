/**
 * 流媒体相关处理器
 */

import { getStreamsConfig, getStreamConfig } from '../utils/kv.js';
import { validateSession } from './auth.js';
import { errorResponse, successResponse } from '../utils/cors.js';
import { logStreamEvent, logError, logInfo } from '../utils/logger.js';

/**
 * 调用VPS转码API
 */
async function callTranscoderAPI(env, endpoint, method = 'GET', data = null) {
  try {
    const vpsApiUrl = env.VPS_API_URL || 'https://yoyo-vps.5202021.xyz';
    const apiKey = env.VPS_API_KEY;

    if (!apiKey) {
      throw new Error('VPS API key not configured');
    }

    const url = `${vpsApiUrl}/api/${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'User-Agent': 'Cloudflare-Worker/1.0'
      }
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    logInfo(env, 'Calling VPS transcoder API', {
      url,
      method,
      endpoint,
      hasData: !!data
    });

    const response = await fetch(url, options);
    const responseText = await response.text();

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Invalid JSON response from VPS API: ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(`VPS API error (${response.status}): ${responseData.message || responseText}`);
    }

    logInfo(env, 'VPS transcoder API call successful', {
      endpoint,
      method,
      status: response.status,
      responseStatus: responseData.status
    });

    return responseData;

  } catch (error) {
    logError(env, 'VPS transcoder API call failed', error, { endpoint, method });
    throw error;
  }
}

/**
 * 检查VPS服务器连通性
 */
async function checkVpsHealth(env) {
  try {
    const vpsApiUrl = env.VPS_API_URL || 'https://yoyo-vps.5202021.xyz';
    const apiKey = env.VPS_API_KEY;

    if (!apiKey) {
      return { available: false, error: 'VPS API key not configured' };
    }

    const response = await fetch(`${vpsApiUrl}/health`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'User-Agent': 'Cloudflare-Worker-Health/1.0'
      },
      signal: AbortSignal.timeout(5000) // 5秒超时
    });

    if (response.ok) {
      const data = await response.json();
      return { available: true, data };
    } else {
      return { available: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { available: false, error: error.message };
  }
}

export const handleStreams = {
  /**
   * 获取所有可用的流列表（用户视图）
   */
  async getStreams(request, env, ctx) {
    try {
      // 验证用户认证
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      // 获取流配置
      const streamsConfig = await getStreamsConfig(env);

      // 按排序字段排序，然后只返回用户需要的信息（隐藏敏感的RTMP URL）
      const sortedStreams = streamsConfig.sort((a, b) => {
        const orderA = a.sortOrder || 0;
        const orderB = b.sortOrder || 0;
        return orderA - orderB;
      });

      const publicStreams = sortedStreams.map(stream => ({
        id: stream.id,
        name: stream.name,
        createdAt: stream.createdAt,
        sortOrder: stream.sortOrder || 0
      }));

      logInfo(env, 'Streams list retrieved', {
        username: auth.user.username,
        streamsCount: publicStreams.length
      });

      return successResponse({
        streams: publicStreams,
        count: publicStreams.length
      }, 'Streams retrieved successfully', request);

    } catch (error) {
      logError(env, 'Get streams handler error', error);
      return errorResponse('Failed to retrieve streams', 'STREAMS_ERROR', 500, request);
    }
  },

  /**
   * 请求播放指定流
   */
  async playStream(request, env, ctx) {
    try {
      const startTime = Date.now();

      // 验证用户认证
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse('Stream ID is required', 'MISSING_STREAM_ID', 400, request);
      }

      // 获取流配置
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, 'STREAM_NOT_FOUND', 404, request);
      }

      logStreamEvent(env, 'play_request', streamId, auth.user.username, request);

      try {
        // 检查VPS服务器连通性
        const vpsHealth = await checkVpsHealth(env);
        if (!vpsHealth.available) {
          return errorResponse('VPS server is not available', 'VPS_UNAVAILABLE', 503, request);
        }

        // 调用VPS API启动转码
        const transcoderResponse = await callTranscoderAPI(env, 'start-stream', 'POST', {
          streamId: streamConfig.id,
          rtmpUrl: streamConfig.rtmpUrl
        });

        const responseTime = Date.now() - startTime;

        logStreamEvent(env, 'play_success', streamId, auth.user.username, request, {
          responseTime: `${responseTime}ms`,
          processId: transcoderResponse.data?.processId
        });

        // 返回HLS播放地址（修复文件名匹配问题）
        const hlsUrl = `/hls/${streamId}/playlist.m3u8`;

        return successResponse({
          streamId,
          streamName: streamConfig.name,
          hlsUrl,
          transcoderInfo: {
            processId: transcoderResponse.data?.processId,
            status: transcoderResponse.status
          },
          responseTime
        }, `Stream '${streamConfig.name}' started successfully`, request);

      } catch (transcoderError) {
        logStreamEvent(env, 'play_failed', streamId, auth.user.username, request, {
          error: transcoderError.message,
          responseTime: Date.now() - startTime
        });

        // 根据错误类型返回相应的错误信息
        if (transcoderError.message.includes('timeout')) {
          return errorResponse(
            'Stream startup timeout. Please try again.',
            'STREAM_TIMEOUT',
            504,
            request
          );
        } else if (transcoderError.message.includes('Connection')) {
          return errorResponse(
            'Unable to connect to stream source. Please check the stream configuration.',
            'STREAM_CONNECTION_ERROR',
            502,
            request
          );
        } else {
          return errorResponse(
            `Failed to start stream: ${transcoderError.message}`,
            'STREAM_START_ERROR',
            500,
            request
          );
        }
      }

    } catch (error) {
      logError(env, 'Play stream handler error', error, { streamId: request.params?.id });
      return errorResponse('Failed to start stream playback', 'PLAY_ERROR', 500, request);
    }
  },

  /**
   * 停止指定流（可选功能）
   */
  async stopStream(request, env, ctx) {
    try {
      // 验证用户认证
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse('Stream ID is required', 'MISSING_STREAM_ID', 400, request);
      }

      // 检查流是否存在
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, 'STREAM_NOT_FOUND', 404, request);
      }

      logStreamEvent(env, 'stop_request', streamId, auth.user.username, request);

      try {
        // 检查VPS服务器连通性
        const vpsHealth = await checkVpsHealth(env);
        if (!vpsHealth.available) {
          return errorResponse('VPS server is not available', 'VPS_UNAVAILABLE', 503, request);
        }

        // 调用VPS API停止转码
        const transcoderResponse = await callTranscoderAPI(env, 'stop-stream', 'POST', {
          streamId: streamId
        });

        logStreamEvent(env, 'stop_success', streamId, auth.user.username, request, {
          processId: transcoderResponse.data?.processId
        });

        return successResponse({
          streamId,
          streamName: streamConfig.name,
          transcoderInfo: {
            processId: transcoderResponse.data?.processId,
            status: transcoderResponse.status
          }
        }, `Stream '${streamConfig.name}' stopped successfully`, request);

      } catch (transcoderError) {
        logStreamEvent(env, 'stop_failed', streamId, auth.user.username, request, {
          error: transcoderError.message
        });

        return errorResponse(
          `Failed to stop stream: ${transcoderError.message}`,
          'STREAM_STOP_ERROR',
          500,
          request
        );
      }

    } catch (error) {
      logError(env, 'Stop stream handler error', error, { streamId: request.params?.id });
      return errorResponse('Failed to stop stream', 'STOP_ERROR', 500, request);
    }
  }
};
