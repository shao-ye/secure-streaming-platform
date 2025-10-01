#!/bin/bash

# YOYO流媒体平台 - VPS转码API部署脚本
# 作者: YOYO Team
# 版本: 1.0

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
APP_DIR="/opt/yoyo-transcoder"
HLS_DIR="/var/www/hls"
LOG_DIR="/var/log/yoyo-transcoder"
APP_USER="yoyo"
SERVICE_NAME="yoyo-transcoder"

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
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本需要root权限运行"
        log_info "请使用: sudo bash deploy-api.sh"
        exit 1
    fi
}

# 检查环境依赖
check_dependencies() {
    log_step "检查环境依赖..."
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js未安装，请先运行setup-vps.sh"
        exit 1
    fi
    
    # 检查NPM
    if ! command -v npm &> /dev/null; then
        log_error "NPM未安装，请先运行setup-vps.sh"
        exit 1
    fi
    
    # 检查FFmpeg
    if ! command -v ffmpeg &> /dev/null; then
        log_error "FFmpeg未安装，请先运行setup-vps.sh"
        exit 1
    fi
    
    # 检查PM2
    if ! command -v pm2 &> /dev/null; then
        log_error "PM2未安装，请先运行setup-vps.sh"
        exit 1
    fi
    
    # 检查目录
    if [[ ! -d "$APP_DIR" ]]; then
        log_error "应用目录不存在: $APP_DIR"
        exit 1
    fi
    
    log_info "环境依赖检查通过"
}

# 停止现有服务
stop_existing_service() {
    log_step "停止现有服务..."
    
    # 停止PM2进程
    if pm2 list | grep -q "$SERVICE_NAME"; then
        pm2 stop "$SERVICE_NAME" || true
        pm2 delete "$SERVICE_NAME" || true
        log_info "已停止现有PM2进程"
    fi
    
    # 清理旧的HLS文件
    if [[ -d "$HLS_DIR" ]]; then
        find "$HLS_DIR" -name "*.m3u8" -delete 2>/dev/null || true
        find "$HLS_DIR" -name "*.ts" -delete 2>/dev/null || true
        log_info "已清理旧的HLS文件"
    fi
}

# 复制应用代码
deploy_application() {
    log_step "部署应用代码..."
    
    # 检查当前目录是否包含package.json
    if [[ ! -f "package.json" ]]; then
        log_error "当前目录不包含package.json文件"
        log_info "请在vps-transcoder-api项目根目录运行此脚本"
        exit 1
    fi
    
    # 复制代码到应用目录
    log_info "复制代码到 $APP_DIR"
    cp -r . "$APP_DIR/"
    
    # 设置目录权限
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    
    log_info "应用代码部署完成"
}

# 安装依赖
install_dependencies() {
    log_step "安装应用依赖..."
    
    cd "$APP_DIR"
    
    # 切换到应用用户安装依赖
    sudo -u "$APP_USER" npm install --production
    
    log_info "应用依赖安装完成"
}

# 创建环境配置文件
create_env_file() {
    log_step "创建环境配置文件..."
    
    # 生成随机API密钥
    API_KEY=$(openssl rand -hex 32)
    
    # 创建.env文件
    cat > "$APP_DIR/.env" << EOF
# YOYO转码API环境配置
NODE_ENV=production
PORT=3000

# API安全配置
API_KEY=$API_KEY
ENABLE_IP_WHITELIST=true

# 目录配置
HLS_OUTPUT_DIR=$HLS_DIR
LOG_DIR=$LOG_DIR

# FFmpeg配置
FFMPEG_PATH=/usr/bin/ffmpeg
SEGMENT_DURATION=2
PLAYLIST_SIZE=6

# 日志配置
LOG_LEVEL=info
LOG_MAX_SIZE=10m
LOG_MAX_FILES=5

# 性能配置
MAX_CONCURRENT_STREAMS=10
STREAM_TIMEOUT=300000
CLEANUP_INTERVAL=60000

# Cloudflare IP段（用于IP白名单）
ALLOWED_IPS=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22
EOF
    
    # 设置文件权限
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
    
    log_info "环境配置文件创建完成"
    log_warn "API密钥: $API_KEY"
    log_warn "请保存此密钥，稍后配置Cloudflare Workers时需要使用"
}

