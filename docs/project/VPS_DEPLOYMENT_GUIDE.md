# YOYO流媒体平台 - VPS部署完整指南

## 📋 **部署概览**

本指南将帮助您在CentOS 9 VPS服务器上部署YOYO流媒体平台的转码服务，实现RTMP到HLS的实时转码功能。

### **服务器要求**
- **操作系统**: CentOS 9 / RHEL 9
- **CPU**: 1核心（最低）
- **内存**: 2GB（推荐）
- **存储**: 30GB（最低）
- **网络**: 公网IP，开放端口22, 80, 443, 3000

### **架构组件**
- **Node.js 18**: API服务运行环境
- **FFmpeg**: 视频转码引擎
- **Nginx**: 反向代理和静态文件服务
- **PM2**: 进程管理器
- **Firewalld**: 防火墙管理

---

## 🚀 **快速部署（推荐）**

### **步骤1: 上传代码到VPS**
```bash
# 方法1: 使用Git克隆（推荐）
git clone YOUR_REPO_URL /tmp/yoyo-transcoder
cd /tmp/yoyo-transcoder/vps-transcoder-api

# 方法2: 使用SCP上传
scp -r ./vps-transcoder-api root@YOUR_VPS_IP:/tmp/yoyo-transcoder
ssh root@YOUR_VPS_IP
cd /tmp/yoyo-transcoder
```

### **步骤2: 运行环境安装脚本**
```bash
# 给脚本执行权限
chmod +x scripts/setup-vps.sh

# 运行环境安装（需要root权限）
sudo bash scripts/setup-vps.sh
```

### **步骤3: 部署API服务**
```bash
# 给脚本执行权限
chmod +x scripts/deploy-api.sh

# 运行部署脚本
sudo bash scripts/deploy-api.sh
```

### **步骤4: 配置Nginx**
```bash
# 给脚本执行权限
chmod +x scripts/configure-nginx.sh

# 运行Nginx配置脚本
sudo bash scripts/configure-nginx.sh
```

### **步骤5: 验证部署**
```bash
# 检查服务状态
pm2 status
systemctl status nginx

# 测试API健康检查
curl http://localhost:3000/health
curl http://localhost/health

# 查看服务日志
pm2 logs yoyo-transcoder
tail -f /var/log/nginx/yoyo-access.log
```

---

## 🔧 **手动部署步骤**

如果自动化脚本遇到问题，可以按照以下步骤手动部署：

### **1. 系统环境准备**

#### **更新系统**
```bash
dnf update -y
dnf install -y epel-release
```

#### **安装基础工具**
```bash
dnf install -y wget curl git vim htop unzip tar gcc gcc-c++ make openssl-devel zlib-devel pcre-devel
```

#### **安装Node.js 18**
```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
dnf install -y nodejs
node --version
npm --version
```

#### **安装FFmpeg**
```bash
dnf install -y https://download1.rpmfusion.org/free/el/rpmfusion-free-release-9.noarch.rpm
dnf install -y https://download1.rpmfusion.org/nonfree/el/rpmfusion-nonfree-release-9.noarch.rpm
dnf install -y ffmpeg ffmpeg-devel
ffmpeg -version
```

#### **安装Nginx**
```bash
dnf install -y nginx
systemctl enable nginx
systemctl start nginx
nginx -v
```

#### **安装PM2**
```bash
npm install -g pm2
pm2 --version
pm2 startup
```

### **2. 创建目录结构**
```bash
mkdir -p /opt/yoyo-transcoder
mkdir -p /var/www/hls
mkdir -p /var/log/yoyo-transcoder

# 创建系统用户
useradd -r -s /bin/bash -d /opt/yoyo-transcoder yoyo

# 设置权限
chown -R yoyo:yoyo /opt/yoyo-transcoder
chown -R nginx:nginx /var/www/hls
chown -R yoyo:yoyo /var/log/yoyo-transcoder
```

