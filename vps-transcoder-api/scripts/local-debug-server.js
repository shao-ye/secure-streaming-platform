/**
 * 本地调试服务器 - 用于测试VPS转码API功能
 * 可以在本地环境中调试转码逻辑，无需部署到VPS
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// 设置本地环境变量
process.env.NODE_ENV = 'development';
process.env.PORT = '3001';
process.env.API_KEY = '85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938';
process.env.HLS_OUTPUT_DIR = path.join(__dirname, '..', 'debug-hls');
process.env.LOG_DIR = path.join(__dirname, '..', 'debug-logs');

// Windows环境下的FFmpeg路径（需要安装FFmpeg）
if (process.platform === 'win32') {
    // 常见的FFmpeg安装路径
    const possiblePaths = [
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'ffmpeg.exe' // 如果在PATH中
    ];
    
    for (const ffmpegPath of possiblePaths) {
        try {
            if (fs.existsSync(ffmpegPath) || ffmpegPath === 'ffmpeg.exe') {
                process.env.FFMPEG_PATH = ffmpegPath;
                break;
            }
        } catch (e) {
            // 继续尝试下一个路径
        }
    }
}

console.log('🔧 本地调试环境配置:');
console.log(`📁 HLS输出目录: ${process.env.HLS_OUTPUT_DIR}`);
console.log(`📝 日志目录: ${process.env.LOG_DIR}`);
console.log(`🎬 FFmpeg路径: ${process.env.FFMPEG_PATH || '未找到FFmpeg'}`);

// 创建必要的目录
if (!fs.existsSync(process.env.HLS_OUTPUT_DIR)) {
    fs.mkdirSync(process.env.HLS_OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(process.env.LOG_DIR)) {
    fs.mkdirSync(process.env.LOG_DIR, { recursive: true });
}

// 导入主应用
const app = require('../vps-transcoder-api/src/app');

const PORT = process.env.PORT;

// 启动调试服务器
app.listen(PORT, '127.0.0.1', () => {
    console.log('🚀 本地调试服务器启动成功!');
    console.log(`📍 服务地址: http://localhost:${PORT}`);
    console.log(`🏥 健康检查: http://localhost:${PORT}/health`);
    console.log(`📊 API状态: http://localhost:${PORT}/api/status`);
    console.log('');
    console.log('🧪 测试命令:');
    console.log(`curl -H "X-API-Key: ${process.env.API_KEY}" http://localhost:${PORT}/api/status`);
    console.log('');
    console.log('🎯 转码测试:');
    console.log(`curl -X POST -H "Content-Type: application/json" -H "X-API-Key: ${process.env.API_KEY}" -d '{"streamId":"test_local","rtmpUrl":"rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"}' http://localhost:${PORT}/api/start-stream`);
    console.log('');
    
    if (!process.env.FFMPEG_PATH) {
        console.log('⚠️  警告: 未找到FFmpeg，转码功能将无法工作');
        console.log('请安装FFmpeg并确保在PATH中，或设置FFMPEG_PATH环境变量');
        console.log('FFmpeg下载: https://ffmpeg.org/download.html');
    }
    
    console.log('按 Ctrl+C 停止服务器');
});
