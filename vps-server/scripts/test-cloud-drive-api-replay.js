#!/usr/bin/env node

/**
 * 中国移动云盘接口 replay 验证脚本
 *
 * 用途：
 *   用 state.json 里解密后的 sessionBundle.cookies，在 Node 里通过 axios 直接调用
 *   139 目录浏览相关接口，验证：
 *     1. 不打开浏览器能否直接调用（VPS 后端集成的前提）
 *     2. userDomainId 应当从何处获取（cookies / localStorage / 响应体）
 *     3. 个人网盘、家庭列表、家庭相册列表能否正常返回
 *
 * 使用：
 *   node scripts/test-cloud-drive-api-replay.js
 *
 * 超时：整体 45 秒硬超时，避免 axios 异常挂住。
 */

require('dotenv').config();

const axios = require('axios');
const CloudDriveService = require('../src/services/CloudDriveService');

/**
 * 打印一条分隔线加标题
 * @param {string} title
 */
function section(title) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
}

/**
 * 从 sessionBundle.cookies 拼出 Cookie 请求头字符串
 * 只选 139 域名相关的条目，避免无意义字段污染
 * @param {Array} cookies
 * @returns {string} Cookie 请求头值
 */
function buildCookieHeader(cookies) {
  return (cookies || [])
    .filter((c) => (c.domain || '').includes('139.com'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * 硬超时守护
 */
function rejectAfter(ms) {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(`hard timeout after ${ms}ms`)), ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

async function runOnce() {
  const service = new CloudDriveService();
  const state = service.loadState();
  if (!state.sessionBundleEncrypted) {
    console.error('[replay] state.json 没有 sessionBundleEncrypted，请先运行 test-cloud-drive-auto-login.js');
    return 1;
  }
  const bundle = JSON.parse(service.decryptText(state.sessionBundleEncrypted));

  const cookies = bundle.cookies || [];
  const ls = bundle.localStorage || {};

  console.log('[replay] cookies total:', cookies.length);
  console.log('[replay] localStorage keys:', Object.keys(ls));

  // 寻找 userDomainId 候选
  section('候选 userDomainId 来源');
  console.log('localStorage.TY_USER_ID       =', ls.TY_USER_ID);
  console.log('localStorage.encryptAccount   =', (ls.encryptAccount || '').slice(0, 80));
  console.log('localStorage.ENCRYPTACCOUNT   =', (ls.ENCRYPTACCOUNT || '').slice(0, 80));
  console.log('localStorage.simplifyAccount  =', ls.simplifyAccount);
  console.log('localStorage.routerInfo[:200] =', (ls.routerInfo || '').slice(0, 200));
  console.log('cookies(name=value) 列表：');
  cookies.forEach((c) => {
    const val = (c.value || '').length > 50 ? c.value.slice(0, 50) + '...' : c.value;
    console.log(`  ${c.domain}${c.path}  ${c.name}=${val}`);
  });

  const cookieHeader = buildCookieHeader(cookies);
  console.log('\n[replay] Cookie header length:', cookieHeader.length);

  const commonHeaders = {
    'Cookie': cookieHeader,
    'Content-Type': 'application/json;charset=UTF-8',
    'Referer': 'https://yun.139.com/w/',
    'Origin': 'https://yun.139.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  };

  // ---------------------------------------------------------------- Case 1: personal root
  section('1. POST /hcy/file/list  (个人网盘根目录)');
  try {
    const resp = await axios.post('https://yun.139.com/hcy/file/list', {
      pageInfo: { pageSize: 100, pageCursor: null },
      orderBy: 'updated_at',
      orderDirection: 'DESC',
      parentFileId: '/',
      imageThumbnailStyleList: ['Small', 'Large']
    }, { headers: { ...commonHeaders, Referer: 'https://yun.139.com/' }, timeout: 15000, validateStatus: () => true });
    console.log('HTTP', resp.status, 'code:', resp.data?.code, 'message:', resp.data?.message);
    const items = resp.data?.data?.items || [];
    console.log('items total:', items.length);
    items.slice(0, 6).forEach((x) => console.log(`  - [${x.type}] ${x.name}  fileId=${x.fileId}`));
    // 存一个子目录 fileId 给 Case 2 使用
    const folder = items.find((x) => x.type === 'folder');
    global.__sampleFolderFileId = folder?.fileId || null;
    global.__sampleFolderName = folder?.name || null;
  } catch (e) {
    console.error('failed:', e.response?.status, e.response?.data || e.message);
  }

  // ---------------------------------------------------------------- Case 2: personal child
  if (global.__sampleFolderFileId) {
    section(`2. POST /hcy/file/list  (个人网盘子目录: ${global.__sampleFolderName})`);
    try {
      const resp = await axios.post('https://yun.139.com/hcy/file/list', {
        pageInfo: { pageSize: 50, pageCursor: null },
        orderBy: 'updated_at',
        orderDirection: 'DESC',
        parentFileId: global.__sampleFolderFileId,
        imageThumbnailStyleList: ['Small', 'Large']
      }, { headers: { ...commonHeaders, Referer: 'https://yun.139.com/' }, timeout: 15000, validateStatus: () => true });
      console.log('HTTP', resp.status, 'code:', resp.data?.code, 'message:', resp.data?.message);
      const items = resp.data?.data?.items || [];
      console.log('items total:', items.length);
      items.slice(0, 6).forEach((x) => console.log(`  - [${x.type}] ${x.name}`));
    } catch (e) {
      console.error('failed:', e.response?.status, e.response?.data || e.message);
    }
  }

  // ---------------------------------------------------------------- Case 3: family list  - 试两种 userDomainId
  // 尝试候选：localStorage.TY_USER_ID / 已知值 / 留空
  const userDomainCandidates = [
    { label: 'from localStorage.TY_USER_ID', value: ls.TY_USER_ID },
    { label: 'hardcoded 1039957508171465698', value: '1039957508171465698' },
    { label: 'empty (let 139 infer)', value: '' }
  ].filter((c) => c.value !== undefined);

  let workingUserDomainId = '';
  for (const cand of userDomainCandidates) {
    section(`3. POST queryFamilyCloud with userDomainId = ${JSON.stringify(cand.value)} (${cand.label})`);
    try {
      const resp = await axios.post(
        'https://yun.139.com/orchestration/familyCloud-rebuild/cloudManage/v1.0/queryFamilyCloud',
        {
          pageInfo: { pageNum: 1, pageSize: 100 },
          commonAccountInfo: { userDomainId: String(cand.value || ''), accountType: 1 }
        },
        { headers: commonHeaders, timeout: 15000, validateStatus: () => true }
      );
      console.log('HTTP', resp.status, 'code:', resp.data?.code, 'message:', resp.data?.message);
      const list = resp.data?.data?.familyCloudList;
      if (list && list.length) {
        list.forEach((f) => console.log(`  - ${f.cloudName}  cloudID=${f.cloudID}`));
        if (!workingUserDomainId) workingUserDomainId = String(cand.value);
      } else {
        console.log('  data:', JSON.stringify(resp.data?.data || {}).slice(0, 200));
      }
    } catch (e) {
      console.error('failed:', e.response?.status, e.response?.data || e.message);
    }
  }

  // ---------------------------------------------------------------- Case 4: family album list
  if (workingUserDomainId) {
    section(`4. POST queryCloudPhoto  (家庭相册列表，cloudID=1167813833499519836)`);
    try {
      const resp = await axios.post(
        'https://yun.139.com/orchestration/familyCloud-rebuild/cloudCatalog/v1.0/queryCloudPhoto',
        {
          cloudID: '1167813833499519836',
          pageInfo: { pageNum: 1, pageSize: 50 },
          commonAccountInfo: { userDomainId: workingUserDomainId, accountType: 1 }
        },
        { headers: commonHeaders, timeout: 15000, validateStatus: () => true }
      );
      console.log('HTTP', resp.status, 'code:', resp.data?.code, 'message:', resp.data?.message);
      const list = resp.data?.data?.cloudPhotoList || [];
      list.forEach((p) => console.log(`  - ${p.photoName}  photoID=${p.photoID}`));
    } catch (e) {
      console.error('failed:', e.response?.status, e.response?.data || e.message);
    }
  } else {
    console.log('\n[replay] 所有 userDomainId 候选均失败，跳过 Case 4');
  }

  return 0;
}

async function main() {
  const HARD_TIMEOUT_MS = 45_000;
  try {
    const code = await Promise.race([runOnce(), rejectAfter(HARD_TIMEOUT_MS)]);
    process.exit(code);
  } catch (error) {
    console.error('[replay] fatal:', error.message);
    process.exit(3);
  }
}

main();
