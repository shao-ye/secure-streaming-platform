const express = require('express');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');
const CloudDriveService = require('../services/CloudDriveService');
const CloudDriveBrowseService = require('../services/cloud-drive/CloudDriveBrowseService');

const router = express.Router();
const cloudDriveService = new CloudDriveService();

/**
 * 云盘目录浏览服务（进程级单例）
 * 复用 CloudDriveService 的 state.json 会话；首次调用 browse 时懒启动 Playwright。
 * headless 默认 true，可通过 CLOUD_DRIVE_BROWSE_HEADLESS=false 覆盖便于本地排障。
 */
const cloudDriveBrowseService = new CloudDriveBrowseService({
  cloudDriveService,
  headless: process.env.CLOUD_DRIVE_BROWSE_HEADLESS !== 'false'
});

/**
 * 进程退出时释放 Playwright 浏览器资源，避免子进程残留
 */
['SIGINT', 'SIGTERM', 'beforeExit'].forEach((signal) => {
  process.once(signal, () => {
    cloudDriveBrowseService.dispose().catch((error) => {
      logger.warn('释放云盘浏览服务资源失败', { error: error.message });
    });
  });
});

/**
 * 把底层 browseService 的异常映射为 HTTP 响应
 * - 未登录 → 401 + NOT_LOGGED_IN
 * - 其他 → 500
 * @param {import('express').Response} res
 * @param {Error} error
 * @param {string} fallbackMessage 用于日志的描述
 */
function respondBrowseError(res, error, fallbackMessage) {
  logger.error(fallbackMessage, { error: error.message });
  // 识别“尚未登录”这种前置条件错误，给前端明确 code 以便跳转登录
  if (/尚未登录|请先完成短信验证码登录/.test(error.message)) {
    return res.status(401).json({
      status: 'error',
      code: 'CLOUD_DRIVE_NOT_LOGGED_IN',
      message: error.message
    });
  }
  return res.status(500).json({
    status: 'error',
    message: error.message
  });
}

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

/**
 * GET /api/cloud-drive/browse/personal
 * 浏览个人网盘目录
 * 查询参数：
 *   - parentFileId: 父目录 fileId，缺省为 "/" 根目录
 *   - pageSize: 分页大小，范围 10~100，默认 50
 *   - pageCursor: 分页游标（由上次响应返回的 nextCursor）
 */
router.get('/browse/personal', async (req, res) => {
  try {
    // 原样透传 parentFileId，139 端会自己校验合法性
    const parentFileId = typeof req.query.parentFileId === 'string' && req.query.parentFileId
      ? req.query.parentFileId
      : '/';
    // 把 pageSize 夹到 139 服务端允许的 [10, 100] 范围内，避免 04000002 错误
    const rawPageSize = Number.parseInt(req.query.pageSize, 10);
    const pageSize = Number.isFinite(rawPageSize)
      ? Math.max(10, Math.min(100, rawPageSize))
      : 50;
    const pageCursor = typeof req.query.pageCursor === 'string' && req.query.pageCursor
      ? req.query.pageCursor
      : null;

    const result = await cloudDriveBrowseService.browsePersonal({ parentFileId, pageSize, pageCursor });
    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    respondBrowseError(res, error, '浏览云盘个人网盘失败');
  }
});

/**
 * GET /api/cloud-drive/browse/family
 * 列出当前账号所属的家庭列表
 * 无额外参数
 */
router.get('/browse/family', async (req, res) => {
  try {
    const result = await cloudDriveBrowseService.browseFamily();
    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    respondBrowseError(res, error, '浏览云盘家庭列表失败');
  }
});

/**
 * GET /api/cloud-drive/browse/family-albums
 * 列出指定家庭下的相册
 * 查询参数：
 *   - cloudId: 家庭云 ID（必填）
 */
router.get('/browse/family-albums', async (req, res) => {
  try {
    const cloudId = typeof req.query.cloudId === 'string' ? req.query.cloudId.trim() : '';
    if (!cloudId) {
      return res.status(400).json({
        status: 'error',
        message: '缺少 cloudId 参数'
      });
    }
    const result = await cloudDriveBrowseService.browseFamilyAlbums({ cloudId });
    res.status(200).json({ status: 'success', data: result });
  } catch (error) {
    respondBrowseError(res, error, '浏览云盘家庭相册失败');
  }
});

module.exports = router;
