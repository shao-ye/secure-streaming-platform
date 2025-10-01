#!/bin/bash

# 完整部署脚本 - 从tmp目录部署所有修复后的代码
# 包含所有之前的修复：FFmpeg参数优化、API路由修复、Express配置等

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 配置
SOURCE_DIR="/tmp/vps-transcoder-api"
APP_DIR="/opt/yoyo-transcoder"
BACKUP_DIR="/opt/yoyo-transcoder-backup-$(date +%Y%m%d_%H%M%S)"
HLS_DIR="/var/www/hls"
LOG_DIR="/var/log/transcoder"
PM2_APP_NAME="vps-transcoder-api"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

echo -e "${GREEN}🚀 开始完整部署YOYO转码API服务...${NC}"
echo -e "${BLUE}📂 源目录: $SOURCE_DIR${NC}"
echo -e "${BLUE}🎯 目标目录: $APP_DIR${NC}"

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ 请使用root用户执行此脚本${NC}"
    exit 1
fi

# 检查源目录
if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}❌ 错误: 源目录不存在: $SOURCE_DIR${NC}"
    echo -e "${YELLOW}请确保项目代码已上传到 $SOURCE_DIR${NC}"
    exit 1
fi

# 检查关键文件
echo -e "${YELLOW}🔍 验证源代码完整性...${NC}"
REQUIRED_FILES=(
    "$SOURCE_DIR/vps-transcoder-api/package.json"
    "$SOURCE_DIR/vps-transcoder-api/src/app.js"
    "$SOURCE_DIR/vps-transcoder-api/src/services/ProcessManager.js"
    "$SOURCE_DIR/vps-transcoder-api/src/routes/stream.js"
    "$SOURCE_DIR/vps-transcoder-api/src/routes/status.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}❌ 错误: 关键文件缺失: $file${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ 源代码验证通过${NC}"

# 停止现有服务
echo -e "${YELLOW}🛑 停止现有服务...${NC}"
pm2 stop $PM2_APP_NAME 2>/dev/null || echo "服务未运行"

# 备份现有应用（如果存在）
if [ -d "$APP_DIR" ]; then
    echo -e "${YELLOW}💾 备份现有应用到: $BACKUP_DIR${NC}"
    cp -r "$APP_DIR" "$BACKUP_DIR"
fi

# 创建应用目录
echo -e "${YELLOW}📁 准备应用目录...${NC}"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

# 复制新代码
echo -e "${YELLOW}📂 复制应用代码...${NC}"
if [ -d "$SOURCE_DIR/vps-transcoder-api" ]; then
    cp -r "$SOURCE_DIR/vps-transcoder-api"/* "$APP_DIR"/
else
    cp -r "$SOURCE_DIR"/* "$APP_DIR"/
fi

echo -e "${GREEN}✅ 应用代码复制完成${NC}"

# 进入应用目录
cd "$APP_DIR"

# 创建缺失的API路由文件（如果不存在）
echo -e "${YELLOW}🔧 检查和修复API路由...${NC}"
if [ ! -f "src/routes/api.js" ]; then
    echo -e "${YELLOW}📝 创建缺失的api.js路由文件...${NC}"
    cat > src/routes/api.js << 'EOF'
/**
 * VPS Transcoder API Routes
 * 整合所有API端点的主路由文件
 */

const express = require('express');
const router = express.Router();

// 导入子路由
const streamRoutes = require('./stream');
const statusRoutes = require('./status');

// API密钥验证中间件
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedApiKey = process.env.API_KEY;

  // 如果配置了API密钥，则进行验证
  if (expectedApiKey && apiKey !== expectedApiKey) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or missing API key',
      code: 'UNAUTHORIZED'
    });
  }

  next();
};

// 客户端IP记录中间件
const clientIpMiddleware = (req, res, next) => {
  req.clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
                 (req.connection.socket ? req.connection.socket.remoteAddress : null);
  next();
};

// 应用中间件
router.use(clientIpMiddleware);
router.use(apiKeyAuth);

