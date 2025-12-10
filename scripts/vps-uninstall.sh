#!/usr/bin/env bash
# YOYO 流媒体平台 - VPS 卸载/清理脚本（支持保留数据或彻底清除）
# 版本: 2.1.0
# 用法（交互式）：
#   bash <(curl -fsSL https://raw.githubusercontent.com/shao-ye/secure-streaming-platform/master/vps-server/scripts/vps-uninstall.sh)
# 用法（非交互式）：
#   bash vps-uninstall.sh --purge           # 彻底清除（含代码、日志、HLS、Nginx 配置、cloudflared systemd）
#   bash vps-uninstall.sh --keep-data       # 卸载服务但保留数据（默认）

# 中文注释：不再使用全局 set -e，避免某些命令非零退出时脚本直接“静默终止”；
# 关键失败场景统一通过 error() 显式报错退出，其它非关键命令在内部已使用 || true 做容错。

# 中文注释：默认路径/名称
INSTALL_DIR="/opt/yoyo-transcoder"
HLS_DIR="/var/www/hls"
LOG_DIR="/var/log/yoyo-transcoder"
NGINX_CONF="/etc/nginx/conf.d/yoyo-transcoder.conf"
SERVICE_NAME="yoyo-transcoder"

PURGE="false"
KEEP_DATA="true"
NON_INTERACTIVE="false"

# 日志函数
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log() { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[警告]${NC} $1" >&2; }
error() { echo -e "${RED}[错误]${NC} $1" >&2; exit 1; }
step() { echo ""; echo -e "${CYAN}▶ $1${NC}"; }
success() { echo -e "${GREEN}✓${NC} $1"; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --purge) PURGE="true"; KEEP_DATA="false"; shift 1;;
      --keep-data) KEEP_DATA="true"; PURGE="false"; shift 1;;
      --non-interactive) NON_INTERACTIVE="true"; shift 1;;
      --help|-h)
        echo "用法: vps-uninstall.sh [--purge] [--keep-data] [--non-interactive]"; exit 0;;
      *) warn "忽略未知参数: $1"; shift 1;;
    esac
  done
}

check_root() { [[ $EUID -ne 0 ]] && error "需要 root 权限"; }

detect_os() {
  if [[ -f /etc/os-release ]]; then . /etc/os-release; OS=$ID; else OS=""; fi
  case "$OS" in
    centos|rhel) PKG_MANAGER="dnf"; command -v dnf >/dev/null 2>&1 || PKG_MANAGER="yum" ;;
    ubuntu|debian) PKG_MANAGER="apt-get" ;;
    *) warn "未识别的系统: $OS" ;;
  esac
}

ask_yn() {
  local prompt="$1"; local def="$2"; local ans
  if [[ "$NON_INTERACTIVE" == "true" ]]; then echo "$def"; return; fi
  read -rp "$prompt" ans || true
  if [[ -z "$ans" ]]; then echo "$def"; else echo "$ans"; fi
}

stop_pm2() {
  step "停止 PM2 服务..."
  if command -v pm2 >/dev/null 2>&1; then
    pm2 stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    pm2 delete "$SERVICE_NAME" >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
    success "PM2 服务已停止并删除"
  else
    warn "PM2 未安装，跳过"
  fi
}

remove_nginx() {
  step "移除 Nginx 配置..."
  if [[ -f "$NGINX_CONF" ]]; then
    rm -f "$NGINX_CONF"
    if command -v nginx >/dev/null 2>&1; then
      nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
    fi
    success "已删除 Nginx 配置并重载"
  else
    warn "未找到 Nginx 配置，跳过"
  fi
}

remove_cloudflared() {
  step "清理 cloudflared systemd 服务..."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop cloudflared >/dev/null 2>&1 || true
    systemctl disable cloudflared >/dev/null 2>&1 || true
  fi
  if [[ -f "/etc/systemd/system/cloudflared.service" ]]; then
    rm -f /etc/systemd/system/cloudflared.service
    systemctl daemon-reload >/dev/null 2>&1 || true
    success "已移除 cloudflared systemd 服务"
  else
    warn "未发现 cloudflared systemd 文件，跳过"
  fi
}

