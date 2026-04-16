#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const playwright = require('playwright');
const CloudDriveLoginExecutor = require('../src/services/cloud-drive/CloudDriveLoginExecutor');
const CloudDriveService = require('../src/services/CloudDriveService');

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

async function main() {
  const account = (process.argv[2] || '').trim();

  if (!/^\d{11}$/.test(account)) {
    console.error('Usage: node scripts/test-cloud-drive-send-sms.js <11-digit-phone>');
    process.exit(1);
  }

  const service = new CloudDriveService();

  console.log(`[cloud-drive] sending sms code for ${account} ...`);
  if (systemBrowserPath) {
    console.log(`[cloud-drive] using system browser: ${systemBrowserPath}`);
  } else {
    console.log('[cloud-drive] using Playwright managed browser');
  }

  try {
    const result = await service.sendSms({ account });
    const output = {
      statusCode: result.statusCode,
      payload: result.payload
    };

    console.log(JSON.stringify(output, null, 2));

    if (result.statusCode === 200 && result.payload?.status === 'success') {
      console.log('[cloud-drive] sms request accepted');
      process.exit(0);
    }

    console.error('[cloud-drive] sms request failed');
    process.exit(2);
  } catch (error) {
    console.error('[cloud-drive] unexpected error:', error.message);
    process.exit(3);
  }
}

main();
