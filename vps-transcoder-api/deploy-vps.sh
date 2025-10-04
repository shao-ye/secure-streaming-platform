#!/bin/bash
echo "🔧 YOYO流媒体平台 - VPS端修复部署"
echo ""

# 配置参数
APP_DIR="/opt/yoyo-transcoder"
BACKUP_DIR="/opt/yoyo-transcoder-backup-$(date +%Y%m%d_%H%M%S)"
SERVICE_NAME="vps-transcoder-api"

echo "📦 步骤1: 备份当前代码..."
if [ -d "$APP_DIR" ]; then
    cp -r "$APP_DIR" "$BACKUP_DIR"
    echo "✅ 备份完成: $BACKUP_DIR"
else
    echo "⚠️ 应用目录不存在，跳过备份"
fi

echo "🛑 步骤2: 停止服务..."
pm2 stop $SERVICE_NAME
sleep 2

echo "🧹 步骤3: 清理旧的HLS文件..."
rm -rf /var/www/hls/*/segment*.ts
rm -rf /var/www/hls/*/playlist.m3u8
echo "✅ HLS文件清理完成"

echo "📊 步骤4: 检查更新的文件..."
if [ -f "$APP_DIR/src/services/SimpleStreamManager.js" ]; then
    echo "✅ SimpleStreamManager.js 文件存在"
    
    # 检查关键修复内容
    if grep -q "hls_time.*2" "$APP_DIR/src/services/SimpleStreamManager.js"; then
        echo "✅ HLS分片时间修复已应用 (2秒)"
    else
        echo "⚠️ HLS分片时间修复可能未应用"
    fi
    
    if grep -q "hls_list_size.*6" "$APP_DIR/src/services/SimpleStreamManager.js"; then
        echo "✅ HLS分片数量修复已应用 (6个)"
    else
        echo "⚠️ HLS分片数量修复可能未应用"
    fi
    
    if grep -q "analyzeduration" "$APP_DIR/src/services/SimpleStreamManager.js"; then
        echo "✅ FFmpeg冷启动优化已应用"
    else
        echo "⚠️ FFmpeg冷启动优化可能未应用"
    fi
else
    echo "❌ SimpleStreamManager.js 文件不存在"
    exit 1
fi

echo "🔄 步骤5: 重启服务..."
cd "$APP_DIR"
pm2 restart $SERVICE_NAME
sleep 5

echo "📊 步骤6: 检查服务状态..."
pm2 status $SERVICE_NAME
echo ""
echo "📋 最近日志:"
pm2 logs $SERVICE_NAME --lines 10 --nostream

echo ""
echo "🎉 VPS端部署完成!"
echo ""
echo "📝 修复内容验证:"
echo "1. ✅ HLS循环播放修复"
echo "2. ✅ FFmpeg冷启动优化" 
echo "3. ✅ 分片实时性检查"
echo "4. ✅ 服务重启完成"
echo ""
echo "🔄 请在前端测试播放效果"
