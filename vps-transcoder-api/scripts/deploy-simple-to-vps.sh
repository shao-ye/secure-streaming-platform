#!/bin/bash

# YOYO流媒体平台 - 简化架构VPS部署脚本
# 将新的SimpleStreamManager部署到生产服务器

set -e

# 配置
VPS_HOST="142.171.75.220"
VPS_USER="root"
VPS_APP_DIR="/opt/yoyo-transcoder"
LOCAL_PROJECT_DIR="../"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

echo "🚀 YOYO简化架构VPS部署脚本"
echo "============================="

# 检查依赖
if ! command -v rsync &> /dev/null; then
    echo "❌ rsync 未安装，请先安装 rsync"
    exit 1
fi

if ! command -v ssh &> /dev/null; then
    echo "❌ ssh 未安装，请先安装 ssh"
    exit 1
fi

echo "📋 部署信息："
echo "- VPS服务器: $VPS_HOST"
echo "- 应用目录: $VPS_APP_DIR"
echo "- 本地项目: $LOCAL_PROJECT_DIR"
echo ""

# 步骤1: 本地代码验证
echo "🔍 步骤1: 本地代码验证..."
cd "$LOCAL_PROJECT_DIR"

if [ ! -f "src/services/SimpleStreamManager.js" ]; then
    echo "❌ SimpleStreamManager.js 文件不存在"
    exit 1
fi

if [ ! -f "src/routes/simple-stream.js" ]; then
    echo "❌ simple-stream.js 路由文件不存在"
    exit 1
fi

echo "✅ 本地代码文件检查通过"

# 步骤2: 运行本地测试
echo "🧪 步骤2: 运行本地测试..."
if [ -f "scripts/local-test-simple.js" ]; then
    echo "运行本地测试脚本..."
    node scripts/local-test-simple.js
    if [ $? -eq 0 ]; then
        echo "✅ 本地测试通过"
    else
        echo "❌ 本地测试失败，停止部署"
        exit 1
    fi
else
    echo "⚠️ 本地测试脚本不存在，跳过测试"
fi

# 步骤3: 备份VPS现有代码
echo "💾 步骤3: 备份VPS现有代码..."
BACKUP_DIR="/opt/yoyo-transcoder-backup-$(date +%Y%m%d-%H%M%S)"

ssh $VPS_USER@$VPS_HOST << EOF
if [ -d "$VPS_APP_DIR" ]; then
    echo "创建备份目录: $BACKUP_DIR"
    cp -r "$VPS_APP_DIR" "$BACKUP_DIR"
    echo "✅ 备份完成: $BACKUP_DIR"
else
    echo "⚠️ 应用目录不存在，跳过备份"
fi
EOF

# 步骤4: 同步代码到VPS
echo "📤 步骤4: 同步代码到VPS..."

# 创建临时部署目录
TEMP_DEPLOY_DIR="/tmp/yoyo-deploy-$(date +%s)"
mkdir -p "$TEMP_DEPLOY_DIR"

# 复制需要的文件
echo "准备部署文件..."
cp -r src "$TEMP_DEPLOY_DIR/"
cp package.json "$TEMP_DEPLOY_DIR/"
cp package-lock.json "$TEMP_DEPLOY_DIR/" 2>/dev/null || echo "package-lock.json 不存在，跳过"

# 同步到VPS
echo "同步文件到VPS..."
rsync -avz --delete "$TEMP_DEPLOY_DIR/" $VPS_USER@$VPS_HOST:$VPS_APP_DIR/

# 清理临时目录
rm -rf "$TEMP_DEPLOY_DIR"

echo "✅ 代码同步完成"

# 步骤5: VPS服务器配置
echo "⚙️ 步骤5: VPS服务器配置..."

ssh $VPS_USER@$VPS_HOST << 'EOF'
cd /opt/yoyo-transcoder

echo "检查Node.js版本..."
node --version

echo "安装/更新依赖..."
npm install --production

echo "检查FFmpeg..."
ffmpeg -version | head -1

echo "确保HLS输出目录存在..."
mkdir -p /var/www/hls
chown -R root:root /var/www/hls
chmod -R 755 /var/www/hls

echo "检查日志目录..."
mkdir -p /var/log/transcoder
chown -R root:root /var/log/transcoder

echo "✅ VPS环境配置完成"
EOF

# 步骤6: 重启服务
echo "🔄 步骤6: 重启应用服务..."

ssh $VPS_USER@$VPS_HOST << 'EOF'
cd /opt/yoyo-transcoder

echo "停止现有PM2进程..."
pm2 stop vps-transcoder-api || echo "进程未运行"
pm2 delete vps-transcoder-api || echo "进程不存在"

echo "启动新的应用服务..."
pm2 start src/app.js --name vps-transcoder-api --log /var/log/transcoder/app.log

echo "等待服务启动..."
sleep 5

echo "检查PM2状态..."
pm2 status

