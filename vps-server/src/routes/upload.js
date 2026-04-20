const express = require('express');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * 录制文件上传相关 API
 *
 * 路由列表：
 *   POST /api/upload/enqueue        手动入队（测试/运维）
 *   GET  /api/upload/queue-status   查看队列 + Worker 状态
 *   POST /api/upload/worker/resume  登录恢复后手动让 Worker 继续消费
 *
 * 依赖：
 *   app.locals.uploadQueue   UploadQueueService 实例（app.js 启动时挂载）
 *   app.locals.uploadWorker  CloudUploadWorker 实例（app.js 启动时挂载）
 */
const router = express.Router();
router.use(authMiddleware);

/**
 * 从 req.app.locals 读取 Queue 实例，未挂载时返回 null
 * @param {import('express').Request} req
 */
function getQueue(req) {
  return req.app.locals.uploadQueue || null;
}

/**
 * 从 req.app.locals 读取 Worker 实例，未挂载时返回 null
 * @param {import('express').Request} req
 */
function getWorker(req) {
  return req.app.locals.uploadWorker || null;
}

/**
 * 校验 enqueue 请求体
 *
 * body 必需字段：
 *   filePath    上传目标的本地绝对路径
 *   channelId   来源频道标识
 *   uploadConfig.destinationType  仅支持 'familyAlbum'
 *   uploadConfig.groupId
 *   uploadConfig.albumId
 *
 * @param {Object} body
 * @returns {{ok: boolean, message?: string, task?: Object}}
 */
function validateEnqueuePayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'body 必须为 JSON 对象' };
  }
  const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const cfg = body.uploadConfig || {};
  if (!filePath) return { ok: false, message: 'filePath 必填' };
  if (!channelId) return { ok: false, message: 'channelId 必填' };
  if (cfg.destinationType !== 'familyAlbum') {
    return { ok: false, message: '当前仅支持 destinationType=familyAlbum' };
  }
  const groupId = typeof cfg.groupId === 'string' ? cfg.groupId.trim() : '';
  const albumId = typeof cfg.albumId === 'string' ? cfg.albumId.trim() : '';
  if (!groupId || !albumId) {
    return { ok: false, message: '家庭相册上传需要 groupId + albumId' };
  }
  const retryTimes = typeof cfg.retryTimes === 'number' && cfg.retryTimes > 0 ? cfg.retryTimes : 3;
  return {
    ok: true,
    task: {
      filePath,
      channelId,
      uploadConfig: {
        destinationType: 'familyAlbum',
        groupId,
        albumId,
        targetName: typeof cfg.targetName === 'string' ? cfg.targetName : '',
        retryTimes
      }
    }
  };
}

/**
 * POST /api/upload/enqueue
 * 手动入队一个上传任务，便于测试和运维补传
 *
 * 请求体示例：
 *   {
 *     "filePath": "/srv/filebrowser/yoyo-k/stream_xxx/20260420/xxx.mp4",
 *     "channelId": "stream_xxx",
 *     "uploadConfig": {
 *       "destinationType": "familyAlbum",
 *       "groupId": "1167813833499519836",
 *       "albumId": "1244462741363734839",
 *       "targetName": "test12",
 *       "retryTimes": 3
 *     }
 *   }
 */
router.post('/enqueue', (req, res) => {
  try {
    const queue = getQueue(req);
    if (!queue) {
      return res.status(503).json({
        status: 'error',
        message: 'UploadQueueService 未启动',
        code: 'QUEUE_NOT_READY'
      });
    }

    const check = validateEnqueuePayload(req.body);
    if (!check.ok) {
      return res.status(400).json({ status: 'error', message: check.message });
    }

    const result = queue.enqueue({
      ...check.task,
      enqueuedAt: Date.now()
    });
    if (!result.enqueued) {
      return res.status(200).json({
        status: 'success',
        enqueued: false,
        reason: result.reason,
        data: queue.getStatus()
      });
    }

    return res.status(200).json({
      status: 'success',
      enqueued: true,
      data: queue.getStatus()
    });
  } catch (error) {
    logger.error('手动入队上传任务失败', { error: error.message });
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * GET /api/upload/queue-status
 * 查看上传队列 + Worker 当前状态（前端轮询 / 手动检查）
 */
router.get('/queue-status', (req, res) => {
  try {
    const queue = getQueue(req);
    const worker = getWorker(req);
    const queueStatus = queue ? queue.getStatus() : null;
    const workerStatus = worker ? worker.getStatus() : null;
    return res.status(200).json({
      status: 'success',
      data: {
        queue: queueStatus,
        worker: workerStatus
      }
    });
  } catch (error) {
    logger.error('查询上传队列状态失败', { error: error.message });
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

/**
 * POST /api/upload/worker/resume
 * 登录失效后，管理员重新扫码登录成功 → 调用本接口让 Worker 继续消费
 * 幂等：Worker 未暂停时调用也安全
 */
router.post('/worker/resume', (req, res) => {
  try {
    const worker = getWorker(req);
    if (!worker) {
      return res.status(503).json({
        status: 'error',
        message: 'CloudUploadWorker 未启动',
        code: 'WORKER_NOT_READY'
      });
    }
    worker.resume();
    return res.status(200).json({
      status: 'success',
      data: worker.getStatus()
    });
  } catch (error) {
    logger.error('恢复上传 Worker 失败', { error: error.message });
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
