# YOYO流媒体平台 - VPS部署信息记录

## 📋 部署概览

**部署时间**: 2025-10-01 15:06 (UTC+8)  
**部署状态**: ✅ VPS转码API服务已成功部署并运行  
**VPS提供商**: RackNerd  
**服务器标识**: racknerd-508823f  

## 🔑 关键配置信息

### API密钥 (重要！)
```
API_KEY: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938
```
> ⚠️ **请妥善保管此密钥，配置Cloudflare Workers时需要使用**

### 服务端点
- **API服务**: `http://YOUR_VPS_IP:3000`
- **健康检查**: `http://YOUR_VPS_IP:3000/health`
- **HLS流服务**: `http://YOUR_VPS_IP/hls/` (需要配置Nginx)

## 🏗️ 系统环境

### 已安装组件
| 组件 | 版本 | 状态 | 说明 |
|------|------|------|------|
| **Node.js** | v18.20.8 | ✅ 运行中 | JavaScript运行时 |
| **NPM** | 10.8.2 | ✅ 可用 | 包管理器 |
| **FFmpeg** | 5.1.7 | ✅ 可用 | 视频转码引擎 |
| **Nginx** | 1.20.1 | ✅ 运行中 | Web服务器 |
| **PM2** | 6.0.13 | ✅ 运行中 | 进程管理器 |

### 系统配置
- **操作系统**: CentOS 9
- **防火墙端口**: 22 (SSH), 80 (HTTP), 443 (HTTPS), 3000 (API)
- **SELinux**: Disabled
- **系统优化**: 网络参数已优化

## 📁 目录结构

```
/opt/yoyo-transcoder/          # 应用主目录
├── src/                       # 源代码
├── config/                    # 配置文件
├── package.json              # 依赖配置
├── ecosystem.config.js       # PM2配置
└── .env                      # 环境变量

/var/www/hls/                 # HLS输出目录
/var/log/yoyo-transcoder/     # 应用日志
/var/log/transcoder/          # PM2日志
```

## 🔧 服务管理

### PM2进程状态
```bash
# 查看进程状态
pm2 status

# 查看日志
pm2 logs vps-transcoder-api

# 重启服务
pm2 restart vps-transcoder-api

# 停止服务
pm2 stop vps-transcoder-api
```

### 系统服务
```bash
# 查看系统服务状态
systemctl status yoyo-transcoder
systemctl status nginx
systemctl status pm2-root

# 重启服务
systemctl restart yoyo-transcoder
systemctl restart nginx
```

## 🌐 网络配置

### 当前开放端口
- **22**: SSH访问
- **80**: HTTP (Nginx)
- **443**: HTTPS (Nginx)
- **3000**: API服务

### 防火墙状态
```bash
# 查看防火墙状态
firewall-cmd --list-all

# 添加新端口 (如需要)
firewall-cmd --permanent --add-port=PORT/tcp
firewall-cmd --reload
```

## 📊 服务验证

### API健康检查
```bash
curl http://localhost:3000/health
```
**预期响应**:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-01T07:06:04.042Z",
  "uptime": 35.764304463,
  "environment": "development",
  "version": "1.0.0"
}
```

### 服务日志检查
```bash
# PM2日志
pm2 logs vps-transcoder-api

# 系统日志
journalctl -u yoyo-transcoder -f
```

## 🔄 下一步操作

### 待完成任务
1. **配置Nginx反向代理**
   ```bash
   bash scripts/configure-nginx.sh
   ```

2. **配置Cloudflare Workers**
   - 更新Workers环境变量
   - 设置VPS_API_URL和VPS_API_KEY

3. **测试转码功能**
   - 发送RTMP流到VPS
   - 验证HLS输出

### Cloudflare Workers配置
在Workers中设置以下环境变量:
```
VPS_API_URL = http://YOUR_VPS_IP:3000
VPS_API_KEY = 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938
```

## 🚨 故障排除

### 常见问题
1. **API服务无响应**
   ```bash
   pm2 restart vps-transcoder-api
   pm2 logs vps-transcoder-api
   ```

2. **FFmpeg转码失败**
   ```bash
   ffmpeg -version
   which ffmpeg
   ```

3. **端口访问问题**
   ```bash
   netstat -tlnp | grep :3000
   firewall-cmd --list-ports
   ```

### 重要文件位置
- **环境配置**: `/opt/yoyo-transcoder/.env`
- **PM2配置**: `/opt/yoyo-transcoder/ecosystem.config.js`
- **Nginx配置**: `/etc/nginx/nginx.conf`
- **系统服务**: `/etc/systemd/system/yoyo-transcoder.service`

## 📝 部署历史

### 2025-10-01 部署记录
- ✅ 系统环境安装完成
- ✅ FFmpeg依赖冲突问题解决
- ✅ PM2日志目录权限问题修复
- ✅ VPS转码API服务成功启动
- ⏳ 等待Nginx配置完成

---

**文档更新**: 2025-10-01 15:06  
**维护人员**: YOYO Team  
**联系方式**: 项目仓库Issues
