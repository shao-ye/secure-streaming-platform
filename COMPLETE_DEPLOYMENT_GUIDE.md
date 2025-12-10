# YOYO流媒体平台 - 完整部署指南

## 📋 项目概述

**项目名称**: YOYO安全流媒体播放平台  
**项目类型**: 企业级多用户、多频道安全流媒体Web播放平台  
**部署时间**: 2025-10-01  
**部署状态**: ✅ 生产环境部署完成  

## 🏗️ 系统架构

### 三层架构设计
```
┌─────────────────────────────────────────────────────────────┐
│                    用户访问层                                │
│  https://yoyoapi.your-domain.com (前端 + API)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Cloudflare Workers                          │
│  • 业务逻辑处理                                             │
│  • 用户认证与权限管理                                        │
│  • API路由与代理                                            │
│  • 数据存储 (Cloudflare KV)                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    VPS转码服务                               │
│  http://yoyo-vps.your-domain.com                               │
│  • FFmpeg视频转码                                           │
│  • RTMP流接收                                               │
│  • HLS流输出                                                │
│  • Nginx反向代理                                            │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 部署流程记录

### 阶段一：VPS环境搭建

#### 1.1 服务器信息
- **服务器**: RackNerd VPS (racknerd-508823f)
- **操作系统**: CentOS 9
- **域名**: yoyo-vps.your-domain.com
- **端口**: 52535 (自定义端口)

#### 1.2 基础环境安装
```bash
# 执行VPS环境安装脚本
bash scripts/setup-vps.sh
```

**安装组件**:
- ✅ Node.js v18.20.8
- ✅ FFmpeg 5.1.7 (解决CentOS 9依赖冲突)
- ✅ Nginx 1.20.1
- ✅ PM2 6.0.13

#### 1.3 FFmpeg依赖问题解决
**问题**: CentOS 9环境下FFmpeg安装遇到依赖冲突
**解决方案**: 创建专用修复脚本
```bash
bash scripts/fix-ffmpeg.sh
```

**修复内容**:
- 清理之前失败的安装
- 启用PowerTools仓库
- 安装音频处理依赖
- 解决ladspa和rubberband依赖冲突
- 备用静态编译版本安装

#### 1.4 转码API服务部署
```bash
bash scripts/deploy-api.sh
```

**部署内容**:
- 应用代码部署到 `/opt/yoyo-transcoder`
- 环境配置文件创建
- PM2进程管理配置
- 系统服务创建

**生成的API密钥**:
```
<VPS_API_KEY>
```

#### 1.5 Nginx配置
```bash
bash scripts/configure-nginx.sh
```

**配置特性**:
- 反向代理到Node.js服务 (端口3000)
- HLS文件服务配置
- CORS支持
- 智能缓存策略
- 安全头设置
- 日志轮转配置

#### 1.6 端口自定义配置
```bash
bash scripts/change-nginx-port.sh
```
- 将默认端口80修改为52535
- 自动配置防火墙规则
- 测试新端口访问

### 阶段二：Cloudflare Workers部署

#### 2.1 环境变量配置
```bash
# VPS API密钥
echo "<VPS_API_KEY>" | wrangler secret put VPS_API_KEY --env production

# VPS API地址
echo "http://yoyo-vps.your-domain.com/api" | wrangler secret put VPS_API_URL --env production

# HLS服务地址
echo "http://yoyo-vps.your-domain.com/hls" | wrangler secret put VPS_HLS_URL --env production

# 启用VPS功能
echo "true" | wrangler secret put VPS_ENABLED --env production
```

#### 2.2 生产环境部署
```bash
wrangler deploy --env production
```

**部署结果**:
- ✅ 部署ID: 28ead1f1-dead-48c2-a8c9-e531465ee31b
- ✅ 域名: yoyoapi.your-domain.com
- ✅ KV绑定: YOYO_USER_DB

#### 2.3 管理员用户初始化
```bash
Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/init-admin" -Method POST -ContentType "application/json" -Body "{}"
```

**用户信息**:
- 用户名: admin
- 密码: <PASSWORD>
- 角色: 管理员

### 阶段三：系统验证

#### 3.1 服务状态验证
```bash
# Cloudflare Workers API状态
Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/status" -Method GET

