#!/bin/bash

# YOYO流媒体平台 - Nginx配置脚本
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
HLS_DIR="/var/www/hls"
NGINX_CONF_DIR="/etc/nginx"
NGINX_SITES_DIR="/etc/nginx/conf.d"
SERVICE_NAME="nginx"

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
        log_info "请使用: sudo bash configure-nginx.sh"
        exit 1
    fi
}

# 检查Nginx是否安装
check_nginx() {
    log_step "检查Nginx安装状态..."
    
    if ! command -v nginx &> /dev/null; then
        log_error "Nginx未安装，请先运行setup-vps.sh"
        exit 1
    fi
    
    log_info "Nginx已安装: $(nginx -v 2>&1)"
}

# 备份现有配置
backup_config() {
    log_step "备份现有Nginx配置..."
    
    BACKUP_DIR="/etc/nginx/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # 备份主配置文件
    if [[ -f "$NGINX_CONF_DIR/nginx.conf" ]]; then
        cp "$NGINX_CONF_DIR/nginx.conf" "$BACKUP_DIR/"
        log_info "已备份主配置文件"
    fi
    
    # 备份站点配置
    if [[ -d "$NGINX_SITES_DIR" ]]; then
        cp -r "$NGINX_SITES_DIR"/* "$BACKUP_DIR/" 2>/dev/null || true
        log_info "已备份站点配置文件"
    fi
    
    log_info "配置备份完成: $BACKUP_DIR"
}

# 创建YOYO转码服务配置
create_yoyo_config() {
    log_step "创建YOYO转码服务配置..."
    
    cat > "$NGINX_SITES_DIR/yoyo-transcoder.conf" << 'EOF'
# YOYO流媒体平台 - 转码服务配置

# 上游API服务器
upstream yoyo_api {
    server 127.0.0.1:3000;
    keepalive 32;
}

# 主服务器配置
server {
    listen 80;
    server_name _;
    
    # 安全头设置
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    
    # 日志配置
    access_log /var/log/nginx/yoyo-access.log;
    error_log /var/log/nginx/yoyo-error.log;
    
    # 客户端配置
    client_max_body_size 10M;
    client_body_timeout 60s;
    client_header_timeout 60s;
    
    # Gzip压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;
    
    # HLS流文件服务
    location /hls/ {
        alias /var/www/hls/;
        
        # CORS设置
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
        add_header Access-Control-Allow-Headers 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range';
        add_header Access-Control-Expose-Headers 'Content-Length,Content-Range';
        
        # 缓存设置
        location ~* \.(m3u8)$ {
            expires -1;
            add_header Cache-Control no-cache;
        }
        
        location ~* \.(ts)$ {
            expires 1h;
            add_header Cache-Control public;
        }
        
        # 文件类型设置
        location ~* \.(m3u8)$ {
            add_header Content-Type application/vnd.apple.mpegurl;
        }
        
        location ~* \.(ts)$ {
            add_header Content-Type video/mp2t;
        }
        
        # 安全设置
        try_files $uri =404;
    }
    
    # API代理
    location /api/ {
        proxy_pass http://yoyo_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # 缓冲设置
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }
    
    # 健康检查端点
    location /health {
        proxy_pass http://yoyo_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        access_log off;
    }
    
    # 状态页面（仅本地访问）
    location /nginx_status {
        stub_status on;
        access_log off;
        allow 127.0.0.1;
        deny all;
    }
    
    # 默认页面
    location / {
        return 200 'YOYO Transcoder Service is running';
        add_header Content-Type text/plain;
    }
    
    # 错误页面
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;
    
    location = /404.html {
        return 404 'Resource not found';
        add_header Content-Type text/plain;
    }
    
    location = /50x.html {
        return 500 'Internal server error';
        add_header Content-Type text/plain;
    }
}

# HTTPS配置模板（需要SSL证书时启用）
# server {
#     listen 443 ssl http2;
#     server_name your-domain.com;
#     
#     ssl_certificate /path/to/your/certificate.crt;
#     ssl_certificate_key /path/to/your/private.key;
#     
#     # SSL配置
#     ssl_protocols TLSv1.2 TLSv1.3;
#     ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
#     ssl_prefer_server_ciphers off;
#     ssl_session_cache shared:SSL:10m;
#     ssl_session_timeout 10m;
#     
#     # 其他配置与HTTP相同...
# }
EOF
    
    log_info "YOYO转码服务配置创建完成"
}

# 优化Nginx主配置
optimize_nginx_config() {
    log_step "优化Nginx主配置..."
    
    # 备份原始配置
    cp "$NGINX_CONF_DIR/nginx.conf" "$NGINX_CONF_DIR/nginx.conf.backup"
    
    cat > "$NGINX_CONF_DIR/nginx.conf" << 'EOF'
# YOYO流媒体平台 - Nginx主配置文件

user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

# 加载动态模块
include /usr/share/nginx/modules/*.conf;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    # 日志格式
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    
    # 基础设置
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;
    
    # MIME类型
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Gzip压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;
    
    # 缓冲区设置
    client_body_buffer_size 128k;
    client_max_body_size 10m;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 4k;
    output_buffers 1 32k;
    postpone_output 1460;
    
    # 超时设置
    client_header_timeout 3m;
    client_body_timeout 3m;
    send_timeout 3m;
    
    # 连接限制
    limit_conn_zone $binary_remote_addr zone=addr:5m;
    limit_req_zone $binary_remote_addr zone=req:5m rate=10r/s;
    
    # 包含站点配置
    include /etc/nginx/conf.d/*.conf;
}
EOF
    
    log_info "Nginx主配置优化完成"
}

# 创建日志轮转配置
create_log_rotation() {
    log_step "创建Nginx日志轮转配置..."
    
    cat > /etc/logrotate.d/nginx-yoyo << 'EOF'
/var/log/nginx/yoyo-*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 nginx nginx
    sharedscripts
    postrotate
        if [ -f /var/run/nginx.pid ]; then
            kill -USR1 `cat /var/run/nginx.pid`
        fi
    endscript
}
EOF
    
    log_info "Nginx日志轮转配置完成"
}

# 测试配置
test_config() {
    log_step "测试Nginx配置..."
    
    if nginx -t; then
        log_info "Nginx配置测试通过"
    else
        log_error "Nginx配置测试失败"
        exit 1
    fi
}

# 重启Nginx服务
restart_nginx() {
    log_step "重启Nginx服务..."
    
    systemctl restart nginx
    
    if systemctl is-active --quiet nginx; then
        log_info "Nginx服务重启成功"
    else
        log_error "Nginx服务重启失败"
        systemctl status nginx
        exit 1
    fi
}

# 验证服务
verify_service() {
    log_step "验证Nginx服务..."
    
    # 等待服务启动
    sleep 2
    
    # 测试HTTP访问
    if curl -f http://localhost/ &>/dev/null; then
        log_info "HTTP服务验证通过"
    else
        log_error "HTTP服务验证失败"
        exit 1
    fi
    
    # 测试HLS目录访问
    if curl -f http://localhost/hls/ &>/dev/null; then
        log_info "HLS目录访问验证通过"
    else
        log_warn "HLS目录访问验证失败（可能是因为目录为空）"
    fi
    
    # 显示服务状态
    echo ""
    echo "Nginx服务状态:"
    systemctl status nginx --no-pager -l
}

# 显示配置信息
show_config_info() {
    log_step "配置信息总结..."
    
    echo ""
    echo "========================================"
    echo "  Nginx配置完成"
    echo "========================================"
    echo ""
    echo "服务端点:"
    echo "  - 主页面: http://YOUR_VPS_IP/"
    echo "  - API代理: http://YOUR_VPS_IP/api/"
    echo "  - HLS流: http://YOUR_VPS_IP/hls/"
    echo "  - 健康检查: http://YOUR_VPS_IP/health"
    echo "  - 状态页面: http://YOUR_VPS_IP/nginx_status (仅本地)"
    echo ""
    echo "配置文件:"
    echo "  - 主配置: /etc/nginx/nginx.conf"
    echo "  - 站点配置: /etc/nginx/conf.d/yoyo-transcoder.conf"
    echo "  - 日志轮转: /etc/logrotate.d/nginx-yoyo"
    echo ""
    echo "日志文件:"
    echo "  - 访问日志: /var/log/nginx/yoyo-access.log"
    echo "  - 错误日志: /var/log/nginx/yoyo-error.log"
    echo ""
    echo "管理命令:"
    echo "  - 重启服务: systemctl restart nginx"
    echo "  - 查看状态: systemctl status nginx"
    echo "  - 测试配置: nginx -t"
    echo "  - 重载配置: nginx -s reload"
    echo ""
    echo "下一步操作:"
    echo "  1. 在Cloudflare Workers中配置VPS IP地址"
    echo "  2. 测试完整的RTMP到HLS转码流程"
    echo "  3. 配置SSL证书（可选）"
    echo ""
    echo "========================================"
}

# 主函数
main() {
    echo "========================================"
    echo "  YOYO流媒体平台 - Nginx配置脚本"
    echo "========================================"
    echo ""
    
    check_root
    check_nginx
    backup_config
    create_yoyo_config
    optimize_nginx_config
    create_log_rotation
    test_config
    restart_nginx
    verify_service
    
    echo ""
    show_config_info
}

# 执行主函数
main "$@"
