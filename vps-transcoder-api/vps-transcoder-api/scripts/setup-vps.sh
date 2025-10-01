#!/bin/bash

# YOYO流媒体平台 - VPS服务器环境安装脚本
# 适用于 CentOS 9 / RHEL 9
# 作者: YOYO Team
# 版本: 1.0

set -e  # 遇到错误立即退出

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
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本需要root权限运行"
        log_info "请使用: sudo bash setup-vps.sh"
        exit 1
    fi
}

# 系统信息检查
check_system() {
    log_step "检查系统信息..."
    
    # 检查操作系统
    if [[ -f /etc/redhat-release ]]; then
        OS_VERSION=$(cat /etc/redhat-release)
        log_info "检测到系统: $OS_VERSION"
    else
        log_error "不支持的操作系统，此脚本仅支持CentOS 9/RHEL 9"
        exit 1
    fi
    
    # 检查系统资源
    TOTAL_MEM=$(free -m | awk 'NR==2{printf "%.0f", $2}')
    TOTAL_DISK=$(df -h / | awk 'NR==2{print $2}')
    CPU_CORES=$(nproc)
    
    log_info "系统资源: CPU=${CPU_CORES}核, 内存=${TOTAL_MEM}MB, 磁盘=${TOTAL_DISK}"
    
    if [[ $TOTAL_MEM -lt 1800 ]]; then
        log_warn "内存不足2GB，可能影响FFmpeg转码性能"
    fi
}

# 更新系统
update_system() {
    log_step "更新系统包..."
    dnf update -y
    dnf install -y epel-release
    log_info "系统更新完成"
}

# 安装基础工具
install_basic_tools() {
    log_step "安装基础工具..."
    dnf install -y \
        wget \
        curl \
        git \
        vim \
        htop \
        unzip \
        tar \
        gcc \
        gcc-c++ \
        make \
        openssl-devel \
        zlib-devel \
        pcre-devel
    log_info "基础工具安装完成"
}

# 安装Node.js
install_nodejs() {
    log_step "安装Node.js 18..."
    
    # 添加NodeSource仓库
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    
    # 安装Node.js
    dnf install -y nodejs
    
    # 验证安装
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    
    log_info "Node.js安装完成: $NODE_VERSION"
    log_info "NPM版本: $NPM_VERSION"
    
    # 配置npm镜像源（可选，提高下载速度）
    npm config set registry https://registry.npmmirror.com
    log_info "已配置npm镜像源"
}

# 安装FFmpeg
install_ffmpeg() {
    log_step "安装FFmpeg..."
    
    # 启用RPM Fusion仓库
    dnf install -y \
        https://download1.rpmfusion.org/free/el/rpmfusion-free-release-9.noarch.rpm \
        https://download1.rpmfusion.org/nonfree/el/rpmfusion-nonfree-release-9.noarch.rpm
    
    # 安装必要的依赖包
    log_info "安装FFmpeg依赖包..."
    dnf install -y \
        ladspa \
        rubberband \
        rubberband-devel \
        --skip-broken --nobest
    
    # 安装FFmpeg（使用更宽松的依赖解析）
    log_info "安装FFmpeg主程序..."
    dnf install -y ffmpeg ffmpeg-devel --skip-broken --nobest
    
    # 如果标准安装失败，尝试替代方案
    if ! command -v ffmpeg &> /dev/null; then
        log_warn "标准FFmpeg安装失败，尝试替代方案..."
        
        # 方案1: 安装较旧版本
        dnf install -y ffmpeg-4* --skip-broken --nobest || true
        
        # 方案2: 从源码编译（简化版）
        if ! command -v ffmpeg &> /dev/null; then
            log_warn "尝试安装静态编译版本..."
            install_ffmpeg_static
        fi
    fi
    
    # 验证安装
    if command -v ffmpeg &> /dev/null; then
        FFMPEG_VERSION=$(ffmpeg -version | head -n1)
        log_info "FFmpeg安装完成: $FFMPEG_VERSION"
        
        # 测试FFmpeg功能
        if ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -f null - &>/dev/null; then
            log_info "FFmpeg功能测试通过"
        else
            log_warn "FFmpeg功能测试失败，但程序已安装"
        fi
    else
        log_error "FFmpeg安装失败"
        exit 1
    fi
}

