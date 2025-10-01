# YOYO安全流媒体播放平台 - 完整架构文档

## 📋 项目概述

**项目名称**: YOYO安全流媒体播放平台  
**项目定位**: 企业级多用户、多频道安全流媒体Web播放平台  
**技术架构**: 三层架构（前端 + 业务层 + 转码层）  
**部署时间**: 2025年10月1日  
**当前状态**: 生产环境运行中 ✅

---

## 🌐 生产环境域名配置

### 前端应用层
- **域名**: `https://yoyo.5202021.xyz`
- **技术栈**: Vue.js 3 + Element Plus + hls.js
- **部署平台**: Cloudflare Pages
- **功能**: 用户界面、视频播放器、频道管理

### 业务逻辑层 (Cloudflare Workers)
- **域名**: `https://yoyoapi.5202021.xyz`
- **技术栈**: Cloudflare Workers + KV存储
- **功能**: API服务、用户认证、会话管理、业务逻辑处理

### 转码服务层 (VPS)
- **域名**: `https://yoyo-vps.5202021.xyz`
- **真实地址**: `142.171.75.220:52535`
- **技术栈**: Node.js + Express + FFmpeg + Nginx + PM2
- **功能**: RTMP到HLS转码、文件服务、进程管理

---

## 🔧 VPS服务器详细配置

### 服务器信息
- **服务器标识**: racknerd-508823f
- **操作系统**: CentOS 9
- **IP地址**: 142.171.75.220
- **Nginx端口**: 52535
- **Node.js API端口**: 3000

### 已安装软件版本
- **Node.js**: v18.20.8
- **FFmpeg**: 5.1.7 (支持libx264、AAC编码)
- **Nginx**: 1.20.1
- **PM2**: 6.0.13

### 目录结构
```
/opt/yoyo-transcoder/          # 应用主目录
├── src/                       # 源代码
│   ├── services/ProcessManager.js  # FFmpeg进程管理
│   ├── routes/stream.js       # 转码API路由
│   └── app.js                 # Express应用入口
├── config/                    # 配置文件
└── logs/                      # 日志目录

/var/www/hls/                  # HLS输出目录
├── [streamId]/                # 各流的输出目录
│   ├── playlist.m3u8          # HLS播放列表
│   └── segment*.ts            # 视频分片文件

/etc/nginx/nginx.conf          # Nginx配置文件
```

---

## 🔐 认证与安全配置

### API密钥
- **VPS API密钥**: `85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938`
- **用途**: VPS转码API认证

### 管理员账号
- **用户名**: `admin`
- **密码**: `admin123`
- **权限**: 系统管理员，可访问所有功能

### 会话管理
- **认证方式**: 基于Cookie的会话管理
- **密码加密**: PBKDF2哈希算法
- **会话存储**: Cloudflare KV数据库

---

## 📡 API端点配置

### Cloudflare Workers API端点
```
https://yoyoapi.5202021.xyz/api/login              # 用户登录
https://yoyoapi.5202021.xyz/api/logout             # 用户登出
https://yoyoapi.5202021.xyz/api/me                 # 获取当前用户信息
https://yoyoapi.5202021.xyz/api/streams            # 获取流列表
https://yoyoapi.5202021.xyz/api/play/:id           # 启动转码流
https://yoyoapi.5202021.xyz/api/stop/:id           # 停止转码流
https://yoyoapi.5202021.xyz/api/stream/:id/status  # 查询流状态
https://yoyoapi.5202021.xyz/hls/:streamId/:file    # HLS文件代理
```

### VPS转码API端点
```
https://yoyo-vps.5202021.xyz/health                # 健康检查
https://yoyo-vps.5202021.xyz/api/start-stream      # 启动转码
https://yoyo-vps.5202021.xyz/api/stop-stream       # 停止转码
https://yoyo-vps.5202021.xyz/api/streams           # 获取运行中的流
https://yoyo-vps.5202021.xyz/api/stream/:streamId  # 获取流信息
https://yoyo-vps.5202021.xyz/hls/                  # HLS文件服务
```

---

## 🎥 RTMP测试源配置

### 真实RTMP测试地址
```
rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4
```

### 测试用RTMP源（备用）
```
rtmp://live-par-2-abr.livepush.io/live/bigbuckbunnyiphone_400
```

