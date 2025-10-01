/**
 * HLS代理处理器
 */

import { validateSession } from './auth.js';
import { getStreamConfig } from '../utils/kv.js';
import { errorResponse } from '../utils/cors.js';
import { logError, logInfo } from '../utils/logger.js';

/**
 * 缓存控制头设置
 */
const CACHE_HEADERS = {
  m3u8: {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  },
  ts: {
    'Cache-Control': 'public, max-age=3600',
    'Expires': new Date(Date.now() + 3600000).toUTCString()
  }
};

export const handleProxy = {
  /**
   * 代理HLS文件请求到VPS服务器
   */
  async hlsFile(request, env, ctx) {
    try {
      const startTime = Date.now();

      // 验证用户认证
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required to access streams', 'AUTH_REQUIRED', 401, request);
      }

      const { streamId, file } = request.params;

      if (!streamId || !file) {
        return errorResponse('Stream ID and file name are required', 'MISSING_PARAMS', 400, request);
      }

      // 验证流是否存在于配置中
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, 'STREAM_NOT_FOUND', 404, request);
      }

      // 验证文件类型（安全检查）
      const fileExtension = file.split('.').pop()?.toLowerCase();
      if (!['m3u8', 'ts'].includes(fileExtension)) {
        return errorResponse('Invalid file type', 'INVALID_FILE_TYPE', 400, request);
      }

      // 构建VPS上的HLS文件URL（修复端口和域名配置）
      const vpsBaseUrl = env.VPS_HLS_URL || 'https://yoyo-vps.5202021.xyz';
      const hlsFileUrl = `${vpsBaseUrl}/hls/${streamId}/${file}`;

      try {
        // 代理请求到VPS
        const vpsResponse = await fetch(hlsFileUrl, {
          method: request.method,
          headers: {
            'User-Agent': 'Cloudflare-Worker-HLS-Proxy/1.0',
            'Accept': request.headers.get('Accept') || '*/*',
            'Accept-Encoding': request.headers.get('Accept-Encoding') || 'gzip, deflate',
            'Range': request.headers.get('Range') // 支持Range请求
          },
          // 设置超时
          signal: AbortSignal.timeout(10000) // 10秒超时
        });

        if (!vpsResponse.ok) {
          // 如果是404，可能是文件还没生成，返回更友好的错误
          if (vpsResponse.status === 404) {
            return new Response('Stream file not available yet. Please try again in a moment.', {
              status: 202, // 202 Accepted - 表示正在处理
              headers: {
                'Content-Type': 'text/plain',
                'Retry-After': '2' // 建议2秒后重试
              }
            });
          }

          return new Response(`Upstream server error: ${vpsResponse.status}`, {
            status: vpsResponse.status,
            headers: {
              'Content-Type': 'text/plain'
            }
          });
        }

        // 获取响应内容
        let responseBody = await vpsResponse.arrayBuffer();

        // 如果是m3u8文件，需要修改其中的片段URL以包含认证token
        if (fileExtension === 'm3u8') {
          const m3u8Content = new TextDecoder().decode(responseBody);
          const url = new URL(request.url);
          const token = url.searchParams.get('token');
          
          if (token) {
            // 修改m3u8内容，为所有.ts片段URL添加token参数
            const modifiedContent = m3u8Content.replace(
              /^([^#\n\r]+\.ts)$/gm,
              `$1?token=${token}`
            );
            responseBody = new TextEncoder().encode(modifiedContent);
          }
        }

        // 准备响应头
        const responseHeaders = {
          'Content-Type': vpsResponse.headers.get('Content-Type') || 
                          (fileExtension === 'm3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t'),
          'Content-Length': responseBody.byteLength.toString(),
          'Last-Modified': vpsResponse.headers.get('Last-Modified'),
          'ETag': vpsResponse.headers.get('ETag'),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Accept-Encoding',
          'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Encoding, Content-Length, Content-Range',
          // 根据文件类型设置缓存策略
          ...CACHE_HEADERS[fileExtension]
        };

        // 移除空值
        Object.keys(responseHeaders).forEach(key => {
          if (responseHeaders[key] === null || responseHeaders[key] === undefined) {
            delete responseHeaders[key];
          }
        });

        // 支持Range请求（对于.ts文件）
        if (request.headers.get('Range') && vpsResponse.headers.get('Content-Range')) {
          responseHeaders['Content-Range'] = vpsResponse.headers.get('Content-Range');
          responseHeaders['Accept-Ranges'] = 'bytes';
        }

        const responseTime = Date.now() - startTime;

        // 记录成功的代理请求（仅对m3u8文件，减少日志量）
        if (fileExtension === 'm3u8') {
          logInfo(env, 'HLS file proxied successfully', {
            streamId,
            file,
            username: auth.user.username,
            responseTime: `${responseTime}ms`,
            fileSize: responseBody.byteLength,
            clientIp: request.headers.get('CF-Connecting-IP')
          });
        }

        return new Response(responseBody, {
          status: vpsResponse.status,
          headers: responseHeaders
        });

      } catch (fetchError) {
        logError(env, 'HLS file proxy fetch error', fetchError, {
          streamId,
          file,
          username: auth.user.username,
          hlsFileUrl,
          responseTime: Date.now() - startTime
        });

        if (fetchError.name === 'TimeoutError') {
          return new Response('Stream server timeout. Please try again.', {
            status: 504,
            headers: {
              'Content-Type': 'text/plain',
              'Retry-After': '5'
            }
          });
        }

        return new Response('Failed to fetch stream data from server', {
          status: 502,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      }

    } catch (error) {
      logError(env, 'HLS proxy handler error', error, {
        streamId: request.params?.streamId,
        file: request.params?.file,
        url: request.url
      });

      return errorResponse('Internal server error during stream proxy', 'PROXY_ERROR', 500, request);
    }
  }
};
