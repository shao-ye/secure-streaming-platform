#!/bin/bash

# 修复VPS上的API路由问题
# 将缺失的api.js文件部署到VPS服务器

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔧 修复VPS API路由问题...${NC}"

# VPS配置
VPS_HOST="yoyo-vps.5202021.xyz"
SSH_PORT="52535"
APP_DIR="/opt/yoyo-transcoder"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

# 检查本地api.js文件
LOCAL_API_FILE="/tmp/vps-transcoder-api/src/routes/api.js"

if [ ! -f "$LOCAL_API_FILE" ]; then
    echo -e "${RED}❌ 错误: 本地api.js文件不存在: $LOCAL_API_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 找到本地api.js文件${NC}"

# 通过SSH复制api.js文件到VPS
echo -e "${YELLOW}📂 复制api.js文件到VPS...${NC}"

# 读取本地文件内容
API_CONTENT=$(cat "$LOCAL_API_FILE")

# 通过SSH创建文件
ssh -p $SSH_PORT root@$VPS_HOST "
cd $APP_DIR/src/routes
echo 'Creating api.js file...'
cat > api.js << 'APIEOF'
$API_CONTENT
APIEOF
echo 'api.js file created successfully'
ls -la api.js
"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ api.js文件复制成功${NC}"
else
    echo -e "${RED}❌ api.js文件复制失败${NC}"
    exit 1
fi

# 修复Express trust proxy配置
echo -e "${YELLOW}⚙️  修复Express配置...${NC}"

ssh -p $SSH_PORT root@$VPS_HOST "
cd $APP_DIR/src
echo 'Updating app.js to fix trust proxy issue...'
sed -i '/app.use(cors/i app.set(\"trust proxy\", true);' app.js
echo 'Express configuration updated'
"

# 重启PM2服务
echo -e "${YELLOW}🔄 重启PM2服务...${NC}"

ssh -p $SSH_PORT root@$VPS_HOST "
pm2 restart vps-transcoder-api
echo 'Waiting for service to restart...'
sleep 5
pm2 status vps-transcoder-api
"

# 等待服务启动
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 3

# 测试修复结果
echo -e "${YELLOW}🧪 测试修复结果...${NC}"

# 测试状态端点
echo -e "${BLUE}测试状态端点...${NC}"
STATUS_RESPONSE=$(curl -s -H "X-API-Key: $API_KEY" http://$VPS_HOST/api/status)
if echo "$STATUS_RESPONSE" | grep -q "running"; then
    echo -e "${GREEN}✅ API状态端点正常${NC}"
    echo -e "${CYAN}响应: $STATUS_RESPONSE${NC}"
else
    echo -e "${RED}❌ API状态端点异常${NC}"
    echo -e "${YELLOW}响应: $STATUS_RESPONSE${NC}"
fi

# 测试转码端点
echo -e "${BLUE}测试转码端点...${NC}"
TRANSCODE_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{"streamId":"test_fix_'$(date +%H%M%S)'","rtmpUrl":"rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"}' \
    http://$VPS_HOST/api/start-stream)

if echo "$TRANSCODE_RESPONSE" | grep -q "success\|started\|data"; then
    echo -e "${GREEN}✅ 转码端点修复成功!${NC}"
    echo -e "${CYAN}响应: $TRANSCODE_RESPONSE${NC}"
elif echo "$TRANSCODE_RESPONSE" | grep -q "Endpoint not found"; then
    echo -e "${RED}❌ 转码端点仍然返回404，路由修复失败${NC}"
    echo -e "${YELLOW}响应: $TRANSCODE_RESPONSE${NC}"
else
    echo -e "${YELLOW}🔍 转码端点响应: $TRANSCODE_RESPONSE${NC}"
fi

echo -e "${GREEN}🎉 路由修复完成!${NC}"

# 显示下一步建议
echo -e "${BLUE}🎯 下一步建议:${NC}"
echo -e "${YELLOW}1. 检查服务日志:${NC} ssh -p $SSH_PORT root@$VPS_HOST 'pm2 logs vps-transcoder-api --lines 20'"
echo -e "${YELLOW}2. 如果转码端点正常，可以在前端测试播放功能${NC}"
echo -e "${YELLOW}3. 如果仍有问题，检查FFmpeg进程日志${NC}"
