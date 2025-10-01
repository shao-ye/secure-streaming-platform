#!/bin/bash

# YOYO流媒体平台 - VPS部署脚本 (Linux/Git Bash/WSL)
# 作者: YOYO Team
# 版本: 1.0

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

echo "========================================"
echo "  🚀 YOYO VPS部署脚本"
echo "========================================"
echo ""

# 获取VPS信息
read -p "请输入VPS IP地址: " VPS_IP
read -p "请输入SSH用户名 [root]: " VPS_USER
VPS_USER=${VPS_USER:-root}
read -p "请输入SSH端口 [22]: " SSH_PORT
SSH_PORT=${SSH_PORT:-22}

echo ""
log_info "VPS信息:"
echo "  - IP地址: $VPS_IP"
echo "  - 用户: $VPS_USER"
echo "  - 端口: $SSH_PORT"
echo ""

# 确认部署
read -p "确认开始部署? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "部署已取消"
    exit 0
fi

echo ""
log_step "开始VPS部署..."

# 测试SSH连接
log_step "测试SSH连接..."
if ssh -p $SSH_PORT -o ConnectTimeout=10 -o BatchMode=yes $VPS_USER@$VPS_IP "echo 'SSH连接成功'" 2>/dev/null; then
    log_info "SSH连接测试通过"
else
    log_error "SSH连接失败，请检查:"
    echo "  - VPS IP地址和端口是否正确"
    echo "  - SSH密钥是否已配置"
    echo "  - 防火墙是否开放SSH端口"
    exit 1
fi

# 上传代码
log_step "上传代码到VPS..."
ssh -p $SSH_PORT $VPS_USER@$VPS_IP "mkdir -p /tmp/yoyo-deploy"

# 获取当前脚本所在目录的父目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

log_info "上传vps-transcoder-api目录..."
scp -P $SSH_PORT -r "$PROJECT_DIR/vps-transcoder-api" "$VPS_USER@$VPS_IP:/tmp/yoyo-deploy/"

if [ $? -eq 0 ]; then
    log_info "代码上传完成"
else
    log_error "代码上传失败"
    exit 1
fi

# 执行远程部署
log_step "执行远程部署..."
ssh -p $SSH_PORT $VPS_USER@$VPS_IP << 'REMOTE_SCRIPT'
set -e

echo "========================================"
echo "  🚀 VPS远程部署开始"
echo "========================================"

cd /tmp/yoyo-deploy/vps-transcoder-api

# 给脚本执行权限
chmod +x scripts/*.sh

echo ""
echo "[步骤1/3] 安装系统环境..."
bash scripts/setup-vps.sh

echo ""
echo "[步骤2/3] 部署转码API..."
bash scripts/deploy-api.sh

echo ""
echo "[步骤3/3] 配置Nginx服务..."
bash scripts/configure-nginx.sh

echo ""
echo "========================================"
echo "✅ VPS部署完成！"
echo "========================================"

# 显示服务状态
echo ""
echo "📊 服务状态:"
pm2 status || echo "PM2状态检查失败"
systemctl status nginx --no-pager -l || echo "Nginx状态检查失败"

echo ""
echo "🔑 API密钥:"
if [ -f "/opt/yoyo-transcoder/.env" ]; then
    grep "API_KEY=" /opt/yoyo-transcoder/.env | cut -d'=' -f2
else
    echo "API密钥文件不存在"
fi

echo ""
echo "🌐 服务地址:"
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "YOUR_VPS_IP")
echo "  - API服务: http://$VPS_IP:3000"
echo "  - HLS流: http://$VPS_IP/hls/"
echo "  - 健康检查: http://$VPS_IP/health"

echo ""
echo "========================================"
REMOTE_SCRIPT

if [ $? -eq 0 ]; then
    log_info "远程部署执行成功"
else
    log_error "远程部署执行失败"
    exit 1
fi

# 获取部署结果
log_step "获取部署信息..."
API_KEY=$(ssh -p $SSH_PORT $VPS_USER@$VPS_IP "grep 'API_KEY=' /opt/yoyo-transcoder/.env 2>/dev/null | cut -d'=' -f2" || echo "获取失败")

# 验证服务
log_step "验证服务状态..."
if ssh -p $SSH_PORT $VPS_USER@$VPS_IP "curl -f http://localhost:3000/health" >/dev/null 2>&1; then
    log_info "API服务运行正常"
else
    log_warn "API服务可能异常"
fi

if ssh -p $SSH_PORT $VPS_USER@$VPS_IP "curl -f http://localhost/health" >/dev/null 2>&1; then
    log_info "Nginx服务运行正常"
else
    log_warn "Nginx服务可能异常"
fi

# 清理临时文件
log_step "清理临时文件..."
ssh -p $SSH_PORT $VPS_USER@$VPS_IP "rm -rf /tmp/yoyo-deploy"

echo ""
echo "========================================"
echo "  🎉 VPS部署全部完成！"
echo "========================================"
echo ""
echo "🌐 VPS服务地址:"
echo "  - API服务: http://$VPS_IP:3000"
echo "  - HLS流: http://$VPS_IP/hls/"
echo "  - 健康检查: http://$VPS_IP/health"
echo ""
echo "🔑 API密钥 (请保存):"
echo "  $API_KEY"
echo ""
echo "🔧 管理命令:"
echo "  ssh -p $SSH_PORT $VPS_USER@$VPS_IP \"pm2 status\""
echo "  ssh -p $SSH_PORT $VPS_USER@$VPS_IP \"pm2 logs yoyo-transcoder\""
echo "  ssh -p $SSH_PORT $VPS_USER@$VPS_IP \"systemctl status nginx\""
echo ""
echo "📝 下一步操作:"
echo "  1. 在Cloudflare Workers中配置VPS连接"
echo "  2. 运行: node ../cloudflare-worker/scripts/update-vps-config.js"
echo "  3. 测试完整的转码和播放流程"
echo ""
echo "========================================"
