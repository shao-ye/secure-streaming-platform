const express = require('express');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');
const CloudDriveService = require('../services/CloudDriveService');

const router = express.Router();
const cloudDriveService = new CloudDriveService();

/**
 * 中国移动云盘路由
 * 当前阶段主要提供配置页所需的状态查询、短信登录与手动路径校验能力。
 */
router.use(authMiddleware);

/**
 * GET /api/cloud-drive/auth-status
 * 获取当前云盘认证状态。
 */
router.get('/auth-status', (req, res) => {
  try {
    const result = cloudDriveService.getAuthStatus();
    res.status(200).json(result);
  } catch (error) {
    logger.error('获取云盘状态失败', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * POST /api/cloud-drive/send-sms
 * 请求发送短信验证码。
 */
router.post('/send-sms', async (req, res) => {
  try {
    const result = await cloudDriveService.sendSms(req.body || {});
    res.status(result.statusCode).json(result.payload);
  } catch (error) {
    logger.error('请求发送短信验证码失败', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * POST /api/cloud-drive/login/validate
 * 执行云盘登录验证。
 */
router.post('/login/validate', async (req, res) => {
  try {
    const result = await cloudDriveService.validateLogin(req.body || {});
    res.status(result.statusCode).json(result.payload);
  } catch (error) {
    logger.error('执行云盘登录验证失败', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * POST /api/cloud-drive/validate-target
 * 校验上传目标配置。
 */
router.post('/validate-target', (req, res) => {
  try {
    const result = cloudDriveService.validateTarget(req.body || {});
    res.status(result.statusCode).json(result.payload);
  } catch (error) {
    logger.error('校验云盘上传目标失败', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

module.exports = router;
