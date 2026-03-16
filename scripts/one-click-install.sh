#!/bin/bash
# YOYO 流媒体平台 - VPS 一键安装脚本
# 版本: 2.0.0
# 用法: bash <(curl -Ls https://raw.githubusercontent.com/YOUR_REPO/main/vps-server/scripts/one-click-install.sh)
# 
# 环境变量:
#   VPS_DOMAIN - VPS域名 (可选)
#   API_KEY - API密钥 (留空自动生成)
#   API_PORT - API端口 (默认3000)
#   NGINX_PORT - Nginx端口 (默认80)
#   SKIP_DEPS - 跳过依赖安装 (默认false)

set -e  # 遇到错误立即退出

# 全局变量
SCRIPT_VERSION="2.0.0"
INSTALL_DIR="/opt/yoyo-transcoder"
HLS_DIR="/var/www/hls"
LOG_DIR="/var/log/transcoder"
APP_USER="yoyo"
APP_GROUP="yoyo"
APP_HOME="/home/yoyo"
APP_PM2_HOME="$APP_HOME/.pm2"
SERVICE_NAME="yoyo-transcoder"
RECORDINGS_DIR="/srv/filebrowser/yoyo-k"
GITHUB_REPO="https://github.com/shao-ye/secure-streaming-platform.git"
GITHUB_BRANCH="main"

# 用户配置（环境变量）
VPS_DOMAIN="${VPS_DOMAIN:-}"
API_KEY="${API_KEY:-}"
API_PORT="${API_PORT:-3000}"
NGINX_PORT="${NGINX_PORT:-80}"
SKIP_DEPS="${SKIP_DEPS:-false}"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 日志函数
log() { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[警告]${NC} $1" >&2; }
error() { echo -e "${RED}[错误]${NC} $1" >&2; exit 1; }
step() { echo ""; echo -e "${CYAN}▶ $1${NC}"; }
success() { echo -e "${GREEN}✓${NC} $1"; }

# 中文注释：以固定 HOME / PM2_HOME 切换到运行用户执行命令，避免 root 与 yoyo 的 PM2 上下文混用。
run_as_app_user() {
    sudo -H -u "$APP_USER" env HOME="$APP_HOME" PM2_HOME="$APP_PM2_HOME" PATH="/usr/local/bin:/usr/bin:/bin:$PATH" "$@"
}

# 中文注释：确保运行用户、HOME 与 PM2_HOME 存在，后续所有 PM2 操作统一落到 yoyo 用户下。
ensure_runtime_user() {
    if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
        groupadd -r "$APP_GROUP"
    fi

    if ! id "$APP_USER" >/dev/null 2>&1; then
        useradd -r -g "$APP_GROUP" -m -d "$APP_HOME" -s /bin/bash "$APP_USER"
    fi

    install -d -m 755 -o "$APP_USER" -g "$APP_GROUP" "$APP_HOME"
    install -d -m 700 -o "$APP_USER" -g "$APP_GROUP" "$APP_PM2_HOME"
}

# 中文注释：统一运行目录、日志目录和 HLS 目录权限，避免 root 更新后再次把权限打坏。
fix_runtime_permissions() {
    install -d -m 755 -o "$APP_USER" -g "$APP_GROUP" "$INSTALL_DIR"
    install -d -m 755 -o "$APP_USER" -g "$APP_GROUP" "$HLS_DIR"
    install -d -m 755 -o "$APP_USER" -g "$APP_GROUP" "$LOG_DIR"
    chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR" "$HLS_DIR" "$LOG_DIR" "$APP_HOME"
    chmod 700 "$APP_PM2_HOME"
}

# 中文注释：录制目录仍保留给 File Browser 所在的 root 体系，但额外授予 yoyo 写权限，避免影响下载服务。
ensure_recordings_permissions() {
    install -d -m 750 /srv/filebrowser
    mkdir -p "$RECORDINGS_DIR"

    if command -v setfacl >/dev/null 2>&1; then
        chmod 750 "$RECORDINGS_DIR"
        setfacl -R -m "u:${APP_USER}:rwx" "$RECORDINGS_DIR" >/dev/null 2>&1 || true
        find "$RECORDINGS_DIR" -type d -exec setfacl -m "d:u:${APP_USER}:rwx" {} \; 2>/dev/null || true
    else
        chown -R root:"$APP_GROUP" "$RECORDINGS_DIR"
        find "$RECORDINGS_DIR" -type d -exec chmod 2770 {} \; 2>/dev/null || true
        find "$RECORDINGS_DIR" -type f -exec chmod 660 {} \; 2>/dev/null || true
    fi
}

# 中文注释：生成 systemd 服务，root 后续仍通过 systemctl 运维，但实际运行身份固定为 yoyo。
ensure_systemd_service() {
    local pm2_bin
    pm2_bin=$(command -v pm2 2>/dev/null || echo /usr/bin/pm2)

    cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=YOYO Transcoder API Service
After=network.target

[Service]
Type=forking
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$INSTALL_DIR
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=HOME=$APP_HOME
Environment=PM2_HOME=$APP_PM2_HOME
Environment=TZ=Asia/Shanghai
ExecStart=$pm2_bin start ecosystem.config.js --env production --update-env
ExecReload=$pm2_bin reload ecosystem.config.js --env production --update-env
ExecStop=$pm2_bin delete vps-transcoder-api
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
}

# 检测操作系统
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$ID
    elif [[ -f /etc/redhat-release ]]; then
        OS="centos"
    else
        error "不支持的操作系统"
    fi
    
    case $OS in
        centos|rhel) PKG_MANAGER="dnf"; [[ ! $(command -v dnf) ]] && PKG_MANAGER="yum" ;;
        ubuntu|debian) PKG_MANAGER="apt-get" ;;
        *) error "不支持的操作系统: $OS" ;;
    esac
}

