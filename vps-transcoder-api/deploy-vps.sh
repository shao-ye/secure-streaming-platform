#!/bin/bash

# VPS一键部署脚本 - 从Git同步到服务重启
# 用途: 在VPS上同步最新代码并重启服务

set -e  # 遇到错误立即退出

echo "🚀 开始VPS一键部署..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# 检查是否为root用户
if [[ $EUID -ne 0 ]]; then
   log_error "此脚本需要root权限运行"
   exit 1
fi

# 项目配置
GIT_DIR="/tmp/github/secure-streaming-platform"
PROJECT_DIR="/opt/yoyo-transcoder"
PM2_APP_NAME="vps-transcoder-api"
SERVICE_PORT="52535"

log_step "1. 同步Git代码"

# 检查Git目录
if [ ! -d "$GIT_DIR" ]; then
    log_error "Git目录不存在: $GIT_DIR"
    log_info "请先克隆仓库到 $GIT_DIR"
    exit 1
fi

cd $GIT_DIR
log_info "当前目录: $(pwd)"

# 拉取最新代码
log_info "拉取最新代码..."
git fetch origin
git reset --hard origin/master
log_info "✅ 代码同步完成"

# 显示最新提交信息
LATEST_COMMIT=$(git log -1 --pretty=format:"%h - %s (%an, %ar)")
log_info "最新提交: $LATEST_COMMIT"

log_step "2. 备份当前服务"

# 创建项目目录（如果不存在）
mkdir -p $PROJECT_DIR
mkdir -p $PROJECT_DIR/logs

# 备份当前配置（如果存在）
if [ -f "$PROJECT_DIR/ecosystem.config.js" ]; then
    cp $PROJECT_DIR/ecosystem.config.js $PROJECT_DIR/ecosystem.config.js.backup
    log_info "已备份PM2配置文件"
fi

log_step "3. 更新项目文件"

# 复制VPS API文件
VPS_SOURCE="$GIT_DIR/vps-transcoder-api"
if [ -d "$VPS_SOURCE" ]; then
    # 复制源代码
    cp -r $VPS_SOURCE/src/* $PROJECT_DIR/src/ 2>/dev/null || true
    cp $VPS_SOURCE/app.js $PROJECT_DIR/ 2>/dev/null || true
    cp $VPS_SOURCE/package.json $PROJECT_DIR/ 2>/dev/null || true
    
    log_info "✅ VPS API文件已更新"
else
    log_warn "VPS源码目录不存在: $VPS_SOURCE"
fi

log_step "4. 安装/更新依赖"

cd $PROJECT_DIR

# 检查package.json
if [ -f "package.json" ]; then
    log_info "更新Node.js依赖..."
    npm install --production
    log_info "✅ 依赖更新完成"
else
    log_warn "package.json不存在，跳过依赖安装"
fi

log_step "5. 重新配置PM2"

# 创建或更新PM2配置
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: '${PM2_APP_NAME}',
    script: './app.js',
    cwd: '${PROJECT_DIR}',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: '${SERVICE_PORT}'
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
EOF

log_info "✅ PM2配置已更新"

log_step "6. 重启服务"

# 检查PM2是否安装
if ! command -v pm2 &> /dev/null; then
    log_error "PM2未安装，请先安装: npm install -g pm2"
    exit 1
fi

# 重启服务
if pm2 list | grep -q $PM2_APP_NAME; then
    log_info "重启现有服务..."
    pm2 restart $PM2_APP_NAME
else
    log_info "启动新服务..."
    pm2 start ecosystem.config.js
fi

# 保存PM2配置
pm2 save

log_step "7. 验证部署"

# 等待服务启动
sleep 3

# 检查服务状态
if pm2 list | grep -q "online.*$PM2_APP_NAME"; then
    log_info "✅ 服务运行正常"
else
    log_error "❌ 服务启动失败"
    log_info "查看错误日志:"
    pm2 logs $PM2_APP_NAME --lines 10
    exit 1
fi

# 检查端口
if netstat -tlnp | grep -q ":$SERVICE_PORT "; then
    log_info "✅ 端口 $SERVICE_PORT 正在监听"
else
    log_warn "⚠️ 端口 $SERVICE_PORT 未监听"
fi

# 测试健康检查
log_info "测试API健康检查..."
sleep 2
if curl -s -f "http://localhost:$SERVICE_PORT/api/health" > /dev/null 2>&1; then
    log_info "✅ API健康检查通过"
else
    log_warn "⚠️ API健康检查失败，可能服务还在启动"
fi

log_step "8. 部署完成"

echo ""
echo "🎉 VPS一键部署完成！"
echo ""
echo "📊 部署信息:"
echo "  - Git提交: $LATEST_COMMIT"
echo "  - 项目目录: $PROJECT_DIR"
echo "  - 服务端口: $SERVICE_PORT"
echo "  - PM2应用: $PM2_APP_NAME"
echo ""
echo "🔧 常用命令:"
echo "  - 查看状态: pm2 status"
echo "  - 查看日志: pm2 logs $PM2_APP_NAME"
echo "  - 重启服务: pm2 restart $PM2_APP_NAME"
echo ""
echo "🌐 API端点:"
echo "  - 健康检查: http://localhost:$SERVICE_PORT/api/health"
echo "  - 代理测试: http://localhost:$SERVICE_PORT/api/proxy/test"
echo ""

# 显示当前服务状态
echo "📈 当前服务状态:"
pm2 status

echo ""
log_info "部署脚本执行完成！"
