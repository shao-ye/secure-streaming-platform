#!/bin/bash

# YOYO流媒体平台 - 修改Nginx端口脚本
# 将Nginx端口从80修改为52535

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

NEW_PORT=52535

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
echo "  🔧 修改Nginx端口为 $NEW_PORT"
echo "========================================"
echo ""

# 检查是否为root用户
if [[ $EUID -ne 0 ]]; then
    log_error "此脚本需要root权限运行"
    exit 1
fi

# 备份配置文件
log_step "备份Nginx配置文件..."
cp /etc/nginx/conf.d/yoyo-transcoder.conf /etc/nginx/conf.d/yoyo-transcoder.conf.backup-$(date +%Y%m%d-%H%M%S)
log_info "配置文件已备份"

# 修改端口
log_step "修改Nginx监听端口为 $NEW_PORT..."
sed -i "s/listen 80;/listen $NEW_PORT;/g" /etc/nginx/conf.d/yoyo-transcoder.conf
log_info "端口修改完成"

# 开放防火墙端口
log_step "开放防火墙端口 $NEW_PORT..."
firewall-cmd --permanent --add-port=$NEW_PORT/tcp
firewall-cmd --reload
log_info "防火墙端口已开放"

# 测试配置
log_step "测试Nginx配置..."
if nginx -t; then
    log_info "Nginx配置测试通过"
else
    log_error "Nginx配置测试失败"
    exit 1
fi

# 重启Nginx
log_step "重启Nginx服务..."
systemctl restart nginx

if systemctl is-active --quiet nginx; then
    log_info "Nginx服务重启成功"
else
    log_error "Nginx服务重启失败"
    systemctl status nginx
    exit 1
fi

# 获取VPS IP地址
log_step "获取VPS IP地址..."
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "无法获取IP")

# 测试新端口
log_step "测试新端口访问..."
sleep 2

if curl -f http://localhost:$NEW_PORT/ &>/dev/null; then
    log_info "本地端口 $NEW_PORT 访问正常"
else
    log_warn "本地端口 $NEW_PORT 访问可能有问题"
fi

echo ""
echo "========================================"
echo "  🎉 端口修改完成！"
echo "========================================"
echo ""
echo "新的访问地址:"
echo "  - 主页面: http://$VPS_IP:$NEW_PORT/"
echo "  - API代理: http://$VPS_IP:$NEW_PORT/api/health"
echo "  - HLS流服务: http://$VPS_IP:$NEW_PORT/hls/"
echo "  - 健康检查: http://$VPS_IP:$NEW_PORT/health"
echo "  - 状态页面: http://$VPS_IP:$NEW_PORT/nginx_status (仅本地)"
echo ""
echo "本地测试命令:"
echo "  curl http://localhost:$NEW_PORT/"
echo "  curl http://localhost:$NEW_PORT/health"
echo "  curl http://localhost:$NEW_PORT/api/health"
echo ""
echo "防火墙状态:"
firewall-cmd --list-ports | grep $NEW_PORT && echo "  ✅ 端口 $NEW_PORT 已开放" || echo "  ❌ 端口 $NEW_PORT 未开放"
echo ""
echo "管理命令:"
echo "  - 查看Nginx状态: systemctl status nginx"
echo "  - 查看端口占用: netstat -tlnp | grep :$NEW_PORT"
echo "  - 测试配置: nginx -t"
echo ""
echo "========================================"
