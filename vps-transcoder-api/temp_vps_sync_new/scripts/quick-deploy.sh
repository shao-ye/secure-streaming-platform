#!/bin/bash

# YOYO流媒体平台 - 一键部署脚本
# 作者: YOYO Team
# 版本: 1.0

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
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

log_success() {
    echo -e "${PURPLE}[SUCCESS]${NC} $1"
}

# 显示欢迎信息
show_welcome() {
    clear
    echo "========================================"
    echo "  🚀 YOYO流媒体平台 - 一键部署脚本"
    echo "========================================"
    echo ""
    echo "本脚本将自动完成以下操作："
    echo "  ✓ 安装系统环境 (Node.js, FFmpeg, Nginx, PM2)"
    echo "  ✓ 部署转码API服务"
    echo "  ✓ 配置Nginx反向代理"
    echo "  ✓ 启动和验证所有服务"
    echo ""
    echo "服务器要求："
    echo "  - CentOS 9 / RHEL 9"
    echo "  - 1核心CPU, 2GB内存, 30GB存储"
    echo "  - Root权限"
    echo ""
    echo "========================================"
    echo ""
}

# 检查系统要求
check_requirements() {
    log_step "检查系统要求..."
    
    # 检查root权限
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本需要root权限运行"
        log_info "请使用: sudo bash quick-deploy.sh"
        exit 1
    fi
    
    # 检查操作系统
    if [[ ! -f /etc/redhat-release ]]; then
        log_error "不支持的操作系统，此脚本仅支持CentOS 9/RHEL 9"
        exit 1
    fi
    
    # 检查网络连接
    if ! ping -c 1 8.8.8.8 &>/dev/null; then
        log_error "网络连接失败，请检查网络设置"
        exit 1
    fi
    
    # 检查磁盘空间
    AVAILABLE_SPACE=$(df / | awk 'NR==2 {print $4}')
    if [[ $AVAILABLE_SPACE -lt 5000000 ]]; then  # 5GB
        log_warn "可用磁盘空间不足5GB，可能影响部署"
    fi
    
    log_info "系统要求检查通过"
}

# 确认部署
confirm_deployment() {
    echo ""
    log_warn "⚠️  重要提醒："
    echo "  - 此脚本将修改系统配置和安装软件包"
    echo "  - 建议在全新的VPS上运行"
    echo "  - 部署过程需要5-10分钟"
    echo ""
    
    read -p "是否继续部署？(y/N): " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "部署已取消"
        exit 0
    fi
    
    echo ""
    log_info "开始部署..."
    echo ""
}

# 执行部署步骤
run_deployment() {
    local SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # 步骤1: 环境安装
    log_step "步骤 1/3: 安装系统环境..."
    if [[ -f "$SCRIPT_DIR/setup-vps.sh" ]]; then
        bash "$SCRIPT_DIR/setup-vps.sh"
    else
        log_error "找不到环境安装脚本: setup-vps.sh"
        exit 1
    fi
    
    echo ""
    log_success "✓ 系统环境安装完成"
    echo ""
    
    # 步骤2: 部署API
    log_step "步骤 2/3: 部署转码API服务..."
    if [[ -f "$SCRIPT_DIR/deploy-api.sh" ]]; then
        bash "$SCRIPT_DIR/deploy-api.sh"
    else
        log_error "找不到API部署脚本: deploy-api.sh"
        exit 1
    fi
    
    echo ""
    log_success "✓ 转码API服务部署完成"
    echo ""
    
    # 步骤3: 配置Nginx
    log_step "步骤 3/3: 配置Nginx服务..."
    if [[ -f "$SCRIPT_DIR/configure-nginx.sh" ]]; then
        bash "$SCRIPT_DIR/configure-nginx.sh"
    else
        log_error "找不到Nginx配置脚本: configure-nginx.sh"
        exit 1
    fi
    
    echo ""
    log_success "✓ Nginx服务配置完成"
    echo ""
}

