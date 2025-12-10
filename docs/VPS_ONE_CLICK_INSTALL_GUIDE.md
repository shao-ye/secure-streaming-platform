# VPS 一键安装指南

**版本**: 2.0.0  
**更新日期**: 2025-11-10  
**适用人群**: 所有用户（零基础小白也能轻松使用）

---

## 🚀 快速开始（仅需 1 行命令）

### **方式一：标准安装（推荐）**

```bash
bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh)
```

**完成后自动获得**：
- ✅ Node.js 18+ 运行环境
- ✅ FFmpeg 视频转码工具
- ✅ Nginx Web 服务器
- ✅ PM2 进程管理器
- ✅ YOYO 转码 API 服务
- ✅ 自动生成的 API 密钥
- ✅ 开机自启动配置

### **方式二：自定义安装**

```bash
# 指定域名（推荐）
VPS_DOMAIN=vps.example.com bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh)

# 自定义 API 密钥
API_KEY=my-secret-key-12345 bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh)

# 自定义端口（适合端口被占用的情况）
API_PORT=8080 NGINX_PORT=8888 bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh)

# 跳过依赖安装（已有环境时加速部署）
SKIP_DEPS=true bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh)
```

---

## 📋 安装前准备

### **VPS 服务器要求**

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| **操作系统** | CentOS 7+, Ubuntu 18.04+, Debian 10+ | CentOS 9 Stream / Ubuntu 22.04 |
| **CPU** | 1 核 | 2 核及以上 |
| **内存** | 2 GB | 4 GB 及以上 |
| **磁盘** | 20 GB | 50 GB SSD |
| **网络** | 稳定的公网 IP | 独立 IP + 域名 |
| **端口** | 22 (SSH), 80/443, 3000 | 已开放防火墙规则 |

### **准备工作清单**

- [ ] 一台 VPS 服务器（Vultr、DigitalOcean、阿里云等）
- [ ] 服务器的 SSH 登录信息（IP、端口、密码/密钥）
- [ ] Root 权限或 sudo 权限
- [ ] （可选）一个指向服务器 IP 的域名

---

## 🎯 完整安装流程

### **步骤 1: 登录 VPS**

#### **方式 A: 使用密码登录**
```bash
ssh root@YOUR_VPS_IP
```

#### **方式 B: 使用密钥登录**
```bash
ssh -i your_key.pem root@YOUR_VPS_IP
```

### **步骤 2: 执行一键安装命令**

```bash
bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh)
```

### **步骤 3: 等待自动安装**

脚本会自动完成以下操作（约 3-5 分钟）：

```
✓ 检查系统环境
✓ 安装 Node.js 18
✓ 安装 FFmpeg
✓ 安装 Nginx
✓ 安装 PM2
✓ 下载项目代码
✓ 安装项目依赖
✓ 生成配置文件
✓ 配置 Nginx
✓ 启动服务
✓ 健康检查
```

### **步骤 4: 记录安装信息**

安装成功后会显示类似如下信息：

```
============================================
  🎉 安装完成！
============================================

🔐 API 密钥: 85da076ae7a4c5d8f1b2e3c4...

🌐 访问地址:
   http://123.45.67.89:3000/health

🛠️ 管理命令:
   pm2 status | logs | restart yoyo-transcoder

📝 配置到 Cloudflare Workers:
   VPS_API_URL = http://123.45.67.89
   VPS_API_KEY = 85da076ae7a4c5d8f1b2e3c4...
============================================
```

**请务必保存以下信息**：
- ✅ API 密钥（`VPS_API_KEY`）
- ✅ VPS 地址（`VPS_API_URL`）
- ✅ 访问地址（用于测试）

---

## ✅ 安装后验证

### **1. 检查服务状态**

```bash
pm2 status
```

应该看到 `yoyo-transcoder` 状态为 `online`：

```
┌─────┬────────────────────┬─────────┬────────┐
│ id  │ name               │ status  │ cpu    │
├─────┼────────────────────┼─────────┼────────┤
│ 0   │ yoyo-transcoder   │ online  │ 0%     │
└─────┴────────────────────┴─────────┴────────┘
```

