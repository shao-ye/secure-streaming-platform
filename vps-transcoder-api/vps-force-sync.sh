#!/bin/bash

# VPS强制同步脚本 - 专门解决ProxyManager_v2.js更新问题
# 确保代码真正同步到运行目录

echo "🔧 VPS强制同步 - $(date)"

# 配置路径
GIT_DIR="/tmp/github/secure-streaming-platform/vps-transcoder-api"
SOURCE_FILE="$GIT_DIR/vps-transcoder-api/src/services/ProxyManager_v2.js"
TARGET_FILE="/opt/yoyo-transcoder/src/services/ProxyManager_v2.js"

echo "📁 检查源文件..."
if [ ! -f "$SOURCE_FILE" ]; then
    echo "❌ 源文件不存在: $SOURCE_FILE"
    exit 1
fi

echo "📥 拉取最新代码..."
cd "$GIT_DIR" || exit 1
git pull origin master

echo "🔍 检查源文件内容..."
if grep -q "method: 'real_test'" "$SOURCE_FILE"; then
    echo "✅ 源文件包含正确的 'real_test' 方法"
else
    echo "❌ 源文件仍包含 'vps_validation' 方法"
    echo "📋 源文件内容预览:"
    grep -A 5 -B 5 "method:" "$SOURCE_FILE" | head -20
    exit 1
fi

echo "💾 备份目标文件..."
cp "$TARGET_FILE" "$TARGET_FILE.backup.$(date +%Y%m%d_%H%M%S)" 2>/dev/null

echo "📋 强制复制文件..."
cp "$SOURCE_FILE" "$TARGET_FILE"

echo "🔍 验证目标文件..."
if grep -q "method: 'real_test'" "$TARGET_FILE"; then
    echo "✅ 目标文件已更新为 'real_test' 方法"
else
    echo "❌ 目标文件更新失败"
    echo "📋 目标文件内容:"
    grep -A 5 -B 5 "method:" "$TARGET_FILE" | head -20
    exit 1
fi

echo "🔄 重启PM2服务..."
pm2 reload vps-transcoder-api

echo "⏳ 等待服务启动..."
sleep 5

echo "🧪 测试API..."
TEST_RESULT=$(curl -s -X POST http://localhost:3000/api/proxy/test \
  -H 'Content-Type: application/json' \
  -d '{
    "proxyConfig": {
      "id": "test",
      "config": "vless://test@test.com:443"
    },
    "testUrl": "https://www.baidu.com"
  }')

echo "📊 测试结果:"
echo "$TEST_RESULT" | jq .

if echo "$TEST_RESULT" | grep -q '"method":"real_test"'; then
    echo "🎉 强制同步成功! 方法已更新为 real_test"
else
    echo "❌ 强制同步失败，仍返回其他方法"
    echo "📋 详细结果: $TEST_RESULT"
fi

echo ""
echo "✅ 强制同步完成!"
echo "时间: $(date)"
