# Cloudflare Pages 部署指南

## 📋 概述

本指南将帮助您将YOYO流媒体平台前端部署到Cloudflare Pages，实现全Cloudflare生态系统架构。

## 🏗️ 架构优势

### 优化后的架构
```
用户浏览器 → Cloudflare Pages (前端) → Cloudflare Workers (API) → VPS转码服务
                                              ↓
                                         Cloudflare KV存储
```

### 主要优势
- **全球CDN**: 前端资源自动分发到全球边缘节点
- **零冷启动**: 静态资源无需启动时间
- **自动HTTPS**: 免费SSL证书
- **Git集成**: 自动部署和预览环境
- **成本优化**: 免费额度丰富

## 🚀 部署步骤

### 步骤1: 准备Git仓库

确保您的代码已推送到Git仓库（GitHub、GitLab等）：

```bash
# 提交当前更改
git add .
git commit -m "feat: 配置Cloudflare Pages部署"
git push origin main
```

### 步骤2: 创建Cloudflare Pages应用

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击左侧菜单 "Pages"
3. 点击 "创建项目" → "连接到Git"
4. 选择您的Git提供商并授权
5. 选择包含前端代码的仓库

### 步骤3: 配置构建设置

在Pages设置页面配置以下参数：

#### 基本设置
- **项目名称**: `yoyo-streaming-frontend`
- **生产分支**: `main`
- **构建命令**: `npm run build`
- **构建输出目录**: `dist`
- **根目录**: `frontend`

#### 环境变量
在 "设置" → "环境变量" 中添加：

```
VITE_API_BASE_URL=https://yoyo-streaming-api.your-subdomain.workers.dev
VITE_APP_TITLE=YOYO流媒体平台
VITE_APP_VERSION=1.0.0
VITE_HLS_PROXY_URL=https://yoyo-streaming-api.your-subdomain.workers.dev/hls
VITE_ENVIRONMENT=production
VITE_WORKER_URL=https://yoyo-streaming-api.your-subdomain.workers.dev
VITE_DEBUG=false
VITE_LOG_LEVEL=error
```

### 步骤4: 部署验证

1. 点击 "保存并部署"
2. 等待构建完成（通常2-5分钟）
3. 访问提供的 `*.pages.dev` 域名
4. 验证应用正常加载

### 步骤5: 配置自定义域名（可选）

1. 在Pages项目设置中点击 "自定义域"
2. 添加您的域名
3. 按照提示配置DNS记录
4. 等待SSL证书自动颁发

## 🔧 Workers CORS配置更新

需要更新Cloudflare Workers的CORS配置以允许Pages域名访问：

```javascript
// 在 src/utils/cors.js 中更新允许的源
const allowedOrigins = [
  'https://yoyo-streaming.pages.dev',
  'https://your-custom-domain.com',
  'http://localhost:8080', // 开发环境
];
```

## 📊 构建优化配置

### package.json 脚本优化
```json
{
  "scripts": {
    "build": "vite build",
    "build:pages": "vite build --mode production",
    "preview": "vite preview --host 0.0.0.0"
  }
}
```

### Vite配置优化
当前配置已针对Pages优化：
- ✅ 代码分割配置
- ✅ 资源压缩
- ✅ 环境变量注入
- ✅ 构建输出优化

## 🔒 安全配置

### HTTP头配置 (_headers文件)
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
```

### 重定向配置 (_redirects文件)
```
# API代理到Worker
/api/* https://yoyo-streaming-api.your-subdomain.workers.dev/api/:splat 200
/hls/* https://yoyo-streaming-api.your-subdomain.workers.dev/hls/:splat 200

# SPA路由
/* /index.html 200
```

## 🚦 部署验证清单

- [ ] 应用正常加载
- [ ] 登录功能正常
- [ ] API请求成功
- [ ] 视频播放正常
- [ ] 管理员功能可用
- [ ] 移动端适配正常
- [ ] HTTPS证书有效

## 🔄 自动部署配置

### Git工作流
- **主分支推送**: 自动部署到生产环境
- **PR创建**: 自动创建预览环境
- **分支合并**: 自动更新生产部署

### 部署钩子（可选）
可以配置Webhook通知部署状态到Slack、Discord等。

## 📈 性能监控

### Cloudflare Analytics
- 页面访问统计
- 性能指标监控
- 错误率追踪
- 地理分布分析

### Core Web Vitals
Pages自动提供Core Web Vitals监控：
- LCP (Largest Contentful Paint)
- FID (First Input Delay)
- CLS (Cumulative Layout Shift)

## 🛠️ 故障排查

### 常见问题

1. **构建失败**
   - 检查Node.js版本兼容性
   - 验证依赖安装
   - 查看构建日志

2. **API请求失败**
   - 检查环境变量配置
   - 验证Worker CORS设置
   - 确认Worker部署状态

3. **路由问题**
   - 检查_redirects文件配置
   - 验证SPA路由设置

### 调试工具
- Cloudflare Pages构建日志
- 浏览器开发者工具
- Cloudflare Workers日志

## 📞 支持资源

- [Cloudflare Pages文档](https://developers.cloudflare.com/pages/)
- [Vite构建指南](https://vitejs.dev/guide/build.html)
- [Vue.js部署指南](https://vuejs.org/guide/best-practices/production-deployment.html)

## 🎯 下一步

部署完成后，您可以：
1. 配置自定义域名
2. 设置监控告警
3. 优化性能指标
4. 添加分析工具
5. 配置CDN缓存策略
