# 代理连接错误修复指南

## 问题描述

用户在管理后台配置并开启代理功能后，系统显示"连接错误"，无法通过代理传输视频流。

### 问题现象
1. 代理功能总开关已开启
2. 已配置VLESS代理（jp和us节点）
3. 代理状态显示"连接错误"
4. 视频无法通过代理传输

## 问题原因分析

### 1. V2Ray/Xray客户端未安装
- VPS服务器上缺少V2Ray或Xray二进制文件
- ProxyManager无法启动代理进程

### 2. 代理进程未正确启动
- 即使配置了代理，但V2Ray进程没有运行
- 代理端口（1080）未监听

### 3. 透明代理规则未配置
- iptables规则未添加
- RTMP流量未重定向到代理

### 4. FFmpeg未配置代理环境变量
- FFmpeg进程直接连接RTMP源
- 未通过代理获取视频流

## 解决方案

### 快速修复步骤

1. **运行诊断脚本**
```powershell
.\fix-proxy-connection.ps1
```
这个脚本会：
- 检查VPS代理服务状态
- 检查V2Ray进程
- 显示诊断结果
- 提供自动修复选项

2. **部署修复程序**
```powershell
.\deploy-proxy-fix.ps1
```
这个脚本会：
- 上传修复文件到VPS
- 安装V2Ray客户端
- 配置代理服务
- 重启相关服务

### 手动修复步骤

如果自动修复失败，可以手动执行以下步骤：

#### 1. SSH连接到VPS
```bash
ssh root@<VPS_IP>
```

#### 2. 安装V2Ray
```bash
curl -Ls https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh | sudo bash
```

#### 3. 检查安装结果
```bash
which v2ray
# 应该输出: /usr/local/bin/v2ray
```

#### 4. 重启PM2服务
```bash
cd /opt/yoyo-transcoder
pm2 restart vps-transcoder-api
```

#### 5. 检查代理状态
```bash
curl http://localhost:3000/api/proxy/status
```

## 代理工作原理

### 架构设计
```
前端管理界面
    ↓ (配置代理)
Cloudflare Workers API
    ↓ (同步配置)
VPS ProxyManager服务
    ↓ (启动V2Ray)
V2Ray/Xray进程 (监听1080端口)
    ↓ (透明代理)
FFmpeg进程
    ↓ (通过代理获取RTMP流)
HLS输出文件
    ↓
前端播放器
```

### 关键组件

1. **ProxyManager.js**
   - 管理V2Ray进程生命周期
   - 生成V2Ray配置文件
   - 配置透明代理规则

2. **代理路由 (proxy.js)**
   - 提供代理配置API
   - 提供代理状态API
   - 提供代理测试API

3. **透明代理配置**
   - iptables规则重定向流量
   - RTMP (1935端口) → 代理 (1080端口)
   - HTTP/HTTPS流量 → 代理

## 验证代理功能

### 1. 检查代理服务状态
```bash
curl https://yoyo-vps.your-domain.com/api/proxy/status
```

预期响应：
```json
{
  "status": "success",
  "data": {
    "connectionStatus": "connected",
    "currentProxy": "proxy_jp_xxx"
  }
}
```

### 2. 检查V2Ray进程
```bash
ps aux | grep v2ray
```

应该看到V2Ray进程运行

### 3. 检查代理端口
```bash
netstat -tlnp | grep :1080
```

应该看到1080端口监听

### 4. 测试代理连接
在管理后台：
1. 点击代理的"测试"按钮
2. 查看延迟结果
3. 状态应显示"连接成功"

### 5. 验证视频流代理
1. 开启代理功能
2. 播放视频
3. 检查网络请求是否通过代理

## 常见问题

### Q1: 代理配置后仍显示"连接错误"
**A:** 可能是V2Ray未安装或未启动，运行修复脚本

### Q2: 代理测试成功但视频不通过代理
**A:** 检查透明代理规则是否生效：
```bash
iptables -t nat -L OUTPUT -n
```

### Q3: 代理连接不稳定
**A:** 可能是代理节点问题，尝试切换到其他节点

### Q4: 如何确认视频通过代理传输
**A:** 查看FFmpeg日志，确认环境变量包含代理设置：
```bash
tail -f /opt/yoyo-transcoder/logs/ffmpeg-*.log
```

## 技术支持

如果问题仍未解决，请提供以下信息：
1. 诊断脚本输出结果
2. VPS上的错误日志
3. 浏览器控制台错误信息
4. 代理配置详情

## 相关文件

- `fix-proxy-connection.ps1` - 诊断和修复脚本
- `deploy-proxy-fix.ps1` - 部署修复程序
- `enable-proxy-streaming.sh` - VPS端配置脚本
- `src/services/ProxyManager.js` - 代理管理服务
- `src/routes/proxy.js` - 代理API路由
