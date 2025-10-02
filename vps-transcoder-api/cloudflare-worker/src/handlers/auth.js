/**
 * 认证相关处理器
 */

import { getUser, createSession, getSession, deleteSession } from '../utils/kv.js';
import { verifyPassword, generateSessionId } from '../utils/crypto.js';
import { errorResponse, successResponse } from '../utils/cors.js';
import { logAuthEvent, logError, logInfo } from '../utils/logger.js';

/**
 * 记录登录日志到KV存储
 */
async function recordLoginLog(env, username, request, success, details = {}) {
  try {
    // 获取客户端信息
    const clientIP = request.headers.get('CF-Connecting-IP') || 
                     request.headers.get('X-Forwarded-For') || 
                     request.headers.get('X-Real-IP') || 
                     '未知';
    
    const userAgent = request.headers.get('User-Agent') || '未知';
    const country = request.cf?.country || '未知';
    const city = request.cf?.city || '未知';
    
    // 创建登录日志条目
    const logEntry = {
      id: generateSessionId(), // 使用随机ID
      username: username || '未知',
      ip: clientIP,
      userAgent: userAgent,
      timestamp: new Date().toISOString(),
      status: success ? 'success' : 'failed',
      location: `${country} ${city}`,
      details: details
    };

    // 获取现有登录日志
    let loginLogs = [];
    try {
      const existingLogs = await env.YOYO_USER_DB.get('login_logs');
      if (existingLogs) {
        loginLogs = JSON.parse(existingLogs);
      }
    } catch (error) {
      console.warn('Failed to get existing login logs:', error);
    }

    // 添加新日志条目
    loginLogs.unshift(logEntry);
    
    // 保持最多1000条记录
    if (loginLogs.length > 1000) {
      loginLogs = loginLogs.slice(0, 1000);
    }

    // 保存到KV
    await env.YOYO_USER_DB.put('login_logs', JSON.stringify(loginLogs));
    
    console.log('Login log recorded:', { username, success, ip: clientIP });
  } catch (error) {
    console.error('Failed to record login log:', error);
    // 不抛出错误，避免影响登录流程
  }
}

/**
 * 从请求中提取会话ID（支持Authorization header、Cookie和查询参数）
 */
function getSessionIdFromRequest(request) {
  if (!request || !request.headers) {
    return null;
  }
  
  // 优先从Authorization header获取token
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // 从查询参数获取token（用于HLS文件请求）
  const url = new URL(request.url);
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) {
    return tokenFromQuery;
  }
  
  // 如果没有Authorization header和查询参数，则从Cookie获取
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {});

  return cookies.session || cookies.sessionId;
}

/**
 * 验证用户会话
 */
export async function validateSession(request, env) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    if (!sessionId) {
      return null;
    }

    const session = await getSession(env, sessionId);
    if (!session) {
      return null;
    }

    // 获取用户详细信息
    const user = await getUser(env, session.username);
    if (!user) {
      // 会话存在但用户不存在，删除无效会话
      await deleteSession(env, sessionId);
      return null;
    }

    return {
      session,
      user: {
        username: user.username,
        role: user.role,
        createdAt: user.createdAt
      }
    };
  } catch (error) {
    logError(env, 'Session validation failed', error);
    return null;
  }
}

/**
 * 需要认证的中间件
 */
export function requireAuth(handler, requiredRole = null) {
  return async (request, env, ctx) => {
    const auth = await validateSession(request, env);
    if (!auth) {
      return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
    }

    // 检查角色权限
    if (requiredRole && auth.user.role !== requiredRole && auth.user.role !== 'admin') {
      logAuthEvent(env, 'access_denied', auth.user.username, request, false, { requiredRole, userRole: auth.user.role });
      return errorResponse('Insufficient privileges', 'INSUFFICIENT_PRIVILEGES', 403, request);
    }

    // 将认证信息添加到请求中
    request.auth = auth;
    return await handler(request, env, ctx);
  };
}

/**
 * 用户登录
 */
