const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 中国移动 139 云盘文件上传器（纯 Node.js 流式版）
 *
 * 改造历史：
 * - V1（已废弃）：fs.readFileSync + toString('base64') + page.evaluate(整个 base64) + 浏览器 atob + fetch PUT
 *                 内存路径膨胀 5~6 倍，1GB 文件直接 OOM
 * - V2（已废弃）：拆三段：create/complete 走浏览器借 sign，PUT 走 Node 流式
 *                 mcloud-sign 与 body 强绑定，借 sign 方案不可行；Playwright setInputFiles 被 SPA 拒绝
 * - V3（当前）  ：完全脱离浏览器
 *                 1) 逆向 mcloud-sign 算法（getNewSign），纯 Node.js 生成签名
 *                 2) 从 sessionBundle.cookies 读 authorization + skey（session 级常驻 cookie）
 *                 3) PUT 走 Node.js fetch + fs.createReadStream（预签名 URL 无需 sign）
 *                 4) 启动无 Playwright、无浏览器，内存峰值 O(1)，不受文件大小影响
 *
 * mcloud-sign 算法（已验证）：
 *   格式：<time>,<nonce>,<MD5_UPPER>
 *   time    格式化北京时间字符串，例如 "2026-04-20 14:05:56"
 *   nonce   16 字符随机字符串（大小写字母+数字）
 *   sign    MD5( MD5(base64(字符排序后的 URL 编码后的 body JSON)) + MD5(time + ":" + nonce) ).toUpperCase()
 */

// ============================================================================
// 139 接口固定 header（抓包得到，所有 file/* 接口一致）
// ============================================================================
const FIXED_HEADERS = Object.freeze({
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7',
  'cache-control': 'no-cache',
  'caller': 'web',
  'cms-device': 'default',
  'content-type': 'application/json;charset=UTF-8',
  'inner-hcy-router-https': '1',
  'mcloud-channel': '1000101',
  'mcloud-client': '10701',
  'mcloud-route': '001',
  'mcloud-version': '7.17.3',
  'origin': 'https://yun.139.com',
  'pragma': 'no-cache',
  'referer': 'https://yun.139.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'x-deviceinfo': '||9|7.17.3|chrome|147.0.0.0|3c5fafa2c4efb23d4c44276360eef413||windows 10||zh-CN|||',
  'x-huawei-channelsrc': '10000034',
  'x-inner-ntwk': '2',
  'x-m4c-caller': 'PC',
  'x-m4c-src': '10002',
  'x-svctype': '1',
  'x-yun-api-version': 'v1',
  'x-yun-app-channel': '10000034',
  'x-yun-channel-source': '10000034',
  'x-yun-client-info': '||9|7.17.3|chrome|147.0.0.0|3c5fafa2c4efb23d4c44276360eef413||windows 10||zh-CN|||dW5kZWZpbmVk||',
  'x-yun-module-type': '100',
  'x-yun-svc-type': '1'
});

const API_FILE_CREATE = 'https://group.yun.139.com/hcy/group/dynamic/file/create';
const API_FILE_COMPLETE = 'https://group.yun.139.com/hcy/group/dynamic/file/complete';

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 计算字符串的 MD5（32 位小写 hex）
 * @param {string} s 待哈希字符串
 * @returns {string} MD5 结果
 */
function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

/**
 * 格式化为北京时间字符串（UTC+8），格式 "yyyy-MM-dd HH:mm:ss"
 * 不受服务器时区影响：不管 VPS 在哪个时区，结果恒为北京时间
 * @param {Date} [date] 可选日期，默认当前时间
 * @returns {string} 北京时间字符串
 */
