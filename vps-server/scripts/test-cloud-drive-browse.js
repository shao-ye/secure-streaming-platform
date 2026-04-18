#!/usr/bin/env node

/**
 * CloudDriveBrowseService 集成测试脚本
 *
 * 用途：
 *   依次验证 browsePersonal（根 + 子目录）、browseFamily、browseFamilyAlbums
 *   三个方法能否正常返回。默认使用 headful 浏览器方便肉眼确认，生产环境则由
 *   VPS 服务以 headless 模式运行。
 *
 * 前置：
 *   已通过 scripts/test-cloud-drive-auto-login.js 完成本地登录，state.json
 *   的 sessionBundleEncrypted 已填充。
 *
 * 超时：整体 150 秒硬超时。
 */

require('dotenv').config();

const fs = require('fs');
const playwright = require('playwright');
const CloudDriveBrowseService = require('../src/services/cloud-drive/CloudDriveBrowseService');

/**
 * 查找本机可用的 Chrome / Edge，测试时复用避免下载内置 Chromium
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

// 测试时让 BrowseService 使用系统浏览器
if (systemBrowserPath) {
  CloudDriveBrowseService.prototype.loadPlaywright = function () {
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

async function runOnce() {
  // 测试中保留 headful 方便观察；生产环境 new 时传 { headless: true }
  const service = new CloudDriveBrowseService({ headless: false });

  try {
    console.log('=== 1. browsePersonal root ===');
    const root = await service.browsePersonal({ parentFileId: '/', pageSize: 50 });
    console.log('items:', root.items.length);
    root.items.slice(0, 8).forEach((x) => console.log(`  - [${x.type}] ${x.name}  id=${x.id}`));

    const firstFolder = root.items.find((x) => x.type === 'folder');
    if (firstFolder) {
      console.log(`\n=== 2. browsePersonal child (${firstFolder.name}) ===`);
      const child = await service.browsePersonal({ parentFileId: firstFolder.id, pageSize: 50 });
      console.log('items:', child.items.length);
      child.items.slice(0, 5).forEach((x) => console.log(`  - [${x.type}] ${x.name}`));
    }

    console.log('\n=== 3. browseFamily ===');
    const family = await service.browseFamily();
    console.log('families:', family.families.length);
    family.families.forEach((f) => console.log(`  - ${f.name}  id=${f.id}`));

    if (family.families.length > 0) {
      const firstCloud = family.families[0];
      console.log(`\n=== 4. browseFamilyAlbums (${firstCloud.name}) ===`);
      const albums = await service.browseFamilyAlbums({ cloudId: firstCloud.id });
      console.log('albums:', albums.albums.length);
      albums.albums.forEach((a) => console.log(`  - ${a.name}  id=${a.id}`));
    }

    console.log('\n[browse-test] 全部通过 ✔');
    return 0;
  } catch (e) {
    console.error('[browse-test] FAILED:', e.message);
    return 2;
  } finally {
    await service.dispose().catch(() => {});
  }
}

async function main() {
  try {
    const code = await Promise.race([runOnce(), rejectAfter(150_000)]);
    process.exit(code);
  } catch (e) {
    console.error('[browse-test] fatal:', e.message);
    process.exit(3);
  }
}

main();