# 安装FFmpeg静态编译版本（备用方案）
install_ffmpeg_static() {
    log_info "下载FFmpeg静态编译版本..."
    
    # 创建临时目录
    mkdir -p /tmp/ffmpeg-install
    cd /tmp/ffmpeg-install
    
    # 下载静态编译版本
    wget -O ffmpeg-release.tar.xz \
        "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" || {
        log_error "FFmpeg静态版本下载失败"
        return 1
    }
    
    # 解压并安装
    tar -xf ffmpeg-release.tar.xz
    FFMPEG_DIR=$(find . -name "ffmpeg-*-amd64-static" -type d | head -n1)
    
    if [[ -n "$FFMPEG_DIR" ]]; then
        cp "$FFMPEG_DIR/ffmpeg" /usr/local/bin/
        cp "$FFMPEG_DIR/ffprobe" /usr/local/bin/
        chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
        
        # 创建符号链接
        ln -sf /usr/local/bin/ffmpeg /usr/bin/ffmpeg
        ln -sf /usr/local/bin/ffprobe /usr/bin/ffprobe
        
        log_info "FFmpeg静态版本安装完成"
    else
        log_error "FFmpeg静态版本解压失败"
        return 1
    fi
    
    # 清理临时文件
    cd /
    rm -rf /tmp/ffmpeg-install
}

# 安装Nginx
install_nginx() {
    log_step "安装Nginx..."
    
    dnf install -y nginx
    
    # 启用并启动Nginx
    systemctl enable nginx
    systemctl start nginx
    
    # 验证安装
    NGINX_VERSION=$(nginx -v 2>&1)
    log_info "Nginx安装完成: $NGINX_VERSION"
    
    # 检查Nginx状态
    if systemctl is-active --quiet nginx; then
        log_info "Nginx服务运行正常"
    else
        log_error "Nginx服务启动失败"
        exit 1
    fi
}

# 安装PM2
install_pm2() {
    log_step "安装PM2进程管理器..."
    
    npm install -g pm2
    
    # 验证安装
    PM2_VERSION=$(pm2 --version)
    log_info "PM2安装完成: v$PM2_VERSION"
    
    # 配置PM2开机自启
    pm2 startup
    log_info "PM2开机自启配置完成"
}

# 创建项目目录
create_directories() {
    log_step "创建项目目录..."
    
    # 创建应用目录
    mkdir -p /opt/yoyo-transcoder
    mkdir -p /var/www/hls
    mkdir -p /var/log/yoyo-transcoder
    
    # 设置目录权限
    chown -R nginx:nginx /var/www/hls
    chmod -R 755 /var/www/hls
    
    chown -R root:root /opt/yoyo-transcoder
    chmod -R 755 /opt/yoyo-transcoder
    
    chown -R root:root /var/log/yoyo-transcoder
    chmod -R 755 /var/log/yoyo-transcoder
    
    log_info "项目目录创建完成"
    log_info "应用目录: /opt/yoyo-transcoder"
    log_info "HLS输出目录: /var/www/hls"
    log_info "日志目录: /var/log/yoyo-transcoder"
}

# 配置防火墙
configure_firewall() {
    log_step "配置防火墙..."
    
    # 启用firewalld
    systemctl enable firewalld
    systemctl start firewalld
    
    # 开放必要端口
    firewall-cmd --permanent --add-port=80/tcp      # HTTP
    firewall-cmd --permanent --add-port=443/tcp     # HTTPS
    firewall-cmd --permanent --add-port=3000/tcp    # API服务
    firewall-cmd --permanent --add-port=22/tcp      # SSH
    
    # 重载防火墙配置
    firewall-cmd --reload
    
    log_info "防火墙配置完成"
    log_info "已开放端口: 22, 80, 443, 3000"
}

