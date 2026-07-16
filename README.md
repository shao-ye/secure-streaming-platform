# YOYO流媒体平台 - 安全实时直播与监控平台

## 🧩 项目简介

YOYO流媒体平台是一个面向多种实时监控与直播场景的**安全直播 / 回放一体化解决方案**，采用「前端 + Cloudflare Workers + VPS 转码」的三层架构，通过 Cloudflare 边缘网络 + VPS 转码服务，实现：

- 支持多用户、多频道的实时视频流播放与录制；
- 管理员可在后台集中管理频道、预加载与定时录制策略；
- 结合 Cloudflare Tunnel 隐藏 VPS 源站 IP，降低被攻击风险。

本仓库包含完整的三端代码：Cloudflare Worker（后端 API 网关）、Vue 前端和 VPS 转码服务端。

## ✨ 核心特性

- **安全访问与隐藏源站**：
  - 前端与管理后台只访问 Cloudflare Workers 域名；
  - 通过 Cloudflare Tunnel 访问 VPS，无需在防火墙暴露转码端口。

- **多频道直播 + 录制管理**：
  - 支持多个 RTMP 频道配置、排序与启停；
  - 一键开启 / 关闭频道预加载与定时录制。

- **智能预加载与定时任务体系**：
  - 支持按工作日 / 时间段规则自动启动或停止转码；
  - 内置录制文件保留策略与定期清理任务。

- **双维度路由与 Workers 流共享缓存**：
  - 前端路径（Pages / Tunnel）+ 后端路径（直连 / 代理）的组合路由，提高可用性；
  - HLS 分片在 Workers 缓存，多端观看共用一条转码流，显著节省 VPS 带宽。

- **前后端完全开源，便于二次开发**：
  - 所有核心逻辑开放，方便安全审计与私有化部署。

## 🏗️ 整体架构一览

```text
┌────────────────────────────────────────────┐
│ 前端层: Vue 3 + Element Plus + hls.js       │
│ 域名: https://yoyo.your-domain.com          │
│ 部署: Cloudflare Pages                      │
└────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────┐
│ 业务层: Cloudflare Workers                  │
│ 域名: https://yoyoapi.your-domain.com       │
│ 功能: API 服务、路由决策、用户认证、HLS 缓存 │
└────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────┐
│ 转码层: Node.js + FFmpeg (VPS)              │
│ 域名: https://yoyo-vps.your-domain.com      │
│ 功能: RTMP → HLS 转码、进程管理、代理服务    │
└────────────────────────────────────────────┘
```

## 🔧 模块划分（简版）

- **前端层（Cloudflare Pages + Vue 3）**：频道列表、播放器界面、用户登录与权限控制，并展示当前路由模式。
- **业务层（Cloudflare Workers）**：统一 API 网关、用户与频道管理、预加载配置、HLS 分片缓存、隧道代理与路由决策。
- **转码层（VPS + Node.js + FFmpeg + Nginx）**：RTMP → HLS 实时转码、转码进程调度、多用户共享转码、录制与视频清理任务。

## 🛠 技术栈

- **前端**：Vue 3 + Vite + Element Plus
- **边缘层**：Cloudflare Workers + KV +（可选）R2 + Cloudflare Tunnel
- **VPS 服务端**：Node.js (Express) + FFmpeg + Nginx + PM2

## ⚡ 快速上手（概览）

> 只展示整体流程，详细图文步骤请查看
> [`docs/DEPLOYMENT_GUIDE.md`](./docs/DEPLOYMENT_GUIDE.md)。
>
> 如需了解 VPS 一键卸载脚本的行为与用法，请参见：
> [`docs/VPS_UNINSTALL_GUIDE.md`](./docs/VPS_UNINSTALL_GUIDE.md)。