# VPS服务状态
Invoke-RestMethod -Uri "http://yoyo-vps.your-domain.com/health" -Method GET
```

**验证结果**:
- ✅ Workers API: 正常运行 (v2.0.0)
- ✅ VPS服务: 正常运行 (运行时间: 2521秒)

## 📊 部署配置详情

### VPS服务配置

#### 目录结构
```
/opt/yoyo-transcoder/          # 应用主目录
├── src/                       # 源代码
├── config/                    # 配置文件
├── package.json              # 依赖配置
├── ecosystem.config.js       # PM2配置（由 vps-server/ecosystem.config.js 同步到此目录）
└── .env                      # 环境变量

/var/www/hls/                 # HLS输出目录
/var/log/yoyo-transcoder/     # 应用日志
/var/log/transcoder/          # PM2日志
```

#### 网络配置
```bash
# 开放端口
22    # SSH
80    # HTTP (重定向到52535)
443   # HTTPS
3000  # Node.js API (内部)
52535 # Nginx主服务端口
```

#### 服务管理
```bash
# PM2进程管理
pm2 status                    # 查看进程状态
pm2 logs vps-transcoder-api   # 查看日志
pm2 restart vps-transcoder-api # 重启服务

# 系统服务
systemctl status nginx        # Nginx状态
systemctl status yoyo-transcoder # 应用服务状态
```

### Cloudflare Workers配置

#### 环境变量
| 变量名 | 值 | 说明 |
|--------|----|----|
| VPS_API_URL | http://yoyo-vps.your-domain.com/api | VPS API地址 |
| VPS_API_KEY | <VPS_API_KEY> | API密钥 |
| VPS_HLS_URL | http://yoyo-vps.your-domain.com/hls | HLS服务地址 |
| VPS_ENABLED | true | 启用VPS功能 |
| ENVIRONMENT | production | 运行环境 |

#### KV数据库
- **绑定名**: YOYO_USER_DB
- **命名空间ID**: <KV_Namespace_ID>
- **用途**: 用户数据、会话管理、流配置存储

## 🌐 服务端点

### 主要访问地址
- **前端页面**: https://yoyoapi.your-domain.com/
- **管理后台**: https://yoyoapi.your-domain.com/admin
- **登录页面**: https://yoyoapi.your-domain.com/login
- **API基础地址**: https://yoyoapi.your-domain.com/api/

### VPS服务端点
- **健康检查**: http://yoyo-vps.your-domain.com/health
- **API代理**: http://yoyo-vps.your-domain.com/api/
- **HLS流服务**: http://yoyo-vps.your-domain.com/hls/
- **Nginx状态**: http://yoyo-vps.your-domain.com/nginx_status (仅本地)

### API端点列表
```
# 认证相关
POST /api/login              # 用户登录
POST /api/logout             # 用户登出
GET  /api/me                 # 获取当前用户信息
POST /api/init-admin         # 初始化管理员用户

# 流管理 (用户)
GET  /api/streams            # 获取流列表
POST /api/play/:id           # 播放流
POST /api/stop/:id           # 停止流
GET  /api/stream/:id/status  # 获取流状态

# 管理员功能
GET  /api/admin/streams      # 管理流配置
POST /api/admin/streams      # 创建流
PUT  /api/admin/streams/:id  # 更新流
DELETE /api/admin/streams/:id # 删除流
GET  /api/admin/vps/health   # VPS健康检查
GET  /api/admin/system/status # 系统状态
```

## 🔐 安全配置

### 认证机制
- **会话管理**: 基于Cookie的会话系统
- **密码哈希**: PBKDF2算法
- **API认证**: X-API-Key头部验证
- **权限控制**: 管理员/普通用户角色分离

### 网络安全
- **HTTPS强制**: Cloudflare自动SSL
- **CORS配置**: 跨域请求控制
- **防火墙**: VPS端口访问限制
- **源站保护**: Cloudflare代理隐藏真实IP

## 🧪 功能测试指南

### 1. 基础功能测试
```bash
# 测试Workers API
curl https://yoyoapi.your-domain.com/api/status

# 测试VPS健康状态
curl http://yoyo-vps.your-domain.com/health

