/**
 * 简化版启动脚本
 * 解决模块加载问题
 */

console.log('🚀 Initializing VPS Transcoder API...');

// 检查Node.js版本
const nodeVersion = process.version;
console.log(`Node.js version: ${nodeVersion}`);

if (parseInt(nodeVersion.slice(1).split('.')[0]) < 18) {
    console.error('❌ Node.js version 18 or higher is required');
    process.exit(1);
}

// 检查关键文件
const fs = require('fs');
const path = require('path');

const requiredFiles = [
    'package.json',
    '.env',
    'src/app.js'
];

console.log('🔍 Checking required files...');
for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
        console.log(`✅ Found: ${file}`);
    } else {
        console.error(`❌ Missing: ${file}`);
        if (file === '.env') {
            console.log('Creating default .env file...');
            const defaultEnv = `# 服务器配置
PORT=3000
NODE_ENV=development

# API安全配置
API_SECRET_KEY=test-api-key-change-in-production

# FFmpeg配置
FFMPEG_PATH=/usr/bin/ffmpeg
HLS_OUTPUT_DIR=./hls
HLS_SEGMENT_TIME=2
HLS_LIST_SIZE=6

# 日志配置
LOG_LEVEL=info
LOG_DIR=./logs

# Cloudflare IP范围验证 (开发环境关闭)
ENABLE_IP_WHITELIST=false`;

            fs.writeFileSync('.env', defaultEnv);
            console.log('✅ Created default .env file');
        }
    }
}

// 启动应用
try {
    console.log('🎯 Starting application...');
    require('./src/app.js');
} catch (error) {
    console.error('❌ Failed to start application:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}
