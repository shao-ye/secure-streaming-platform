# YOYO流媒体平台 - 前端项目

## 项目简介

YOYO流媒体平台前端是一个基于Vue 3的现代化Web应用，提供安全可靠的企业级流媒体管理和播放功能。

### 主要功能

- 🔐 **用户认证系统** - 安全的登录/登出，基于角色的权限管理
- 📺 **视频播放器** - 支持HLS流播放，自动重试，错误恢复
- 📋 **频道管理** - 完整的CRUD操作，实时状态监控
- 🛠️ **管理后台** - 系统状态监控，缓存管理，诊断工具
- 📱 **响应式设计** - 完美适配桌面端和移动端

### 技术栈

- **框架**: Vue 3 + Composition API
- **构建工具**: Vite 4
- **UI组件库**: Element Plus
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **HTTP客户端**: Axios
- **视频播放**: HLS.js
- **样式**: CSS3 + Flexbox/Grid
- **开发语言**: JavaScript/TypeScript

## 快速开始

### 环境要求

- Node.js >= 16.0.0
- npm >= 8.0.0 或 yarn >= 1.22.0

### 安装依赖

```bash
# 使用npm
npm install

# 或使用yarn
yarn install
```

### 开发环境运行

```bash
# 启动开发服务器
npm run dev

# 或
yarn dev
```

访问 http://localhost:8080 查看应用

### 构建生产版本

```bash
# 构建生产版本
npm run build

# 或
yarn build
```

构建产物将输出到 `dist/` 目录

### 预览生产版本

```bash
# 预览构建后的应用
npm run preview

# 或
yarn preview
```

## 环境配置

### 环境变量

项目支持多环境配置，通过 `.env` 文件管理：

#### 开发环境 (`.env.development`)
```bash
VITE_API_BASE_URL=http://localhost:8787
VITE_APP_TITLE=YOYO流媒体平台
VITE_HLS_PROXY_URL=http://localhost:8787/hls
VITE_ENVIRONMENT=development
VITE_DEBUG=true
```

#### 生产环境 (`.env.production`)
```bash
VITE_API_BASE_URL=https://your-worker.your-subdomain.workers.dev
VITE_APP_TITLE=YOYO流媒体平台
VITE_HLS_PROXY_URL=https://your-worker.your-subdomain.workers.dev/hls
VITE_ENVIRONMENT=production
VITE_DEBUG=false
```

### 配置说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `VITE_API_BASE_URL` | 后端API基础URL | `http://localhost:8787` |
| `VITE_APP_TITLE` | 应用标题 | `YOYO流媒体平台` |
| `VITE_HLS_PROXY_URL` | HLS代理服务URL | `http://localhost:8787/hls` |
| `VITE_ENVIRONMENT` | 运行环境 | `development` |
| `VITE_DEBUG` | 调试模式 | `false` |
| `VITE_LOG_LEVEL` | 日志级别 | `info` |

## 项目结构

```
frontend/
├── public/                 # 静态资源
├── src/
│   ├── components/        # 可复用组件
│   │   ├── StreamList.vue      # 频道列表组件
│   │   ├── VideoPlayer.vue     # 视频播放器组件
│   │   ├── StreamManager.vue   # 频道管理组件
│   │   └── SystemDiagnostics.vue # 系统诊断组件
│   ├── router/           # 路由配置
│   │   └── index.js
│   ├── stores/           # 状态管理
│   │   ├── user.js            # 用户状态
│   │   └── streams.js         # 频道状态
│   ├── utils/            # 工具函数
│   │   ├── axios.js           # HTTP客户端配置
│   │   └── config.js          # 应用配置
│   ├── views/            # 页面组件
│   │   ├── Login.vue          # 登录页面
│   │   ├── Dashboard.vue      # 主控制台
│   │   └── AdminPanel.vue     # 管理后台
│   ├── App.vue           # 根组件
│   ├── main.js           # 应用入口
│   └── style.css         # 全局样式
├── .env.development      # 开发环境配置
├── .env.production       # 生产环境配置
├── vite.config.js        # Vite配置
├── package.json          # 项目依赖
└── README.md            # 项目文档
```

## 核心功能

### 用户认证

- 支持用户名/密码登录
- 基于Cookie的会话管理
- 自动登录状态检查
- 权限路由守卫

### 视频播放

- HLS流媒体播放
- 自动播放控制
- 错误自动重试
- 播放状态监控
- 全屏播放支持

### 频道管理

- 频道列表展示
- 实时播放状态
- 频道切换播放
- 管理员CRUD操作

