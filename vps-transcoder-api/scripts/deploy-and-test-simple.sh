#!/bin/bash

# YOYO流媒体平台 - 简化版部署和测试脚本

set -e

echo "🚀 YOYO流媒体平台简化版部署和测试脚本"
echo "============================================"

# 配置
VPS_API_URL="http://localhost:3000"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

echo "📋 部署步骤："
echo "1. 部署VPS转码服务代码"
echo "2. 重启VPS服务"
echo "3. 初始化频道配置"
echo "4. 测试简化流管理器"
echo "5. 部署Cloudflare Workers"
echo ""

# 步骤1: 部署VPS代码到服务器
echo "📤 步骤1: 部署VPS转码服务代码..."
echo "正在上传代码到VPS服务器..."

# 创建临时目录并复制文件
TEMP_DIR="/tmp/yoyo-simple-deploy-$(date +%s)"
mkdir -p "$TEMP_DIR"

# 复制关键文件
cp -r "../vps-transcoder-api/src" "$TEMP_DIR/"
cp "../vps-transcoder-api/package.json" "$TEMP_DIR/"

# 上传到VPS
echo "正在同步代码到VPS..."
rsync -avz --delete "$TEMP_DIR/" root@142.171.75.220:/opt/yoyo-transcoder/

# 清理临时目录
rm -rf "$TEMP_DIR"

echo "✅ 代码上传完成"

# 步骤2: 重启VPS服务
echo "🔄 步骤2: 重启VPS服务..."
ssh root@142.171.75.220 << 'EOF'
cd /opt/yoyo-transcoder
echo "安装依赖..."
npm install --production
echo "重启PM2服务..."
pm2 restart vps-transcoder-api || pm2 start src/app.js --name vps-transcoder-api
echo "等待服务启动..."
sleep 5
pm2 status
EOF

echo "✅ VPS服务重启完成"

# 步骤3: 检查服务状态
echo "🔍 步骤3: 检查服务状态..."
sleep 3

if curl -s -f "$VPS_API_URL/health" > /dev/null; then
    echo "✅ VPS API服务运行正常"
else
    echo "❌ VPS API服务未响应，请检查服务状态"
    exit 1
fi

# 步骤4: 初始化频道配置
echo "⚙️ 步骤4: 初始化频道配置..."

# 使用用户提供的有效RTMP源
RTMP_SOURCE_1="rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b"
RTMP_SOURCE_2="rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c"

echo "配置8个频道..."
curl -X POST "$VPS_API_URL/api/simple-stream/batch-configure" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{
    \"channels\": [
      {\"channelId\": \"stream_ensxma2g\", \"name\": \"二楼教室1\", \"rtmpUrl\": \"$RTMP_SOURCE_2\"},
      {\"channelId\": \"stream_gkg5hknc\", \"name\": \"二楼教室2\", \"rtmpUrl\": \"$RTMP_SOURCE_1\"},
      {\"channelId\": \"stream_kcwxuedx\", \"name\": \"国际班\", \"rtmpUrl\": \"$RTMP_SOURCE_2\"},
      {\"channelId\": \"stream_kil0lecb\", \"name\": \"C班\", \"rtmpUrl\": \"$RTMP_SOURCE_1\"},
      {\"channelId\": \"stream_noyoostd\", \"name\": \"三楼舞蹈室\", \"rtmpUrl\": \"$RTMP_SOURCE_2\"},
      {\"channelId\": \"stream_3blyhqh3\", \"name\": \"多功能厅\", \"rtmpUrl\": \"$RTMP_SOURCE_1\"},
      {\"channelId\": \"stream_8zf48z6g\", \"name\": \"操场1\", \"rtmpUrl\": \"$RTMP_SOURCE_2\"},
      {\"channelId\": \"stream_cpa2czoo\", \"name\": \"操场2\", \"rtmpUrl\": \"$RTMP_SOURCE_1\"}
    ]
  }" | jq .

echo "✅ 频道配置完成"

# 步骤5: 测试简化流管理器
echo "🧪 步骤5: 测试简化流管理器..."

echo "测试开始观看频道..."
RESPONSE=$(curl -s -X POST "$VPS_API_URL/api/simple-stream/start-watching" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"channelId": "stream_ensxma2g", "userId": "test-user-1"}')

echo "开始观看响应: $RESPONSE"

# 提取sessionId
SESSION_ID=$(echo "$RESPONSE" | jq -r '.data.sessionId // empty')

if [ -n "$SESSION_ID" ]; then
    echo "✅ 成功启动转码，会话ID: $SESSION_ID"
    
    echo "等待5秒让转码稳定..."
    sleep 5
    
    echo "检查系统状态..."
    curl -s "$VPS_API_URL/api/simple-stream/system/status" \
      -H "X-API-Key: $API_KEY" | jq .
    
    echo "测试停止观看..."
    curl -s -X POST "$VPS_API_URL/api/simple-stream/stop-watching" \
      -H "Content-Type: application/json" \
      -H "X-API-Key: $API_KEY" \
      -d "{\"sessionId\": \"$SESSION_ID\"}" | jq .
    
    echo "✅ 简化流管理器测试完成"
else
    echo "❌ 启动转码失败"
    exit 1
fi

# 步骤6: 部署Cloudflare Workers（可选）
echo "☁️ 步骤6: 部署Cloudflare Workers（可选）..."
echo "请手动执行以下命令部署Workers："
echo "cd ../cloudflare-worker"
echo "npm install"
echo "wrangler deploy --env production"

echo ""
echo "🎉 简化版部署完成！"
echo ""
echo "📊 系统特性："
echo "✅ 实时RTMP流处理（0.5秒HLS分片）"
echo "✅ 按需启动转码（无观看者时不处理）"
echo "✅ 智能会话管理（用户切换时自动清理）"
echo "✅ 共享转码进程（多用户观看同一频道）"
echo "✅ 自动资源清理（5分钟无活动自动停止）"
echo ""
echo "🔗 API端点："
echo "- 健康检查: GET $VPS_API_URL/health"
echo "- 开始观看: POST $VPS_API_URL/api/simple-stream/start-watching"
echo "- 停止观看: POST $VPS_API_URL/api/simple-stream/stop-watching"
echo "- 系统状态: GET $VPS_API_URL/api/simple-stream/system/status"
echo ""
echo "🎯 下一步："
echo "1. 部署Cloudflare Workers以获得完整的API代理"
echo "2. 测试前端应用的视频播放功能"
echo "3. 验证频道切换和会话管理"
echo ""