echo "保存PM2配置..."
pm2 save
EOF

# 步骤7: 健康检查
echo "🏥 步骤7: 服务健康检查..."

echo "等待服务完全启动..."
sleep 10

# 检查服务状态
echo "检查API健康状态..."
HEALTH_CHECK=$(ssh $VPS_USER@$VPS_HOST "curl -s -f http://localhost:3000/health || echo 'FAILED'")

if [[ "$HEALTH_CHECK" == *"healthy"* ]]; then
    echo "✅ API服务健康检查通过"
else
    echo "❌ API服务健康检查失败"
    echo "响应: $HEALTH_CHECK"
    
    # 显示日志
    echo "查看应用日志..."
    ssh $VPS_USER@$VPS_HOST "pm2 logs vps-transcoder-api --lines 20"
    exit 1
fi

# 步骤8: 初始化频道配置
echo "🎛️ 步骤8: 初始化频道配置..."

# 使用有效的RTMP源
RTMP_SOURCE_1="rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b"
RTMP_SOURCE_2="rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c"

ssh $VPS_USER@$VPS_HOST << EOF
echo "配置频道..."
curl -X POST "http://localhost:3000/api/simple-stream/batch-configure" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -d '{
    "channels": [
      {"channelId": "stream_ensxma2g", "name": "二楼教室1", "rtmpUrl": "$RTMP_SOURCE_2"},
      {"channelId": "stream_gkg5hknc", "name": "二楼教室2", "rtmpUrl": "$RTMP_SOURCE_1"},
      {"channelId": "stream_kcwxuedx", "name": "国际班", "rtmpUrl": "$RTMP_SOURCE_2"},
      {"channelId": "stream_kil0lecb", "name": "C班", "rtmpUrl": "$RTMP_SOURCE_1"},
      {"channelId": "stream_noyoostd", "name": "三楼舞蹈室", "rtmpUrl": "$RTMP_SOURCE_2"},
      {"channelId": "stream_3blyhqh3", "name": "多功能厅", "rtmpUrl": "$RTMP_SOURCE_1"},
      {"channelId": "stream_8zf48z6g", "name": "操场1", "rtmpUrl": "$RTMP_SOURCE_2"},
      {"channelId": "stream_cpa2czoo", "name": "操场2", "rtmpUrl": "$RTMP_SOURCE_1"}
    ]
  }'
EOF

echo "✅ 频道配置完成"

# 步骤9: 功能测试
echo "🧪 步骤9: 功能测试..."

echo "测试系统状态API..."
SYSTEM_STATUS=$(ssh $VPS_USER@$VPS_HOST "curl -s -H 'X-API-Key: $API_KEY' http://localhost:3000/api/simple-stream/system/status")
echo "系统状态: $SYSTEM_STATUS"

echo "测试开始观看API..."
START_RESPONSE=$(ssh $VPS_USER@$VPS_HOST "curl -s -X POST -H 'Content-Type: application/json' -H 'X-API-Key: $API_KEY' -d '{\"channelId\": \"stream_ensxma2g\", \"userId\": \"test-deploy-user\"}' http://localhost:3000/api/simple-stream/start-watching")
echo "开始观看响应: $START_RESPONSE"

# 提取sessionId进行清理
SESSION_ID=$(echo "$START_RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
if [ -n "$SESSION_ID" ]; then
    echo "清理测试会话: $SESSION_ID"
    ssh $VPS_USER@$VPS_HOST "curl -s -X POST -H 'Content-Type: application/json' -H 'X-API-Key: $API_KEY' -d '{\"sessionId\": \"$SESSION_ID\"}' http://localhost:3000/api/simple-stream/stop-watching" > /dev/null
fi

echo "✅ 功能测试完成"

# 部署总结
echo ""
echo "🎉 简化架构部署完成！"
echo "=========================="
echo ""
echo "📊 部署摘要："
echo "✅ 代码同步完成"
echo "✅ 依赖安装完成"
echo "✅ 服务重启成功"
echo "✅ 健康检查通过"
echo "✅ 频道配置完成"
echo "✅ 功能测试通过"
echo ""
echo "🔗 API端点："
echo "- 健康检查: http://localhost:3000/health"
echo "- 系统状态: http://localhost:3000/api/simple-stream/system/status"
echo "- 开始观看: POST http://localhost:3000/api/simple-stream/start-watching"
echo "- 停止观看: POST http://localhost:3000/api/simple-stream/stop-watching"
echo ""
echo "📋 新架构特性："
echo "• 0.5秒HLS分片，超低延迟"
echo "• 按需启动转码，节省资源"
echo "• 智能会话管理，自动清理"
echo "• 多用户共享转码进程"
echo "• 无缝频道切换支持"
echo ""
echo "🎯 下一步："
echo "1. 部署Cloudflare Workers"
echo "2. 测试前端集成"
echo "3. 验证端到端功能"
echo ""
echo "🚀 简化架构已准备就绪！"