# 检查Root权限
check_root() {
    [[ $EUID -ne 0 ]] && error "需要root权限，请使用: sudo bash <(curl -Ls ...)"
}

# 安装Node.js
install_nodejs() {
    step "安装 Node.js 18..."
    if command -v node &>/dev/null; then
        local ver=$(node -v | grep -oP '\d+' | head -1)
        [[ $ver -ge 18 ]] && success "Node.js 已安装: $(node -v)" && return 0
    fi
    
    case $OS in
        centos|rhel)
            curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - >/dev/null 2>&1
            $PKG_MANAGER install -y nodejs >/dev/null 2>&1
            ;;
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_18.x | bash - >/dev/null 2>&1
            $PKG_MANAGER update >/dev/null 2>&1
            $PKG_MANAGER install -y nodejs >/dev/null 2>&1
            ;;
    esac
    success "Node.js 安装完成: $(node -v)"
}

# 安装FFmpeg（静态版本）
install_ffmpeg() {
    step "安装 FFmpeg..."
    command -v ffmpeg &>/dev/null && success "FFmpeg 已安装" && return 0
    
    local tmp_dir=$(mktemp -d)
    cd "$tmp_dir"
    wget -q https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz 2>/dev/null || {
        warn "静态版本下载失败，使用系统包..."
        $PKG_MANAGER install -y ffmpeg >/dev/null 2>&1
        cd / && rm -rf "$tmp_dir"
        return 0
    }
    
    tar -xf ffmpeg-release-amd64-static.tar.xz
    local dir=$(find . -name "ffmpeg-*-amd64-static" -type d | head -n1)
    [[ -n "$dir" ]] && {
        cp "$dir/ffmpeg" /usr/local/bin/
        cp "$dir/ffprobe" /usr/local/bin/
        chmod +x /usr/local/bin/{ffmpeg,ffprobe}
        ln -sf /usr/local/bin/ffmpeg /usr/bin/ffmpeg
    }
    cd / && rm -rf "$tmp_dir"
    success "FFmpeg 安装完成"
}

# 安装Nginx
install_nginx() {
    step "安装 Nginx..."
    command -v nginx &>/dev/null && success "Nginx 已安装" && return 0
    $PKG_MANAGER install -y nginx >/dev/null 2>&1
    systemctl enable nginx >/dev/null 2>&1
    success "Nginx 安装完成"
}

# 安装PM2
install_pm2() {
    step "安装 PM2..."
    command -v pm2 &>/dev/null && success "PM2 已安装" && return 0
    npm install -g pm2 >/dev/null 2>&1
    success "PM2 安装完成"
}

# 克隆项目
clone_project() {
    step "下载项目代码..."
    local tmp="/tmp/yoyo-$$"
    git clone --depth 1 --branch "$GITHUB_BRANCH" "$GITHUB_REPO" "$tmp" >/dev/null 2>&1 || error "代码下载失败"
    mkdir -p "$INSTALL_DIR"
    cp -r "$tmp/vps-server/"* "$INSTALL_DIR/"
    chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR"
    rm -rf "$tmp"
    success "代码下载完成"
}

