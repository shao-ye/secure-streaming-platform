#!/usr/bin/env node

/**
 * 中国移动云盘目录浏览 API 探测脚本
 *
 * 用途：
 *   复用 data/cloud-drive/state.json 里已加密保存的 sessionBundle，恢复 139 登录态，
 *   打开 139 web，并在后台拦截所有业务 API 请求。用户在浏览器里手动点击
 *   “我的文件 / 家庭云” 浏览若干目录后，脚本把采集到的接口落盘成 JSON 报告，
 *   供后续设计 CloudDriveBrowseService 使用。
 *
 * 超时：整个脚本 150 秒硬超时；用户按 Ctrl+C 也能提前结束。
 *
 * 使用示例（PowerShell）：
 *   node scripts/test-cloud-drive-api-probe.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const CloudDriveService = require('../src/services/CloudDriveService');

/** 139 业务 API 域名白名单，过滤掉与调研无关的第三方资源 */
const API_HOST_ALLOWLIST = [
  'yun.139.com',
  'orchestration.yun.139.com',
  'group.yun.139.com',
  'caiyun.139.com'
];

/** 业务 API 路径特征，进一步过滤掉同域名下的静态 HTML / JS */
const API_PATH_INCLUDES = [
  '/orchestration/',
  '/hcy/',
  '/rest/',
  '/api/',
  '/cloud/'
];

/**
 * 需要在报告落盘前脱敏的请求头字段（全部小写对比）。
 * 这些字段要么本身是凭据（authorization/cookie），
 * 要么在短时间窗口内可被回放（mcloud-sign），
 * 要么包含设备硬件特征（x-yun-client-info / x-deviceinfo）。
 * GitGuardian 等扫描器会把 "Basic <base64>" 或长 base64 认定为泄露，
 * 所以即使是本地 outputs/ 目录也要脱敏，防止被误 git add -f 或被人复制分享。
 */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'mcloud-sign',
  'x-yun-client-info',
  'x-deviceinfo'
]);

/**
 * 对一组 HTTP 请求头做脱敏处理：命中敏感名单的 value 替换为 [REDACTED]。
 * 采用浅拷贝，不会修改原 headers 对象。
 * @param {Object<string,string>} headers 原始请求头
 * @returns {Object<string,string>} 脱敏后的新对象
 */