# 测试管理员登录
curl -X POST https://yoyoapi.your-domain.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<PASSWORD>"}'
```

### 2. 流媒体功能测试

#### 2.1 添加测试频道
1. 访问管理后台: https://yoyoapi.your-domain.com/admin
2. 使用admin/<PASSWORD>登录
3. 添加新频道配置

#### 2.2 RTMP推流测试
```bash
# 使用FFmpeg推流
ffmpeg -re -i test.mp4 -c copy -f flv rtmp://yoyo-vps.your-domain.com/live/STREAM_KEY

# 使用OBS Studio
# RTMP URL: rtmp://yoyo-vps.your-domain.com/live/
# Stream Key: [您设置的频道密钥]
```

#### 2.3 HLS播放测试
```bash
# 检查HLS文件生成
curl http://yoyo-vps.your-domain.com/hls/CHANNEL_ID/

# 播放HLS流
# URL: http://yoyo-vps.your-domain.com/hls/CHANNEL_ID/playlist.m3u8
```

## 🔧 运维管理

### 日常维护命令
```bash
# VPS服务器维护
ssh root@yoyo-vps.your-domain.com

# 查看服务状态
pm2 status
systemctl status nginx
systemctl status yoyo-transcoder

# 查看日志
pm2 logs vps-transcoder-api
tail -f /var/log/nginx/yoyo-access.log
tail -f /var/log/nginx/yoyo-error.log

# 重启服务
pm2 restart vps-transcoder-api
systemctl restart nginx
```

### 监控指标
- **VPS资源使用**: CPU、内存、磁盘
- **网络流量**: 带宽使用情况
- **转码性能**: FFmpeg进程状态
- **API响应时间**: Workers性能监控
- **错误日志**: 异常情况追踪

## 📈 性能优化

### 已实施的优化
1. **Nginx配置优化**
   - Gzip压缩
   - 连接复用
   - 缓冲区调优
   - 静态文件缓存

2. **FFmpeg参数优化**
   - 硬件加速支持
   - 编码参数调优
   - 分辨率自适应

3. **Cloudflare优化**
   - 全球CDN加速
   - 智能路由
   - DDoS防护

### 扩展建议
1. **负载均衡**: 多VPS实例部署
2. **数据库优化**: Redis缓存层
3. **监控告警**: Prometheus + Grafana
4. **自动扩容**: 基于负载的动态扩容

## 🚨 故障排除

### 常见问题及解决方案

#### VPS服务问题
```bash
# API服务无响应
pm2 restart vps-transcoder-api
pm2 logs vps-transcoder-api

# FFmpeg转码失败
ffmpeg -version
which ffmpeg
ps aux | grep ffmpeg

# Nginx配置错误
nginx -t
systemctl status nginx
```

#### Workers部署问题
```bash
# 重新部署
wrangler deploy --env production

# 检查环境变量
wrangler secret list --env production

# 查看实时日志
wrangler tail --env production
```

#### 网络连接问题
```bash
# 测试端口连通性
telnet yoyo-vps.your-domain.com 52535

# 检查防火墙
firewall-cmd --list-all

# DNS解析检查
nslookup yoyo-vps.your-domain.com
```

## 📝 更新日志

### 2025-10-01 初始部署
- ✅ VPS环境搭建完成
- ✅ FFmpeg依赖问题解决
- ✅ Nginx配置和端口自定义
- ✅ Cloudflare Workers生产部署
- ✅ 三层架构连接配置
- ✅ 管理员用户初始化
- ✅ 基础功能验证完成

## 📞 技术支持

### 关键文件位置
- **VPS配置**: `/opt/yoyo-transcoder/.env`
- **Nginx配置**: `/etc/nginx/conf.d/yoyo-transcoder.conf`
- **PM2配置**: `/opt/yoyo-transcoder/ecosystem.config.js`
- **部署脚本**: `vps-transcoder-api/scripts/`

### 备份策略
- **代码备份**: Git仓库
- **配置备份**: 自动备份到 `/etc/nginx/backup-*`
- **数据备份**: Cloudflare KV自动备份
- **日志轮转**: 自动清理和压缩

---

**文档版本**: v1.0  
**最后更新**: 2025-10-01 15:49  
**维护团队**: YOYO Development Team  

> 本文档记录了YOYO流媒体平台的完整部署过程，包含所有关键配置和操作步骤。如有问题请参考故障排除章节或联系技术支持。
