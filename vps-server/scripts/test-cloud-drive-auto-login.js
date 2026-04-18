#!/usr/bin/env node

/**
 * 中国移动云盘本地单进程登录脚本
 *
 * 用途：
 *   CloudDriveService.validateLogin 必须在 service.activeLoginSession 存活的同一个
 *   进程里调用。本脚本在一个进程里串联：
 *     1. sendSms 触发 139 发送验证码
 *     2. 轮询 data/cloud-drive/sms-code.txt 等待用户写入 6 位验证码
 *     3. validateLogin 提交验证码完成登录
 *   登录成功后本地 data/cloud-drive/state.json 的 sessionBundleEncrypted 会被填充，
 *   供后续探测脚本 test-cloud-drive-api-probe.js 复用登录态。
 *
 * 使用示例（PowerShell）：
 *   node scripts/test-cloud-drive-auto-login.js 13800138000
 *   # 看到 "SMS sent, waiting..." 后，在另一个终端写入验证码：
 *   Set-Content -Path data\cloud-drive\sms-code.txt -Value '123456' -Encoding ASCII -NoNewline
 *
 * 超时：整体 6 分钟硬超时；等待验证码的窗口 5 分钟。
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const CloudDriveLoginExecutor = require('../src/services/cloud-drive/CloudDriveLoginExecutor');
const CloudDriveService = require('../src/services/CloudDriveService');

/**
 * 查找本机可用的 Chrome / Edge 可执行路径
 * @returns {string} 可执行路径；未找到返回空字符串
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

// 复用系统浏览器，避免等待 Playwright 下载内置 Chromium
const systemBrowserPath = resolveSystemBrowserPath();
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
 * 健壮的验证码文件读取：兼容 PowerShell 写入时可能的多种编码（UTF-8 BOM / UTF-16 LE BOM / ASCII / UTF-8）
 * @param {string} filePath 文件路径
 * @returns {string} 已去除 BOM 与空白、提取出的纯数字验证码；若无法解析返回空字符串
 */
function readSmsCodeRobust(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    let content = '';
    // UTF-16 LE BOM (FF FE)
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
      content = buffer.toString('utf16le', 2);
    }
    // UTF-8 BOM (EF BB BF)
    else if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      content = buffer.toString('utf8', 3);
    } else {
      content = buffer.toString('utf8');
    }
    // 清除不可见字符，仅保留连续数字
    const matched = (content || '').replace(/\s+/g, '').match(/\d{4,8}/);
    return matched ? matched[0] : '';
  } catch {
    return '';
  }
}

/**
 * 轮询等待验证码文件写入
 * @param {string} filePath 等待的文件
 * @param {number} timeoutMs 总等待超时
 * @returns {Promise<string>} 读取到的验证码；超时返回空串
 */
async function waitForSmsCode(filePath, timeoutMs) {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const code = readSmsCodeRobust(filePath);
      if (code) return code;
    }
    // 每 30 秒输出一次心跳，方便观察脚本没死
    const elapsed = Date.now() - start;
    if (elapsed - lastLog >= 30_000) {
      const remain = Math.ceil((timeoutMs - elapsed) / 1000);
      console.log(`[auto-login] still waiting SMS code ... ${remain}s remaining`);
      lastLog = elapsed;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return '';
}

/**
 * 硬超时守护
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
 * 主流程
 */
async function runOnce() {
  const account = (process.argv[2] || '').trim();
  if (!/^\d{11}$/.test(account)) {
    console.error('Usage: node scripts/test-cloud-drive-auto-login.js <11-digit-phone>');
    return 1;
  }

  const service = new CloudDriveService();
  const smsFile = path.join(process.cwd(), 'data', 'cloud-drive', 'sms-code.txt');

  // 清理遗留验证码文件，避免读到旧值
  if (fs.existsSync(smsFile)) {
    try { fs.unlinkSync(smsFile); } catch {}
  }

  console.log('[auto-login] account:', account);
  if (systemBrowserPath) {
    console.log('[auto-login] using system browser:', systemBrowserPath);
  }

  // Step 1 - 发送验证码
  console.log('[auto-login] step 1/3: sending SMS code ...');
  const sendResult = await service.sendSms({ account });
  const sendOk = sendResult.statusCode === 200 && sendResult.payload?.status === 'success';
  if (!sendOk) {
    console.error('[auto-login] sendSms failed:', JSON.stringify(sendResult.payload, null, 2));
    await service.clearActiveLoginSession().catch(() => {});
    return 2;
  }
  console.log('[auto-login] sendSms response:', JSON.stringify(sendResult.payload?.data || {}, null, 2));

  // Step 2 - 等验证码写入文件
  console.log('[auto-login] step 2/3: waiting for SMS code file:', smsFile);
  console.log('[auto-login]   写入命令 (PowerShell)：');
  console.log('[auto-login]   Set-Content -Path data\\cloud-drive\\sms-code.txt -Value \'XXXXXX\' -Encoding ASCII -NoNewline');

  const smsCode = await waitForSmsCode(smsFile, 5 * 60 * 1000);
  if (!smsCode) {
    console.error('[auto-login] timeout waiting for SMS code (5 minutes)');
    await service.clearActiveLoginSession().catch(() => {});
    return 4;
  }
  console.log('[auto-login] got SMS code:', smsCode);

  // Step 3 - 提交验证码
  console.log('[auto-login] step 3/3: submitting SMS code ...');
  const submitResult = await service.validateLogin({ account, smsCode });
  console.log('[auto-login] validateLogin response:',
    JSON.stringify({
      statusCode: submitResult.statusCode,
      status: submitResult.payload?.status,
      message: submitResult.payload?.message,
      authStatus: submitResult.payload?.data?.cloudDrive?.authStatus,
      sessionBundleSummary: submitResult.payload?.data?.cloudDrive?.sessionBundleSummary
    }, null, 2));

  // 清理 sms-code.txt，避免遗留
  if (fs.existsSync(smsFile)) {
    try { fs.unlinkSync(smsFile); } catch {}
  }

  const submitOk = submitResult.statusCode === 200 && submitResult.payload?.status === 'success';
  if (!submitOk) {
    return 5;
  }

  // 验证 state.json 是否真的写入了 sessionBundleEncrypted
  const state = service.loadState();
  console.log('[auto-login] state.json.sessionBundleEncrypted length:',
    state.sessionBundleEncrypted?.length || 0);
  if (!state.sessionBundleEncrypted) {
    console.error('[auto-login] WARNING: state.json has no sessionBundleEncrypted after login!');
    return 6;
  }

  console.log('[auto-login] DONE  本地登录完成，state.json 已保存会话包');
  return 0;
}

/**
 * 入口：设置硬超时保护
 */
async function main() {
  const HARD_TIMEOUT_MS = 6 * 60 * 1000; // 6 分钟
  try {
    const code = await Promise.race([runOnce(), rejectAfter(HARD_TIMEOUT_MS)]);
    process.exit(code);
  } catch (error) {
    console.error('[auto-login] fatal error:', error.message);
    process.exit(3);
  }
}

main();
