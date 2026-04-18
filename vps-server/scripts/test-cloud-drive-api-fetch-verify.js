#!/usr/bin/env node

/**
 * 中国移动云盘浏览器内 fetch 验证脚本
 *
 * 目的：验证 "在登录态页面的 page.evaluate 里用 fetch 调 139 接口" 是否
 *       会被 139 前端 JS 自动拦截并加上 mcloud-sign / authorization 等
 *       必需 header。如果可行，VPS 的 CloudDriveBrowseService 可以采用
 *       "保留浏览器页面 + page.evaluate fetch" 的实现方案，无需反向签名。
 *
 * 前置：需要已通过 test-cloud-drive-auto-login.js 完成本地登录，
 *      state.json 里存有 sessionBundleEncrypted。
 *
 * 超时：硬超时 90 秒。
 */

require('dotenv').config();

const fs = require('fs');
const playwright = require('playwright');
const CloudDriveService = require('../src/services/CloudDriveService');
const CloudDriveLoginExecutor = require('../src/services/cloud-drive/CloudDriveLoginExecutor');

/**
 * 查找本机可用的 Chrome / Edge
 */
function resolveSystemBrowserPath() {
  const candidates = [
    process.env.CLOUD_DRIVE_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || '';
}

const systemBrowserPath = resolveSystemBrowserPath();
if (systemBrowserPath) {
  CloudDriveLoginExecutor.prototype.loadPlaywright = function () {
    return {
      chromium: {
        launch: (options = {}) => playwright.chromium.launch({
          ...options,
          executablePath: systemBrowserPath
        })
      }
    };
  };
}

function rejectAfter(ms) {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(`hard timeout ${ms}ms`)), ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * 把 sessionBundle 转 storageState（复用 probe 的逻辑）
 */
function buildStorageState(bundle) {
  return {
    cookies: (bundle.cookies || []).map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
      expires: typeof c.expires === 'number' ? c.expires : -1,
      httpOnly: !!c.httpOnly, secure: !!c.secure,
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'
    })),
    origins: [{
      origin: 'https://yun.139.com',
      localStorage: Object.entries(bundle.localStorage || {}).map(([name, value]) => ({ name, value: String(value) }))
    }]
  };
}

