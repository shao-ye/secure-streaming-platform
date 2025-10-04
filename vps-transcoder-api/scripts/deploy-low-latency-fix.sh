#!/bin/bash

# 部署低延迟FFmpeg优化代码到VPS服务器
# 服务器: 142.171.75.220

VPS_IP="142.171.75.220"
VPS_USER="root"
PROJECT_DIR="/root/vps-transcoder-api"
LOCAL_SRC="./vps-transcoder-api/src/services/ProcessManager.js"

echo "=== 部署低延迟FFmpeg优化代码 ==="
echo "目标服务器: $VPS_IP"
echo "部署时间: $(date)"
echo ""

# 1. 检查VPS连接
echo "1. 检查VPS服务器连接..."
ssh -o ConnectTimeout=10 $VPS_USER@$VPS_IP "echo 'VPS连接成功'" || {
    echo "❌ 无法连接到VPS服务器"
    exit 1
}

# 2. 备份当前ProcessManager.js
echo "2. 备份当前ProcessManager.js..."
ssh $VPS_USER@$VPS_IP "cp $PROJECT_DIR/src/services/ProcessManager.js $PROJECT_DIR/src/services/ProcessManager.js.backup.$(date +%Y%m%d_%H%M%S)" || {
    echo "❌ 备份失败"
    exit 1
}

# 3. 上传优化后的ProcessManager.js
echo "3. 上传优化后的ProcessManager.js..."
scp "$LOCAL_SRC" "$VPS_USER@$VPS_IP:$PROJECT_DIR/src/services/ProcessManager.js" || {
    echo "❌ 文件上传失败"
    exit 1
}

# 4. 验证文件上传
echo "4. 验证文件上传..."
ssh $VPS_USER@$VPS_IP "ls -la $PROJECT_DIR/src/services/ProcessManager.js && echo '文件上传成功'"

# 5. 检查当前运行的转码进程
echo "5. 检查当前运行的转码进程..."
ssh $VPS_USER@$VPS_IP "pm2 list | grep vps-transcoder-api"

# 6. 重启转码API服务应用新配置
echo "6. 重启转码API服务..."
ssh $VPS_USER@$VPS_IP "cd $PROJECT_DIR && pm2 restart vps-transcoder-api" || {
    echo "❌ 服务重启失败"
    exit 1
}

# 7. 检查服务状态
echo "7. 检查服务状态..."
ssh $VPS_USER@$VPS_IP "pm2 status vps-transcoder-api"

# 8. 验证服务健康状态
echo "8. 验证服务健康状态..."
ssh $VPS_USER@$VPS_IP "curl -s http://localhost:3000/health | head -5"

echo ""
echo "=== 部署完成 ==="
echo "✅ 低延迟FFmpeg优化代码已成功部署到VPS"
echo "✅ 转码API服务已重启并应用新配置"
echo ""
echo "优化内容："
echo "- HLS分片时间: 2秒 → 1秒"
echo "- 播放列表大小: 6个分片 → 3个分片"
echo "- 添加低延迟FFmpeg参数"
echo "- 预期延迟: 12-15秒 → 3-4秒"
echo ""
echo "请测试新的转码流延迟效果！"