remove_files() {
  if [[ "$KEEP_DATA" == "true" ]]; then
    step "保留数据模式：仅移除程序，不删除数据目录"
    if [[ -d "$INSTALL_DIR" ]]; then
      rm -rf "$INSTALL_DIR"
      success "已删除 $INSTALL_DIR"
    else
      warn "未找到程序目录：$INSTALL_DIR"
    fi
  else
    step "彻底清除模式：删除程序与数据目录"
    [[ -d "$INSTALL_DIR" ]] && rm -rf "$INSTALL_DIR" && log "已删除程序目录：$INSTALL_DIR" || warn "未找到程序目录：$INSTALL_DIR"
    [[ -d "$HLS_DIR" ]] && rm -rf "$HLS_DIR" && log "已删除 HLS 目录：$HLS_DIR" || warn "未找到 HLS 目录：$HLS_DIR"
    [[ -d "$LOG_DIR" ]] && rm -rf "$LOG_DIR" && log "已删除日志目录：$LOG_DIR" || warn "未找到 日志目录：$LOG_DIR"
  fi
}

main() {
  echo "============================================"; echo -e "${CYAN}  YOYO VPS 卸载 v2.1.0${NC}"; echo "============================================"; echo ""
  parse_args "$@"; check_root; detect_os

  # 中文注释：在开头输出一次当前运行模式，避免用户误以为脚本什么都没做
  log "运行参数：PURGE=${PURGE}, KEEP_DATA=${KEEP_DATA}, NON_INTERACTIVE=${NON_INTERACTIVE}"

  if [[ "$NON_INTERACTIVE" != "true" ]]; then
    if [[ "$PURGE" == "true" ]]; then
      local ans=$(ask_yn "确认执行【彻底清除】（含数据）？[y/N] " "N")
      [[ "$ans" =~ ^(y|Y)$ ]] || error "已取消"
    else
      local ans=$(ask_yn "仅卸载服务并保留数据？[Y/n] " "Y")
      [[ "$ans" =~ ^(n|N)$ ]] && PURGE="true" && KEEP_DATA="false"
    fi
  fi

  # 中文注释：简单检查一下关键目录/配置是否存在，并给出提示，避免“静默卸载”体验
  step "环境检查..."
  if [[ ! -d "$INSTALL_DIR" && ! -f "$NGINX_CONF" && ! -d "$HLS_DIR" && ! -d "$LOG_DIR" ]]; then
    warn "未检测到已安装的 YOYO VPS 相关目录或配置，可能已经卸载过或尚未安装。"
  else
    [[ -d "$INSTALL_DIR" ]] && log "检测到程序目录：$INSTALL_DIR" || warn "未找到程序目录：$INSTALL_DIR"
    [[ -f "$NGINX_CONF" ]] && log "检测到 Nginx 配置：$NGINX_CONF" || warn "未找到 Nginx 配置：$NGINX_CONF"
    [[ -d "$HLS_DIR" ]] && log "检测到 HLS 目录：$HLS_DIR" || warn "未找到 HLS 目录：$HLS_DIR"
    [[ -d "$LOG_DIR" ]] && log "检测到日志目录：$LOG_DIR" || warn "未找到日志目录：$LOG_DIR"
  fi

  stop_pm2
  remove_nginx

  if [[ "$PURGE" == "true" ]]; then
    # 中文注释：彻底清除模式下，同时移除 cloudflared 服务
    remove_cloudflared
  else
    warn "已保留 cloudflared（如需删除可添加 --purge）"
  fi

  remove_files
  success "卸载流程完成"
  log "如需二次确认，可检查上述目录/配置是否已被移除。"
}

main "$@"
