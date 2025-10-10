const logger = require('../utils/logger');

// Cloudflare IP段列表（用于IP白名单验证）
const CLOUDFLARE_IP_RANGES = [
  '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '104.16.0.0/13',
  '104.24.0.0/14', '108.162.192.0/18', '131.0.72.0/22', '141.101.64.0/18',
  '162.158.0.0/15', '172.64.0.0/13', '173.245.48.0/20', '188.114.96.0/20',
  '190.93.240.0/20', '197.234.240.0/22', '198.41.128.0/17'
];

/**
 * 检查IP是否在CIDR范围内
 * @param {string} ip - 要检查的IP地址
 * @param {string} cidr - CIDR格式的IP范围
 * @returns {boolean} - 是否在范围内
 */
function isIpInRange(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - bits) - 1);
  return (ip2int(ip) & mask) === (ip2int(range) & mask);
}

/**
 * 将IP地址转换为整数
 * @param {string} ip - IP地址字符串
 * @returns {number} - IP地址对应的整数
 */
function ip2int(ip) {
  return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

/**
 * 验证IP是否为Cloudflare IP
 * @param {string} clientIp - 客户端IP
 * @returns {boolean} - 是否为Cloudflare IP
 */
function isCloudflareIp(clientIp) {
  // 如果禁用IP白名单验证，直接返回true
  if (process.env.ENABLE_IP_WHITELIST !== 'true') {
    return true;
  }

  // 本地开发环境跳过IP验证
  if (process.env.NODE_ENV === 'development' && 
      (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost')) {
    return true;
  }

  // 检查是否在Cloudflare IP范围内
  return CLOUDFLARE_IP_RANGES.some(range => isIpInRange(clientIp, range));
}

/**
 * API密钥认证中间件
 */
const authMiddleware = (req, res, next) => {
  try {
    // 获取API密钥
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      logger.warn('API request without API key', {
        ip: req.ip,
        path: req.path,
        userAgent: req.headers['user-agent']
      });

      return res.status(401).json({
        status: 'error',
        message: 'API key is required',
        code: 'MISSING_API_KEY'
      });
    }

    // 验证API密钥
    if (apiKey !== process.env.API_SECRET_KEY) {
      logger.warn('Invalid API key attempt', {
        ip: req.ip,
        path: req.path,
        providedKey: apiKey.substring(0, 8) + '...', // 只记录前8位用于调试
        userAgent: req.headers['user-agent']
      });

      return res.status(403).json({
        status: 'error',
        message: 'Invalid API key',
        code: 'INVALID_API_KEY'
      });
    }

    // 获取真实IP地址
    const clientIp = req.headers['cf-connecting-ip'] || 
                     req.headers['x-forwarded-for'] || 
                     req.connection.remoteAddress ||
                     req.ip;

    // 验证IP白名单（Cloudflare IP段）
    if (!isCloudflareIp(clientIp)) {
      logger.warn('Request from non-Cloudflare IP', {
        ip: clientIp,
        path: req.path,
        userAgent: req.headers['user-agent']
      });

      return res.status(403).json({
        status: 'error',
        message: 'Access denied',
        code: 'IP_NOT_ALLOWED'
      });
    }

    // 记录成功的认证
    logger.info('API request authenticated', {
      ip: clientIp,
      path: req.path,
      method: req.method
    });

    // 将客户端IP添加到请求对象中供后续使用
    req.clientIp = clientIp;

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during authentication',
      code: 'AUTH_ERROR'
    });
  }
};

module.exports = authMiddleware;