# 创建日志轮转配置
create_logrotate_config() {
    log_step "创建日志轮转配置..."
    
    cat > /etc/logrotate.d/yoyo-transcoder << EOF
$LOG_DIR/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 $APP_USER $APP_USER
    postrotate
        pm2 reload $SERVICE_NAME > /dev/null 2>&1 || true
    endscript
}
EOF
    
    log_info "日志轮转配置完成"
}

# 创建系统服务文件
create_systemd_service() {
    log_step "创建系统服务..."
    
    cat > /etc/systemd/system/yoyo-transcoder.service << EOF
[Unit]
Description=YOYO Transcoder API Service
After=network.target

[Service]
Type=forking
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/pm2 start ecosystem.config.js --env production
ExecReload=/usr/bin/pm2 reload ecosystem.config.js --env production
ExecStop=/usr/bin/pm2 stop ecosystem.config.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    
    # 重载systemd配置
    systemctl daemon-reload
    systemctl enable yoyo-transcoder
    
    log_info "系统服务创建完成"
}

# 启动服务
start_service() {
    log_step "启动转码API服务..."
    
    cd "$APP_DIR"
    
    # 使用PM2启动服务
    sudo -u "$APP_USER" pm2 start ecosystem.config.js --env production
    
    # 保存PM2配置
    sudo -u "$APP_USER" pm2 save
    
    # 等待服务启动
    sleep 5
    
    # 检查服务状态
    if sudo -u "$APP_USER" pm2 list | grep -q "$SERVICE_NAME.*online"; then
        log_info "转码API服务启动成功"
    else
        log_error "转码API服务启动失败"
        sudo -u "$APP_USER" pm2 logs "$SERVICE_NAME" --lines 20
        exit 1
    fi
}

# 健康检查
health_check() {
    log_step "服务健康检查..."
    
    # 等待服务完全启动
    sleep 3
    
    # 检查健康端点
    if curl -f http://localhost:3000/health &>/dev/null; then
        log_info "健康检查通过"
        
        # 显示服务信息
        HEALTH_INFO=$(curl -s http://localhost:3000/health | python3 -m json.tool 2>/dev/null || echo "无法解析健康信息")
        echo "服务信息: $HEALTH_INFO"
    else
        log_error "健康检查失败"
        log_info "检查服务日志:"
        sudo -u "$APP_USER" pm2 logs "$SERVICE_NAME" --lines 10
        exit 1
    fi
}

# 显示部署信息
show_deployment_info() {
    log_step "部署信息总结..."
    
    echo ""
    echo "========================================"
    echo "  YOYO转码API部署完成"
    echo "========================================"
    echo ""
    echo "服务信息:"
    echo "  - 服务名称: $SERVICE_NAME"
    echo "  - 运行端口: 3000"
    echo "  - 应用目录: $APP_DIR"
    echo "  - HLS目录: $HLS_DIR"
    echo "  - 日志目录: $LOG_DIR"
    echo ""
    echo "API端点:"
    echo "  - 健康检查: http://YOUR_VPS_IP:3000/health"
    echo "  - API状态: http://YOUR_VPS_IP:3000/api/status"
    echo "  - HLS文件: http://YOUR_VPS_IP/hls/"
    echo ""
    echo "管理命令:"
    echo "  - 查看状态: pm2 status"
    echo "  - 查看日志: pm2 logs $SERVICE_NAME"
    echo "  - 重启服务: pm2 restart $SERVICE_NAME"
    echo "  - 停止服务: pm2 stop $SERVICE_NAME"
    echo ""
    echo "下一步操作:"
    echo "  1. 配置Nginx (运行 bash configure-nginx.sh)"
    echo "  2. 在Cloudflare Workers中配置VPS连接"
    echo "  3. 测试RTMP到HLS转码功能"
    echo ""
    echo "API密钥 (请保存):"
    echo "  $(grep API_KEY $APP_DIR/.env | cut -d'=' -f2)"
    echo ""
    echo "========================================"
}

# 主函数
main() {
    echo "========================================"
    echo "  YOYO流媒体平台 - API部署脚本"
    echo "========================================"
    echo ""
    
    check_root
    check_dependencies
    stop_existing_service
    deploy_application
    install_dependencies
    create_env_file
    create_logrotate_config
    create_systemd_service
    start_service
    health_check
    
    echo ""
    show_deployment_info
}

# 执行主函数
main "$@"