export const handleAuth = {
  async login(request, env, ctx) {
    try {
      const startTime = Date.now();
      
      // 调试：记录请求信息
      console.log('=== LOGIN REQUEST DEBUG ===');
      console.log('Request object exists:', !!request);
      console.log('Method:', request?.method);
      console.log('URL:', request?.url);
      
      // 安全地获取headers信息
      if (request && request.headers) {
        try {
          console.log('Headers:', Object.fromEntries(request.headers.entries()));
        } catch (e) {
          console.log('Headers error:', e.message);
          console.log('Headers type:', typeof request.headers);
        }
      } else {
        console.log('Headers: undefined or missing');
      }

      // 解析请求数据
      let loginData;
      try {
        if (!request || typeof request.text !== 'function') {
          console.log('ERROR: Invalid request object');
          return errorResponse('Invalid request object', 'INVALID_REQUEST', 400, request);
        }
        
        const requestText = await request.text();
        console.log('Raw request body length:', requestText.length);
        console.log('Raw request body:', requestText);
        
        if (!requestText || requestText.trim() === '') {
          console.log('ERROR: Empty request body');
          return errorResponse('Empty request body', 'EMPTY_BODY', 400, request);
        }
        
        loginData = JSON.parse(requestText);
        console.log('Parsed login data:', loginData);
      } catch (error) {
        console.error('JSON parse error:', error.message);
        console.error('Error stack:', error.stack);
        return errorResponse('Invalid JSON in request body', 'INVALID_JSON', 400, request);
      }

      const { username, password } = loginData;

      // 验证输入
      if (!username || !password) {
        logAuthEvent(env, 'login_attempt', username || 'unknown', request, false, { reason: 'missing_credentials' });
        await recordLoginLog(env, username || 'unknown', request, false, { reason: 'missing_credentials' });
        return errorResponse('Username and password are required', 'MISSING_CREDENTIALS', 400, request);
      }

      // 获取用户数据
      const user = await getUser(env, username);
      if (!user) {
        logAuthEvent(env, 'login_attempt', username, request, false, { reason: 'user_not_found' });
        await recordLoginLog(env, username, request, false, { reason: 'user_not_found' });
        return errorResponse('Invalid username or password', 'INVALID_CREDENTIALS', 401, request);
      }

      // 验证密码
      const isValidPassword = await verifyPassword(password, user.salt, user.hashedPassword);
      if (!isValidPassword) {
        logAuthEvent(env, 'login_attempt', username, request, false, { reason: 'invalid_password' });
        await recordLoginLog(env, username, request, false, { reason: 'invalid_password' });
        return errorResponse('Invalid username or password', 'INVALID_CREDENTIALS', 401, request);
      }

      // 创建会话
      const sessionId = generateSessionId();
      const sessionTimeout = parseInt(env.SESSION_TIMEOUT) || 86400000; // 默认24小时
      const session = await createSession(env, sessionId, username, sessionTimeout);

      // 记录成功登录
      logAuthEvent(env, 'login_success', username, request, true, {
        sessionId,
        role: user.role,
        responseTime: Date.now() - startTime
      });
      
      // 记录登录日志到KV存储
      await recordLoginLog(env, username, request, true, {
        sessionId,
        role: user.role,
        responseTime: Date.now() - startTime
      });

      // 创建响应数据
      const responseData = {
        user: {
          username: user.username,
          role: user.role,
          createdAt: user.createdAt
        },
        session: {
          sessionId: session.sessionId,
          expiresAt: new Date(session.expiresAt).toISOString()
        },
        token: sessionId // 返回token供前端使用Authorization header
      };

      // 创建响应并设置Cookie
      const response = successResponse(responseData, 'Login successful', request);

      // 设置简化的Cookie（避免跨域问题）
      const cookieValue = `session=${sessionId}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionTimeout / 1000)}; Path=/`;
      response.headers.set('Set-Cookie', cookieValue);

      return response;

    } catch (error) {
      logError(env, 'Login handler error', error, { url: request.url });
      return errorResponse('Internal server error during login', 'LOGIN_ERROR', 500, request);
    }
  },

  async logout(request, env, ctx) {
    try {
      const sessionId = getSessionIdFromRequest(request);

      if (sessionId) {
        // 获取会话信息用于日志
        const session = await getSession(env, sessionId);
        const username = session?.username || 'unknown';

        // 删除会话
        await deleteSession(env, sessionId);

        // 记录登出事件
        logAuthEvent(env, 'logout', username, request, true, { sessionId });
      }

      // 创建响应并清除Cookie
      const response = successResponse(null, 'Logout successful', request);
      response.headers.set('Set-Cookie', 'session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/');

      return response;

    } catch (error) {
      logError(env, 'Logout handler error', error);
      return errorResponse('Internal server error during logout', 'LOGOUT_ERROR', 500, request);
    }
  },

  async getCurrentUser(request, env, ctx) {
    try {
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse('Authentication required', 'AUTH_REQUIRED', 401, request);
      }

      return successResponse({
        user: auth.user,
        session: {
          sessionId: auth.session.sessionId,
          expiresAt: new Date(auth.session.expiresAt).toISOString()
        }
      }, 'User information retrieved', request);

    } catch (error) {
      logError(env, 'Get current user handler error', error);
      return errorResponse('Internal server error', 'USER_INFO_ERROR', 500, request);
    }
  }
};
