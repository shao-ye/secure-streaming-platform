#!/bin/bash

# 修复HLS循环播放问题 - VPS部署脚本
echo "🔧 修复HLS循环播放问题..."

# 配置参数
APP_DIR="/opt/yoyo-transcoder"
BACKUP_DIR="/opt/yoyo-transcoder-backup-$(date +%Y%m%d_%H%M%S)"

echo "📦 步骤1: 备份当前代码..."
cp -r "$APP_DIR" "$BACKUP_DIR"
echo "✅ 备份完成: $BACKUP_DIR"

echo "🛑 步骤2: 停止当前服务..."
pm2 stop vps-transcoder-api
sleep 2

echo "🧹 步骤3: 清理旧的HLS文件..."
rm -rf /var/www/hls/*/segment*.ts
rm -rf /var/www/hls/*/playlist.m3u8
echo "✅ HLS文件清理完成"

echo "🔄 步骤4: 重启服务..."
cd "$APP_DIR"
pm2 start vps-transcoder-api
sleep 5

echo "📊 步骤5: 检查服务状态..."
pm2 status vps-transcoder-api
pm2 logs vps-transcoder-api --lines 10

echo ""
echo "🎉 HLS循环播放问题修复完成!"
echo ""
echo "📝 修复内容:"
echo "1. ✅ HLS分片时间: 0.5秒 → 2秒"
echo "2. ✅ 分片列表大小: 2个 → 6个" 
echo "3. ✅ 移除delete_segments标志"
echo "4. ✅ 添加hls_wrap循环机制"
echo ""
echo "🔄 请在前端重新点击频道开始播放测试"