# 安装依赖
install_deps() {
    step "安装项目依赖..."
    cd "$INSTALL_DIR"
    fix_runtime_permissions
    run_as_app_user npm install --production >/dev/null 2>&1 || error "依赖安装失败"
    success "依赖安装完成"
}

# 生成配置
generate_config() {
    step "生成配置文件..."
    [[ -z "$API_KEY" ]] && API_KEY=$(openssl rand -hex 32)
    
    cat > "$INSTALL_DIR/.env" << EOF
TZ=Asia/Shanghai
NODE_ENV=production
PORT=$API_PORT
API_KEY=$API_KEY
VPS_API_KEY=$API_KEY
ENABLE_IP_WHITELIST=true
HLS_OUTPUT_DIR=$HLS_DIR
LOG_DIR=$LOG_DIR
FFMPEG_PATH=/usr/bin/ffmpeg
SEGMENT_DURATION=2
PLAYLIST_SIZE=6
LOG_LEVEL=info
MAX_CONCURRENT_STREAMS=10
STREAM_TIMEOUT=300000
CLEANUP_INTERVAL=60000
ALLOWED_IPS=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22
RECORDINGS_PATH=$RECORDINGS_DIR
EOF
    chown "$APP_USER:$APP_GROUP" "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/.env"
    success "配置生成完成"
}

# 配置Nginx
configure_nginx() {
    step "配置 Nginx..."
    cat > /etc/nginx/conf.d/yoyo-transcoder.conf << EOF
server {
    listen $NGINX_PORT;
    server_name ${VPS_DOMAIN:-_};
    
    location /hls/ {
        alias $HLS_DIR/;
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "public, max-age=10";
        types { application/vnd.apple.mpegurl m3u8; video/mp2t ts; }
    }
    
    location /api/ {
        proxy_pass http://127.0.0.1:$API_PORT/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    
    location /health {
        proxy_pass http://127.0.0.1:$API_PORT/health;
    }
}
EOF
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1
    success "Nginx 配置完成"
}

# 启动服务
start_service() {
    step "启动服务..."
    cd "$INSTALL_DIR"
    fix_runtime_permissions
    ensure_recordings_permissions
    ensure_systemd_service
    systemctl restart "$SERVICE_NAME" >/dev/null 2>&1 || error "服务启动失败"
    run_as_app_user pm2 save >/dev/null 2>&1 || true
    sleep 3
    curl -sf http://localhost:$API_PORT/health >/dev/null || error "健康检查失败"
    success "服务启动成功"
}

# 显示结果
show_result() {
    local ip=$(curl -s4 ifconfig.me 2>/dev/null || echo "YOUR_IP")
    echo ""
    echo "============================================"
    echo -e "${GREEN}  🎉 安装完成！${NC}"
    echo "============================================"
    echo ""
    echo "🔐 API 密钥: ${YELLOW}$API_KEY${NC}"
    echo ""
    echo "🌐 访问地址:"
    [[ -n "$VPS_DOMAIN" ]] && echo "   http://$VPS_DOMAIN/health" || echo "   http://$ip:$API_PORT/health"
    echo ""
    echo "🛠️ 管理命令:"
    echo "   systemctl status|restart|stop $SERVICE_NAME"
    echo "   sudo -u $APP_USER HOME=$APP_HOME PM2_HOME=$APP_PM2_HOME pm2 status"
    echo ""
    echo "📝 配置到 Cloudflare Workers:"
    echo "   VPS_API_URL = http://${VPS_DOMAIN:-$ip}"
    echo "   VPS_API_KEY = $API_KEY"
    echo "============================================"
}

# 主函数
main() {
    clear
    echo "============================================"
    echo -e "${CYAN}  YOYO VPS 一键安装 v$SCRIPT_VERSION${NC}"
    echo "============================================"
    echo ""
    
    check_root
    detect_os
    ensure_runtime_user
    
    fix_runtime_permissions
    ensure_recordings_permissions
    
    [[ "$SKIP_DEPS" != "true" ]] && {
        install_nodejs
        install_ffmpeg
        install_nginx
        install_pm2
    }
    
    clone_project
    install_deps
    generate_config
    configure_nginx
    start_service
    show_result
}

main "$@"
