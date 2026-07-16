# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库定位

YOYO 流媒体平台 —— 一个「前端 + Cloudflare Workers + VPS 转码」的三层直播 / 录制系统。三端代码位于同一个仓库的三个顶层目录中，且**各自有独立的 `package.json`、依赖、部署方式**，不要在根目录尝试统一构建。

## 三个子项目

| 子项目 | 路径 | 运行时 | 入口 | 部署方式 |
| --- | --- | --- | --- | --- |
| Cloudflare Worker（API 网关） | `cloudflare-worker/` | Workers Runtime | `src/index.js` | `wrangler deploy --env production` |
| 前端 SPA | `frontend/` | Node 20+ / Vite | `src/main.js` | Cloudflare Pages（构建：`npm run build`，输出 `dist/`） |
| VPS 转码服务 | `vps-server/` | Node 18+ / Express | `src/app.js`（PM2 `ecosystem.config.js`） | `pm2 restart ecosystem.config.js` |

根目录的 `package.json` 只是一个便捷壳：`npm run dev` / `npm run build` 都是 `cd frontend && ...`。VPS 端和 Worker 端必须在各自子目录运行命令。

## 常用命令

```bash
# 前端开发服务器（vite，端口 8080，/api 代理到 http://localhost:8787）
cd frontend && npm run dev

# 前端构建 / Lint
cd frontend && npm run build
cd frontend && npm run lint

# Worker 本地调试 / 生产部署 / 实时日志
cd cloudflare-worker && npm run dev
cd cloudflare-worker && npm run deploy:production
cd cloudflare-worker && npm run tail

# VPS 服务（本地开发用 nodemon；生产由 PM2 管理）
cd vps-server && npm run dev
cd vps-server && npm test                # jest
cd vps-server && npx jest path/to/file   # 单文件 / 单测
cd vps-server && npm run lint
```

VPS 生产部署不是 `npm start`，而是 PM2 重载：`pm2 restart ecosystem.config.js`（日志写入 `/var/log/transcoder/`，HLS 输出 `/var/www/hls`，录制 `/var/www/recordings`）。

## 三层架构关键点

1. **前端只与 Workers 通信**——`yoyoapi.<domain>`。Workers 既是认证 / 业务网关，也是 HLS 分片缓存层；VPS 源站通过 Cloudflare Tunnel 暴露，不直接面向公网。`wrangler.toml` 中定义了三个 tunnel 子域：`TUNNEL_API_DOMAIN` / `TUNNEL_HLS_DOMAIN` / `TUNNEL_HEALTH_DOMAIN`。
2. **Worker 单文件主入口**：`cloudflare-worker/src/index.js` 直接路由所有请求，调用 `src/handlers/` 下的子模块（`simple-streams.js`、`proxyHandler.js`、`preloadHandler.js`、`recordHandler.js`、`channelConfigHandler.js`、`cloudDriveHandler.js`）。绑定 1 个 KV (`YOYO_USER_DB`) + 2 个 R2 桶 (`PROXY_TEST_HISTORY`、`LOGIN_LOGS`)。频道配置存 KV，**没有硬编码 CHANNELS**。
3. **VPS 是"按需 + 心跳保活"的无状态转码层**：核心是 `vps-server/src/services/SimpleStreamManager.js`——频道 ↔ FFmpeg 进程一对一映射，前端心跳维持，超时自动清理，RTMP 地址变更自动重启。配置不存 VPS，由 Worker/前端按需传入。其他重要 service 各管一块：`PreloadScheduler` / `RecordScheduler`（cron + 工作日 / 时段策略）、`VideoCleanupScheduler`（按保留期清理 `/var/www/recordings`）、`ProcessManager`（FFmpeg 生命周期）、`ChannelRouter` + `IntelligentRoutingManager`（双维度路由决策）、`upload-queue/` + `cloud-backup/` + `cloud-drive/`（中国移动云盘自动上传）。
4. **VPS 路由按"独立 try/catch 加载"**：`vps-server/src/app.js` 把每个 `src/routes/*.js` 单独包在 `try` 中，加载失败只记错不致命。新增路由时遵循同样模式，避免一个模块的错误把整个 API 拖垮。
5. **VPS 配置严格强校验**：`vps-server/config/index.js` 启动时校验必需环境变量（`VPS_BASE_URL` / `WORKERS_API_URL` / `VPS_API_KEY` / `HLS_OUTPUT_DIR` 等），缺失立即报错。不要给配置项写默认值，要保持显式。
6. **PM2 限制了内存**：`max_memory_restart: 500M`，且 node_args `--max-old-space-size=256`。在 VPS 端引入大对象 / 长缓存时要意识到这个上限。

## 前端要点

- Vue 3 + Vite + Element Plus + Pinia + vue-router + hls.js。Element Plus 通过 `unplugin-auto-import` / `unplugin-vue-components` 自动按需导入，**不要手动 `import { ElButton }`**。
- 路径别名：`@` → `frontend/src`。
- API 层在 `src/services/`（`api.js`、`streamingApi.js`、`proxyApi.js`、`userApi.js`），统一通过 `src/utils/axios.js` 配置，**不要绕过它直接 `axios.get`**。
- 视图入口：`src/views/{Login,Dashboard,AdminPanel,StreamingTest}.vue`。组件区分桌面 / 移动两套（`MobileOptimized*`）。
- 前端开发服务器代理：`/api` → `VITE_API_BASE_URL`（默认 `http://localhost:8787`，即本地 wrangler dev），`/hls` 同理。本地联调 Worker 时要先 `wrangler dev`。

## 临时脚本约定

`vps-server/scripts/_*-tmp.sh`、`scripts/_*` 是诊断 / 一次性运维脚本（git 里大量未跟踪 `_xxx-tmp.sh`），不属于产品代码。**不要把这些当成稳定接口或模板**——如果要加正式脚本，放在 `scripts/{deploy,test,fix,utils}/` 下并起规范命名。

## 文档位置

- 完整部署 / 故障排查文档在 `docs/`（中文）。
- 子项目自己的 README：`cloudflare-worker/README.部署配置说明.md`、`vps-server/README.md`、`frontend/CLOUDFLARE_PAGES_DEPLOYMENT.md`。
- 排查"为什么这么设计"时，`docs/` 下的 `SIMPLE_STREAMING_REDESIGN.md`、`DUAL_DIMENSION_ROUTING_FIX.md`、`COMPLETE_VIDEO_STREAMING_LOGIC.md` 是关键背景。

## 任务执行注意

- **修改三端的哪一端，就只在哪一端执行 lint/test/构建**——不要试图在根目录跑统一脚本。
- 修改前端 UI 后，使用 `mcp__chrome-devtools__*` 工具在浏览器中实际验证（用户全局规则要求）。
- 注释用中文；公开方法上方加方法说明注释；复杂逻辑加多行中文注释（用户全局规则）。
- 通过 SSH 操作 VPS 时必须带超时退出，避免会话卡死（用户全局规则）。
