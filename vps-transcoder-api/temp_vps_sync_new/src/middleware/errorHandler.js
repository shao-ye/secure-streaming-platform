const logger = require('../utils/logger');

/**
 * 全局错误处理中间件
 */
const errorHandler = (err, req, res, next) => {
  // 记录错误
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.clientIp || req.ip,
    userAgent: req.headers['user-agent']
  });

  // 根据错误类型返回适当的响应
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error';
    code = 'VALIDATION_ERROR';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid data format';
    code = 'INVALID_FORMAT';
  } else if (err.code === 'ENOENT') {
    statusCode = 404;
    message = 'Resource not found';
    code = 'NOT_FOUND';
  } else if (err.code === 'EACCES') {
    statusCode = 403;
    message = 'Permission denied';
    code = 'PERMISSION_DENIED';
  }

  // 在开发环境中包含更多调试信息
  const response = {
    status: 'error',
    message,
    code,
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development') {
    response.debug = {
      stack: err.stack,
      originalError: err.message
    };
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
