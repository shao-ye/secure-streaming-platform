# Cloudflare Pages 前端部署指南

## 🎯 部署目标
将YOYO流媒体平台前端部署到Cloudflare Pages，实现全球CDN加速和自动化部署。

## 📋 当前状态
- ✅ 前端项目构建成功 (npm run build)
- ✅ 所有配置文件已准备完毕
- ✅ Cloudflare Workers API已部署 (yoyoapi.5202021.xyz)
- ✅ 环境变量配置正确

## 🚀 部署步骤

### 步骤1: 登录Cloudflare Dashboard
1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 选择您的账户和域名 `5202021.xyz`

### 步骤2: 创建Pages应用
1. 在左侧菜单中选择 **"Pages"**
2. 点击 **"Create a project"**
3. 选择 **"Connect to Git"**

### 步骤3: 连接Git仓库
1. 选择您的Git提供商 (GitHub/GitLab)
2. 选择包含前端代码的仓库
3. 选择分支 (通常是 `main` 或 `master`)

### 步骤4: 配置构建设置
```
Project name: yoyo-streaming-platform
Production branch: main
Build command: npm run build
Build output directory: dist
Root directory: frontend
Node.js version: 18
```

### 步骤5: 设置环境变量
在 **"Environment variables"** 部分添加以下变量：

**生产环境变量**:
```
VITE_API_BASE_URL=https://yoyoapi.5202021.xyz
VITE_APP_TITLE=YOYO流媒体平台
VITE_APP_VERSION=1.0.0
VITE_HLS_PROXY_URL=https://yoyoapi.5202021.xyz/hls
VITE_ENVIRONMENT=production
VITE_WORKER_URL=https://yoyoapi.5202021.xyz
VITE_DEBUG=false
VITE_LOG_LEVEL=error
```

### 步骤6: 配置自定义域名
1. 部署完成后，进入Pages项目设置
2. 选择 **"Custom domains"**
3. 添加自定义域名: `yoyo.5202021.xyz`
4. 等待DNS验证完成

### 步骤7: 验证部署配置文件
确保以下文件存在于 `frontend/public/` 目录：

**_headers文件** (已存在):
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*.html
  Cache-Control: no-cache, no-store, must-revalidate

/api/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization
```

**_redirects文件** (已存在):
```
/api/* https://yoyoapi.5202021.xyz/api/:splat 200
/hls/* https://yoyoapi.5202021.xyz/hls/:splat 200
/* /index.html 200
```

## 🔧 高级配置

### 自动部署触发器
- **Git推送**: 每次推送到主分支自动触发部署
- **预览部署**: Pull Request自动创建预览环境
- **回滚**: 支持一键回滚到之前版本

### 性能优化设置
1. **缓存策略**: 静态资源长期缓存，HTML文件不缓存
2. **压缩**: 自动启用Brotli和Gzip压缩
3. **CDN**: 全球200+节点加速
4. **HTTP/2**: 自动启用HTTP/2和HTTP/3

### 安全配置
1. **HTTPS**: 自动SSL证书和强制HTTPS
2. **安全头**: 自动添加安全响应头
3. **DDoS防护**: Cloudflare自动DDoS防护
4. **WAF**: Web应用防火墙保护

## 📊 部署验证

### 1. 构建验证
```bash
# 本地验证构建
cd frontend
npm install
npm run build

# 检查构建输出
ls -la dist/
```

### 2. 功能验证
部署完成后访问以下URL验证：

- **主页**: https://yoyo.5202021.xyz
- **登录页**: https://yoyo.5202021.xyz/login
- **管理页**: https://yoyo.5202021.xyz/admin

### 3. API连接验证
在浏览器开发者工具中检查：
- API请求是否正确代理到 `yoyoapi.5202021.xyz`
- 登录功能是否正常
- 流列表是否正常加载

## 🚨 故障排除

### 构建失败
```bash
# 检查Node.js版本
node --version  # 应该是v18+

# 清理依赖重新安装
rm -rf node_modules package-lock.json
npm install

# 检查环境变量
npm run build -- --mode production
```

### 404错误
1. 检查 `_redirects` 文件是否正确
2. 确认SPA路由配置
3. 验证API代理规则

### API连接失败
1. 检查CORS配置
2. 验证Workers部署状态
3. 确认环境变量配置

### 自定义域名问题
1. 检查DNS记录配置
2. 等待SSL证书生成
3. 验证域名所有权

## 📈 监控和维护

### 部署监控
- **构建状态**: Pages Dashboard实时监控
- **部署历史**: 查看所有部署记录
- **性能指标**: Core Web Vitals监控

### 日志查看
```bash
# Pages部署日志
在Cloudflare Dashboard > Pages > 项目 > 部署历史

# 实时错误监控
在浏览器开发者工具 > Console 查看前端错误
```

### 定期维护
1. **依赖更新**: 定期更新npm依赖
2. **安全补丁**: 关注安全更新
3. **性能优化**: 监控Core Web Vitals指标
4. **备份**: Git仓库自动备份代码

## 🔗 相关链接

- **前端地址**: https://yoyo.5202021.xyz
- **API地址**: https://yoyoapi.5202021.xyz
- **VPS地址**: https://yoyo-vps.5202021.xyz
- **Cloudflare Dashboard**: https://dash.cloudflare.com

## ✅ 部署完成检查清单

- [ ] Git仓库连接成功
- [ ] 构建配置正确
- [ ] 环境变量设置完毕
- [ ] 自定义域名配置
- [ ] _headers和_redirects文件部署
- [ ] HTTPS证书生效
- [ ] 前端页面正常访问
- [ ] API代理功能正常
- [ ] 登录功能测试通过
- [ ] 流媒体播放测试通过

完成以上所有步骤后，YOYO流媒体平台前端将成功部署到Cloudflare Pages！
