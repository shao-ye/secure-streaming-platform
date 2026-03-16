#!/usr/bin/env bash
# YOYO 流媒体平台 - VPS 一键安装脚本（交互/非交互 + Cloudflare Tunnel Token 安装）
# 版本: 2.1.0
# 用法（交互式）:
#   bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/secure-streaming-platform/master/vps-server/scripts/vps-oneclick.sh)
# 用法（非交互式示例）:
#   bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/secure-streaming-platform/master/vps-server/scripts/vps-oneclick.sh) \
#     --api-port 3000 --token CF_TUNNEL_TOKEN --hostname yoyo-vps.example.com --domain vps.example.com --non-interactive --yes
#
# 说明：
# - 脚本仅“安装 cloudflared Token 并以 systemd 服务运行”，不在脚本中创建隧道实体与 Public Hostname。
#   建议在 Cloudflare Zero Trust 控制台完成“创建隧道 + 添加 Public Hostname（目标 URL 指向 http://127.0.0.1:<NGINX_PORT>）”。
# - 安装完成后会在终端输出 VPS_API_URL / VPS_API_KEY，便于在 Cloudflare Worker 中配置。

set -e

# -------------------- 全局默认配置 --------------------
SCRIPT_VERSION="2.1.0"
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

# 环境变量（可被参数覆盖）
VPS_DOMAIN="${VPS_DOMAIN:-}"
API_KEY="${API_KEY:-}"
API_PORT="${API_PORT:-3000}"
NGINX_PORT="${NGINX_PORT:-52535}"
SKIP_DEPS="${SKIP_DEPS:-false}"
CF_TUNNEL_TOKEN="${CF_TUNNEL_TOKEN:-}"
CF_HOSTNAME="${CF_HOSTNAME:-}"
NON_INTERACTIVE="${NON_INTERACTIVE:-false}"
ASSUME_YES="${ASSUME_YES:-false}"

# -------------------- 日志与工具函数 --------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
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
    success "运行用户已创建: $APP_USER"
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
    success "录制目录已配置 ACL 权限"
  else
    chown -R root:"$APP_GROUP" "$RECORDINGS_DIR"
    find "$RECORDINGS_DIR" -type d -exec chmod 2770 {} \; 2>/dev/null || true
    find "$RECORDINGS_DIR" -type f -exec chmod 660 {} \; 2>/dev/null || true
    warn "未检测到 setfacl，已回退为 root:${APP_GROUP} 共享组权限"
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

parse_args() {
  # 中文注释：解析命令行参数（非交互模式使用），支持自定义端口/Token/Hostname 等
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --api-port) API_PORT="$2"; shift 2;;
      --nginx-port) NGINX_PORT="$2"; shift 2;;
      --token) CF_TUNNEL_TOKEN="$2"; shift 2;;
      --hostname) CF_HOSTNAME="$2"; shift 2;;
      --domain) VPS_DOMAIN="$2"; shift 2;;
      --api-key) API_KEY="$2"; shift 2;;
      --skip-deps) SKIP_DEPS="true"; shift 1;;
      --non-interactive) NON_INTERACTIVE="true"; shift 1;;
      --yes|-y) ASSUME_YES="true"; shift 1;;
      --update) UPDATE_MODE="true"; shift 1;;
      --help|-h)
        echo "用法: vps-oneclick.sh [选项]"
        echo "选项:"
        echo "  --api-port PORT          API 端口（默认: 3000）"
        echo "  --nginx-port PORT        Nginx 暴露端口（默认: 52535）"
        echo "  --token TOKEN            Cloudflare Tunnel Token"
        echo "  --hostname HOSTNAME      Tunnel 公开域名"
        echo "  --domain DOMAIN          VPS 域名"
        echo "  --api-key KEY            自定义 API Key"
        echo "  --skip-deps              跳过依赖安装"
        echo "  --non-interactive        非交互模式"
        echo "  --yes, -y                自动确认所有提示"
        echo "  --update                 更新模式（仅更新代码和依赖）"
        echo "  --help, -h               显示此帮助信息"
        exit 0;;
      *) warn "忽略未知参数: $1"; shift 1;;
    esac
  done
  return 0
}

check_root() {
  if [[ $EUID -ne 0 ]]; then
    error "需要 root 权限，请使用 sudo 运行脚本"
  fi
  return 0
}

