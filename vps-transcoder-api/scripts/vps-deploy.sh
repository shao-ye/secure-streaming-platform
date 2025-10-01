#!/bin/bash

# YOYO流媒体平台 - VPS转码API部署脚本
# 在VPS服务器上直接执行此脚本
# 使用方法: bash vps-deploy.sh

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[信息]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

log_error() {
    echo -e "${RED}[错误]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[步骤]${NC} $1"
}

# 显示标题
echo -e "${BLUE}"
echo "========================================"
echo "  🚀 YOYO流媒体平台 VPS部署脚本"
echo "========================================"
echo -e "${NC}"

# 检查是否为root用户
if [[ $EUID -ne 0 ]]; then
   log_error "此脚本需要root权限运行"
   echo "请使用: sudo bash vps-deploy.sh"
   exit 1
fi

# 设置变量
APP_DIR="/opt/yoyo-transcoder"
HLS_DIR="/var/www/hls"
LOG_DIR="/var/log/transcoder"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
BACKUP_DIR="/opt/backups/yoyo-$(date +%Y%m%d_%H%M%S)"

log_info "开始VPS转码API部署..."
log_info "应用目录: $APP_DIR"
log_info "HLS目录: $HLS_DIR"
log_info "日志目录: $LOG_DIR"

# 步骤1: 备份现有文件
log_step "1/8 备份现有文件..."
if [ -d "$APP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    cp -r "$APP_DIR" "$BACKUP_DIR/"
    log_info "现有文件已备份到: $BACKUP_DIR"
else
    log_info "未发现现有安装，跳过备份"
fi

# 步骤2: 停止现有服务
log_step "2/8 停止现有服务..."
if command -v pm2 >/dev/null 2>&1; then
    pm2 stop vps-transcoder-api 2>/dev/null || true
    pm2 delete vps-transcoder-api 2>/dev/null || true
    log_info "PM2服务已停止"
fi

# 步骤3: 创建必要目录
log_step "3/8 创建应用目录..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/src/routes"
mkdir -p "$APP_DIR/src/services"
mkdir -p "$APP_DIR/src/utils"
mkdir -p "$APP_DIR/src/middleware"
mkdir -p "$HLS_DIR"
mkdir -p "$LOG_DIR"

# 设置目录权限
chown -R root:root "$APP_DIR"
chmod -R 755 "$APP_DIR"

# 检测Web服务器用户
WEB_USER="nginx"
if ! id "$WEB_USER" >/dev/null 2>&1; then
    WEB_USER="apache"
    if ! id "$WEB_USER" >/dev/null 2>&1; then
        WEB_USER="root"
        log_warn "未找到nginx或apache用户，使用root用户"
    fi
fi

chown -R $WEB_USER:$WEB_USER "$HLS_DIR"
chmod -R 755 "$HLS_DIR"
chmod -R 755 "$LOG_DIR"

log_info "目录创建完成"

# 步骤4: 创建API路由文件
log_step "4/8 创建API路由文件..."

# 创建主API路由文件
cat > "$APP_DIR/src/routes/api.js" << 'EOF'
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

log_info "API路由文件创建完成"

# 步骤5: 检查并创建其他必要文件
log_step "5/8 检查应用文件..."

# 检查package.json
if [ ! -f "$APP_DIR/package.json" ]; then
    log_warn "package.json不存在，创建基础版本..."
    cat > "$APP_DIR/package.json" << 'EOF'
{
  "name": "yoyo-vps-transcoder",
  "version": "1.0.0",
  "description": "YOYO流媒体平台VPS转码服务",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "dev": "nodemon src/app.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "morgan": "^1.10.0",
    "express-rate-limit": "^6.8.1",
    "dotenv": "^16.3.1"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF
fi

# 检查.env文件
if [ ! -f "$APP_DIR/.env" ]; then
    log_warn ".env文件不存在，创建配置文件..."
    cat > "$APP_DIR/.env" << EOF
# VPS转码API配置
NODE_ENV=production
PORT=3000
API_KEY=$API_KEY

# 目录配置
HLS_OUTPUT_DIR=$HLS_DIR
LOG_DIR=$LOG_DIR

# 安全配置
ENABLE_IP_WHITELIST=false
ALLOWED_ORIGINS=*

# FFmpeg配置
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
EOF
fi

# 检查主应用文件
if [ ! -f "$APP_DIR/src/app.js" ]; then
    log_error "主应用文件 src/app.js 不存在"
    log_error "请确保已上传完整的应用代码"
    exit 1
fi

# 步骤6: 安装依赖
log_step "6/8 安装Node.js依赖..."
cd "$APP_DIR"

# 检查Node.js
if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js未安装，请先安装Node.js"
    exit 1
fi

# 检查npm
if ! command -v npm >/dev/null 2>&1; then
    log_error "npm未安装，请先安装npm"
    exit 1
fi

# 安装依赖
npm install --production
log_info "依赖安装完成"

# 步骤7: 配置PM2
log_step "7/8 配置PM2进程管理..."

# 检查PM2
if ! command -v pm2 >/dev/null 2>&1; then
    log_warn "PM2未安装，正在安装..."
    npm install -g pm2
fi

# 创建PM2配置文件
cat > "$APP_DIR/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [{
    name: 'vps-transcoder-api',
    script: 'src/app.js',
    cwd: '/opt/yoyo-transcoder',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: '/var/log/transcoder/combined.log',
    out_file: '/var/log/transcoder/out.log',
    error_file: '/var/log/transcoder/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G',
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'hls'],
    restart_delay: 4000
  }]
};
EOF

