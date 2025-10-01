#!/bin/bash

# 部署验证脚本 - 验证所有修复是否正确应用
# 在VPS上运行此脚本来验证部署后的代码修复

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/opt/yoyo-transcoder"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

echo -e "${GREEN}🔍 验证YOYO转码API部署修复...${NC}"

# 检查应用目录
if [ ! -d "$APP_DIR" ]; then
    echo -e "${RED}❌ 应用目录不存在: $APP_DIR${NC}"
    exit 1
fi

cd "$APP_DIR"

echo -e "${YELLOW}1. 验证ProcessManager.js中的FFmpeg参数修复...${NC}"
if grep -q "playlist.m3u8" src/services/ProcessManager.js; then
    echo -e "${GREEN}✅ FFmpeg输出文件名已修复为playlist.m3u8${NC}"
else
    echo -e "${RED}❌ FFmpeg输出文件名未修复${NC}"
fi

if grep -q "preset.*ultrafast" src/services/ProcessManager.js; then
    echo -e "${GREEN}✅ FFmpeg预设已优化为ultrafast${NC}"
else
    echo -e "${RED}❌ FFmpeg预设未优化${NC}"
fi

echo -e "${YELLOW}2. 验证API路由文件...${NC}"
if [ -f "src/routes/api.js" ]; then
    echo -e "${GREEN}✅ api.js路由文件存在${NC}"
    if grep -q "streamRoutes" src/routes/api.js; then
        echo -e "${GREEN}✅ 流处理路由已正确挂载${NC}"
    else
        echo -e "${RED}❌ 流处理路由挂载有问题${NC}"
    fi
else
    echo -e "${RED}❌ api.js路由文件缺失${NC}"
fi

echo -e "${YELLOW}3. 验证Express配置...${NC}"
if grep -q "trust proxy" src/app.js; then
    echo -e "${GREEN}✅ trust proxy配置已添加${NC}"
else
    echo -e "${RED}❌ trust proxy配置缺失${NC}"
fi

if grep -q "skip.*127.0.0.1" src/app.js; then
    echo -e "${GREEN}✅ 速率限制本地跳过配置已添加${NC}"
else
    echo -e "${RED}❌ 速率限制配置未优化${NC}"
fi

echo -e "${YELLOW}4. 验证环境配置...${NC}"
if [ -f ".env" ]; then
    echo -e "${GREEN}✅ .env文件存在${NC}"
    if grep -q "API_KEY=$API_KEY" .env; then
        echo -e "${GREEN}✅ API密钥配置正确${NC}"
    else
        echo -e "${RED}❌ API密钥配置错误${NC}"
    fi
else
    echo -e "${RED}❌ .env文件缺失${NC}"
fi

echo -e "${YELLOW}5. 验证服务状态...${NC}"
if pm2 list | grep -q "vps-transcoder-api.*online"; then
    echo -e "${GREEN}✅ PM2服务正在运行${NC}"
else
    echo -e "${RED}❌ PM2服务未运行${NC}"
fi

echo -e "${YELLOW}6. 测试API端点...${NC}"
# 测试健康检查
if curl -s -f http://localhost:3000/health >/dev/null; then
    echo -e "${GREEN}✅ 健康检查端点正常${NC}"
else
    echo -e "${RED}❌ 健康检查端点异常${NC}"
fi

# 测试API状态
STATUS_RESPONSE=$(curl -s -H "X-API-Key: $API_KEY" http://localhost:3000/api/status 2>/dev/null || echo "error")
if echo "$STATUS_RESPONSE" | grep -q "running"; then
    echo -e "${GREEN}✅ API状态端点正常${NC}"
else
    echo -e "${RED}❌ API状态端点异常: $STATUS_RESPONSE${NC}"
fi

# 测试转码端点
echo -e "${YELLOW}7. 测试转码端点响应...${NC}"
TEST_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{"streamId":"verify_test","rtmpUrl":"rtmp://test.example.com/live/test"}' \
    http://localhost:3000/api/start-stream 2>/dev/null || echo "connection_error")

if echo "$TEST_RESPONSE" | grep -q "Endpoint not found"; then
    echo -e "${RED}❌ 转码端点仍返回404 - 路由问题未解决${NC}"
elif echo "$TEST_RESPONSE" | grep -q "success\|started\|error.*FFmpeg"; then
    echo -e "${GREEN}✅ 转码端点响应正常（路由已修复）${NC}"
elif echo "$TEST_RESPONSE" | grep -q "connection_error"; then
    echo -e "${RED}❌ 无法连接到API服务${NC}"
else
    echo -e "${YELLOW}🔍 转码端点响应: $TEST_RESPONSE${NC}"
fi

echo -e "${YELLOW}8. 检查目录权限...${NC}"
if [ -w "/var/www/hls" ]; then
    echo -e "${GREEN}✅ HLS输出目录可写${NC}"
else
    echo -e "${RED}❌ HLS输出目录权限问题${NC}"
fi

echo -e "${BLUE}==================== 验证完成 ====================${NC}"
echo -e "${GREEN}🎉 部署验证脚本执行完成!${NC}"
echo -e "${YELLOW}如果发现问题，请检查对应的配置文件或重新运行部署脚本${NC}"
