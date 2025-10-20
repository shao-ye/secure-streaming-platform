#!/bin/bash

# VPS转码服务修复部署脚本
# 解决频道播放问题：同步最新的SimpleStreamManager代码

echo "=== VPS转码服务修复部署脚本 ==="
echo "时间: $(date)"
echo ""

# 设置变量
VPS_IP="142.171.75.220"
VPS_USER="root"
VPS_SERVICE_DIR="/opt/yoyo-transcoder"
LOCAL_SOURCE_DIR="./temp_vps_sync_new/src"

echo "🎯 目标VPS: $VPS_IP"
echo "📁 服务目录: $VPS_SERVICE_DIR"
echo "📦 本地源码: $LOCAL_SOURCE_DIR"
echo ""

# 1. 检查本地源码目录
if [ ! -d "$LOCAL_SOURCE_DIR" ]; then
    echo "❌ 本地源码目录不存在: $LOCAL_SOURCE_DIR"
    exit 1
fi

echo "✅ 本地源码目录存在"

# 2. 备份VPS上的现有代码
echo ""
echo "💾 备份VPS现有代码..."
ssh -o ConnectTimeout=10 $VPS_USER@$VPS_IP "
    cd $VPS_SERVICE_DIR
    if [ -d src ]; then
        cp -r src src_backup_$(date +%Y%m%d_%H%M%S)
        echo '✅ 代码已备份'
    else
        echo '⚠️ 源码目录不存在，跳过备份'
    fi
"

# 3. 停止服务
echo ""
echo "🛑 停止转码服务..."
ssh -o ConnectTimeout=10 $VPS_USER@$VPS_IP "
    pm2 stop vps-transcoder-api || echo '服务未运行'
    sleep 2
"

# 4. 同步最新代码
echo ""
echo "📤 同步最新代码到VPS..."
scp -r "$LOCAL_SOURCE_DIR" "$VPS_USER@$VPS_IP:$VPS_SERVICE_DIR/"

# 5. 安装依赖
echo ""
echo "📦 安装/更新依赖..."
ssh -o ConnectTimeout=10 $VPS_USER@$VPS_IP "
    cd $VPS_SERVICE_DIR
    npm install --production
    echo '✅ 依赖安装完成'
"

# 6. 清理旧的HLS文件
echo ""
echo "🧹 清理旧的HLS文件..."
ssh -o ConnectTimeout=10 $VPS_USER@$VPS_IP "
    rm -rf /var/www/hls/stream_*
    mkdir -p /var/www/hls
    chmod -R 755 /var/www/hls
    chown -R www-data:www-data /var/www/hls
    echo '✅ HLS目录已清理'
"

# 7. 重启服务
echo ""
echo "🔄 重启转码服务..."
ssh -o ConnectTimeout=10 $VPS_USER@$VPS_IP "
    cd $VPS_SERVICE_DIR
    pm2 start ecosystem.config.js || pm2 restart vps-transcoder-api
    sleep 3
    pm2 status
"

# 8. 验证服务状态
echo ""
echo "🧪 验证服务状态..."
sleep 5

# 测试基础API
echo "测试基础API..."
curl -s "http://$VPS_IP:3000/api/status" | jq . || echo "基础API测试失败"

# 测试SimpleStreamManager API
echo ""
echo "测试SimpleStreamManager API..."
curl -s "http://$VPS_IP:3000/api/simple-stream/health" | jq . || echo "SimpleStreamManager API测试失败"

echo ""
echo "🎉 部署完成！"
echo ""
echo "📋 后续测试步骤："
echo "1. 在浏览器中测试频道播放"
echo "2. 检查HLS文件是否正常生成"
echo "3. 验证频道切换功能"
echo ""
echo "🔍 如果还有问题，请检查："
echo "- pm2 logs vps-transcoder-api"
echo "- /var/www/hls/ 目录权限"
echo "- FFmpeg是否正确安装"
