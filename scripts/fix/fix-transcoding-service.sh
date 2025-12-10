#!/bin/bash

# YOYO转码服务修复脚本
# 解决频道播放问题：频道一无法播放，频道二延迟7分钟

echo "=== YOYO转码服务修复脚本 ==="
echo "时间: $(date)"
echo ""

# 1. 清理过期的HLS文件
echo "🧹 清理过期HLS文件..."
rm -rf /var/www/hls/stream_*
mkdir -p /var/www/hls
chmod 755 /var/www/hls
echo "✅ HLS目录已清理"

# 2. 检查FFmpeg安装
echo ""
echo "🔍 检查FFmpeg安装状态..."
if command -v ffmpeg &> /dev/null; then
    echo "✅ FFmpeg已安装: $(ffmpeg -version | head -n1)"
else
    echo "❌ FFmpeg未安装，正在安装..."
    apt update
    apt install -y ffmpeg
    echo "✅ FFmpeg安装完成"
fi

# 3. 检查Node.js服务目录
echo ""
echo "🔍 检查服务目录结构..."
SERVICE_DIR="/opt/yoyo-transcoder"
if [ -d "$SERVICE_DIR" ]; then
    echo "✅ 服务目录存在: $SERVICE_DIR"
    ls -la "$SERVICE_DIR"
else
    echo "❌ 服务目录不存在，创建目录..."
    mkdir -p "$SERVICE_DIR"
    echo "✅ 服务目录已创建"
fi

# 4. 检查当前运行的进程
echo ""
echo "🔍 检查当前进程状态..."
echo "Node.js进程:"
ps aux | grep node | grep -v grep || echo "无Node.js进程"
echo ""
echo "FFmpeg进程:"
ps aux | grep ffmpeg | grep -v grep || echo "无FFmpeg进程"

# 5. 重启转码服务
echo ""
echo "🔄 重启转码服务..."
cd "$SERVICE_DIR"
pm2 reload vps-transcoder-api || pm2 restart vps-transcoder-api
sleep 3
pm2 status

# 6. 测试服务状态
echo ""
echo "🧪 测试服务状态..."
curl -s http://localhost:3000/api/status | jq . || echo "API测试失败"

# 7. 检查Nginx配置
echo ""
echo "🔍 检查Nginx配置..."
nginx -t && echo "✅ Nginx配置正确" || echo "❌ Nginx配置有误"

# 8. 创建测试HLS目录
echo ""
echo "📁 创建测试目录结构..."
mkdir -p /var/www/hls/stream_ensxma2g
mkdir -p /var/www/hls/stream_gkg5hknc
chown -R www-data:www-data /var/www/hls
chmod -R 755 /var/www/hls
echo "✅ 目录权限已设置"

echo ""
echo "🎉 修复脚本执行完成！"
echo "请测试频道播放功能"