### **2. 测试健康检查接口**

```bash
curl http://localhost:3000/health
```

应该返回：

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2025-11-10T03:25:00.000Z"
}
```

### **3. 测试外网访问**

在本地电脑浏览器访问：

```
http://YOUR_VPS_IP:3000/health
```

或（如果配置了域名）：

```
http://vps.example.com/health
```

看到 JSON 响应说明服务正常。

---

## 🔗 配置到 Cloudflare Workers

安装完成后，需要将 VPS 信息配置到 Cloudflare Workers：

### **方法 1: Cloudflare Dashboard（推荐小白）**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入你的 Worker 项目
3. 点击 **Settings** → **Variables**
4. 添加以下环境变量：

| 变量名 | 类型 | 值 | 说明 |
|--------|------|---|------|
| `VPS_API_URL` | 纯文本 | `http://YOUR_VPS_IP` 或 `http://vps.example.com` | VPS 地址 |
| `VPS_API_KEY` | Secret | 安装时生成的 API 密钥 | 加密存储 |

5. 点击 **Save** 保存

### **方法 2: wrangler CLI（开发者）**

```bash
# 设置 VPS 地址
wrangler secret put VPS_API_URL
# 输入: http://YOUR_VPS_IP

# 设置 API 密钥
wrangler secret put VPS_API_KEY
# 输入: 你的API密钥
```

---

## 🛠️ 日常管理命令

### **服务管理**

```bash
# 查看服务状态
pm2 status

# 查看实时日志
pm2 logs yoyo-transcoder

# 查看最近 50 行日志
pm2 logs yoyo-transcoder --lines 50

# 重启服务
pm2 restart yoyo-transcoder

# 停止服务
pm2 stop yoyo-transcoder

# 启动服务
pm2 start yoyo-transcoder
```

### **系统监控**

```bash
# PM2 监控面板
pm2 monit

# 查看系统资源
htop

# 查看磁盘使用
df -h

# 查看内存使用
free -h
```

### **日志查看**

```bash
# 应用日志
tail -f /var/log/yoyo-transcoder/app.log

# Nginx 访问日志
tail -f /var/log/nginx/access.log

# Nginx 错误日志
tail -f /var/log/nginx/error.log
```

---

## 🔄 更新服务

### **方式 1: 使用部署脚本**

```bash
cd /opt/yoyo-transcoder
bash scripts/vps-simple-deploy.sh
```

### **方式 2: 手动更新**

```bash
# 停止服务
pm2 stop yoyo-transcoder

# 拉取最新代码
cd /tmp
git clone https://github.com/YOUR_USERNAME/secure-streaming-platform.git
cd secure-streaming-platform/vps-server
cp -r * /opt/yoyo-transcoder/

# 更新依赖
cd /opt/yoyo-transcoder
npm install --production

# 重启服务
pm2 restart yoyo-transcoder
```

---

## 🗑️ 卸载服务

### **完全卸载**

```bash
bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh) --uninstall
```

或手动卸载：

```bash
# 停止并删除服务
pm2 stop yoyo-transcoder
pm2 delete yoyo-transcoder
pm2 save

# 删除文件
rm -rf /opt/yoyo-transcoder
rm -rf /var/www/hls
rm -rf /var/log/yoyo-transcoder
rm -f /etc/nginx/conf.d/yoyo-transcoder.conf

# 重载 Nginx
systemctl reload nginx
```

### **仅卸载环境（保留配置）**

```bash
# 只卸载 Node.js、FFmpeg 等
yum remove nodejs ffmpeg nginx  # CentOS
apt-get remove nodejs ffmpeg nginx  # Ubuntu
```

---

## ❓ 常见问题

### **Q1: 安装失败怎么办？**

**A**: 查看错误信息，常见原因：
- 端口被占用：使用自定义端口 `API_PORT=8080`
- 内存不足：升级 VPS 配置
- 网络问题：检查防火墙和网络连接
- 权限问题：确保使用 root 用户

### **Q2: 如何更改 API 端口？**