function formatBeijingTime(date = new Date()) {
  const bjMs = date.getTime() + 8 * 3600 * 1000;
  const d = new Date(bjMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * 生成指定长度的随机字符串（大小写字母+数字），用作 mcloud-sign 的 nonce
 * 与 SPA 的 getRandomSring 保持等效
 * @param {number} len 长度
 * @returns {string} 随机串
 */
function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * 生成指定长度的 16 进制小写随机字符串，用作 seqNo
 * @param {number} len 长度
 * @returns {string} hex 串
 */
function randomHex(len) {
  const chars = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

/**
 * 计算 139 的 mcloud-sign（已验证算法，与 SPA getNewSign 等价）
 *
 * 算法步骤：
 *   1. s = encodeURIComponent(JSON.stringify(body)) 的字符数组按 Unicode 升序排序后拼回
 *      （"字符级排序"使得 body 字段顺序不影响结果）
 *   2. r = MD5(base64(s))
 *   3. l = MD5(time + ":" + nonce)
 *   4. sign = MD5(r + l).toUpperCase()
 *
 * @param {Object} body 请求体；若 body 为 null/undefined，s 保持空串
 * @param {string} time 北京时间字符串 "yyyy-MM-dd HH:mm:ss"
 * @param {string} nonce 16 字符随机串
 * @returns {string} 32 位大写 hex
 */
function getNewSign(body, time, nonce) {
  let s = '';
  if (body) {
    s = JSON.stringify(body);
    s = encodeURIComponent(s);
    s = s.split('').sort().join('');
  }
  const r = md5(Buffer.from(s, 'utf8').toString('base64'));
  const l = md5(time + ':' + nonce);
  return md5(r + l).toUpperCase();
}

/**
 * 从 cookie 数组中查找指定 name 的 value，域名需属于 139.com
 * @param {Array} cookies sessionBundle.cookies
 * @param {string} name cookie 名
 * @returns {string|null} cookie 值（已 URL 解码）；找不到返回 null
 */
function findCookieValue(cookies, name) {
  if (!Array.isArray(cookies)) return null;
  const c = cookies.find((item) => item.name === name && item.domain && /139\.com/.test(item.domain));
  if (!c || !c.value) return null;
  // cookie value 可能 URL 编码过，解码后使用
  try { return decodeURIComponent(c.value); } catch (err) { return c.value; }
}

// ============================================================================
// HybridUploader 主类
// ============================================================================

class HybridUploader {
  /**
   * 构造器
   *
   * @param {Object} options 选项
   * @param {Object} options.sessionBundle 会话数据（从 CloudDriveService 解密得到）
   *                                        必须包含 cookies 数组，且 cookies 中含 authorization + skey
   * @param {string} options.targetAlbumId 目标相册 ID（家庭相册的 photoID）
   * @param {string} options.groupId 家庭 ID（cloudId）
   * @param {Function} [options.onProgress] 进度回调，签名 ({phase, uploaded, total, percent}) => void
   *                                         phase 可能是 'hash' / 'put'
   */
  constructor(options = {}) {
    if (!options.sessionBundle) throw new Error('HybridUploader 需要 sessionBundle');
    if (!options.targetAlbumId) throw new Error('HybridUploader 需要 targetAlbumId');
    if (!options.groupId) throw new Error('HybridUploader 需要 groupId');

    this.sessionBundle = options.sessionBundle;
    this.targetAlbumId = String(options.targetAlbumId);
    this.groupId = String(options.groupId);
    this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => { };

    // 从 cookie 提取 session 级认证值（SPA 把 authorization + skey 写到 cookie，不是 localStorage）
    const cookies = this.sessionBundle.cookies || [];
    this.authorization = findCookieValue(cookies, 'authorization');
    this.skey = findCookieValue(cookies, 'skey');
    if (!this.authorization) {
      throw new Error('sessionBundle cookies 中找不到 authorization，请重新登录');
    }
    if (!this.skey) {
      throw new Error('sessionBundle cookies 中找不到 skey，请重新登录');
    }
  }

  /**
   * 构造带 mcloud-sign 的完整请求头
   * @param {Object} body 请求体（用于计算 sign）
   * @returns {Object} 请求头对象
   */
  _buildSignedHeaders(body) {
    const time = formatBeijingTime();
    const nonce = randomString(16);
    const sign = getNewSign(body, time, nonce);
    return {
      ...FIXED_HEADERS,
      'authorization': this.authorization,
      'mcloud-skey': this.skey,
      'mcloud-sign': `${time},${nonce},${sign}`
    };
  }

  /**
   * 流式计算文件 SHA256（不把文件全部读入内存）
   * @param {string} filePath 文件绝对路径
   * @returns {Promise<string>} 64 位小写 hex
   */
  async calculateFileSHA256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 调用 file/create 创建上传任务（或命中秒传）
   *
   * 成功响应形态（命中秒传时 uploadId/partInfos 为 null）：
   *   { success: true, data: { fileId, uploadId, partInfos: [{ uploadUrl, ... }], exist, ... } }
   *
   * @param {Object} params { fileName, fileSize, contentHash }
   * @returns {Promise<Object>} 响应 data 子对象
   */
  async createFileRecord({ fileName, fileSize, contentHash }) {
    const body = {
      groupId: this.groupId,
      groupType: 1,
      catalogType: 1,
      seqNo: randomHex(32),
      targetAlbumId: this.targetAlbumId,
      fileRenameMode: 'auto_rename',
      contentType: 'application/oct-stream',
      type: 'file',
      name: fileName,
      size: fileSize,
      contentHashAlgorithm: 'SHA256',
      contentHash,
      partInfos: [{ parallelHashCtx: { partOffset: 0 }, partNumber: 1, partSize: fileSize }],
      parentFileId: this.targetAlbumId
    };
    const headers = this._buildSignedHeaders(body);

    const res = await fetch(API_FILE_CREATE, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(`file/create 响应非 JSON: status=${res.status} body=${text.slice(0, 500)}`);
    }
    if (!res.ok || !json.success) {
      throw new Error(`file/create 业务失败 status=${res.status} body=${JSON.stringify(json).slice(0, 800)}`);
    }
    return json.data;
  }

  /**
   * 流式 PUT 文件到预签名 URL（S3 兼容的对象存储，签名已在 URL 参数中）
   *
   * 关键实现点：
   *   - body 用 fs.createReadStream，确保内存 O(1)
   *   - duplex: 'half' 是 Node 18+ fetch 流式 body 的必需参数，缺失会报 TypeError
   *   - Content-Length 必须显式指定（S3 预签名要求签名头包含 content-length）
   *
   * @param {string} filePath 本地文件路径
   * @param {string} uploadUrl 预签名上传 URL（来自 file/create 返回）
   * @param {number} fileSize 文件字节数
   * @returns {Promise<string|null>} 响应返回的 ETag
   */
  async streamPutFile(filePath, uploadUrl, fileSize) {
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    // 进度统计：每 10% 打一行日志，避免刷屏
    let uploaded = 0;
    let lastLogPercent = 0;
    const onProgress = this.onProgress;
    stream.on('data', (chunk) => {
      uploaded += chunk.length;
      const percent = fileSize > 0 ? Math.floor((uploaded / fileSize) * 100) : 0;
      if (percent >= lastLogPercent + 10) {
        const mb = (uploaded / 1024 / 1024).toFixed(1);
        const totalMb = (fileSize / 1024 / 1024).toFixed(1);
        console.log(`[Hybrid] PUT 进度: ${percent}% (${mb}/${totalMb} MB)`);
        lastLogPercent = percent;
        try { onProgress({ phase: 'put', uploaded, total: fileSize, percent }); } catch (err) { /* 忽略进度回调异常 */ }
      }
    });

    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: stream,
      duplex: 'half',
      headers: {
        'content-length': String(fileSize)
      }
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PUT 失败 status=${res.status} body=${text.slice(0, 500)}`);
    }

    return res.headers.get('etag');
  }

  /**
   * 调用 file/complete 确认上传完成，服务端合并分片并入库
   *
   * @param {Object} params { fileId, uploadId, contentHash }
   * @returns {Promise<Object>} 响应 data 子对象（含 fileId、name、path、createdAt 等）
   */
  async completeFileUpload({ fileId, uploadId, contentHash }) {
    const body = {
      groupId: this.groupId,
      fileId,
      uploadId,
      contentHash,
      contentHashAlgorithm: 'SHA256'
    };
    const headers = this._buildSignedHeaders(body);

    const res = await fetch(API_FILE_COMPLETE, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(`file/complete 响应非 JSON: status=${res.status} body=${text.slice(0, 500)}`);
    }
    if (!res.ok || !json.success) {
      throw new Error(`file/complete 业务失败 status=${res.status} body=${JSON.stringify(json).slice(0, 800)}`);
    }
    return json.data;
  }

  /**
   * 上传文件主入口
   *
   * 流程：
   *   1) 流式 SHA256
   *   2) file/create（命中秒传则直接返回）
   *   3) 流式 PUT（预签名 URL）
   *   4) file/complete
   *
   * @param {string} filePath 本地待上传文件绝对路径
   * @returns {Promise<Object>} { success, rapidUpload, fileId, uploadId?, etag?, completeData? }
   */
  async upload(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }
    const fileSize = fs.statSync(filePath).size;
    const ext = path.extname(filePath) || '';

    console.log(`[Hybrid] 开始上传: ${path.basename(filePath)}`);
    console.log(`[Hybrid] 文件大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // Step 1: 流式 SHA256
    console.log('[Hybrid] 计算文件 SHA256...');
    const tHash = Date.now();
    const contentHash = await this.calculateFileSHA256(filePath);
    console.log(`[Hybrid] SHA256 OK: ${contentHash} (${((Date.now() - tHash) / 1000).toFixed(1)}s)`);
    try { this.onProgress({ phase: 'hash', percent: 100 }); } catch (err) { /* swallow */ }

    // Step 2: file/create（name 用 SHA256 前 32 hex + 扩展名，避免中文名 URL 编码后过长）
    const fileName = contentHash.slice(0, 32) + ext;
    console.log(`[Hybrid] 调 file/create (name=${fileName})...`);
    const createData = await this.createFileRecord({ fileName, fileSize, contentHash });
    console.log(`[Hybrid] create OK: fileId=${createData.fileId}, exist=${createData.exist}, uploadId=${createData.uploadId || 'null'}`);

    // 秒传判定：uploadId 为空且 partInfos 为空说明服务端已命中同 hash 文件
    const hasUploadUrl = !!(createData.uploadId
      && Array.isArray(createData.partInfos)
      && createData.partInfos[0]
      && createData.partInfos[0].uploadUrl);

    if (!hasUploadUrl) {
      console.log('[Hybrid] ✅ 秒传命中（服务端已有同 hash 文件），跳过 PUT 和 complete');
      return {
        success: true,
        rapidUpload: true,
        fileId: createData.fileId
      };
    }

    // Step 3: 流式 PUT
    const uploadUrl = createData.partInfos[0].uploadUrl;
    console.log('[Hybrid] Node 侧流式 PUT 开始...');
    const tPut = Date.now();
    const etag = await this.streamPutFile(filePath, uploadUrl, fileSize);
    console.log(`[Hybrid] PUT 完成 etag=${etag} (${((Date.now() - tPut) / 1000).toFixed(1)}s)`);

    // Step 4: file/complete
    console.log('[Hybrid] 调 file/complete...');
    const completeData = await this.completeFileUpload({
      fileId: createData.fileId,
      uploadId: createData.uploadId,
      contentHash
    });
    console.log(`[Hybrid] ✅ 上传完成 name=${completeData.name} size=${completeData.size} path=${completeData.path}`);

    return {
      success: true,
      rapidUpload: false,
      fileId: createData.fileId,
      uploadId: createData.uploadId,
      etag,
      completeData
    };
  }
}

// 工具函数也导出，便于单元测试与调试
HybridUploader._utils = {
  md5,
  formatBeijingTime,
  randomString,
  randomHex,
  getNewSign,
  findCookieValue
};

module.exports = HybridUploader;