# 启动PM2服务
pm2 start ecosystem.config.js
pm2 save
pm2 startup

log_info "PM2配置完成"

# 步骤8: 验证部署
log_step "8/8 验证部署结果..."

# 等待服务启动
sleep 5

# 检查PM2状态
log_info "PM2服务状态:"
pm2 status

# 检查端口监听
if netstat -tlnp | grep :3000 >/dev/null 2>&1; then
    log_info "✅ 端口3000监听正常"
else
    log_warn "⚠️  端口3000未监听，检查服务状态"
fi

# 测试健康检查
if curl -f http://localhost:3000/health >/dev/null 2>&1; then
    log_info "✅ 健康检查端点正常"
else
    log_warn "⚠️  健康检查端点异常"
fi

# 测试API端点
if curl -f -H "X-API-Key: $API_KEY" http://localhost:3000/api/status >/dev/null 2>&1; then
    log_info "✅ API状态端点正常"
else
    log_warn "⚠️  API状态端点异常"
fi

# 显示部署结果
echo -e "${GREEN}"
echo "========================================"
echo "  🎉 VPS转码API部署完成！"
echo "========================================"
echo -e "${NC}"

echo "📊 服务信息:"
echo "  - 应用目录: $APP_DIR"
echo "  - HLS目录: $HLS_DIR"
echo "  - 日志目录: $LOG_DIR"
echo "  - API端口: 3000"
echo ""

echo "🔑 API密钥:"
echo "  $API_KEY"
echo ""

echo "🌐 服务地址:"
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "YOUR_VPS_IP")
echo "  - 健康检查: http://$VPS_IP:3000/health"
echo "  - API状态: http://$VPS_IP:3000/api/status"
echo "  - HLS流: http://$VPS_IP:3000/hls/"
echo ""

echo "🔧 管理命令:"
echo "  - 查看状态: pm2 status"
echo "  - 查看日志: pm2 logs vps-transcoder-api"
echo "  - 重启服务: pm2 restart vps-transcoder-api"
echo "  - 停止服务: pm2 stop vps-transcoder-api"
echo ""

echo "📝 下一步:"
echo "  1. 配置Nginx反向代理 (可选)"
echo "  2. 配置防火墙开放端口3000"
echo "  3. 在Cloudflare Workers中更新VPS配置"
echo "  4. 测试RTMP推流和HLS播放功能"
echo ""

# 显示可能的问题和解决方案
if [ -f "$APP_DIR/src/routes/stream.js" ]; then
    log_info "✅ 流处理路由文件存在"
else
    log_warn "⚠️  流处理路由文件缺失，可能影响转码功能"
    echo "请确保上传了完整的应用代码，包括:"
    echo "  - src/routes/stream.js"
    echo "  - src/services/ProcessManager.js"
    echo "  - src/utils/logger.js"
fi

log_info "部署脚本执行完成！"