async function runOnce() {
  const service = new CloudDriveService();
  const state = service.loadState();
  if (!state.sessionBundleEncrypted) {
    console.error('[fetch-verify] 请先运行 test-cloud-drive-auto-login.js 完成本地登录');
    return 1;
  }
  const bundle = JSON.parse(service.decryptText(state.sessionBundleEncrypted));
  const storageState = buildStorageState(bundle);

  const browser = await playwright.chromium.launch({
    headless: false,
    executablePath: systemBrowserPath || undefined
  });
  const context = await browser.newContext({ storageState });

  // 在 SPA 任何 JS 跑之前注入 XHR hook，捕获 /hcy/file/list 的完整 header（含 mcloud-sign）
  await context.addInitScript(() => {
    window.__capturedXhr = null;
    const OriginalXHR = window.XMLHttpRequest;
    const origOpen = OriginalXHR.prototype.open;
    const origSend = OriginalXHR.prototype.send;
    const origSetHeader = OriginalXHR.prototype.setRequestHeader;

    OriginalXHR.prototype.open = function (method, url, ...rest) {
      this.__reqMethod = method;
      this.__reqUrl = url;
      this.__reqHeaders = {};
      return origOpen.call(this, method, url, ...rest);
    };
    OriginalXHR.prototype.setRequestHeader = function (k, v) {
      this.__reqHeaders = this.__reqHeaders || {};
      this.__reqHeaders[k] = v;
      return origSetHeader.call(this, k, v);
    };
    OriginalXHR.prototype.send = function (body) {
      try {
        if (this.__reqUrl && this.__reqUrl.includes('/hcy/file/list')) {
          window.__capturedXhr = {
            method: this.__reqMethod,
            url: this.__reqUrl,
            headers: { ...this.__reqHeaders },
            body: typeof body === 'string' ? body : ''
          };
        }
      } catch {}
      return origSend.call(this, body);
    };

    // 给外界提供一个借用 sign 重放请求的函数
    window.__borrowAndCall = async function (overrideUrl, overrideBody) {
      const cap = window.__capturedXhr;
      if (!cap) return { error: 'no captured xhr yet' };
      const res = await fetch(overrideUrl || cap.url, {
        method: 'POST',
        credentials: 'include',
        headers: cap.headers,
        body: JSON.stringify(overrideBody || JSON.parse(cap.body || '{}'))
      });
      const text = await res.text();
      return { status: res.status, textPreview: text.slice(0, 400) };
    };
  });

  const page = await context.newPage();

  try {
    console.log('[fetch-verify] navigating to 139 web ...');
    await page.goto('https://yun.139.com/w/', { waitUntil: 'commit' }).catch(() => {});
    console.log('[fetch-verify] waiting 15s for app bootstrap ...');
    await new Promise((r) => setTimeout(r, 15_000));

    // 确认当前真的已登录：看 ud_id cookie 仍在
    const cookies = await context.cookies();
    const ud = cookies.find((c) => c.name === 'ud_id');
    console.log('[fetch-verify] ud_id cookie value:', ud?.value);

    // ==== Case 1: page.evaluate 里直接 fetch，看是否自动 sign ====
    console.log('\n=== Case 1: page.evaluate fetch /hcy/file/list ===');
    const result1 = await page.evaluate(async () => {
      try {
        const res = await fetch('https://yun.139.com/hcy/file/list', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: JSON.stringify({
            pageInfo: { pageSize: 10, pageCursor: null },
            orderBy: 'updated_at',
            orderDirection: 'DESC',
            parentFileId: '/',
            imageThumbnailStyleList: ['Small', 'Large']
          })
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, bodyPreview: text.slice(0, 800) };
      } catch (e) {
        return { ok: false, status: 0, error: String(e) };
      }
    });
    console.log(JSON.stringify(result1, null, 2));

    // ==== Case 2: 深入找 Vue app / Vuex / Pinia 下的 axios 实例 ====
    console.log('\n=== Case 2: deep search for axios / $http in Vue app ===');
    const result2 = await page.evaluate(async () => {
      const found = [];

      // 探测 Vue 3 app 实例
      const appEl = document.querySelector('#app');
      const vue3App = appEl && appEl.__vue_app__;
      if (vue3App) {
        const gp = vue3App.config?.globalProperties || {};
        ['$http', '$axios', '$request', '$api', '$service'].forEach((k) => {
          if (gp[k]) found.push({ tag: `vue3.globalProperties.${k}`, type: typeof gp[k] });
        });
      }

      // 探测 Vue 2 的 instance
      const vue2Inst = appEl && appEl.__vue__;
      if (vue2Inst) {
        ['$http', '$axios', '$request', '$api'].forEach((k) => {
          if (vue2Inst[k]) found.push({ tag: `vue2.${k}`, type: typeof vue2Inst[k] });
        });
      }

      // 全局 window 上常见位置
      ['axios', '$axios', '$http', 'http', '__axios__', '_axios'].forEach((k) => {
        if (window[k]) found.push({ tag: `window.${k}`, type: typeof window[k] });
      });

      // 探测 Vuex / Pinia
      if (window.__PINIA__) found.push({ tag: '__PINIA__', type: typeof window.__PINIA__ });
      if (vue2Inst?.$store) found.push({ tag: 'vue2.$store', type: typeof vue2Inst.$store });

      // 用本地同源的 personal-kd-njs 子域名再试一次 fetch
      let liveFetch = null;
      try {
        const res = await fetch('https://personal-kd-njs.yun.139.com/hcy/file/list', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: JSON.stringify({
            pageInfo: { pageSize: 5, pageCursor: null },
            orderBy: 'updated_at',
            orderDirection: 'DESC',
            parentFileId: '/',
            imageThumbnailStyleList: ['Small', 'Large']
          })
        });
        const text = await res.text();
        liveFetch = { status: res.status, bodyPreview: text.slice(0, 400) };
      } catch (e) {
        liveFetch = { error: String(e) };
      }

      return { found, liveFetch };
    });
    console.log(JSON.stringify(result2, null, 2));

    // ==== Case 3: 监听 fetch / XHR 拦截器是否存在 ====
    console.log('\n=== Case 3: inspect whether fetch / XMLHttpRequest has been wrapped ===');
    const result3 = await page.evaluate(() => {
      const nativeFetchStr = 'function fetch() { [native code] }';
      const fetchStr = String(window.fetch);
      const isNativeFetch = fetchStr === nativeFetchStr || fetchStr.includes('[native code]');
      // 常见的 XMLHttpRequest 拦截器插入 open/send 的包装
      const XHRSendStr = String(XMLHttpRequest.prototype.send);
      const isNativeXHRSend = XHRSendStr.includes('[native code]');
      return {
        fetchIsNative: isNativeFetch,
        fetchSample: fetchStr.slice(0, 200),
        xhrSendIsNative: isNativeXHRSend,
        xhrSendSample: XHRSendStr.slice(0, 200)
      };
    });
    console.log(JSON.stringify(result3, null, 2));

    // ==== Case 4: 探测 Vuex store 结构，看有哪些 actions/modules 可以 dispatch ====
    console.log('\n=== Case 4: inspect Vuex store ===');
    const result4 = await page.evaluate(() => {
      const appEl = document.querySelector('#app');
      const inst = appEl && appEl.__vue__;
      const store = inst?.$store;
      if (!store) return { hasStore: false };
      const moduleNames = Object.keys(store.state || {});
      // store._actions 是 Vuex 内部存放所有 dispatch 路径的 map
      const actionNames = Object.keys(store._actions || {}).slice(0, 120);
      const mutationNames = Object.keys(store._mutations || {}).slice(0, 60);
      const getterNames = Object.keys(store.getters || {}).slice(0, 40);
      return { hasStore: true, moduleNames, actionNames, mutationNames, getterNames };
    });
    console.log(JSON.stringify(result4, null, 2));

    // ==== Case 5: 监听 SPA 自发请求，作为对照 ====
    console.log('\n=== Case 5: 刷新页面，观察 SPA 自发请求是否带 sign ===');
    const liveRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/hcy/file/list')) {
        liveRequests.push({
          url: req.url(),
          method: req.method(),
          hasMcloudSign: !!req.headers()['mcloud-sign'],
          hasAuthz: !!req.headers()['authorization']
        });
      }
    });
    await page.reload({ waitUntil: 'commit' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 8_000));
    console.log('[fetch-verify] SPA 自发请求（对照）:', JSON.stringify(liveRequests, null, 2));

    // ==== Case 6: 尝试直接调 store.dispatch 触发文件列表请求 ====
    console.log('\n=== Case 6: try to dispatch a likely file-list action ===');
    const result6 = await page.evaluate(async () => {
      const appEl = document.querySelector('#app');
      const inst = appEl && appEl.__vue__;
      const store = inst?.$store;
      if (!store) return { ok: false, reason: 'no store' };
      // 尝试若干常见命名
      const candidateActions = Object.keys(store._actions || {})
        .filter((n) => /file|folder|list|dir|catalog|directory/i.test(n));
      const tried = [];
      for (const name of candidateActions.slice(0, 15)) {
        try {
          const res = await Promise.race([
            store.dispatch(name, { parentFileId: '/', pageInfo: { pageSize: 5 } }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('dispatch timeout 4s')), 4000))
          ]);
          tried.push({ name, ok: true, preview: JSON.stringify(res).slice(0, 200) });
          break; // 一旦成功就退出
        } catch (e) {
          tried.push({ name, ok: false, error: String(e?.message || e).slice(0, 150) });
        }
      }
      return { tried };
    });
    console.log(JSON.stringify(result6, null, 2));

    // ==== Case 7: 借用 SPA 产生的 sign 重放请求 ====
    console.log('\n=== Case 7: reuse sign from SPA\'s captured XHR ===');

    // 7.1 有没有捕获到 sign
    const capCheck = await page.evaluate(() => {
      if (!window.__capturedXhr) return { captured: false };
      return {
        captured: true,
        url: window.__capturedXhr.url,
        bodyLen: (window.__capturedXhr.body || '').length,
        hasMcloudSign: 'mcloud-sign' in window.__capturedXhr.headers,
        signSample: window.__capturedXhr.headers['mcloud-sign'] || ''
      };
    });
    console.log('captured snapshot:', JSON.stringify(capCheck, null, 2));

    if (capCheck.captured) {
      // 7.2 相同 URL + 原始 body 重放
      const r71 = await page.evaluate(() => window.__borrowAndCall(null, null));
      console.log('7.2 replay same url + same body:', JSON.stringify(r71, null, 2));

      // 7.3 相同 URL + 不同 body（查 /手机视频 下面）
      // 先从上一次 case 1 的数据里捞一个 folder fileId；这里硬编码用示例
      const r72 = await page.evaluate(() => window.__borrowAndCall(null, {
        pageInfo: { pageSize: 5, pageCursor: null },
        orderBy: 'updated_at',
        orderDirection: 'DESC',
        parentFileId: 'DE9XaXmsAFAA1211XtQwV0gd00019700101000000044',
        imageThumbnailStyleList: ['Small', 'Large']
      }));
      console.log('7.3 replay same url + different body:', JSON.stringify(r72, null, 2));

      // 7.4 不同 URL（家庭云接口）
      const r73 = await page.evaluate(() => window.__borrowAndCall(
        'https://yun.139.com/orchestration/familyCloud-rebuild/cloudManage/v1.0/queryFamilyCloud',
        {
          pageInfo: { pageNum: 1, pageSize: 100 },
          commonAccountInfo: { userDomainId: '1039957508171465698', accountType: 1 }
        }
      ));
      console.log('7.4 replay different url + family body:', JSON.stringify(r73, null, 2));
    }

  } finally {
    await browser.close().catch(() => {});
  }

  return 0;
}

async function main() {
  try {
    const code = await Promise.race([runOnce(), rejectAfter(90_000)]);
    process.exit(code);
  } catch (e) {
    console.error('[fetch-verify] fatal:', e.message);
    process.exit(3);
  }
}

main();
