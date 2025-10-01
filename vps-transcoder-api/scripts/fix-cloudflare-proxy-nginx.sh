#!/bin/bash

# 修复Cloudflare代理环境下的Nginx配置
# VPS监听52535端口，处理来自Cloudflare的HTTP请求

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}🔧 修复Cloudflare代理环境下的Nginx配置...${NC}"
echo -e "${BLUE}架构: Cloudflare HTTPS -> VPS HTTP:52535 -> Node.js:3000${NC}"

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ 请使用root用户执行此脚本${NC}"
    exit 1
fi

# 备份现有配置
NGINX_CONF="/etc/nginx/nginx.conf"
BACKUP_CONF="/etc/nginx/nginx.conf.backup-$(date +%Y%m%d_%H%M%S)"

if [ -f "$NGINX_CONF" ]; then
    echo -e "${YELLOW}💾 备份现有Nginx配置...${NC}"
    cp "$NGINX_CONF" "$BACKUP_CONF"
    echo -e "${GREEN}✅ 备份完成: $BACKUP_CONF${NC}"
fi

# 创建适用于Cloudflare代理的Nginx配置
echo -e "${YELLOW}📝 创建Cloudflare代理环境的Nginx配置...${NC}"
cat > "$NGINX_CONF" << 'EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

include /usr/share/nginx/modules/*.conf;

events {
    worker_connections 1024;
}

http {
    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for" '
                      'CF-Ray: "$http_cf_ray" CF-IP: "$http_cf_connecting_ip"';

    access_log  /var/log/nginx/access.log  main;

    sendfile            on;
    tcp_nopush          on;
    tcp_nodelay         on;
    keepalive_timeout   65;
    types_hash_max_size 4096;
    client_max_body_size 100M;

    include             /etc/nginx/mime.types;
    default_type        application/octet-stream;

    # 信任Cloudflare代理
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 131.0.72.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    real_ip_header CF-Connecting-IP;

    # 上游服务器配置
    upstream yoyo_transcoder_api {
        server 127.0.0.1:3000;
        keepalive 32;
    }

    # 主服务器配置 - 监听52535端口 (Cloudflare代理目标)
    server {
        listen 52535 default_server;
        listen [::]:52535 default_server;
        server_name yoyo-vps.5202021.xyz _;
        root /var/www/html;

        # 安全头 (适配Cloudflare环境)
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";

        # API代理配置
        location /api/ {
            proxy_pass http://yoyo_transcoder_api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            
            # 使用Cloudflare提供的真实IP
            proxy_set_header X-Real-IP $http_cf_connecting_ip;
            proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
            proxy_set_header X-Forwarded-Proto https;  # Cloudflare使用HTTPS
            proxy_set_header CF-Ray $http_cf_ray;
            proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
            
            proxy_cache_bypass $http_upgrade;
            
            # 超时设置
            proxy_connect_timeout 30s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
            
            # 缓冲设置
            proxy_buffering off;
            proxy_request_buffering off;
        }

        # 健康检查端点代理
        location /health {
            proxy_pass http://yoyo_transcoder_api;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $http_cf_connecting_ip;
            proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
            proxy_set_header X-Forwarded-Proto https;
            
            # 健康检查不缓存
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
            add_header Expires "0";
        }

        # HLS文件服务
        location /hls/ {
            alias /var/www/hls/;
            
            # CORS头用于HLS播放 (通过Cloudflare)
            add_header Access-Control-Allow-Origin *;
            add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
            add_header Access-Control-Allow-Headers 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,CF-Ray,CF-Connecting-IP';
            add_header Access-Control-Expose-Headers 'Content-Length,Content-Range';
            
            # HLS文件类型设置
            location ~* \.m3u8$ {
                add_header Content-Type application/vnd.apple.mpegurl;
                add_header Cache-Control no-cache;
                expires -1;
            }
            
            location ~* \.ts$ {
                add_header Content-Type video/mp2t;
                add_header Cache-Control "public, max-age=3600";
                expires 1h;
            }
        }

        # 默认页面
        location / {
            return 200 'YOYO Transcoder API Server (via Cloudflare Proxy)';
            add_header Content-Type text/plain;
        }

        # 错误页面
        error_page   404              /404.html;
        error_page   500 502 503 504  /50x.html;
        location = /50x.html {
            root   /usr/share/nginx/html;
        }
    }

    # 禁用其他端口的默认访问
    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        server_name _;
        return 444;  # 直接关闭连接
    }
}
EOF

echo -e "${GREEN}✅ Cloudflare代理环境Nginx配置文件创建完成${NC}"

# 测试Nginx配置
echo -e "${YELLOW}🧪 测试Nginx配置语法...${NC}"
if nginx -t; then
    echo -e "${GREEN}✅ Nginx配置语法正确${NC}"
else
    echo -e "${RED}❌ Nginx配置语法错误，恢复备份...${NC}"
    if [ -f "$BACKUP_CONF" ]; then
        cp "$BACKUP_CONF" "$NGINX_CONF"
        echo -e "${YELLOW}已恢复备份配置${NC}"
    fi
    exit 1
fi

# 重启Nginx服务
echo -e "${YELLOW}🔄 重启Nginx服务...${NC}"
systemctl restart nginx

# 检查Nginx状态
if systemctl is-active --quiet nginx; then
    echo -e "${GREEN}✅ Nginx服务重启成功${NC}"
else
    echo -e "${RED}❌ Nginx服务启动失败${NC}"
    systemctl status nginx
    exit 1
fi

# 检查端口监听
echo -e "${YELLOW}🔍 检查端口监听状态...${NC}"
if netstat -tlnp | grep :52535; then
    echo -e "${GREEN}✅ 端口52535正在监听 (Cloudflare代理目标)${NC}"
else
    echo -e "${RED}❌ 端口52535未监听${NC}"
fi

if netstat -tlnp | grep :3000; then
    echo -e "${GREEN}✅ 后端服务端口3000正在监听${NC}"
else
    echo -e "${RED}❌ 后端服务端口3000未监听${NC}"
    echo -e "${YELLOW}检查PM2服务状态:${NC}"
    pm2 status
fi

# 测试本地连接
echo -e "${YELLOW}🧪 测试本地API连接...${NC}"

# 测试健康检查
echo -e "${BLUE}测试健康检查端点...${NC}"
if curl -s -f http://localhost:52535/health >/dev/null; then
    echo -e "${GREEN}✅ 本地52535端口健康检查正常${NC}"
else
    echo -e "${RED}❌ 本地52535端口健康检查失败${NC}"
fi

# 测试API状态
echo -e "${BLUE}测试API状态端点...${NC}"
API_RESPONSE=$(curl -s -H "X-API-Key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938" http://localhost:52535/api/status 2>/dev/null || echo "error")
if echo "$API_RESPONSE" | grep -q "running"; then
    echo -e "${GREEN}✅ 本地52535端口API状态正常${NC}"
    echo -e "${CYAN}响应: $API_RESPONSE${NC}"
else
    echo -e "${RED}❌ 本地52535端口API状态失败${NC}"
    echo -e "${YELLOW}响应: $API_RESPONSE${NC}"
fi

echo -e "${GREEN}🎉 Cloudflare代理环境Nginx配置完成!${NC}"
echo -e "${BLUE}==================== 架构信息 ====================${NC}"
echo -e "${YELLOW}外部访问 (用户):${NC} https://yoyo-vps.5202021.xyz/api/start-stream"
echo -e "${YELLOW}Cloudflare代理:${NC} https -> http://142.171.75.220:52535"
echo -e "${YELLOW}VPS Nginx监听:${NC} 52535端口"
echo -e "${YELLOW}后端Node.js:${NC} 3000端口"
echo -e "${YELLOW}配置备份:${NC} $BACKUP_CONF"
echo -e "${BLUE}=================================================${NC}"

echo -e "${GREEN}✅ 现在Cloudflare代理应该能正确转发到VPS了!${NC}"
echo -e "${CYAN}测试外部访问:${NC}"
echo -e "${YELLOW}https://yoyo-vps.5202021.xyz/health${NC}"
echo -e "${YELLOW}https://yoyo-vps.5202021.xyz/api/status${NC}"