### **3. 部署应用代码**
```bash
# 复制代码到应用目录
cp -r /tmp/yoyo-transcoder/* /opt/yoyo-transcoder/
cd /opt/yoyo-transcoder

# 安装依赖
sudo -u yoyo npm install --production

# 设置权限
chown -R yoyo:yoyo /opt/yoyo-transcoder
```

### **4. 创建环境配置**
```bash
# 生成API密钥
API_KEY=$(openssl rand -hex 32)

# 创建.env文件
cat > /opt/yoyo-transcoder/.env << EOF
NODE_ENV=production
PORT=3000
API_KEY=$API_KEY
ENABLE_IP_WHITELIST=true
HLS_OUTPUT_DIR=/var/www/hls
LOG_DIR=/var/log/yoyo-transcoder
FFMPEG_PATH=/usr/bin/ffmpeg
SEGMENT_DURATION=2
PLAYLIST_SIZE=6
LOG_LEVEL=info
MAX_CONCURRENT_STREAMS=10
STREAM_TIMEOUT=300000
CLEANUP_INTERVAL=60000
ALLOWED_IPS=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22
EOF

chown yoyo:yoyo /opt/yoyo-transcoder/.env
chmod 600 /opt/yoyo-transcoder/.env

echo "API密钥: $API_KEY"
```

### **5. 配置Nginx**
```bash
# 创建站点配置
cp config/nginx.conf /etc/nginx/conf.d/yoyo-transcoder.conf

# 测试配置
nginx -t

# 重启Nginx
systemctl restart nginx
```

### **6. 启动服务**
```bash
cd /opt/yoyo-transcoder

# 使用PM2启动服务
sudo -u yoyo pm2 start ecosystem.config.js --env production

# 保存PM2配置
sudo -u yoyo pm2 save

# 检查服务状态
pm2 status
```

---

## 🔒 **安全配置**

### **防火墙配置**
```bash
# 启用防火墙
systemctl enable firewalld
systemctl start firewalld

# 开放必要端口
firewall-cmd --permanent --add-port=22/tcp    # SSH
firewall-cmd --permanent --add-port=80/tcp    # HTTP
firewall-cmd --permanent --add-port=443/tcp   # HTTPS
firewall-cmd --permanent --add-port=3000/tcp  # API

# 重载配置
firewall-cmd --reload

# 查看开放端口
firewall-cmd --list-ports
```

### **SSH安全加固**
```bash
# 编辑SSH配置
vim /etc/ssh/sshd_config

# 推荐配置
Port 22
PermitRootLogin yes  # 部署完成后建议改为no
PasswordAuthentication yes  # 建议使用密钥认证
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2

# 重启SSH服务
systemctl restart sshd
```

### **系统优化**
```bash
# 增加文件描述符限制
cat >> /etc/security/limits.conf << EOF
yoyo soft nofile 65536
yoyo hard nofile 65536
root soft nofile 65536
root hard nofile 65536
EOF

# 内核参数优化
cat >> /etc/sysctl.conf << EOF
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.netdev_max_backlog = 5000
EOF

sysctl -p
```

---

## 🔗 **Cloudflare Workers配置**

部署完成后，需要在Cloudflare Workers中配置VPS连接：

### **1. 更新环境变量**
在Cloudflare Dashboard中设置以下环境变量：
```
VPS_API_URL=http://YOUR_VPS_IP:3000
VPS_API_KEY=YOUR_GENERATED_API_KEY
VPS_HLS_URL=http://YOUR_VPS_IP/hls
```

### **2. 测试连接**
```bash
# 在VPS上测试API
curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/status

# 测试Cloudflare Workers连接
# 在Workers中调用VPS健康检查端点
```

---

## 📊 **监控和维护**

### **服务状态检查**
```bash
# PM2进程状态
pm2 status
pm2 monit

# Nginx状态
systemctl status nginx
nginx -t

# 系统资源监控
htop
df -h
free -h
```

### **日志查看**
```bash
# PM2日志
pm2 logs yoyo-transcoder
pm2 logs yoyo-transcoder --lines 100

# Nginx日志
tail -f /var/log/nginx/yoyo-access.log
tail -f /var/log/nginx/yoyo-error.log

# 应用日志
tail -f /var/log/yoyo-transcoder/app.log
```