ask() {
  # 中文注释：交互式读取输入；直接回车返回默认值
  local prompt="$1"; local default_val="$2"; local var
  read -rp "$prompt" var || true
  [[ -z "$var" ]] && echo "$default_val" || echo "$var"
}

detect_os() {
  # 中文注释：检测系统并选择合适的包管理器
  if [[ -f /etc/os-release ]]; then . /etc/os-release; OS=$ID; else OS=""; fi
  case "$OS" in
    centos|rhel) PKG_MANAGER="dnf"; command -v dnf >/dev/null 2>&1 || PKG_MANAGER="yum" ;;
    ubuntu|debian) PKG_MANAGER="apt-get" ;;
    *) error "不支持的操作系统：$OS（支持 CentOS/RHEL/Ubuntu/Debian）" ;;
  esac
}

ensure_basic_tools() {
  # 中文注释：确保基础工具存在（目前至少需要 tar，用于解压 ffmpeg 和源码包）
  if ! command -v tar >/dev/null 2>&1; then
    step "安装基础工具 tar..."
    if ! $PKG_MANAGER install -y tar; then
      warn "自动安装 tar 失败，请手动执行例如：dnf install -y tar 或 apt-get install -y tar"
    fi
  fi
}

install_nodejs() {
  step "安装 Node.js 18..."
  if command -v node >/dev/null 2>&1; then
    local ver=$(node -v | grep -oE '[0-9]+' | head -1); [[ $ver -ge 18 ]] && success "Node.js 已安装: $(node -v)" && return 0
  fi
  case $OS in
    centos|rhel)
      curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
      $PKG_MANAGER install -y nodejs ;;
    ubuntu|debian)
      curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
      $PKG_MANAGER update
      $PKG_MANAGER install -y nodejs ;;
  esac
  success "Node.js 安装完成: $(node -v)"
}

install_ffmpeg() {
  step "安装 FFmpeg..."
  if command -v ffmpeg >/dev/null 2>&1; then success "FFmpeg 已安装"; return 0; fi
  local tmp_dir=$(mktemp -d); cd "$tmp_dir"
  local arch=$(uname -m); local url=""
  case "$arch" in
    x86_64|amd64) url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" ;;
    aarch64|arm64) url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz" ;;
    *) url="" ;;
  esac
  # 显示 FFmpeg 下载进度（去掉 -s）
  if [[ -n "$url" ]] && curl -fSLO "$url"; then
    tar -xf ffmpeg-release-*-static.tar.xz
    local dir=$(find . -maxdepth 1 -type d -name 'ffmpeg-*static' | head -n1)
    cp "$dir/ffmpeg" /usr/local/bin/; cp "$dir/ffprobe" /usr/local/bin/
    chmod +x /usr/local/bin/{ffmpeg,ffprobe}; ln -sf /usr/local/bin/ffmpeg /usr/bin/ffmpeg
  else
    warn "静态版下载失败，尝试使用系统包安装"
    $PKG_MANAGER install -y ffmpeg || warn "系统包安装失败，请手动安装 FFmpeg"
  fi
  cd / && rm -rf "$tmp_dir"; success "FFmpeg 安装完成"
}

install_nginx() {
  step "安装 Nginx..."; command -v nginx >/dev/null 2>&1 && success "Nginx 已安装" && return 0
  $PKG_MANAGER install -y nginx || warn "安装 Nginx 失败，请手动安装"
  systemctl enable nginx >/dev/null 2>&1 || true
  success "Nginx 安装完成"
}

install_pm2() { step "安装 PM2..."; command -v pm2 >/dev/null 2>&1 && success "PM2 已安装" && return 0; npm install -g pm2; success "PM2 安装完成"; }