# 配置SELinux
configure_selinux() {
    log_step "配置SELinux..."
    
    # 检查SELinux状态
    SELINUX_STATUS=$(getenforce)
    log_info "当前SELinux状态: $SELINUX_STATUS"
    
    if [[ "$SELINUX_STATUS" == "Enforcing" ]]; then
        log_warn "SELinux处于强制模式，可能需要额外配置"
        log_info "如果遇到权限问题，可以考虑设置为Permissive模式"
        log_info "命令: setenforce 0"
    fi
}

# 创建系统用户
create_system_user() {
    log_step "创建系统用户..."
    
    # 创建yoyo用户用于运行应用
    if ! id "yoyo" &>/dev/null; then
        useradd -r -s /bin/bash -d /opt/yoyo-transcoder yoyo
        log_info "已创建系统用户: yoyo"
    else
        log_info "系统用户yoyo已存在"
    fi
    
    # 设置目录权限
    chown -R yoyo:yoyo /opt/yoyo-transcoder
    chown -R yoyo:yoyo /var/log/yoyo-transcoder
}

# 系统优化
optimize_system() {
    log_step "系统优化配置..."
    
    # 增加文件描述符限制
    cat >> /etc/security/limits.conf << EOF
# YOYO转码服务优化
yoyo soft nofile 65536
yoyo hard nofile 65536
root soft nofile 65536
root hard nofile 65536
EOF
    
    # 内核参数优化
    cat >> /etc/sysctl.conf << EOF
# YOYO转码服务网络优化
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.netdev_max_backlog = 5000
EOF
    
    # 应用内核参数
    sysctl -p
    
    log_info "系统优化配置完成"
}

# 安装完成检查
final_check() {
    log_step "安装完成检查..."
    
    # 检查各个服务状态
    echo "=== 服务状态检查 ==="
    
    # Node.js
    if command -v node &> /dev/null; then
        echo "✓ Node.js: $(node --version)"
    else
        echo "✗ Node.js: 未安装"
    fi
    
    # NPM
    if command -v npm &> /dev/null; then
        echo "✓ NPM: $(npm --version)"
    else
        echo "✗ NPM: 未安装"
    fi
    
    # FFmpeg
    if command -v ffmpeg &> /dev/null; then
        echo "✓ FFmpeg: 已安装"
    else
        echo "✗ FFmpeg: 未安装"
    fi
    
    # Nginx
    if systemctl is-active --quiet nginx; then
        echo "✓ Nginx: 运行中"
    else
        echo "✗ Nginx: 未运行"
    fi
    
    # PM2
    if command -v pm2 &> /dev/null; then
        echo "✓ PM2: $(pm2 --version)"
    else
        echo "✗ PM2: 未安装"
    fi
    
    echo "=== 目录检查 ==="
    echo "✓ 应用目录: /opt/yoyo-transcoder"
    echo "✓ HLS目录: /var/www/hls"
    echo "✓ 日志目录: /var/log/yoyo-transcoder"
    
    echo "=== 网络端口 ==="
    echo "✓ HTTP: 80"
    echo "✓ HTTPS: 443"
    echo "✓ API: 3000"
    echo "✓ SSH: 22"
}

# 主函数
main() {
    echo "========================================"
    echo "  YOYO流媒体平台 - VPS环境安装脚本"
    echo "========================================"
    echo ""
    
    check_root
    check_system
    
    log_info "开始安装VPS环境..."
    echo ""
    
    update_system
    install_basic_tools
    install_nodejs
    install_ffmpeg
    install_nginx
    install_pm2
    create_directories
    create_system_user
    configure_firewall
    configure_selinux
    optimize_system
    
    echo ""
    log_info "VPS环境安装完成！"
    echo ""
    
    final_check
    
    echo ""
    echo "========================================"
    log_info "下一步操作："
    echo "1. 上传转码API代码到 /opt/yoyo-transcoder"
    echo "2. 运行部署脚本: bash deploy-api.sh"
    echo "3. 配置Nginx: 复制nginx配置文件"
    echo "4. 启动服务: pm2 start ecosystem.config.js"
    echo "========================================"
}

# 执行主函数
main "$@"