### FFmpeg转码参数
```bash
ffmpeg -i [RTMP_URL] \
  -fflags +genpts \
  -avoid_negative_ts make_zero \
  -reconnect 1 \
  -reconnect_at_eof 1 \
  -reconnect_streamed 1 \
  -reconnect_delay_max 2 \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -profile:v baseline \
  -level 3.0 \
  -g 30 \
  -keyint_min 15 \
  -c:a aac \
  -b:a 96k \
  -ac 2 \
  -ar 44100 \
  -f hls \
  -hls_time 2 \
  -hls_list_size 6 \
  -hls_segment_filename /var/www/hls/[STREAM_ID]/segment%03d.ts \
  -hls_flags delete_segments+round_durations+independent_segments \
  -hls_allow_cache 0 \
  /var/www/hls/[STREAM_ID]/playlist.m3u8
```

---

## 🔄 数据流转关系

### 转码流程
```
RTMP输入源 
    ↓
VPS FFmpeg转码服务 (yoyo-vps.5202021.xyz)
    ↓
HLS文件生成 (/var/www/hls/)
    ↓
Nginx文件服务 (端口52535)
    ↓
Cloudflare Workers代理 (yoyoapi.5202021.xyz/hls/)
    ↓
前端hls.js播放器 (yoyo.5202021.xyz)
```

### API调用链路
```
前端Vue应用 (yoyo.5202021.xyz)
    ↓ AJAX请求
Cloudflare Workers API (yoyoapi.5202021.xyz)
    ↓ 内部调用
VPS转码API (yoyo-vps.5202021.xyz)
    ↓ 进程管理
FFmpeg转码进程
```

---

## 🛠️ 关键技术配置

### Nginx配置要点
- **监听端口**: 52535 (Cloudflare代理端口)
- **API代理**: 转发到本地3000端口
- **HLS文件服务**: 直接服务/var/www/hls目录
- **CORS配置**: 允许跨域访问

### ProcessManager关键修复
- **参数顺序**: `startStream(rtmpUrl, streamId)` (已修复)
- **超时配置**: 启动超时3秒，连接重试机制
- **进程监控**: 实时监控FFmpeg进程状态

### Express配置修复
- **Trust Proxy**: 设置为1 (修复Rate-Limit问题)
- **Body Parser**: 正确配置JSON解析
- **错误处理**: 完整的错误捕获和日志记录

---

## 📊 性能指标

### 设计目标
- **并发用户**: 50个
- **视频延迟**: ≤5秒
- **API响应时间**: ≤500ms
- **服务可用性**: 99.9%

### 实际性能
- **HLS分片时长**: 2秒
- **播放列表长度**: 6个分片
- **转码预设**: ultrafast (低延迟优先)
- **音频码率**: 96kbps AAC

---

## 🔍 故障排查指南

### 常用诊断命令
```bash
# 检查服务状态
pm2 status
systemctl status nginx

# 检查日志
tail -f /var/log/transcoder/app.log
tail -f /var/log/nginx/error.log

# 测试API连通性
curl -X GET https://yoyo-vps.5202021.xyz/health
curl -X GET https://yoyoapi.5202021.xyz/api/streams

# 检查HLS文件生成
ls -la /var/www/hls/[STREAM_ID]/
```

### 常见问题解决
1. **转码失败**: 检查RTMP源可用性和FFmpeg参数
2. **API 500错误**: 检查ProcessManager参数顺序和Express配置
3. **前端播放失败**: 检查HLS文件生成和CORS配置
4. **认证失败**: 检查会话管理和KV存储状态

---

## 📝 部署历史记录

### 重要修复记录
- **2025-10-01 10:54**: 修复API路由加载和JSON解析问题
- **2025-10-01 11:53**: 优化ProcessManager和FFmpeg参数
- **2025-10-01 13:35**: 修复Express Rate-Limit配置
- **2025-10-01 18:34**: 修复ProcessManager参数传递顺序

### 当前版本状态
- **项目完成度**: 99%
- **核心功能**: 100%可用
- **生产环境**: 稳定运行
- **代码同步**: 所有VPS修改已同步到项目源文件
- **待优化项**: 前端播放器集成验证

---

## 🚀 使用说明

### 快速测试流程
1. 访问 `https://yoyo.5202021.xyz`
2. 使用 `admin/admin123` 登录
3. 选择频道并开始播放
4. 验证视频正常显示

### API测试示例
```javascript
// 登录
const loginResponse = await fetch('https://yoyoapi.5202021.xyz/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  credentials: 'include'
});

// 启动转码
const playResponse = await fetch('https://yoyoapi.5202021.xyz/api/play/test-stream', {
  method: 'POST',
  credentials: 'include'
});

// 查询状态
const statusResponse = await fetch('https://yoyoapi.5202021.xyz/api/stream/test-stream/status', {
  credentials: 'include'
});
```

---

**文档创建时间**: 2025年10月2日  
**文档版本**: v1.0  
**维护人员**: YOYO开发团队  
**联系方式**: 项目仓库Issues