### 系统管理

- 系统状态监控
- 缓存统计查看
- 缓存清理操作
- VPS健康检查
- 系统诊断工具

## API集成

### 后端API接口

前端与Cloudflare Worker后端通过RESTful API通信：

#### 认证接口
- `POST /login` - 用户登录
- `POST /logout` - 用户登出
- `GET /api/user` - 获取用户信息

#### 频道接口
- `GET /api/streams` - 获取频道列表
- `POST /api/play/{id}` - 播放指定频道
- `GET /api/admin/streams` - 管理员获取频道列表
- `POST /api/admin/streams` - 添加频道
- `PUT /api/admin/streams/{id}` - 更新频道
- `DELETE /api/admin/streams/{id}` - 删除频道

#### 管理接口
- `GET /api/admin/cache/stats` - 获取缓存统计
- `POST /api/admin/cache/clear` - 清理缓存
- `GET /api/admin/diagnostics` - 系统诊断
- `GET /api/admin/vps/health` - VPS健康检查

### 代理配置

开发环境通过Vite代理转发API请求：

```javascript
// vite.config.js
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8787',
      changeOrigin: true
    },
    '/hls': {
      target: 'http://localhost:8787',
      changeOrigin: true
    }
  }
}
```

## 部署指南

### 开发环境部署

1. 克隆项目并安装依赖
2. 配置 `.env.development` 文件
3. 启动开发服务器：`npm run dev`

### 生产环境部署

#### 1. 构建应用

```bash
# 安装依赖
npm install

# 构建生产版本
npm run build
```

#### 2. 部署到静态服务器

将 `dist/` 目录部署到任何静态文件服务器：

**Nginx配置示例：**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /path/to/dist;
    index index.html;

    # SPA路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API代理
    location /api/ {
        proxy_pass https://your-worker.your-subdomain.workers.dev;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # HLS代理
    location /hls/ {
        proxy_pass https://your-worker.your-subdomain.workers.dev;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### 3. 部署到CDN

**Cloudflare Pages部署：**
1. 连接GitHub仓库
2. 设置构建命令：`npm run build`
3. 设置输出目录：`dist`
4. 配置环境变量
5. 部署完成

**Vercel部署：**
```bash
# 安装Vercel CLI
npm i -g vercel

# 部署
vercel --prod
```

### Docker部署

```dockerfile
# Dockerfile
FROM node:16-alpine as builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```bash
# 构建镜像
docker build -t yoyo-frontend .

# 运行容器
docker run -p 8080:80 yoyo-frontend
```

## 开发指南

### 代码规范

- 使用Vue 3 Composition API
- 组件命名采用PascalCase
- 文件命名采用kebab-case
- 使用ESLint进行代码检查

### 组件开发

```vue
<template>
  <div class="component-name">
    <!-- 模板内容 -->
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'

// 组件逻辑
</script>

<style scoped>
/* 组件样式 */
</style>
```

### 状态管理

使用Pinia进行状态管理：

```javascript
// stores/example.js
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useExampleStore = defineStore('example', () => {
  const state = ref(null)
  
  const action = async () => {
    // 异步操作
  }
  
  return { state, action }
})
```

### 错误处理

- 使用try-catch处理异步操作
- 统一的错误提示机制
- 网络错误自动重试
- 用户友好的错误信息

## 性能优化

### 构建优化

- 代码分割和懒加载
- 静态资源压缩
- Tree Shaking
- 缓存策略

### 运行时优化

- 组件懒加载
- 图片懒加载
- 虚拟滚动
- 防抖节流

### 网络优化

- HTTP/2支持
- 资源预加载
- CDN加速
- 缓存策略

## 故障排除

### 常见问题

**1. 开发服务器启动失败**
- 检查Node.js版本
- 清除node_modules重新安装
- 检查端口占用

**2. API请求失败**
- 检查后端服务状态
- 验证API地址配置
- 查看网络代理设置

**3. 视频播放失败**
- 检查HLS流地址
- 验证浏览器兼容性
- 查看控制台错误信息

**4. 构建失败**
- 检查依赖版本兼容性
- 清理构建缓存
- 查看构建日志

### 调试技巧

- 开启调试模式：`VITE_DEBUG=true`
- 使用Vue DevTools
- 查看浏览器控制台
- 网络面板监控API请求

## 贡献指南

1. Fork项目
2. 创建功能分支
3. 提交代码变更
4. 推送到分支
5. 创建Pull Request

## 许可证

MIT License

## 联系方式

如有问题或建议，请联系开发团队。