# 最终验证
final_verification() {
    log_step "最终验证..."
    
    local ERRORS=0
    
    # 检查PM2服务
    if sudo -u yoyo pm2 list | grep -q "yoyo-transcoder.*online"; then
        log_success "✓ PM2服务运行正常"
    else
        log_error "✗ PM2服务异常"
        ERRORS=$((ERRORS + 1))
    fi
    
    # 检查Nginx服务
    if systemctl is-active --quiet nginx; then
        log_success "✓ Nginx服务运行正常"
    else
        log_error "✗ Nginx服务异常"
        ERRORS=$((ERRORS + 1))
    fi
    
    # 检查API健康
    if curl -f http://localhost:3000/health &>/dev/null; then
        log_success "✓ API健康检查通过"
    else
        log_error "✗ API健康检查失败"
        ERRORS=$((ERRORS + 1))
    fi
    
    # 检查Nginx代理
    if curl -f http://localhost/health &>/dev/null; then
        log_success "✓ Nginx代理正常"
    else
        log_error "✗ Nginx代理异常"
        ERRORS=$((ERRORS + 1))
    fi
    
    return $ERRORS
}

# 显示部署结果
show_deployment_result() {
    local ERRORS=$1
    
    echo ""
    echo "========================================"
    if [[ $ERRORS -eq 0 ]]; then
        log_success "🎉 部署完成！所有服务运行正常"
    else
        log_error "⚠️  部署完成，但有 $ERRORS 个服务异常"
    fi
    echo "========================================"
    echo ""
    
    # 获取服务器IP
    SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "YOUR_VPS_IP")
    
    # 获取API密钥
    API_KEY=""
    if [[ -f "/opt/yoyo-transcoder/.env" ]]; then
        API_KEY=$(grep "API_KEY=" /opt/yoyo-transcoder/.env | cut -d'=' -f2)
    fi
    
    echo "🌐 服务地址:"
    echo "  - API服务: http://$SERVER_IP:3000"
    echo "  - HLS流: http://$SERVER_IP/hls/"
    echo "  - 健康检查: http://$SERVER_IP/health"
    echo ""
    
    echo "🔑 API密钥 (请保存):"
    echo "  $API_KEY"
    echo ""
    
    echo "📋 下一步操作:"
    echo "  1. 在Cloudflare Workers中配置VPS连接:"
    echo "     - VPS_API_URL=http://$SERVER_IP:3000"
    echo "     - VPS_API_KEY=$API_KEY"
    echo "     - VPS_HLS_URL=http://$SERVER_IP/hls"
    echo ""
    echo "  2. 测试转码功能:"
    echo "     curl -H \"X-API-Key: $API_KEY\" http://$SERVER_IP:3000/api/status"
    echo ""
    echo "  3. 在前端管理界面添加测试频道并验证播放"
    echo ""
    
    echo "🔧 管理命令:"
    echo "  - 查看服务状态: pm2 status"
    echo "  - 查看服务日志: pm2 logs yoyo-transcoder"
    echo "  - 重启API服务: pm2 restart yoyo-transcoder"
    echo "  - 重启Nginx: systemctl restart nginx"
    echo ""
    
    if [[ $ERRORS -gt 0 ]]; then
        echo "❗ 故障排除:"
        echo "  - 查看详细日志: pm2 logs yoyo-transcoder"
        echo "  - 查看Nginx日志: tail -f /var/log/nginx/yoyo-error.log"
        echo "  - 检查防火墙: firewall-cmd --list-ports"
        echo "  - 参考部署指南: cat /path/to/VPS_DEPLOYMENT_GUIDE.md"
        echo ""
    fi
    
    echo "========================================"
}

# 主函数
main() {
    show_welcome
    check_requirements
    confirm_deployment
    
    # 记录开始时间
    START_TIME=$(date +%s)
    
    # 执行部署
    run_deployment
    
    # 最终验证
    final_verification
    ERRORS=$?
    
    # 计算部署时间
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    
    echo ""
    log_info "部署耗时: ${DURATION}秒"
    
    # 显示结果
    show_deployment_result $ERRORS
    
    # 返回错误码
    exit $ERRORS
}

# 捕获中断信号
trap 'echo ""; log_error "部署被中断"; exit 1' INT TERM

# 执行主函数
main "$@"
