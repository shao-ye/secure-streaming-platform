# YOYO VPS手动部署指南

## 🎯 **快速部署步骤**

### **步骤1: 上传代码到VPS**

#### **方法A: 使用SCP（推荐）**
```bash
# 在Git Bash或WSL中执行
scp -r ./vps-transcoder-api root@YOUR_VPS_IP:/tmp/yoyo-deploy
```

#### **方法B: 使用SFTP工具**
- 使用WinSCP、FileZilla等工具
- 将 `vps-transcoder-api` 文件夹上传到 `/tmp/yoyo-deploy/`

#### **方法C: 使用Git克隆**
```bash
# 在VPS上执行
ssh root@YOUR_VPS_IP
git clone YOUR_REPO_URL /tmp/yoyo-deploy
cd /tmp/yoyo-deploy/vps-transcoder-api
```

### **步骤2: SSH连接到VPS**
```bash
ssh root@YOUR_VPS_IP
cd /tmp/yoyo-deploy/vps-transcoder-api
```

### **步骤3: 执行一键部署**
```bash
# 给脚本执行权限
chmod +x scripts/*.sh

# 执行一键部署脚本
bash scripts/quick-deploy.sh
```

## 🔍 **分步部署（如果一键部署失败）**

### **步骤1: 环境安装**
```bash
bash scripts/setup-vps.sh
```

### **步骤2: API部署**
```bash
bash scripts/deploy-api.sh
```

### **步骤3: Nginx配置**
```bash
bash scripts/configure-nginx.sh
```

## ✅ **验证部署结果**

### **检查服务状态**
```bash
# 检查PM2进程
pm2 status

# 检查Nginx服务
systemctl status nginx

# 检查API健康
curl http://localhost:3000/health

# 检查Nginx代理
curl http://localhost/health
```

### **获取API密钥**
```bash
grep "API_KEY=" /opt/yoyo-transcoder/.env | cut -d'=' -f2
```

## 🎉 **部署完成后的信息**

部署成功后，您将获得：
- **API服务**: `http://YOUR_VPS_IP:3000`
- **HLS流**: `http://YOUR_VPS_IP/hls/`
- **健康检查**: `http://YOUR_VPS_IP/health`
- **API密钥**: 用于Cloudflare Workers连接

## 🔧 **常用管理命令**

```bash
# 查看服务状态
pm2 status
systemctl status nginx

# 查看日志
pm2 logs yoyo-transcoder
tail -f /var/log/nginx/yoyo-access.log

# 重启服务
pm2 restart yoyo-transcoder
systemctl restart nginx

# 停止服务
pm2 stop yoyo-transcoder
systemctl stop nginx
```

## ❗ **故障排除**

### **如果SSH连接失败**
```bash
# 检查SSH服务
systemctl status sshd

# 检查防火墙
firewall-cmd --list-ports
```

### **如果脚本执行失败**
```bash
# 查看详细错误
bash -x scripts/setup-vps.sh

# 检查系统日志
journalctl -xe
```

### **如果服务启动失败**
```bash
# 查看PM2日志
pm2 logs yoyo-transcoder --lines 50

# 查看系统资源
free -h
df -h
```
