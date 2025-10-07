/**
 * JWT Token管理器 - 专门用于视频观看认证
 * 基于Web Crypto API，简单可靠，无外部依赖
 */
export class JWTManager {
  constructor(secret = 'yoyo-video-jwt-2025-secure-key') {
    this.secret = secret;
    this.algorithm = 'HS256';
  }

  /**
   * 生成视频观看JWT Token
   * @param {Object} payload - 用户信息
   * @param {number} expiresInHours - 过期时间（小时）
   * @returns {string} JWT Token
   */
  async generateVideoToken(payload, expiresInHours = 24) {
    const header = {
      alg: this.algorithm,
      typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = {
      sub: payload.username,        // 主题（用户名）
      role: payload.role,           // 用户角色
      iat: now,                     // 签发时间
      exp: now + (expiresInHours * 3600), // 过期时间
      aud: 'yoyo-video-streaming',  // 受众
      iss: 'yoyo-platform',         // 签发者
      purpose: 'video-watch'        // Token用途
    };

    // 使用简单可靠的编码方式
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(tokenPayload));
    
    const message = `${encodedHeader}.${encodedPayload}`;
    const signature = await this.signMessage(message);

    return `${message}.${signature}`;
  }

  /**
   * 验证JWT Token
   * @param {string} token - JWT Token
   * @returns {Object} 验证结果
   */
  async verifyToken(token) {
    try {
      if (!token || typeof token !== 'string') {
        return { valid: false, error: 'Invalid token format' };
      }

      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token structure' };
      }

      const [encodedHeader, encodedPayload, providedSignature] = parts;

      // 验证签名
      const message = `${encodedHeader}.${encodedPayload}`;
      const expectedSignature = await this.signMessage(message);

      if (providedSignature !== expectedSignature) {
        return { valid: false, error: 'Invalid signature' };
      }

      // 解码和验证payload
      const payload = JSON.parse(this.base64UrlDecode(encodedPayload));
      const now = Math.floor(Date.now() / 1000);

      // 检查过期时间
      if (payload.exp && now > payload.exp) {
        return { valid: false, error: 'Token expired', expired: true };
      }

      // 检查Token用途
      if (payload.purpose !== 'video-watch') {
        return { valid: false, error: 'Invalid token purpose' };
      }

      return {
        valid: true,
        payload: payload,
        user: {
          username: payload.sub,
          role: payload.role
        }
      };

    } catch (error) {
      return { valid: false, error: `Token verification failed: ${error.message}` };
    }
  }

  /**
   * Base64 URL编码（避免btoa问题）
   */
  base64UrlEncode(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    
    // 手动实现base64url编码，避免btoa问题
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = bytes[i + 1] || 0;
      const c = bytes[i + 2] || 0;
      
      const bitmap = (a << 16) | (b << 8) | c;
      
      result += chars.charAt((bitmap >> 18) & 63);
      result += chars.charAt((bitmap >> 12) & 63);
      result += i + 1 < bytes.length ? chars.charAt((bitmap >> 6) & 63) : '';
      result += i + 2 < bytes.length ? chars.charAt(bitmap & 63) : '';
    }
    
    return result;
  }

  /**
   * Base64 URL解码（简化版本）
   */
  base64UrlDecode(str) {
    // 补齐padding
    str += '='.repeat((4 - str.length % 4) % 4);
    // 替换URL安全字符
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

  /**
   * 使用HMAC-SHA256签名消息
   */
  async signMessage(message) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const signatureArray = new Uint8Array(signature);
    
    // 直接转换为base64url，避免btoa问题
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    
    for (let i = 0; i < signatureArray.length; i += 3) {
      const a = signatureArray[i];
      const b = signatureArray[i + 1] || 0;
      const c = signatureArray[i + 2] || 0;
      
      const bitmap = (a << 16) | (b << 8) | c;
      
      result += chars.charAt((bitmap >> 18) & 63);
      result += chars.charAt((bitmap >> 12) & 63);
      result += i + 1 < signatureArray.length ? chars.charAt((bitmap >> 6) & 63) : '';
      result += i + 2 < signatureArray.length ? chars.charAt(bitmap & 63) : '';
    }
    
    return result;
  }
}

// 全局实例
let globalJWTManager = null;

/**
 * 获取全局JWT管理器实例
 */
export function getJWTManager() {
  if (!globalJWTManager) {
    globalJWTManager = new JWTManager();
  }
  return globalJWTManager;
}

/**
 * HLS请求JWT验证函数（零KV读取）
 */
export async function validateHLSWithJWT(request, streamId = null) {
  try {
    // 从请求中提取JWT Token
    const token = extractJWTFromRequest(request);
    if (!token) {
      return { valid: false, error: 'No JWT token provided' };
    }

    // 验证JWT Token（纯计算，无IO操作）
    const jwtManager = getJWTManager();
    const result = await jwtManager.verifyToken(token);
    
    if (!result.valid) {
      return result;
    }

    console.log(`🎯 JWT验证成功 (零KV读取): ${result.user.username} - ${streamId || 'any'}`);
    
    return {
      valid: true,
      user: result.user,
      auth: {
        user: result.user,
        session: {
          sessionId: 'jwt-based',
          expiresAt: new Date(result.payload.exp * 1000).toISOString()
        }
      }
    };

  } catch (error) {
    console.error('HLS JWT validation error:', error);
    return { valid: false, error: `Validation failed: ${error.message}` };
  }
}

/**
 * 从请求中提取JWT Token
 */
function extractJWTFromRequest(request) {
  // 1. 从Authorization header获取
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // 2. 从查询参数获取（HLS请求主要方式）
  const url = new URL(request.url);
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) {
    return tokenFromQuery;
  }
  
  // 3. 从Cookie获取（备用方式）
  const cookieHeader = request.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {});
    
    return cookies.videoToken || cookies.jwt;
  }
  
  return null;
}
