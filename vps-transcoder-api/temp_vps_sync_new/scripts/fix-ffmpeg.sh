#!/bin/bash

# YOYO流媒体平台 - FFmpeg修复脚本
# 专门解决CentOS 9的FFmpeg依赖冲突问题
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
echo "  🔧 FFmpeg修复脚本 (CentOS 9)"
echo "========================================"
echo ""

# 检查是否为root用户
if [[ $EUID -ne 0 ]]; then
    log_error "此脚本需要root权限运行"
    exit 1
fi

# 清理之前的安装尝试
log_step "清理之前的安装尝试..."
dnf remove -y ffmpeg* libav* x264* x265* 2>/dev/null || true

# 方案1: 尝试解决依赖冲突
log_step "方案1: 解决依赖冲突..."

# 安装PowerTools仓库（包含更多开发包）
dnf install -y dnf-plugins-core
dnf config-manager --set-enabled crb

# 安装基础依赖
log_info "安装基础依赖..."
dnf install -y \
    wget \
    tar \
    xz \
    gcc \
    gcc-c++ \
    make \
    cmake \
    pkg-config \
    yasm \
    nasm

# 尝试安装ladspa和相关依赖
log_info "安装音频处理依赖..."
dnf install -y \
    alsa-lib-devel \
    pulseaudio-libs-devel \
    jack-audio-connection-kit-devel \
    --skip-broken --nobest || true

# 尝试从不同源安装ladspa
dnf install -y ladspa --skip-broken --nobest || {
    log_warn "无法从标准仓库安装ladspa，尝试EPEL..."
    dnf install -y ladspa-devel --skip-broken --nobest || true
}

# 尝试安装rubberband
log_info "安装rubberband..."
dnf install -y rubberband rubberband-devel --skip-broken --nobest || true

# 再次尝试安装FFmpeg
log_info "尝试安装FFmpeg..."
if dnf install -y ffmpeg ffmpeg-devel --skip-broken --nobest; then
    log_info "FFmpeg安装成功！"
    ffmpeg -version | head -n3
    exit 0
fi

# 方案2: 安装静态编译版本
log_step "方案2: 安装静态编译版本..."

# 创建临时目录
TEMP_DIR="/tmp/ffmpeg-static-install"
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

# 下载静态编译版本
log_info "下载FFmpeg静态编译版本..."
wget -O ffmpeg-release.tar.xz \
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" || {
    log_error "下载失败，尝试备用地址..."
    wget -O ffmpeg-release.tar.xz \
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl-shared.tar.xz" || {
        log_error "所有下载地址都失败"
        exit 1
    }
}

# 解压
log_info "解压FFmpeg..."
tar -xf ffmpeg-release.tar.xz

# 找到FFmpeg目录
FFMPEG_DIR=$(find . -maxdepth 1 -type d -name "*ffmpeg*" | head -n1)
if [[ -z "$FFMPEG_DIR" ]]; then
    log_error "未找到FFmpeg目录"
    exit 1
fi

# 安装到系统
log_info "安装FFmpeg到系统..."
if [[ -f "$FFMPEG_DIR/ffmpeg" ]]; then
    cp "$FFMPEG_DIR/ffmpeg" /usr/local/bin/
    chmod +x /usr/local/bin/ffmpeg
    ln -sf /usr/local/bin/ffmpeg /usr/bin/ffmpeg
fi

if [[ -f "$FFMPEG_DIR/ffprobe" ]]; then
    cp "$FFMPEG_DIR/ffprobe" /usr/local/bin/
    chmod +x /usr/local/bin/ffprobe
    ln -sf /usr/local/bin/ffprobe /usr/bin/ffprobe
fi

# 清理临时文件
cd /
rm -rf "$TEMP_DIR"

# 验证安装
log_step "验证FFmpeg安装..."
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n1)
    log_info "✅ FFmpeg安装成功: $FFMPEG_VERSION"
    
    # 功能测试
    log_info "进行功能测试..."
    if ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -f null - &>/dev/null; then
        log_info "✅ FFmpeg功能测试通过"
    else
        log_warn "⚠️ FFmpeg功能测试失败，但程序已安装"
    fi
    
    echo ""
    echo "========================================"
    echo "  🎉 FFmpeg修复完成！"
    echo "========================================"
    echo ""
    echo "FFmpeg信息:"
    ffmpeg -version | head -n3
    echo ""
    echo "安装位置:"
    which ffmpeg
    which ffprobe
    echo ""
    echo "现在可以继续执行VPS部署脚本了！"
    echo "========================================"
    
else
    log_error "❌ FFmpeg安装失败"
    echo ""
    echo "请尝试以下解决方案："
    echo "1. 检查网络连接"
    echo "2. 手动下载FFmpeg二进制文件"
    echo "3. 使用Docker容器运行FFmpeg"
    exit 1
fi
