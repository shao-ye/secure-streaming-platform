# VPS Transcoder API

YOYO多用户、多频道安全流媒体Web播放平台 - VPS转码服务

## 🚀 一键安装（推荐）

### **零基础快速部署**

```bash
bash <(curl -Ls https://raw.githubusercontent.com/YOUR_USERNAME/secure-streaming-platform/main/vps-server/scripts/one-click-install.sh)
```

**仅需 3-5 分钟自动完成**：
- ✅ 环境检测和依赖安装
- ✅ 项目代码部署
- ✅ 服务配置和启动
- ✅ 自动生成 API 密钥

📖 **详细文档**: [一键安装指南](../docs/VPS_ONE_CLICK_INSTALL_GUIDE.md)

### **自定义安装**

```bash
# 指定域名
VPS_DOMAIN=vps.example.com bash <(curl -Ls ...)

# 自定义端口
API_PORT=8080 bash <(curl -Ls ...)

# 跳过依赖安装（已有环境）
SKIP_DEPS=true bash <(curl -Ls ...)
```

---

## 项目简介

这是一个基于Node.js + Express + FFmpeg的视频流转码服务，专门用于将RTMP流转换为HLS格式，支持按需转码和多用户共享观看。

## 主要特性

- 🎥 **按需转码**: 仅在有用户观看时启动转码进程
- 🔒 **安全认证**: API密钥 + IP白名单双重保护
- 🔄 **进程管理**: 智能FFmpeg进程管理，支持自动重启和清理
- 📊 **实时监控**: 完整的系统状态和健康检查
- 🚀 **高性能**: 优化的HLS输出配置，低延迟传输
- 📝 **结构化日志**: 完整的操作日志和错误追踪

## 技术栈

- **运行时**: Node.js 18+
- **Web框架**: Express.js 4.18+
- **视频处理**: FFmpeg
- **Web服务器**: Nginx
- **进程管理**: PM2
- **日志**: Winston
- **安全**: Helmet, CORS, Rate Limiting

## 系统要求

- **操作系统**: CentOS 9 / RHEL 9 / Ubuntu 20.04+
- **CPU**: 1 Core (推荐2 Core+)
- **内存**: 2GB (推荐4GB+)
- **磁盘**: 30GB (推荐SSD)
- **网络**: 稳定的网络连接，支持RTMP输入

## 接口测试验证

### 自动化测试

项目提供了完整的API接口测试套件，可以验证所有功能是否正常工作。

#### 快速测试