### **性能监控**
```bash
# 查看转码进程
ps aux | grep ffmpeg

# 查看HLS文件
ls -la /var/www/hls/

# 网络连接
netstat -tlnp | grep :3000
netstat -tlnp | grep :80
```

### **定期维护**
```bash
# 清理旧的HLS文件（建议设置定时任务）
find /var/www/hls -name "*.ts" -mtime +1 -delete
find /var/www/hls -name "*.m3u8" -mtime +1 -delete

# 重启服务（如需要）
pm2 restart yoyo-transcoder
systemctl restart nginx

# 更新系统
dnf update -y
```

---

## 🧪 **测试验证**

### **基础功能测试**
```bash
# 1. API健康检查
curl http://YOUR_VPS_IP:3000/health
curl http://YOUR_VPS_IP/health

# 2. API状态检查
curl -H "X-API-Key: YOUR_API_KEY" http://YOUR_VPS_IP:3000/api/status

# 3. 启动转码测试
curl -X POST -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"streamId":"test123","rtmpUrl":"rtmp://example.com/live/stream"}' \
  http://YOUR_VPS_IP:3000/api/streams/start

# 4. 检查HLS输出
ls -la /var/www/hls/test123/
curl http://YOUR_VPS_IP/hls/test123/playlist.m3u8
```

### **端到端测试**
1. **配置测试频道**: 在前端管理界面添加测试频道
2. **推送RTMP流**: 使用OBS或FFmpeg推送测试流
3. **验证转码**: 检查HLS文件生成
4. **测试播放**: 在前端播放器中播放HLS流

---

## ❗ **故障排除**

### **常见问题**

#### **1. API服务无法启动**
```bash
# 检查端口占用
netstat -tlnp | grep :3000

# 检查PM2日志
pm2 logs yoyo-transcoder

# 检查环境配置
cat /opt/yoyo-transcoder/.env
```

#### **2. FFmpeg转码失败**
```bash
# 检查FFmpeg安装
ffmpeg -version

# 检查权限
ls -la /var/www/hls/

# 手动测试转码
ffmpeg -f lavfi -i testsrc=duration=10:size=320x240:rate=1 \
  -c:v libx264 -hls_time 2 -hls_list_size 6 \
  /var/www/hls/test/playlist.m3u8
```

#### **3. Nginx代理失败**
```bash
# 检查Nginx配置
nginx -t

# 检查Nginx日志
tail -f /var/log/nginx/yoyo-error.log

# 测试上游服务
curl http://127.0.0.1:3000/health
```

#### **4. 防火墙问题**
```bash
# 检查防火墙状态
firewall-cmd --list-ports

# 临时开放端口测试
firewall-cmd --add-port=3000/tcp

# 检查SELinux
getenforce
setenforce 0  # 临时禁用测试
```

### **性能优化建议**

1. **内存优化**: 如果内存不足，可以调整PM2配置中的`max_memory_restart`
2. **并发限制**: 根据服务器性能调整`MAX_CONCURRENT_STREAMS`
3. **HLS参数**: 调整`SEGMENT_DURATION`和`PLAYLIST_SIZE`优化延迟
4. **定期清理**: 设置定时任务清理过期的HLS文件

---

## 📞 **技术支持**

如果在部署过程中遇到问题，请检查：

1. **系统日志**: `journalctl -xe`
2. **服务日志**: `pm2 logs` 和 `/var/log/nginx/`
3. **网络连接**: 确保端口开放和防火墙配置正确
4. **权限问题**: 检查文件和目录权限设置

部署完成后，您的YOYO流媒体平台转码服务将在以下地址提供服务：
- **API服务**: `http://YOUR_VPS_IP:3000`
- **HLS流**: `http://YOUR_VPS_IP/hls/`
- **健康检查**: `http://YOUR_VPS_IP/health`

记住保存生成的API密钥，在配置Cloudflare Workers时需要使用！