**A**: 编辑配置文件后重启：

```bash
# 编辑 .env 文件
vim /opt/yoyo-transcoder/.env
# 修改 PORT=新端口号

# 重启服务
pm2 restart yoyo-transcoder
```

### **Q3: 如何绑定域名？**

**A**: 
1. DNS 解析：将域名 A 记录指向 VPS IP
2. 更新 Nginx 配置：
   ```bash
   vim /etc/nginx/conf.d/yoyo-transcoder.conf
   # 修改 server_name 为你的域名
   ```
3. 重载 Nginx：`systemctl reload nginx`
4. （可选）配置 SSL 证书

### **Q4: 忘记 API 密钥怎么办？**

**A**: 查看配置文件：

```bash
cat /opt/yoyo-transcoder/.env | grep API_KEY
```

或重新生成：

```bash
# 生成新密钥
openssl rand -hex 32

# 更新 .env 文件
vim /opt/yoyo-transcoder/.env

# 重启服务
pm2 restart yoyo-transcoder

# 记得同时更新 Cloudflare Workers 配置
```

### **Q5: 服务无法启动？**

**A**: 检查日志：

```bash
pm2 logs yoyo-transcoder --lines 50
```

常见问题：
- FFmpeg 未安装：`which ffmpeg`
- 端口被占用：`netstat -tuln | grep 3000`
- 权限问题：`ls -la /opt/yoyo-transcoder`
- 配置错误：`cat /opt/yoyo-transcoder/.env`

### **Q6: 如何配置 HTTPS？**

**A**: 使用 Certbot 自动配置（推荐）：

```bash
# 安装 Certbot
yum install certbot python3-certbot-nginx  # CentOS
apt-get install certbot python3-certbot-nginx  # Ubuntu

# 自动配置 SSL
certbot --nginx -d vps.example.com

# 自动续期
certbot renew --dry-run
```

---

## 📊 性能优化建议

### **1. 增加文件描述符限制**

```bash
# 编辑 limits.conf
vim /etc/security/limits.conf

# 添加以下行
* soft nofile 65536
* hard nofile 65536
```

### **2. 优化 Nginx**

```bash
# 编辑 nginx.conf
vim /etc/nginx/nginx.conf

# 增加 worker 进程和连接数
worker_processes auto;
events {
    worker_connections 4096;
}
```

### **3. 优化 FFmpeg**

在 `.env` 文件中调整：
```bash
MAX_CONCURRENT_STREAMS=5  # 根据 CPU 核心数调整
SEGMENT_DURATION=2        # 分片时长（秒）
PLAYLIST_SIZE=6           # 播放列表大小
```

---

## 🔐 安全建议

### **1. 更改默认端口**

```bash
# 更改 SSH 端口
vim /etc/ssh/sshd_config
# Port 22 → Port 2222

# 重启 SSH
systemctl restart sshd
```

### **2. 配置防火墙**

```bash
# CentOS/RHEL
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=443/tcp
firewall-cmd --reload

# Ubuntu/Debian
ufw allow 3000/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### **3. 定期更新系统**

```bash
# CentOS/RHEL
yum update -y

# Ubuntu/Debian
apt-get update && apt-get upgrade -y
```

### **4. 定期备份配置**

```bash
# 备份关键文件
tar -czf yoyo-backup-$(date +%Y%m%d).tar.gz \
    /opt/yoyo-transcoder/.env \
    /etc/nginx/conf.d/yoyo-transcoder.conf
```

---

## 📚 相关文档

- [完整部署指南](COMPLETE_DEPLOYMENT_GUIDE.md)
- [架构设计文档](project/ARCHITECTURE_V2.md)
- [Cloudflare Worker 配置](cloudflare-worker/README.md)
- [前端部署指南](frontend/README.md)

---

## 💬 获取帮助

遇到问题？
- 📖 查看 [常见问题](#-常见问题)
- 🐛 提交 [GitHub Issue](https://github.com/YOUR_USERNAME/secure-streaming-platform/issues)
- 💬 加入讨论群组

---

**享受一键部署的便利！🎉**