clone_project() {
  step "下载项目代码..."
  local tmp="/tmp/yoyo-$$"; rm -rf "$tmp"; mkdir -p "$tmp"

  # 中文注释：优先使用 git，如果不存在或失败，自动回退到 curl + tarball 方案。
  local repo_url="$GITHUB_REPO"
  local owner_repo="shao-ye/secure-streaming-platform"
  local branches=("$GITHUB_BRANCH" "master" "main")

  if command -v git >/dev/null 2>&1; then
    for br in "${branches[@]}"; do
      if git clone --depth 1 --branch "$br" "$repo_url" "$tmp" >/dev/null 2>&1; then
        mkdir -p "$INSTALL_DIR" && cp -r "$tmp/vps-server/"* "$INSTALL_DIR/" && rm -rf "$tmp"
        chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR"
        success "代码下载完成（git:$br）"
        return 0
      fi
    done
    warn "git clone 失败，尝试使用 tarball 下载..."
    rm -rf "$tmp"; mkdir -p "$tmp"
  else
    warn "未检测到 git，使用 tarball 下载..."
  fi

  # 中文注释：tarball 下载（公共仓库用 codeload，私有仓库可用 GITHUB_TOKEN 走 API）。
  for br in "${branches[@]}"; do
    local tar_url="https://codeload.github.com/${owner_repo}/tar.gz/refs/heads/${br}"
    local tar_file="$tmp/src.tgz"
    if curl -fsSL "$tar_url" -o "$tar_file"; then
      local base
      base=$(tar -tzf "$tar_file" | head -n1 | cut -f1 -d"/") || true
      tar -xzf "$tar_file" -C "$tmp" >/dev/null 2>&1 || continue
      if [[ -n "$base" && -d "$tmp/$base/vps-server" ]]; then
        mkdir -p "$INSTALL_DIR" && cp -r "$tmp/$base/vps-server/"* "$INSTALL_DIR/" && rm -rf "$tmp"
        chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR"
        success "代码下载完成（tarball:$br）"
        return 0
      fi
    fi
  done

  # 中文注释：私有仓库兜底（需要导出 GITHUB_TOKEN）。
  if [[ -n "$GITHUB_TOKEN" ]]; then
    for br in "${branches[@]}"; do
      local api_url="https://api.github.com/repos/${owner_repo}/tarball/${br}"
      local tar_file="$tmp/src.tgz"
      if curl -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" -fsSL "$api_url" -o "$tar_file"; then
        local base
        base=$(tar -tzf "$tar_file" | head -n1 | cut -f1 -d"/") || true
        tar -xzf "$tar_file" -C "$tmp" >/dev/null 2>&1 || continue
        if [[ -n "$base" && -d "$tmp/$base/vps-server" ]]; then
          mkdir -p "$INSTALL_DIR" && cp -r "$tmp/$base/vps-server/"* "$INSTALL_DIR/" && rm -rf "$tmp"
          chown -R "$APP_USER:$APP_GROUP" "$INSTALL_DIR"
          success "代码下载完成（api+token:$br）"
          return 0
        fi
      fi
    done
  fi

  error "代码下载失败"
}

install_deps() {
  step "安装项目依赖..."
  cd "$INSTALL_DIR"
  fix_runtime_permissions
  run_as_app_user npm install --production || error "依赖安装失败"
  success "依赖安装完成"
}

