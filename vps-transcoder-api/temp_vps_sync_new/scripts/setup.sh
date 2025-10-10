#!/bin/bash

# VPS Transcoder API Setup Script for CentOS 9
# 自动化部署和配置脚本

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    log_error "Please run this script as root"
    exit 1
fi

log_info "Starting VPS Transcoder API setup..."

# 1. 更新系统
log_info "Updating system packages..."
dnf update -y

# 2. 安装基础依赖
log_info "Installing basic dependencies..."
dnf install -y wget curl git vim unzip

# 3. 安装Node.js 18
log_info "Installing Node.js 18..."
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
dnf install -y nodejs
log_info "Node.js version: $(node -v)"
log_info "NPM version: $(npm -v)"

# 4. 安装FFmpeg
log_info "Installing FFmpeg..."
dnf install -y epel-release
dnf config-manager --set-enabled crb
dnf install -y --enablerepo=rpmfusion-free ffmpeg
log_info "FFmpeg version: $(ffmpeg -version | head -n1)"

# 5. 安装Nginx
log_info "Installing Nginx..."
dnf install -y nginx
log_info "Nginx version: $(nginx -v 2>&1)"

# 6. 安装PM2
log_info "Installing PM2 globally..."
npm install -g pm2

# 7. 创建必要的目录
log_info "Creating required directories..."
mkdir -p /var/www/hls
mkdir -p /var/log/transcoder
mkdir -p /opt/vps-transcoder-api

# 设置目录权限
chown -R nginx:nginx /var/www/hls
chmod 755 /var/www/hls

chown -R root:root /var/log/transcoder
chmod 755 /var/log/transcoder

# 8. 配置防火墙
log_info "Configuring firewall..."
systemctl start firewalld
systemctl enable firewalld
firewall-cmd --permanent --add-port=8080/tcp  # Nginx HLS服务
firewall-cmd --permanent --add-port=22/tcp    # SSH
firewall-cmd --reload

# 9. 配置SELinux
log_info "Configuring SELinux..."
setsebool -P httpd_can_network_connect 1
setsebool -P httpd_enable_homedirs 1

# 10. 备份原始Nginx配置
log_info "Backing up original Nginx configuration..."
if [ -f /etc/nginx/nginx.conf ]; then
    cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup
fi

# 11. 创建systemd服务文件
log_info "Creating systemd service files..."

# PM2服务文件
cat > /etc/systemd/system/pm2-transcoder.service << 'EOF'
[Unit]
Description=PM2 process manager for VPS Transcoder API
Documentation=https://pm2.keymetrics.io/
After=network.target

[Service]
Type=oneshot
User=root
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=PM2_HOME=/root/.pm2
ExecStart=/usr/local/bin/pm2 resurrect
ExecReload=/usr/local/bin/pm2 reload all
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

# 12. 启用服务
log_info "Enabling services..."
systemctl enable nginx
systemctl enable pm2-transcoder

# 13. 创建日志轮转配置
log_info "Creating log rotation configuration..."
cat > /etc/logrotate.d/vps-transcoder << 'EOF'
/var/log/transcoder/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0644 root root
}
EOF

# 14. 创建健康检查脚本
log_info "Creating health check script..."
cat > /usr/local/bin/transcoder-health-check.sh << 'EOF'
#!/bin/bash

# 健康检查脚本
HEALTH_URL="http://localhost:8080/health"
LOG_FILE="/var/log/transcoder/health-check.log"

# 检查API服务
curl -s --max-time 10 "$HEALTH_URL" > /dev/null
if [ $? -eq 0 ]; then
    echo "$(date): API service is healthy" >> "$LOG_FILE"
    exit 0
else
    echo "$(date): API service is unhealthy, attempting restart" >> "$LOG_FILE"
    systemctl restart pm2-transcoder
    exit 1
fi
EOF

chmod +x /usr/local/bin/transcoder-health-check.sh

# 15. 创建cron任务进行健康检查
log_info "Setting up health check cron job..."
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/transcoder-health-check.sh") | crontab -

# 16. 优化系统参数
log_info "Optimizing system parameters..."
cat >> /etc/sysctl.conf << 'EOF'

# VPS Transcoder API optimizations
net.core.somaxconn = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
fs.file-max = 65535
EOF

sysctl -p

# 17. 设置ulimit
log_info "Configuring ulimits..."
cat >> /etc/security/limits.conf << 'EOF'

# VPS Transcoder API limits
root soft nofile 65535
root hard nofile 65535
nginx soft nofile 65535
nginx hard nofile 65535
EOF

# 18. 创建部署脚本
log_info "Creating deployment script..."
cat > /opt/deploy-transcoder.sh << 'EOF'
#!/bin/bash

# VPS Transcoder API部署脚本
set -e

APP_DIR="/opt/vps-transcoder-api"
NGINX_CONF="/etc/nginx/nginx.conf"

echo "Starting deployment..."

# 停止服务
echo "Stopping services..."
systemctl stop nginx || true
pm2 stop all || true

# 更新代码
echo "Updating application..."
cd "$APP_DIR"
git pull origin main
npm install --production

# 复制配置文件
if [ -f "config/nginx.conf" ]; then
    echo "Updating Nginx configuration..."
    cp "config/nginx.conf" "$NGINX_CONF"
    nginx -t
fi

# 启动服务
echo "Starting services..."
systemctl start nginx
pm2 start ecosystem.config.js --env production
pm2 save

echo "Deployment completed successfully!"
EOF

chmod +x /opt/deploy-transcoder.sh

# 19. 显示完成信息
log_info "Setup completed successfully!"
echo
log_info "Next steps:"
echo "1. Copy your application code to /opt/vps-transcoder-api"
echo "2. Create .env file with your configuration"
echo "3. Copy the nginx.conf to /etc/nginx/nginx.conf"
echo "4. Start services with:"
echo "   systemctl start nginx"
echo "   cd /opt/vps-transcoder-api && pm2 start ecosystem.config.js"
echo "   pm2 save"
echo
log_info "System information:"
echo "- Node.js: $(node -v)"
echo "- NPM: $(npm -v)"
echo "- FFmpeg: $(ffmpeg -version 2>&1 | head -n1 | cut -d' ' -f3)"
echo "- Nginx: $(nginx -v 2>&1 | cut -d'/' -f2)"
echo "- PM2: $(pm2 -v)"
echo
log_info "Important directories:"
echo "- Application: /opt/vps-transcoder-api"
echo "- HLS Output: /var/www/hls"
echo "- Logs: /var/log/transcoder"
echo
log_info "Services:"
echo "- nginx: systemctl status nginx"
echo "- pm2-transcoder: systemctl status pm2-transcoder"
echo
log_warn "Don't forget to configure your firewall and API keys!"
