const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

/**
 * 中文说明：读取必填环境变量，缺失时直接抛错，避免 demo 在半配置状态下误执行。
 * @param {string} key 环境变量名称
 * @returns {string}
 */
function readRequiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`缺少环境变量: ${key}`);
  }
  return value;
}

/**
 * 中文说明：生成一个最小测试视频，避免依赖现有录制文件，便于在 VPS 上重复验证上传链路。
 * @param {string} filePath 测试视频输出路径
 */
function ensureDemoVideo(filePath) {
  if (fs.existsSync(filePath)) {
    return;
  }

  execFileSync('/usr/bin/ffmpeg', [
    '-f', 'lavfi',
    '-i', 'color=c=black:s=320x240:d=1',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    filePath
  ], { stdio: 'inherit' });
}

/**
 * 中文说明：构造 139 云盘公共请求头。签名值外部注入，便于快速替换浏览器抓到的最新会话参数。
 * @param {string} mcloudSign 本次请求使用的 mcloud-sign
 * @returns {Record<string, string>}
 */
function buildCommonHeaders(mcloudSign) {
  return {
    'x-yun-channel-source': readRequiredEnv('YUN_CHANNEL_SOURCE'),
    'authorization': readRequiredEnv('YUN_AUTHORIZATION'),
    'x-yun-client-info': readRequiredEnv('YUN_CLIENT_INFO'),
    'mcloud-version': readRequiredEnv('YUN_MCLOUD_VERSION'),
    'mcloud-client': readRequiredEnv('YUN_MCLOUD_CLIENT'),
    'x-inner-ntwk': readRequiredEnv('YUN_INNER_NTWK'),
    'mcloud-channel': readRequiredEnv('YUN_MCLOUD_CHANNEL'),
    'x-yun-module-type': readRequiredEnv('YUN_MODULE_TYPE'),
    'x-yun-api-version': readRequiredEnv('YUN_API_VERSION'),
    'mcloud-skey': readRequiredEnv('YUN_MCLOUD_SKEY'),
    'cms-device': readRequiredEnv('YUN_CMS_DEVICE'),
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'x-yun-svc-type': readRequiredEnv('YUN_SVC_TYPE'),
    'x-huawei-channelsrc': readRequiredEnv('YUN_HUAWEI_CHANNEL_SOURCE'),
    'x-m4c-src': readRequiredEnv('YUN_M4C_SRC'),
    'x-m4c-caller': readRequiredEnv('YUN_M4C_CALLER'),
    'referer': 'https://yun.139.com/',
    'x-deviceinfo': readRequiredEnv('YUN_DEVICE_INFO'),
    'mcloud-route': readRequiredEnv('YUN_MCLOUD_ROUTE'),
    'caller': readRequiredEnv('YUN_CALLER'),
    'inner-hcy-router-https': readRequiredEnv('YUN_INNER_HCY_ROUTER_HTTPS'),
    'mcloud-sign': mcloudSign,
    'x-yun-app-channel': readRequiredEnv('YUN_APP_CHANNEL'),
    'x-svctype': readRequiredEnv('YUN_X_SVCTYPE'),
    'user-agent': readRequiredEnv('YUN_USER_AGENT'),
    'origin': 'https://yun.139.com'
  };
}

/**
 * 中文说明：向 139 云盘发起 JSON 请求，并返回解析后的响应结果。
 * @param {string} url 请求地址
 * @param {Record<string, string>} headers 请求头
 * @param {Record<string, unknown>} body 请求体
 * @returns {Promise<{response: Response, text: string, json: any}>}
 */
async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }

  return { response, text, json };
}

/**
 * 中文说明：主流程，按 create -> PUT -> complete 顺序验证服务器侧上传链路。
 */
async function main() {
  const groupId = readRequiredEnv('YUN_GROUP_ID');
  const albumId = readRequiredEnv('YUN_ALBUM_ID');
  const accountUserId = readRequiredEnv('YUN_ACCOUNT_USER_ID');
  const createSign = readRequiredEnv('YUN_CREATE_SIGN');
  const completeSign = process.env.YUN_COMPLETE_SIGN || createSign;

  const filePath = process.env.DEMO_FILE_PATH || `/tmp/vps-demo-${Date.now()}.mp4`;
  ensureDemoVideo(filePath);

  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;
  const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const fileName = process.env.DEMO_FILE_NAME || path.basename(filePath);
  const seqNo = crypto.randomUUID().replace(/-/g, '');

  const createBody = {
    groupId,
    seqNo,
    name: fileName,
    size: fileSize,
    partInfos: [{ partNumber: 1, partSize: fileSize }],
    contentHashAlgorithm: 'SHA256',
    contentHash,
    contentType: 'application/oct-stream',
    catalogType: 1,
    groupType: 1,
    targetAlbumId: albumId
  };

  console.log('---CREATE_BODY---');
  console.log(JSON.stringify(createBody, null, 2));

  const createResult = await postJson(
    'https://group.yun.139.com/hcy/group/dynamic/file/create',
    buildCommonHeaders(createSign),
    createBody
  );

  console.log('---CREATE_RESPONSE---');
  console.log(createResult.response.status, createResult.text);

  if (!createResult.response.ok || !createResult.json?.success) {
    throw new Error(`create 失败: ${createResult.response.status} ${createResult.text}`);
  }

  if (createResult.json.data?.rapidUpload) {
    console.log('---RESULT---');
    console.log('服务器侧 create 成功，命中秒传，无需 PUT / complete');
    return;
  }

  const uploadUrl = createResult.json.data?.partInfos?.[0]?.uploadUrl;
  const fileId = createResult.json.data?.fileId;
  const uploadId = createResult.json.data?.uploadId;

  if (!uploadUrl || !fileId || !uploadId) {
    throw new Error(`create 响应缺少 uploadUrl/fileId/uploadId: ${createResult.text}`);
  }

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': String(fileSize)
    },
    body: fileBuffer
  });
  const putText = await putResponse.text();

  console.log('---PUT_RESPONSE---');
  console.log(putResponse.status, putText || '<empty>');

  if (!putResponse.ok) {
    throw new Error(`PUT 失败: ${putResponse.status} ${putText}`);
  }

  const completeBody = {
    groupId,
    accountUserld: accountUserId,
    fileId,
    uploadId,
    contentHash,
    contentHashAlgorithm: 'SHA256'
  };

  console.log('---COMPLETE_BODY---');
  console.log(JSON.stringify(completeBody, null, 2));

  let completeResult = await postJson(
    'https://group.yun.139.com/hcy/group/dynamic/file/complete',
    buildCommonHeaders(completeSign),
    completeBody
  );

  if (!completeResult.response.ok && completeSign !== createSign) {
    console.log('---COMPLETE_RETRY_WITH_CREATE_SIGN---');
    completeResult = await postJson(
      'https://group.yun.139.com/hcy/group/dynamic/file/complete',
      buildCommonHeaders(createSign),
      completeBody
    );
  }

  console.log('---COMPLETE_RESPONSE---');
  console.log(completeResult.response.status, completeResult.text);

  if (!completeResult.response.ok || !completeResult.json?.success) {
    throw new Error(`complete 失败: ${completeResult.response.status} ${completeResult.text}`);
  }

  console.log('---RESULT---');
  console.log('服务器侧 create + PUT + complete 已跑通');
}

main().catch((error) => {
  console.error('---DEMO_ERROR---');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