generate_config() {
  step "生成配置文件..."
  [[ -z "$API_KEY" ]] && API_KEY=$(openssl rand -hex 32)
  
  # 自动生成 VPS_BASE_URL（基于 CF_HOSTNAME 或公网 IP）
  local vps_base_url=""
  if [[ -n "$CF_HOSTNAME" ]]; then
    vps_base_url="https://$CF_HOSTNAME"
  else
    local public_ip=$(curl -s4 ifconfig.me 2>/dev/null || echo "")
    if [[ -n "$public_ip" ]]; then
      vps_base_url="http://${public_ip}:${API_PORT}"
    else
      vps_base_url="http://localhost:${API_PORT}"
    fi
  fi
  
  # 交互式询问 Cloudflare Worker API 地址（用于 VPS 回调到 Workers），非交互模式使用占位符
  local workers_api_url="https://your-worker.workers.dev"
  if [[ "$NON_INTERACTIVE" != "true" ]]; then
    echo ""
    log "📝 请输入 Cloudflare Worker 的完整访问地址（用于 VPS 调用 Workers API，必须以 http:// 或 https:// 开头）"
    log "   示例1: https://your-worker.example.com (绑定到 Workers 的自定义域名)"
    log "   示例2: https://your-worker.workers.dev (默认 workers.dev 域名)"
    log "   提示: 不要只填写裸域名（例如 your-worker.example.com），否则会导致 VPS 配置校验失败。"
    log "         如需后续修改，可编辑 /opt/yoyo-transcoder/.env 中的 WORKERS_API_URL 并执行 systemctl restart $SERVICE_NAME"
    read -rp "   Worker 地址（完整 URL，直接回车使用默认占位值）: " input_url || true
    [[ -n "$input_url" ]] && workers_api_url="$input_url"

    # 中文注释：若用户输入未包含协议，自动补全为 https://，避免 WORKERS_API_URL 校验失败
    if [[ "$workers_api_url" != http://* && "$workers_api_url" != https://* ]]; then
      workers_api_url="https://$workers_api_url"
    fi
  fi
  
  cat > "$INSTALL_DIR/.env" << EOF
TZ=Asia/Shanghai
NODE_ENV=production
PORT=$API_PORT
API_KEY=$API_KEY
VPS_API_KEY=$API_KEY
API_SECRET_KEY=$API_KEY
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
VPS_BASE_URL=$vps_base_url
WORKERS_API_URL=$workers_api_url
RECORDINGS_PATH=$RECORDINGS_DIR
EOF
  chown "$APP_USER:$APP_GROUP" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  success "配置生成完成"
}

configure_nginx() {
  step "配置 Nginx..."
  # 中文注释：按生产环境的 nginx.conf 结构生成配置，使用单独的暴露端口（默认 52535）
  cat > /etc/nginx/conf.d/yoyo-transcoder.conf << EOF
server {
    listen $NGINX_PORT;
    server_name ${VPS_DOMAIN:-_};

    location /api/ {
        proxy_pass http://127.0.0.1:$API_PORT/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /health {
        proxy_pass http://127.0.0.1:$API_PORT/health;
    }

    location /hls/ {
        alias $HLS_DIR/;
        add_header Access-Control-Allow-Origin '*';
        add_header Cache-Control "public, max-age=10";
        types { application/vnd.apple.mpegurl m3u8; video/mp2t ts; }
    }

    location / {
        return 200 'YOYO VPS API Server';
        add_header Content-Type text/plain;
    }
}
EOF
  # 中文注释：先测试配置，再根据当前 Nginx 状态选择 reload 或 start，避免新装系统上服务处于 inactive 状态导致 502
  if nginx -t >/dev/null 2>&1; then
    if systemctl is-active nginx >/dev/null 2>&1; then
      systemctl reload nginx >/dev/null 2>&1 || warn "Nginx 重载失败，请检查 systemctl status nginx"
    else
      systemctl start nginx >/dev/null 2>&1 || warn "Nginx 启动失败，请检查 systemctl status nginx"
    fi
  else
    warn "Nginx 配置测试失败，请检查 /etc/nginx/conf.d/yoyo-transcoder.conf"
  fi
  success "Nginx 配置完成"
}

start_service() {
  step "启动服务..."
  cd "$INSTALL_DIR"
  fix_runtime_permissions
  ensure_recordings_permissions
  ensure_systemd_service
  systemctl restart "$SERVICE_NAME" >/dev/null 2>&1 || error "服务启动失败"
  sleep 3
  run_as_app_user pm2 save >/dev/null 2>&1 || true
  curl -sf http://127.0.0.1:$API_PORT/health >/dev/null || error "健康检查失败"
  success "服务启动成功"
}

install_cloudflared() {
  step "安装 Cloudflare Tunnel (cloudflared)..."
  if command -v cloudflared >/dev/null 2>&1; then success "cloudflared 已安装: $(cloudflared --version | head -n1)"; else
    local arch=$(uname -m); local url=""
    case "$arch" in
      x86_64|amd64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
      aarch64|arm64) url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64" ;;
      *) warn "未识别架构 $arch，尝试使用 amd64 版本"; url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" ;;
    esac
    local tmpf="/tmp/cloudflared-$$"; curl -fSL "$url" -o "$tmpf" || error "下载 cloudflared 失败"; install -m 755 "$tmpf" /usr/local/bin/cloudflared; rm -f "$tmpf"
    success "cloudflared 安装完成"
  fi
  if [[ -n "$CF_TUNNEL_TOKEN" ]]; then
    step "注册并安装 cloudflared systemd 服务（使用 Token）..."
    if systemctl list-unit-files 2>/dev/null | grep -q '^cloudflared.service'; then
      warn "检测到已存在 cloudflared systemd 服务，尝试卸载后重新安装..."
      cloudflared service uninstall || warn "卸载旧 cloudflared 服务失败，请手动检查"
    elif [[ -f /etc/systemd/system/cloudflared.service ]]; then
      warn "检测到残留的 cloudflared.service 单元文件，尝试清理..."
      rm -f /etc/systemd/system/cloudflared.service
      systemctl daemon-reload || true
    fi
    cloudflared --no-autoupdate service install "$CF_TUNNEL_TOKEN" || error "cloudflared 服务安装失败，请检查 Token 是否正确"
    systemctl enable cloudflared >/dev/null 2>&1 || true; systemctl restart cloudflared || true; sleep 2
    success "cloudflared 服务已安装并启动"
  else
    warn "未提供 CF_TUNNEL_TOKEN，跳过 cloudflared 服务安装（你可用 --token 传入）。"
  fi
}

