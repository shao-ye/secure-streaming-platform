#!/bin/bash

# YOYO流媒体平台前端部署到VPS脚本
# 将Vue.js前端构建并部署到VPS的Nginx服务器

set -e

echo "🚀 开始部署YOYO流媒体平台前端到VPS..."

# 配置变量
VPS_HOST="yoyo-vps.5202021.xyz"
VPS_USER="root"
VPS_PORT="22"
FRONTEND_DIR="../frontend"
BUILD_DIR="$FRONTEND_DIR/dist"
VPS_WEB_DIR="/var/www/yoyo-frontend"
NGINX_SITE_CONFIG="/etc/nginx/conf.d/yoyo-frontend.conf"

# 检查前端目录
if [ ! -d "$FRONTEND_DIR" ]; then
    echo "❌ 前端目录不存在: $FRONTEND_DIR"
    exit 1
fi

echo "📁 切换到前端目录..."
cd "$FRONTEND_DIR"

# 检查Node.js和npm
if ! command -v node &> /dev/null; then
    echo "❌ Node.js未安装，请先安装Node.js"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm未安装，请先安装npm"
    exit 1
fi

echo "📦 安装依赖..."
npm install

echo "🔧 更新生产环境配置..."
cat > .env.production << EOF
# 生产环境配置 - VPS部署
VITE_API_BASE_URL=https://yoyoapi.5202021.xyz
VITE_APP_TITLE=YOYO流媒体平台
VITE_APP_VERSION=1.0.0
VITE_HLS_PROXY_URL=https://yoyoapi.5202021.xyz/hls
VITE_ENVIRONMENT=production
VITE_WORKER_URL=https://yoyoapi.5202021.xyz
VITE_DEBUG=false
VITE_LOG_LEVEL=error
VITE_VPS_DOMAIN=yoyo.5202021.xyz
EOF

echo "🏗️ 构建生产版本..."
npm run build

# 检查构建结果
if [ ! -d "$BUILD_DIR" ]; then
    echo "❌ 构建失败，dist目录不存在"
    exit 1
fi

echo "📤 上传文件到VPS..."

# 创建临时压缩包
TEMP_FILE="/tmp/yoyo-frontend-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$TEMP_FILE" -C "$BUILD_DIR" .

echo "🔗 连接VPS并部署..."

# SSH到VPS执行部署
ssh -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" << 'ENDSSH'
set -e

echo "🛠️ 准备VPS环境..."

# 创建网站目录
sudo mkdir -p /var/www/yoyo-frontend
sudo chown -R nginx:nginx /var/www/yoyo-frontend

# 备份现有文件（如果存在）
if [ -d "/var/www/yoyo-frontend/backup" ]; then
    sudo rm -rf /var/www/yoyo-frontend/backup
fi

if [ "$(ls -A /var/www/yoyo-frontend 2>/dev/null)" ]; then
    sudo mkdir -p /var/www/yoyo-frontend/backup
    sudo mv /var/www/yoyo-frontend/* /var/www/yoyo-frontend/backup/ 2>/dev/null || true
fi

echo "📁 网站目录准备完成"
ENDSSH

# 上传文件
echo "📤 传输文件..."
scp -P "$VPS_PORT" "$TEMP_FILE" "$VPS_USER@$VPS_HOST:/tmp/"

# 解压并配置
ssh -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" << ENDSSH
set -e

echo "📦 解压前端文件..."
cd /var/www/yoyo-frontend
sudo tar -xzf /tmp/$(basename $TEMP_FILE)
sudo chown -R nginx:nginx /var/www/yoyo-frontend
sudo chmod -R 755 /var/www/yoyo-frontend

echo "🔧 配置Nginx站点..."

# 创建Nginx配置文件
sudo tee $NGINX_SITE_CONFIG > /dev/null << 'EOF'
server {
    listen 80;
    server_name yoyo.5202021.xyz;
    
    # 重定向到HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yoyo.5202021.xyz;
    
    # SSL配置 (如果有证书)
    # ssl_certificate /path/to/certificate.crt;
    # ssl_certificate_key /path/to/private.key;
    
    # 如果没有SSL证书，临时使用HTTP
    listen 80;
    
    root /var/www/yoyo-frontend;
    index index.html;
    
    # 启用gzip压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
    
    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff;
    }
    
    # API代理到Workers
    location /api/ {
        proxy_pass https://yoyoapi.5202021.xyz/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # CORS支持
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, X-Requested-With";
        
        if (\$request_method = 'OPTIONS') {
            return 204;
        }
    }
    
    # HLS代理到Workers
    location /hls/ {
        proxy_pass https://yoyoapi.5202021.xyz/hls/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # HLS特殊配置
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Access-Control-Allow-Origin *;
    }
    
    # SPA路由支持
    location / {
        try_files \$uri \$uri/ /index.html;
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
    }
    
    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    
    # 日志配置
    access_log /var/log/nginx/yoyo-frontend-access.log;
    error_log /var/log/nginx/yoyo-frontend-error.log;
}
EOF

echo "🧪 测试Nginx配置..."
sudo nginx -t

if [ \$? -eq 0 ]; then
    echo "✅ Nginx配置测试通过"
    echo "🔄 重新加载Nginx..."
    sudo systemctl reload nginx
    echo "✅ Nginx重新加载完成"
else
    echo "❌ Nginx配置测试失败"
    exit 1
fi

# 清理临时文件
sudo rm -f /tmp/$(basename $TEMP_FILE)

echo "🎉 前端部署完成！"
echo ""
echo "📊 部署信息:"
echo "  网站地址: http://yoyo.5202021.xyz"
echo "  文件目录: /var/www/yoyo-frontend"
echo "  Nginx配置: $NGINX_SITE_CONFIG"
echo ""
echo "🔧 后续步骤:"
echo "  1. 配置SSL证书 (推荐使用Let's Encrypt)"
echo "  2. 测试网站功能"
echo "  3. 配置防火墙规则"
echo ""
ENDSSH

# 清理本地临时文件
rm -f "$TEMP_FILE"

echo ""
echo "🎉 部署完成！"
echo ""
echo "📊 部署信息:"
echo "  前端地址: http://yoyo.5202021.xyz"
echo "  API地址: https://yoyoapi.5202021.xyz"
echo "  VPS地址: http://yoyo-vps.5202021.xyz:52535"
echo ""
echo "🧪 测试步骤:"
echo "  1. 访问 http://yoyo.5202021.xyz"
echo "  2. 使用 admin/admin123 登录"
echo "  3. 选择频道测试播放"
echo "  4. 推流测试: ffmpeg -re -i test.mp4 -c copy -f flv rtmp://yoyo-vps.5202021.xyz/live/STREAM_KEY"
echo ""
echo "🔧 如需SSL证书，请运行:"
echo "  sudo certbot --nginx -d yoyo.5202021.xyz"
echo ""
