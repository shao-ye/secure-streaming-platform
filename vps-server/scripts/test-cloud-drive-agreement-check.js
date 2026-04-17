#!/usr/bin/env node

/**
 * 中国移动云盘协议勾选调试脚本
 * 用途：在本地用 Playwright 打开 139 登录页，单独验证 ensureAgreementAccepted
 *       能否真正把协议勾选框勾上（通过观察 <img> 的 src 前后变化判定）。
 * 不执行：不填手机号、不发短信、不提交登录。
 * 超时：整个过程强制 90 秒总超时，避免浏览器卡死导致调试会话挂住。
 *
 * 运行示例（PowerShell）：
 *   node scripts/test-cloud-drive-agreement-check.js
 */

require('dotenv').config();

const fs = require('fs');
const playwright = require('playwright');
const CloudDriveLoginExecutor = require('../src/services/cloud-drive/CloudDriveLoginExecutor');

/**
 * 查找本机可用的 Chrome / Edge 可执行路径
 * 优先使用环境变量 CLOUD_DRIVE_BROWSER_PATH，其次按常见安装目录顺序查找
 * @returns {string} 可执行路径；未找到时返回空字符串，交由 Playwright 内置浏览器处理
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

const systemBrowserPath = resolveSystemBrowserPath();

// 若找到系统浏览器（尤其是 Windows 开发机），复用它而非下载 Playwright 的内置 Chromium
if (systemBrowserPath) {
  CloudDriveLoginExecutor.prototype.loadPlaywright = function loadPlaywrightFromSystemBrowser() {
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

/**
 * 截断超长字符串，便于控制台输出 <img> 的 base64 src
 * @param {string} value 原值
 * @param {number} max 保留长度
 * @returns {string} 截断后的可读字符串
 */
function truncate(value, max = 80) {
  if (!value) return '(null)';
  if (value.length <= max) return value;
  return value.slice(0, max) + '...(' + value.length + ' chars)';
}

/**
 * 总超时守护：到点后 reject，让上层强制退出
 * @param {number} ms 超时毫秒数
 * @returns {Promise<never>} 永远不会 resolve 的 Promise
 */
function rejectAfter(ms) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`hard timeout after ${ms}ms`)), ms);
    // unref 避免 timer 阻止进程退出
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * 单次调试流程：打开 139 → 切到短信登录 → 调用 ensureAgreementAccepted → 对比 img.src
 * @returns {Promise<number>} 0=勾选成功，2=未生效
 */
async function runOnce() {
  const executor = new CloudDriveLoginExecutor();
  const { chromium } = executor.loadPlaywright();

  console.log('[agreement-check] launching browser (headed) ...');
  if (systemBrowserPath) {
    console.log('[agreement-check] using system browser:', systemBrowserPath);
  } else {
    console.log('[agreement-check] using Playwright managed browser');
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[agreement-check] opening 139 login page ...');
    await executor.navigateToLoginPage(page);

    console.log('[agreement-check] switching to sms-login tab ...');
    await executor.ensureSmsLoginTab(page);

    // 观测协议图元素，取点击前的 src
    const imgLocator = page.locator('.code-sms-check-img-wrap img').first();
    const visibleBefore = await imgLocator.isVisible().catch(() => false);
    console.log('[agreement-check] img visible before click:', visibleBefore);

    const srcBefore = await imgLocator.getAttribute('src').catch(() => null);
    console.log('[agreement-check] img.src BEFORE:', truncate(srcBefore));

    // 执行待验证的主流程
    console.log('[agreement-check] invoking ensureAgreementAccepted ...');
    await executor.ensureAgreementAccepted(page);

    const srcAfter = await imgLocator.getAttribute('src').catch(() => null);
    console.log('[agreement-check] img.src AFTER :', truncate(srcAfter));

    const changed = !!(srcBefore && srcAfter && srcBefore !== srcAfter);
    console.log('[agreement-check] src changed:', changed);

    if (changed) {
      console.log('[agreement-check] RESULT = PASS  (协议已成功勾选)');
      return 0;
    }

    // 额外观察：错误提示文本是否可见，辅助诊断
    const promptVisible = await executor.hasAgreementPrompt(page);
    console.log('[agreement-check] error-prompt visible:', promptVisible);
    console.log('[agreement-check] RESULT = FAIL  (协议勾选未生效，请在 Chrome 窗口目视确认)');
    return 2;
  } finally {
    // 保留 3 秒供肉眼观察勾选框的视觉状态，再关闭浏览器
    await new Promise((r) => setTimeout(r, 3000));
    await browser.close().catch(() => {});
  }
}

/**
 * 入口：设置硬超时保护，避免浏览器/网络异常导致脚本挂住
 */
async function main() {
  const HARD_TIMEOUT_MS = 90_000;
  try {
    const exitCode = await Promise.race([
      runOnce(),
      rejectAfter(HARD_TIMEOUT_MS)
    ]);
    process.exit(exitCode);
  } catch (error) {
    console.error('[agreement-check] error:', error.message);
    process.exit(3);
  }
}

main();