show_result() {
  local ip=$(curl -s4 ifconfig.me 2>/dev/null || echo "YOUR_IP")
  echo ""; echo "============================================"; echo -e "${GREEN}  🎉 安装完成！${NC}"; echo "============================================"; echo ""
  echo "🔐 API 密钥: ${YELLOW}$API_KEY${NC}"; echo ""
  echo "🌐 访问地址:"
  if [[ -n "$VPS_DOMAIN" ]]; then echo "   http://$VPS_DOMAIN/health"; else echo "   http://$ip:$API_PORT/health"; fi
  echo ""; echo "🛠️ 管理命令:"; echo "   systemctl status|restart|stop $SERVICE_NAME"; echo "   sudo -u $APP_USER HOME=$APP_HOME PM2_HOME=$APP_PM2_HOME pm2 status"; echo ""
  echo "📝 配置到 Cloudflare Workers:"
  if [[ -n "$CF_HOSTNAME" ]]; then echo "   VPS_API_URL = https://$CF_HOSTNAME"; else echo "   VPS_API_URL = http://${VPS_DOMAIN:-$ip}"; fi
  echo "   VPS_API_KEY = $API_KEY"; echo "============================================"
  if [[ -n "$CF_HOSTNAME" ]]; then
    echo ""; echo "🔎 隧道连通性检查:"; local code
    code=$(curl -ks -o /dev/null -w "%{http_code}" "https://$CF_HOSTNAME/health" || true)
    if [[ "$code" == "200" ]]; then success "通过 Tunnel 访问健康检查成功: https://$CF_HOSTNAME/health"; else warn "通过 Tunnel 访问返回 HTTP $code。若在 UI 已添加 Public Hostname，请确认目标 URL 指向 http://127.0.0.1:$NGINX_PORT 并稍后重试。"; fi
  fi
}