1. 在 Cloudflare 中创建 Worker，部署 `cloudflare-worker/` 代码并绑定自定义域名（Workers API 域名）。  
2. 在 VPS 上执行 `vps-server/scripts/vps-oneclick.sh`，完成 Node.js / FFmpeg / Nginx / PM2 安装与服务端部署。  
3. 在 Cloudflare Zero Trust 中创建 Tunnel，将 Public Hostname 指向 VPS 上的 Nginx 端口。  
4. 部署前端（如 Cloudflare Pages），将 API Base URL 指向 Workers API 域名。  
5. 通过管理后台添加频道、配置预加载与录制，即可开始使用。

## 📁 目录结构

```text
secure-streaming-platform/
│
├── cloudflare-worker/          # Cloudflare Workers（后端API）
│   ├── src/                    # Workers源代码
│   │   ├── index.js            # 主入口文件（单文件架构）
│   │   └── handlers/           # 功能模块
│   ├── wrangler.toml           # Workers配置
│   └── package.json
│
├── frontend/                   # 前端（Vue.js）
│   ├── src/                    # 前端源代码
│   ├── public/                 # 静态资源
│   └── package.json
│
├── vps-server/                 # VPS服务端（Node.js）
│   ├── src/                    # 服务端源代码
│   │   ├── routes/             # API路由
│   │   ├── services/           # 业务服务
│   │   └── middleware/         # 中间件
│   ├── ecosystem.config.js     # PM2配置
│   └── package.json
│
├── docs/                       # 文档
│   ├── project/                # 项目文档
│   ├── root-legacy/            # 遗留文档
│   └── *.md                    # 项目级文档
│
├── scripts/                    # 脚本工具
│   ├── deploy/                 # 部署脚本
│   ├── test/                   # 测试脚本
│   ├── fix/                    # 修复脚本
│   └── utils/                  # 工具脚本
│
├── config/                     # 配置文件
├── src/                        # 共享源代码
└── archive/                    # 归档文件
```

## 🚀 部署流程

> 下文仅为 **快速概览**，完整图文步骤请参见：
> [`docs/DEPLOYMENT_GUIDE.md`](./docs/DEPLOYMENT_GUIDE.md)

### 1. Cloudflare Workers（后端 API 网关）

```bash
cd cloudflare-worker
wrangler deploy --env production
```

### 2. Cloudflare Pages（前端）

```bash
# 自动部署：提交代码到GitHub
git push origin master

# 构建配置：
# - Root directory: frontend
# - Build command: npm run build
# - Output directory: dist
```

### 3. VPS服务端（转码 + HLS）

```bash
cd vps-server
pm2 restart ecosystem.config.js
```

## 🖥️ 系统页面展示

1. 登录页面
   ![ScreenShot_2025-12-15_133025_547.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-15_133025_547.png)
2. 播放页面，支持电脑端，手机端全屏播放。
   ![ScreenShot_2025-12-14_104100_096.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-14_104100_096.png)
3. 后台管理配置页面，可添加频道、配置RTMP视频源，配置预加载与录制。
   ![ScreenShot_2025-12-12_182137_472.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_182137_472.png)
4. 在“预加载与录制配置”中按工作日/时间段配置调度策略。

   可以单独为频道设置是否需要进行预加载与录制，并设置预加载与录制时长，也可以设置播放视频比例。
   ![ScreenShot_2025-12-12_182341_331.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_182341_331.png)
   也可以为所有频道统一设置，录制的视频文件保存时长，进行统一清理，以及是否启用视频分段录制，防止单个视频文件过大。
   ![ScreenShot_2025-12-12_182931_784.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_182931_784.png)
5. 在 **后台管理** → **用户管理** 页面可以添加删除普通用户账号，并为其设置密码。
   ![ScreenShot_2025-12-12_181557_884.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_181557_884.png)
6.可以监控系统状态
   ![ScreenShot_2025-12-14_111245_395.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-14_111245_395.png)

## 📞 联系方式

如有问题，请查看 [`docs/`](./docs/) 目录中的详细文档。

如需业务或技术支持，可发送邮件至：[shaoye@shaoyeai.com](mailto:shaoye@shaoyeai.com)