// 基础状态端点
router.get('/status', (req, res) => {
  res.json({
    status: 'running',
    message: 'VPS Transcoder API is operational',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// 挂载子路由
router.use('/', streamRoutes);  // 流处理路由: /api/start-stream, /api/stop-stream, /api/streams
router.use('/', statusRoutes);  // 系统状态路由: /api/system/status 等

module.exports = router;
EOF
    echo -e "${GREEN}✅ api.js路由文件创建完成${NC}"
fi

# 修复Express配置
echo -e "${YELLOW}⚙️  修复Express配置...${NC}"
if ! grep -q "trust proxy" src/app.js; then
    sed -i '/app.use(cors/i app.set("trust proxy", true);' src/app.js
    echo -e "${GREEN}✅ 添加trust proxy配置${NC}"
fi

# 优化速率限制配置
echo -e "${YELLOW}🔧 优化速率限制配置...${NC}"
sed -i '/const limiter = rateLimit/,/app.use.*limiter/c\
// 速率限制 - 针对VPS环境优化\
const limiter = rateLimit({\
  windowMs: 15 * 60 * 1000, // 15分钟\
  max: NODE_ENV === "development" ? 1000 : 100,\
  message: {\
    error: "Too many requests from this IP, please try again later."\
  },\
  standardHeaders: true,\
  legacyHeaders: false,\
  trustProxy: false, // 禁用trust proxy以避免警告\
  skip: (req) => {\
    // 跳过本地请求的速率限制\
    return req.ip === "127.0.0.1" || req.ip === "::1";\
  }\
});\
\
app.use("/api/", limiter);' src/app.js

echo -e "${GREEN}✅ 速率限制配置优化完成${NC}"

# 安装依赖
echo -e "${YELLOW}📦 安装Node.js依赖...${NC}"
npm install --production

# 创建必要的目录
echo -e "${YELLOW}📁 创建必要目录...${NC}"
mkdir -p "$HLS_DIR"
mkdir -p "$LOG_DIR"
chown -R root:root "$HLS_DIR"
chown -R root:root "$LOG_DIR"
chmod 755 "$HLS_DIR"
chmod 755 "$LOG_DIR"

# 设置环境变量文件
echo -e "${YELLOW}⚙️  配置环境变量...${NC}"
cat > .env << EOF
# VPS转码API环境配置
NODE_ENV=production
PORT=3000
API_KEY=$API_KEY

# FFmpeg配置
FFMPEG_PATH=/usr/bin/ffmpeg
HLS_OUTPUT_DIR=/var/www/hls
HLS_SEGMENT_TIME=6
HLS_LIST_SIZE=10

# 日志配置
LOG_LEVEL=info
LOG_DIR=/var/log/transcoder
EOF

echo -e "${GREEN}✅ 环境配置文件创建完成${NC}"

# 验证FFmpeg
echo -e "${YELLOW}🔍 验证FFmpeg安装...${NC}"
if command -v ffmpeg >/dev/null 2>&1; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n1)
    echo -e "${GREEN}✅ FFmpeg已安装: $FFMPEG_VERSION${NC}"
else
    echo -e "${RED}❌ 错误: FFmpeg未安装${NC}"
    echo -e "${YELLOW}正在安装FFmpeg...${NC}"
    yum install -y epel-release
    yum install -y ffmpeg
fi

# 设置文件权限
echo -e "${YELLOW}🔐 设置文件权限...${NC}"
chown -R root:root "$APP_DIR"
chmod +x "$APP_DIR/src/app.js"

# 启动服务
echo -e "${YELLOW}🚀 启动服务...${NC}"

# 删除旧的PM2进程
pm2 delete $PM2_APP_NAME 2>/dev/null || echo "清理旧进程"

# 启动新服务
pm2 start src/app.js --name $PM2_APP_NAME --log "$LOG_DIR/app.log" --error "$LOG_DIR/error.log"

# 保存PM2配置
pm2 save

# 等待服务启动
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 8

# 健康检查
echo -e "${YELLOW}🏥 执行健康检查...${NC}"
for i in {1..15}; do
    if curl -s -f http://localhost:3000/health >/dev/null; then
        echo -e "${GREEN}✅ 服务健康检查通过!${NC}"
        break
    else
        echo -e "${YELLOW}⏳ 等待服务启动... ($i/15)${NC}"
        sleep 2
    fi
    
    if [ $i -eq 15 ]; then
        echo -e "${RED}❌ 服务启动失败，检查日志:${NC}"
        pm2 logs $PM2_APP_NAME --lines 20
        exit 1
    fi
done

# 显示服务状态
echo -e "${YELLOW}📊 服务状态:${NC}"
pm2 status $PM2_APP_NAME

# 测试API端点
echo -e "${YELLOW}🧪 测试API端点...${NC}"

# 测试状态端点
echo -e "${BLUE}测试状态端点...${NC}"
STATUS_RESPONSE=$(curl -s -H "X-API-Key: $API_KEY" http://localhost:3000/api/status)
if echo "$STATUS_RESPONSE" | grep -q "running"; then
    echo -e "${GREEN}✅ API状态端点正常${NC}"
    echo -e "${CYAN}响应: $STATUS_RESPONSE${NC}"
else
    echo -e "${RED}❌ API状态端点异常${NC}"
    echo -e "${YELLOW}响应: $STATUS_RESPONSE${NC}"
fi

# 测试转码端点
echo -e "${BLUE}测试转码端点...${NC}"
TEST_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{"streamId":"test_deploy_'$(date +%H%M%S)'","rtmpUrl":"rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"}' \
    http://localhost:3000/api/start-stream)

if echo "$TEST_RESPONSE" | grep -q "success\|started\|data"; then
    echo -e "${GREEN}✅ 转码端点测试成功! 所有修复生效!${NC}"
    echo -e "${CYAN}响应: $TEST_RESPONSE${NC}"
elif echo "$TEST_RESPONSE" | grep -q "Endpoint not found"; then
    echo -e "${RED}❌ 转码端点仍然返回404，路由修复失败${NC}"
    echo -e "${YELLOW}响应: $TEST_RESPONSE${NC}"
else
    echo -e "${YELLOW}🔍 转码端点响应: $TEST_RESPONSE${NC}"
    echo -e "${BLUE}检查是否为FFmpeg进程问题...${NC}"
fi

# 显示部署信息
echo -e "${GREEN}🎉 完整部署完成!${NC}"
echo -e "${BLUE}==================== 部署信息 ====================${NC}"
echo -e "${YELLOW}应用目录:${NC} $APP_DIR"
echo -e "${YELLOW}HLS输出目录:${NC} $HLS_DIR"
echo -e "${YELLOW}日志目录:${NC} $LOG_DIR"
echo -e "${YELLOW}PM2应用名:${NC} $PM2_APP_NAME"
echo -e "${YELLOW}API密钥:${NC} $API_KEY"
echo -e "${YELLOW}备份目录:${NC} $BACKUP_DIR"
echo -e "${BLUE}=================================================${NC}"

echo -e "${GREEN}常用命令:${NC}"
echo -e "${YELLOW}查看日志:${NC} pm2 logs $PM2_APP_NAME"
echo -e "${YELLOW}重启服务:${NC} pm2 restart $PM2_APP_NAME"
echo -e "${YELLOW}停止服务:${NC} pm2 stop $PM2_APP_NAME"
echo -e "${YELLOW}服务状态:${NC} pm2 status"

echo -e "${GREEN}✅ 完整部署脚本执行完成!${NC}"

# 显示下一步操作建议
echo -e "${BLUE}🎯 下一步操作建议:${NC}"
echo -e "${YELLOW}1. 如果转码测试成功，可以在前端测试完整播放功能${NC}"
echo -e "${YELLOW}2. 如果转码仍有问题，检查FFmpeg进程日志: pm2 logs $PM2_APP_NAME${NC}"
echo -e "${YELLOW}3. 测试外部访问: curl -H \"X-API-Key: $API_KEY\" http://yoyo-vps.5202021.xyz/api/status${NC}"
echo -e "${YELLOW}4. 检查HLS文件生成: ls -la $HLS_DIR/test_deploy_*/${NC}"