function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(String(key).toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 查找本机可用的 Chrome / Edge 可执行路径
 * @returns {string} 可执行路径；未找到时返回空字符串
 */
function resolveSystemBrowserPath() {
  const candidates = [
    process.env.CLOUD_DRIVE_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

/**
 * 总超时守护
 * @param {number} ms 毫秒数
 * @returns {Promise<never>}
 */
function rejectAfter(ms) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`hard timeout after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * 判断一个 URL 是否是值得记录的业务 API
 * @param {string} url 请求 URL
 * @returns {boolean}
 */
function isInterestingApi(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const host = parsed.hostname;
  if (!API_HOST_ALLOWLIST.some((h) => host === h || host.endsWith('.' + h))) return false;
  if (/\.(js|css|png|jpg|jpeg|svg|woff2?|ico|gif|mp4|m3u8|html)(\?|$)/i.test(parsed.pathname)) return false;
  return API_PATH_INCLUDES.some((p) => parsed.pathname.includes(p));
}

/**
 * 加载 state.json 中加密保存的 sessionBundle
 * @returns {Promise<Object>} { cookies, localStorage, sessionStorage }
 */
async function loadSessionBundle() {
  const service = new CloudDriveService();
  const state = service.loadState();
  if (!state.sessionBundleEncrypted) {
    throw new Error('state.json 里没有 sessionBundleEncrypted，请先完成一次短信登录验证');
  }
  const raw = service.decryptText(state.sessionBundleEncrypted);
  return JSON.parse(raw);
}

/**
 * 把 sessionBundle 转换为 Playwright 的 storageState 格式
 * cookies 直接透传；localStorage 按 139 登录域 https://yun.139.com 挂载；
 * sessionStorage 不是 storageState 标准字段，单独返回供后续 evaluate 注入
 * @param {Object} sessionBundle 已解密的会话包
 * @returns {{ storageState: Object, sessionStorageKV: Array }}
 */
function buildStorageState(sessionBundle) {
  const localStorageKV = Object.entries(sessionBundle.localStorage || {}).map(([name, value]) => ({
    name,
    value: String(value)
  }));
  const sessionStorageKV = Object.entries(sessionBundle.sessionStorage || {}).map(([name, value]) => ({
    name,
    value: String(value)
  }));

  const cookies = (sessionBundle.cookies || []).map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: typeof c.expires === 'number' ? c.expires : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'
  }));

  return {
    storageState: {
      cookies,
      origins: [
        {
          origin: 'https://yun.139.com',
          localStorage: localStorageKV
        }
      ]
    },
    sessionStorageKV
  };
}

/**
 * 简短延迟工具
 * @param {number} ms 毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 尝试点击匹配给定文字的元素
 * 点击失败静默跳过，不阻塞后续步骤
 * @param {import('playwright').Page} page 页面对象
 * @param {string} text 需要匹配的可见文字
 * @param {Object} [options] 额外选项
 * @param {boolean} [options.exact] 是否精确匹配，默认 false
 * @param {number} [options.timeout] 超时时间，默认 3000ms
 * @returns {Promise<boolean>} 是否成功点击
 */
async function tryClickByText(page, text, options = {}) {
  const { exact = false, timeout = 3000 } = options;
  try {
    const locator = page.getByText(text, { exact }).first();
    const visible = await locator.isVisible({ timeout: 1000 }).catch(() => false);
    if (!visible) return false;
    await locator.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * 在页面中 dump 可能是侧边栏导航的元素，便于定位正确选择器
 * @param {import('playwright').Page} page 页面对象
 * @returns {Promise<Array<Object>>} 菜单节点信息数组
 */
async function dumpMenuStructure(page) {
  return page.evaluate(() => {
    /**
     * 过滤可见元素
     */
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    }
    // 常见导航元素：<a>、菜单 class、特定关键词
    const selectors = [
      'a[href]',
      '[class*="menu"] li',
      '[class*="nav"] li',
      '[class*="side"] li',
      '[class*="aside"] li',
      '[class*="tab"]',
      'li[role="menuitem"]',
      '.el-menu-item'
    ];
    const seen = new Set();
    const items = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        const text = (el.innerText || el.textContent || '').trim().slice(0, 40);
        if (!text) continue;
        const key = text + '|' + el.tagName + '|' + (el.className || '');
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          tag: el.tagName,
          text,
          cls: (el.className || '').toString().slice(0, 80),
          href: el.href || '',
          selector: sel
        });
      }
    }
    return items.slice(0, 80);
  }).catch(() => []);
}

/**
 * 多策略点击：优先 href 匹配、其次 text、最后 JS 直接 click()
 * @param {import('playwright').Page} page 页面对象
 * @param {Object} target 目标描述
 * @param {string[]} [target.hrefKeywords] href 里包含任一关键词即命中
 * @param {string[]} [target.texts] 可见文本匹配（any-of）
 * @returns {Promise<boolean>} 是否点击成功
 */
async function clickMultiStrategy(page, target) {
  const { hrefKeywords = [], texts = [] } = target;

  // 策略 1：href 包含关键词
  for (const kw of hrefKeywords) {
    try {
      const loc = page.locator(`a[href*="${kw}"]`).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        await loc.click({ timeout: 3000 });
        return true;
      }
    } catch {}
  }

  // 策略 2：getByText
  for (const t of texts) {
    try {
      const loc = page.getByText(t, { exact: true }).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
        await loc.click({ timeout: 3000 });
        return true;
      }
    } catch {}
  }

  // 策略 3：JS 在页面里找并直接触发点击（处理元素不可滚入视口/被遮挡等情况）
  const clicked = await page.evaluate(({ hrefKeywords, texts }) => {
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    }
    for (const el of document.querySelectorAll('a[href]')) {
      if (!isVisible(el)) continue;
      const href = el.getAttribute('href') || '';
      if (hrefKeywords.some((k) => href.includes(k))) {
        el.click();
        return true;
      }
    }
    const all = document.querySelectorAll('a, li, div, span');
    for (const el of all) {
      if (!isVisible(el)) continue;
      const text = (el.innerText || '').trim();
      if (!text) continue;
      if (texts.includes(text)) {
        el.click();
        return true;
      }
    }
    return false;
  }, { hrefKeywords, texts }).catch(() => false);

  return clicked;
}

/**
 * 自动模式：依次点击 139 主要菜单，触发目录浏览 API 采集
 * 任一步骤点击失败不阻塞后续动作，最大程度保证报告能生成
 * @param {import('playwright').Page} page 页面对象
 * @returns {Promise<void>}
 */
async function runAutoNavigation(page) {
  console.log('[api-probe] auto-nav: waiting 12s for initial page render and XHRs ...');
  await sleep(12_000);

  // 先 dump 一下导航结构，便于日志里定位菜单
  const menu = await dumpMenuStructure(page);
  console.log('[api-probe] auto-nav: visible nav items (top 40):');
  menu.slice(0, 40).forEach((m, i) => {
    console.log(`  [${i}] ${m.tag} "${m.text}" href="${m.href}" cls="${m.cls}"`);
  });

  const steps = [
    // 个人网盘 - 全部（默认应已加载，这里点一下保险）
    { label: '个人网盘 / 全部', target: {
      hrefKeywords: ['#/', '/personal'],
      texts: ['全部', '我的文件']
    }, wait: 6000 },
    // 家庭云 - 家庭相册
    { label: '家庭云 / 家庭相册', target: {
      hrefKeywords: ['familycloud', 'familyalbum', 'family-album'],
      texts: ['家庭相册', '我的家庭']
    }, wait: 8000 },
    // 家庭云 - 家庭文件
    { label: '家庭云 / 家庭文件', target: {
      hrefKeywords: ['familyfile', 'family-file', 'familyCloud/file'],
      texts: ['家庭文件']
    }, wait: 8000 },
    // 进入列表里第一个文件夹（拿子目录 API）
    { label: '进入第一个个人文件夹', target: null, wait: 8000, custom: async () => {
      // 先回到我的文件 / 全部
      await clickMultiStrategy(page, {
        hrefKeywords: ['#/', '/personal'],
        texts: ['全部', '我的文件']
      });
      await sleep(2000);
      // 点列表里第一个 type=folder 的条目：尝试多种可能的选择器
      return page.evaluate(() => {
        const candidates = document.querySelectorAll(
          'tr[class*="row"], .el-table__row, [class*="fileItem"], [class*="file-item"], [class*="file_item"]'
        );
        for (const row of candidates) {
          const rect = row.getBoundingClientRect();
          if (rect.width < 50) continue;
          // 模拟双击文件夹
          ['mousedown', 'mouseup', 'click', 'dblclick'].forEach((t) => {
            row.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, detail: t === 'dblclick' ? 2 : 1 }));
          });
          return true;
        }
        return false;
      }).catch(() => false);
    } }
  ];

  for (const step of steps) {
    console.log(`[api-probe] auto-nav: step "${step.label}" ...`);
    let ok;
    if (step.custom) {
      ok = await step.custom().catch(() => false);
    } else {
      ok = await clickMultiStrategy(page, step.target).catch(() => false);
    }
    console.log(`[api-probe] auto-nav:   clicked=${ok}, waiting ${step.wait}ms for XHRs`);
    await sleep(step.wait);
  }

  console.log('[api-probe] auto-nav: done.');
}

/**
 * 主流程：恢复登录态 → 打开 139 → 监听请求 → 等用户操作 → 输出报告
 * @returns {Promise<number>} 退出码
 */
async function runOnce() {
  const systemBrowserPath = resolveSystemBrowserPath();

  console.log('[api-probe] loading sessionBundle from state.json ...');
  const sessionBundle = await loadSessionBundle();
  console.log('[api-probe] sessionBundle loaded:',
    'cookies=', sessionBundle.cookies?.length || 0,
    'lsKeys=', Object.keys(sessionBundle.localStorage || {}).length,
    'ssKeys=', Object.keys(sessionBundle.sessionStorage || {}).length);

  const { storageState, sessionStorageKV } = buildStorageState(sessionBundle);

  const launchOptions = { headless: false };
  if (systemBrowserPath) {
    launchOptions.executablePath = systemBrowserPath;
    console.log('[api-probe] using system browser:', systemBrowserPath);
  } else {
    console.log('[api-probe] using Playwright managed browser');
  }

  const browser = await playwright.chromium.launch(launchOptions);
  const context = await browser.newContext({ storageState });

  /**
   * 采集到的 API 请求列表。每条记录包含请求元信息和响应预览。
   * @type {Array<Object>}
   */
  const apiLog = [];

  context.on('request', (request) => {
    try {
      const url = request.url();
      if (!isInterestingApi(url)) return;
      const parsed = new URL(url);
      apiLog.push({
        method: request.method(),
        url,
        path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams),
        headers: request.headers(),
        postData: request.postData() || null,
        responseStatus: null,
        responseContentType: null,
        responseBodyPreview: null,
        firstSeenAt: new Date().toISOString()
      });
    } catch { /* ignore */ }
  });

  context.on('response', async (response) => {
    try {
      const request = response.request();
      const url = request.url();
      if (!isInterestingApi(url)) return;
      // 找到最近一条同 URL + 同方法、响应还未填充的记录
      const entry = [...apiLog].reverse().find((e) =>
        e.method === request.method() && e.url === url && e.responseStatus === null
      );
      if (!entry) return;
      entry.responseStatus = response.status();
      entry.responseContentType = response.headers()['content-type'] || '';
      if (entry.responseContentType.includes('json') || entry.responseContentType.includes('text')) {
        const text = await response.text().catch(() => '');
        entry.responseBodyPreview = text.length > 4000 ? text.slice(0, 4000) + '...(truncated)' : text;
      }
    } catch { /* ignore */ }
  });

  const page = await context.newPage();

  console.log('[api-probe] opening 139 web ...');
  // 用 commit 级导航，避免 139 静态资源卡死触发不到 load
  await page.goto('https://yun.139.com/w/', { waitUntil: 'commit' }).catch(() => {});

  // sessionStorage 需要同域 navigate 后才能 set
  if (sessionStorageKV.length > 0) {
    await page.evaluate((kv) => {
      kv.forEach(({ name, value }) => {
        try { window.sessionStorage.setItem(name, value); } catch {}
      });
    }, sessionStorageKV).catch(() => {});
    // 刷新让 JS 重新读取 sessionStorage
    await page.reload({ waitUntil: 'commit' }).catch(() => {});
  }

  // 运行模式：默认 auto（脚本自动点击），--manual 切换为用户手动点击
  const mode = process.argv.includes('--manual') ? 'manual' : 'auto';
  console.log('[api-probe] run mode:', mode);

  if (mode === 'manual') {
    console.log('');
    console.log('============================================================');
    console.log('浏览器已打开并恢复登录态。请按下面顺序在浏览器里手动操作：');
    console.log('  1. 左侧选择【我的文件 → 全部】，点开任意一个文件夹，再返回');
    console.log('  2. 再点开另外一个文件夹，观察目录列表加载');
    console.log('  3. 切换到【我的家庭 → 家庭相册】，进入一个相册后再返回');
    console.log('  4. 若有【家庭文件】，也进去点开一级目录');
    console.log('  5. （可选）在任一目录尝试【新建文件夹】观察接口');
    console.log('完成以上操作后，回到终端按 Ctrl+C 结束。脚本 120 秒后也会自动结束。');
    console.log('============================================================');
    console.log('');
    await new Promise((resolve) => {
      const done = () => resolve();
      process.once('SIGINT', done);
      setTimeout(done, 120_000);
    });
  } else {
    // 自动模式：脚本依次点击 139 主要菜单，采集请求
    await runAutoNavigation(page);
  }

  // 导出报告
  const outputsDir = path.join(__dirname, 'outputs');
  if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });
  const outputFile = path.join(outputsDir, '139-api-探测报告.json');

  const uniqueEndpoints = [...new Set(apiLog.map((e) => e.method + ' ' + e.path))].sort();
  // 报告落盘前统一脱敏 headers，避免 authorization / mcloud-sign / cookie 等凭据被写入文件
  const sanitizedRequests = apiLog.map((entry) => ({
    ...entry,
    headers: sanitizeHeaders(entry.headers)
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    totalRequests: apiLog.length,
    uniqueEndpoints,
    // 说明字段：让 reviewer 一眼看出该报告已脱敏
    sanitized: true,
    sensitiveHeaderNames: [...SENSITIVE_HEADER_NAMES],
    requests: sanitizedRequests
  };

  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf-8');

  console.log('');
  console.log('[api-probe] 采集业务 API 请求总数:', apiLog.length);
  console.log('[api-probe] 去重后的接口列表:');
  uniqueEndpoints.forEach((k) => console.log('  -', k));
  console.log('[api-probe] 报告已写入:', outputFile);

  await browser.close().catch(() => {});
  return 0;
}

/**
 * 入口：设置硬超时保护
 */
async function main() {
  const HARD_TIMEOUT_MS = 150_000;
  try {
    const code = await Promise.race([runOnce(), rejectAfter(HARD_TIMEOUT_MS)]);
    process.exit(code);
  } catch (error) {
    console.error('[api-probe] error:', error.message);
    process.exit(3);
  }
}

main();
