/**
 * HLS代理处理器
 */

import { validateSession } from './auth.js';
import { validateSessionWithCache } from '../utils/session-cache.js';
import { validateHLSWithJWT } from '../utils/jwt-manager.js';
import { getStreamConfig } from '../utils/kv.js';
import { errorResponse } from '../utils/cors.js';
import { logError, logInfo } from '../utils/logger.js';
import { TunnelRouter } from '../utils/tunnel-router.js';

/**
 * 缓存控制头设置
 */
const CACHE_HEADERS = {
  m3u8: {
    'Cache-Control': 'public, max-age=1, must-revalidate', // 1秒缓存，强制重新验证
    'Pragma': 'no-cache',
    'Expires': new Date(Date.now() + 1000).toUTCString()
  },
  ts: {
    'Cache-Control': 'public, max-age=60, immutable', // 1分钟缓存，TS分片不变
    'Expires': new Date(Date.now() + 60000).toUTCString()
  }
};

export const handleProxy = {
  /**
   * 代理HLS文件请求到VPS服务器
   */
  async hlsFile(request, env, ctx) {
    try {
      const startTime = Date.now();

      const { streamId, file } = request.params;

      if (!streamId || !file) {
        return errorResponse('Stream ID and file name are required', 'MISSING_PARAMS', 400, request);
      }

      // 🎯 简化视频Token验证，避免KV读取
      let auth = null;
      
      // 尝试从请求中获取视频Token
      const url = new URL(request.url);
      const videoToken = url.searchParams.get('token');
      
      if (videoToken) {
        try {
          // 简单Base64解码验证
          const tokenData = JSON.parse(atob(videoToken));
          
          // 检查Token是否过期
          if (tokenData.exp && Date.now() < tokenData.exp) {
            // Token有效，构造认证信息（零KV读取）
            auth = {
              user: {
                username: tokenData.username,
                role: tokenData.role
              },
              session: {
                sessionId: tokenData.sessionId,
                expiresAt: new Date(tokenData.exp).toISOString()
              }
            };
            console.log(`✅ 视频Token验证成功 (零KV读取): ${auth.user.username}`);
          } else {
            console.log('⚠️ 视频Token已过期，降级到会话验证');
          }
        } catch (error) {
          console.log('⚠️ 视频Token解析失败，降级到会话验证:', error.message);
        }
      }
      
      // 如果视频Token验证失败，降级到会话缓存验证
      if (!auth) {
        auth = await validateSessionWithCache(request, env);
        if (!auth) {
          return errorResponse('Authentication required to access streams', 'AUTH_REQUIRED', 401, request);
        }
        console.log(`✅ 会话验证成功 (KV缓存): ${auth.user.username}`);
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

      // 🚀 使用隧道路由构建VPS URL，支持地理路由
      const { url: hlsFileUrl, routing } = await TunnelRouter.buildVPSUrl(env, `/hls/${streamId}/${file}`, 'HLS', request);
      
      console.log(`🌐 HLS代理路由: ${routing.type} - ${routing.reason}`);

      try {
        // 代理请求到VPS (带故障转移)
        let vpsResponse;
        try {
          vpsResponse = await fetch(hlsFileUrl, {
            method: request.method,
            headers: {
              'User-Agent': 'YOYO-Tunnel-Proxy/1.0',
              'Accept': request.headers.get('Accept') || '*/*',
              'Accept-Encoding': request.headers.get('Accept-Encoding') || 'gzip, deflate',
              'Range': request.headers.get('Range'),
              'X-Route-Type': routing.type,
              'X-Tunnel-Optimized': routing.type === 'tunnel' ? 'true' : 'false'
            },
            // 设置超时
            signal: AbortSignal.timeout(10000) // 10秒超时
          });
        } catch (error) {
          // 故障转移到直连
          console.warn(`⚠️ 主路由失败，切换直连: ${error.message}`);
          const directRouting = TunnelRouter.getDirectEndpoints();
          const directUrl = `${directRouting.endpoints.HLS}/hls/${streamId}/${file}`;
          
          vpsResponse = await fetch(directUrl, {
            method: request.method,
            headers: {
              'User-Agent': 'YOYO-Fallback-Proxy/1.0',
              'Accept': request.headers.get('Accept') || '*/*',
              'Accept-Encoding': request.headers.get('Accept-Encoding') || 'gzip, deflate',
              'Range': request.headers.get('Range'),
              'X-Route-Type': 'direct-fallback',
              'X-Failover': 'true'
            },
            signal: AbortSignal.timeout(10000)
          });
        }

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
        let needsFallback = false;

        // 🔥 智能内容验证 - 检测隧道是否返回了错误内容
        if (fileExtension === 'm3u8') {
          const m3u8Content = new TextDecoder().decode(responseBody);
          
          // 检查是否为有效的M3U8内容
          if (!m3u8Content.includes('#EXTM3U') || m3u8Content.includes('<!doctype html>')) {
            console.warn(`⚠️ 隧道返回无效M3U8内容，触发故障转移`);
            needsFallback = true;
          } else {
            // 🕒 时间戳一致性检查
            const sequenceMatch = m3u8Content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
            if (sequenceMatch) {
              const currentSequence = parseInt(sequenceMatch[1]);
              console.log(`📺 M3U8分片序列: ${currentSequence}, 路由: ${routing.type}`);
            }
            
            // 有效的M3U8内容，添加token参数
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
        } else if (fileExtension === 'ts') {
          // 🔥 检测TS分片文件是否有效
          const contentType = vpsResponse.headers.get('Content-Type');
          
          // TS文件应该是二进制内容，如果返回HTML则说明隧道有问题
          if (contentType && contentType.includes('text/html')) {
            console.warn(`⚠️ 隧道返回HTML而不是TS分片，触发故障转移`);
            needsFallback = true;
          } else {
            // 检查内容是否以HTML开头（额外验证）
            const firstBytes = new TextDecoder().decode(responseBody.slice(0, 100));
            if (firstBytes.includes('<!doctype html>') || firstBytes.includes('<html')) {
              console.warn(`⚠️ 隧道返回HTML内容而不是TS分片，触发故障转移`);
              needsFallback = true;
            }
          }
        }

        // 🚀 智能故障转移 - 如果内容无效，切换到直连
        if (needsFallback && routing.type === 'tunnel') {
          console.log(`🔄 执行智能故障转移: 隧道内容无效，切换直连`);
          
          try {
            const directRouting = TunnelRouter.getDirectEndpoints();
            const directUrl = `${directRouting.endpoints.HLS}/hls/${streamId}/${file}`;
            
            const fallbackResponse = await fetch(directUrl, {
              method: request.method,
              headers: {
                'User-Agent': 'YOYO-Smart-Fallback/1.0',
                'Accept': request.headers.get('Accept') || '*/*',
                'Accept-Encoding': request.headers.get('Accept-Encoding') || 'gzip, deflate',
                'Range': request.headers.get('Range'),
                'X-Route-Type': 'smart-fallback',
                'X-Fallback-Reason': 'invalid-content'
              },
              signal: AbortSignal.timeout(10000)
            });

            if (fallbackResponse.ok) {
              responseBody = await fallbackResponse.arrayBuffer();
              
              // 重新处理M3U8内容
              if (fileExtension === 'm3u8') {
                const m3u8Content = new TextDecoder().decode(responseBody);
                const url = new URL(request.url);
                const token = url.searchParams.get('token');
                
                if (token && m3u8Content.includes('#EXTM3U')) {
                  const modifiedContent = m3u8Content.replace(
                    /^([^#\n\r]+\.ts)$/gm,
                    `$1?token=${token}`
                  );
                  responseBody = new TextEncoder().encode(modifiedContent);
                }
              }
              
              // 更新路由信息
              routing.type = 'smart-fallback';
              routing.reason = '智能故障转移: 隧道内容无效';
              vpsResponse = fallbackResponse;
              console.log(`✅ 智能故障转移成功`);
            }
          } catch (fallbackError) {
            console.error(`❌ 智能故障转移失败: ${fallbackError.message}`);
            // 继续使用原始响应，让上层处理错误
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
          'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Encoding, Content-Length, Content-Range, X-Route-Via, X-Tunnel-Optimized, X-Response-Time, X-Country, X-Route-Reason, X-File-Type',
          // 隧道优化信息 - 增强版
          'X-Route-Via': routing.type,
          'X-Tunnel-Optimized': routing.type === 'tunnel' ? 'true' : 'false',
          'X-Response-Time': `${Date.now() - startTime}ms`,
          'X-Country': request.cf?.country || 'unknown',
          'X-Route-Reason': routing.reason || 'no reason provided',
          'X-File-Type': fileExtension,
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