update_project() {
  step "检查现有安装..."
  if [[ ! -d "$INSTALL_DIR" ]]; then
    error "未找到已安装的项目，请先执行完整安装"
  fi
  
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    error "未找到配置文件 .env，请先执行完整安装"
  fi

  ensure_runtime_user
  fix_runtime_permissions
  ensure_recordings_permissions
  ensure_systemd_service
  
  step "备份当前代码..."
  local backup_dir="$INSTALL_DIR.backup.$(date +%Y%m%d_%H%M%S)"
  cp -r "$INSTALL_DIR" "$backup_dir"
  success "备份已保存到: $backup_dir"
  
  step "下载最新代码..."
  local tmp_dir="/tmp/yoyo-update-$$"
  rm -rf "$tmp_dir"; mkdir -p "$tmp_dir"
  
  # 使用与 clone_project 相同的逻辑下载代码
  local owner_repo="shao-ye/secure-streaming-platform"
  local branches=("$GITHUB_BRANCH" "master" "main")
  
  for br in "${branches[@]}"; do
    local tar_url="https://codeload.github.com/${owner_repo}/tar.gz/refs/heads/${br}"
    local tar_file="$tmp_dir/src.tgz"
    if curl -fsSL "$tar_url" -o "$tar_file" 2>/dev/null; then
      local base
      base=$(tar -tzf "$tar_file" 2>/dev/null | head -n1 | cut -f1 -d"/") || continue
      tar -xzf "$tar_file" -C "$tmp_dir" 2>/dev/null || continue
      if [[ -n "$base" && -d "$tmp_dir/$base/vps-server" ]]; then
        # 保留 .env 和 node_modules
        local env_backup="$tmp_dir/.env.backup"
        cp "$INSTALL_DIR/.env" "$env_backup"
        
        # 更新代码（排除 .env 和 node_modules）
        rsync -av --exclude='.env' --exclude='node_modules' "$tmp_dir/$base/vps-server/" "$INSTALL_DIR/" >/dev/null 2>&1 || \
          (rm -rf "$INSTALL_DIR/src" && cp -r "$tmp_dir/$base/vps-server/src" "$INSTALL_DIR/" && \
           rm -rf "$INSTALL_DIR/config" && cp -r "$tmp_dir/$base/vps-server/config" "$INSTALL_DIR/" && \
           cp "$tmp_dir/$base/vps-server/package.json" "$INSTALL_DIR/" && \
           cp "$tmp_dir/$base/vps-server/ecosystem.config.js" "$INSTALL_DIR/")
        
        # 恢复 .env
        cp "$env_backup" "$INSTALL_DIR/.env"
        chown "$APP_USER:$APP_GROUP" "$INSTALL_DIR/.env"
        fix_runtime_permissions
        
        rm -rf "$tmp_dir"
        success "代码更新完成（分支: $br）"
        
        step "更新项目依赖..."
        cd "$INSTALL_DIR"
        run_as_app_user npm install --production || warn "依赖更新失败，但不影响使用"
        success "依赖更新完成"
        
        step "重启服务..."
        systemctl restart "$SERVICE_NAME" >/dev/null 2>&1 || error "服务重启失败"
        sleep 3
        curl -sf http://127.0.0.1:$API_PORT/health >/dev/null || warn "健康检查失败，请检查日志"
        success "服务重启成功"
        
        echo ""; echo "============================================"
        echo -e "${GREEN}  🎉 更新完成！${NC}"
        echo "============================================"; echo ""
        echo "📝 更新内容: 代码已更新到最新版本（分支: $br）"
        echo "🔧 配置文件: 已保留原有配置"
        echo "💾 备份位置: $backup_dir"
        echo "🔍 查看日志: pm2 logs vps-transcoder-api"
        echo "============================================"
        return 0
      fi
    fi
  done
  
  rm -rf "$tmp_dir"
  error "代码下载失败，更新中止。原有备份保存在: $backup_dir"
}

main() {
  clear; echo "============================================"; echo -e "${CYAN}  YOYO VPS 一键安装 v$SCRIPT_VERSION${NC}"; echo "============================================"; echo ""
  parse_args "$@"; check_root; detect_os; ensure_basic_tools
  ensure_runtime_user
  
  # 更新模式
  if [[ "$UPDATE_MODE" == "true" ]]; then
    update_project
    exit 0
  fi
  
  # 完整安装模式
  fix_runtime_permissions
  ensure_recordings_permissions
  if [[ "$SKIP_DEPS" != "true" ]]; then install_nodejs; install_ffmpeg; install_nginx; install_pm2; fi

  # 中文注释：交互式模式下，询问用户是否使用默认端口、是否安装 cloudflared、以及 Hostname
  if [[ "$NON_INTERACTIVE" != "true" ]]; then
    local ans
    read -rp "是否使用默认 API 端口 $API_PORT ? [Y/n] " ans || true
    if [[ "$ans" =~ ^(n|N)$ ]]; then API_PORT=$(ask "请输入自定义 API 端口: " "$API_PORT"); fi
    read -rp "是否使用默认 Nginx 暴露端口 $NGINX_PORT ? [Y/n] " ans || true
    if [[ "$ans" =~ ^(n|N)$ ]]; then NGINX_PORT=$(ask "请输入自定义 Nginx 暴露端口: " "$NGINX_PORT"); fi
    if [[ -z "$CF_TUNNEL_TOKEN" ]]; then
      read -rp "是否安装并注册 Cloudflare Tunnel（需要 UI 中的 Token）? [y/N] " ans || true
      if [[ "$ans" =~ ^(y|Y)$ ]]; then read -rp "请输入 CF_TUNNEL_TOKEN: " CF_TUNNEL_TOKEN; fi
    fi
    if [[ -z "$CF_HOSTNAME" ]]; then
      read -rp "是否输入 Tunnel Hostname 以便连通性测试（例如 yoyo-vps.example.com）? [Y/n] " ans || true
      if [[ ! "$ans" =~ ^(n|N)$ ]]; then read -rp "请输入 Tunnel Hostname: " CF_HOSTNAME; fi
    fi
  fi

  clone_project; fix_runtime_permissions; install_deps; generate_config; configure_nginx; start_service; install_cloudflared; show_result
}

main "$@"
