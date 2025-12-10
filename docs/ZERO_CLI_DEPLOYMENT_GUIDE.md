# 零命令行部署指南（Cloudflare 控制台 + VPS 一键命令）

> 面向小白用户：不在本地安装 wrangler / Node / Git，不写任何命令。本指南只在 Cloudflare 控制台点点配置；在 VPS 上仅执行一条（或两条）命令。
> 更新时间：2025-12-06

---

## 一、总体目标

- 前端（Cloudflare Pages）：在 Cloudflare 控制台连接仓库、配置环境变量，自动构建部署。
- 业务层（Cloudflare Workers）：在 Cloudflare 控制台完成项目连接/配置（无需本地 wrangler），在 UI 中配置变量、Secrets、KV/R2 绑定。
- 转码层（VPS）：登录 VPS 执行一条命令，自动安装运行环境 + 拉仓库 + 同步代码 + PM2 启停 + 健康校验。

---

## 二、Cloudflare 控制台配置（全程点点点）

### 1）域名与 DNS（一次性）
- 确保你的域名已经接入 Cloudflare。
- A 记录：
  - `yoyo.你的域名` → 前端 Pages 自定义域名
  - `yoyoapi.你的域名` → Workers 自定义域名
  - `yoyo-vps.你的域名` → 指向 VPS IP，开启橙色云（代理）
- Origin Rules（推荐，直连模式）：
  - 规则名：`yoyo-vps-api`
  - 主机名等于：`yoyo-vps.你的域名`
  - 动作：覆盖源端口 → 52535（将 443 → 52535）

### 2）前端：Cloudflare Pages（连接仓库，自动构建）
- 进入 Cloudflare 控制台 → Workers & Pages → Pages → Create project → Connect to Git。
- 选择你的代码仓库与分支。
- Build 配置：
  - Root directory：`frontend`
  - Build command：`npm run build`
  - Build output directory：`dist`
  - Node.js version：`18`（或 Cloudflare 默认）
- 环境变量（Environment variables → Production）：
  - `VITE_API_BASE_URL=https://yoyoapi.你的域名`
  - `VITE_WORKER_URL=https://yoyoapi.你的域名`
  - `VITE_APP_TITLE=YOYO流媒体平台`
  - `VITE_ENVIRONMENT=production`
  - 其余参考：`docs/CLOUDFLARE_PAGES_DEPLOYMENT_GUIDE.md`
- 自定义域名：添加 `yoyo.你的域名`。

### 3）业务层：Cloudflare Workers（无需本地 wrangler）
- 方式A（推荐，若你的账户入口可见）：
  - 控制台 → Workers & Pages → Create application → 选择 Worker → Connect to Git。
  - 选择你的仓库与分支。
  - Working directory（或 Project path）：`cloudflare-worker`
  - 构建：如控制台支持“使用 wrangler.toml / 自动构建”，直接保存；
    - 若需自定义命令，可设置：`npm ci && npm run deploy:production`（Cloudflare 后台执行，不依赖你的本地）
- 方式B（若 A 不可用）：
  - 仍在 Cloudflare 控制台创建 Worker 应用；
  - 使用“Workflows（Beta）/ Integrations”或绑定 GitHub App 的方式，让 Cloudflare 后台执行构建与部署；
  - 如仍无该能力，采用 GitHub Web 界面添加官方 `wrangler-action` 工作流（全程网页点选，无需本地工具）。

- Worker 环境配置（Workers → Settings）：
  - Variables（env.vars）：
    - `FRONTEND_DOMAIN=https://yoyo.你的域名`
    - `PAGES_DOMAIN=https://<你的pages项目>.pages.dev`
    - `WORKER_DOMAIN=https://yoyoapi.你的域名`
    - `VPS_API_URL=https://yoyo-vps.你的域名`
    - （如使用隧道）`TUNNEL_API_DOMAIN` / `TUNNEL_HLS_DOMAIN` / `TUNNEL_HEALTH_DOMAIN`
  - Secrets：
    - `VPS_API_KEY`（与 VPS `.env` 中一致）
    - `EMERGENCY_ADMIN_PASSWORD`
    - `INIT_SECRET`（用于初始化路由安全校验）
  - KV 绑定：
    - `YOYO_USER_DB` → 选择或新建命名空间（仅在 Dashboard 绑定即可；仓库 wrangler.toml 已最小化，不需要填写ID）
  - R2 绑定：
    - `PROXY_TEST_HISTORY` → `proxy-test-history`
    - `LOGIN_LOGS` → `yoyo-login-logs`

> 说明：本仓库已将 `cloudflare-worker/wrangler.toml` 最小化，不再硬编码域名/路由/KV/R2/变量。小白用户无需修改仓库文件，全部在 Cloudflare Dashboard 完成绑定与变量/Secrets 配置。

### 4）初始化（一次浏览器操作）
- 目的：像 cloud-mail 一样，一次初始化即创建 KV 索引、管理员、默认配置，幂等可重复
- 操作方式（二选一）：
  - 简单方式：打开 `https://yoyoapi.你的域名/api/admin/init/你的INIT_SECRET`
  - 更安全：打开 `https://yoyoapi.你的域名/api/admin/init` 并添加请求头 `X-Init-Secret: 你的INIT_SECRET`
- 预期返回：`{"status":"success", "data": { "executed": [...] }}`。重复执行不会报错（幂等）。

---

## 三、VPS：一条命令完成安装 + 部署

适配系统：CentOS 9 / RHEL 9（脚本基于 dnf）。

- 以 root 登录 VPS 后，执行：

```bash
curl -fsSL https://raw.githubusercontent.com/shao-ye/secure-streaming-platform/main/vps-server/scripts/setup-vps.sh | bash && bash -lc 'cd /tmp/github/secure-streaming-platform/vps-server && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh'
```

脚本说明：
- 第1段：`setup-vps.sh` 自动安装 Node.js 18 / FFmpeg / Nginx / PM2，创建目录与优化系统。
- 第2段：`vps-simple-deploy.sh` 自动克隆/修复仓库、同步代码到 `/opt/yoyo-transcoder`、校验依赖、PM2 启停、健康检查。
- `.env` 未填写时，基础服务仍可运行；建议后续在 `/opt/yoyo-transcoder/.env` 填写 `VPS_API_KEY`、`HLS_OUTPUT_DIR`、`LOG_DIR` 等（参考 `.env.example`）。

> 若你的 VPS 不是 CentOS/RHEL 9，请告知系统版本，我会补充对应安装脚本（Ubuntu/Debian）。

---

## 四、部署验证（无本地工具）

- Workers：
  - `https://yoyoapi.你的域名/health` 应返回 JSON 状态与版本
  - `https://yoyoapi.你的域名/tunnel-proxy/test` 返回成功提示
  - `https://yoyoapi.你的域名/api/admin/init/<INIT_SECRET>` 首次执行返回 success，重复执行仍 success（幂等）
- VPS：
  - `https://yoyo-vps.你的域名/health`（经 Origin Rules → 52535）
  - `https://yoyo-vps.你的域名/hls/<channelId>/playlist.m3u8` 可获取播放列表
- Pages：
  - `https://yoyo.你的域名` 访问主页、登录与播放功能是否正常

---

## 五、常见问题（FAQ）

- Workers 构建入口没有“Connect to Git”？
  - 使用 Cloudflare “Workflows（Beta）/ Integrations”入口；或采用 GitHub 网页添加官方 `wrangler-action`，依然不需要本地安装 wrangler。
- 访问 `yoyo-vps.你的域名/health` 失败？
  - 检查：DNS 为橙色云；Origin Rules 443 → 52535；VPS 上 Nginx/PM2 进程正常。
- `.ts` 分片缓慢或卡顿？
  - 确认前端播放 URL 为 Workers 代理路由（`/tunnel-proxy/hls/...`），并检查 Workers 缓存命中；VPS 带宽/CPU 是否正常。
- KV/R2 报错？
  - 检查 Workers 的绑定是否与控制台资源一致（命名空间 ID、Bucket 名称正确）。

---

## 六、零命令行方案总结

- Cloudflare 控制台完成 Pages 与 Workers 的全部配置与部署；
- VPS 仅需登录执行“一条命令”完成安装与上线；
- 全程不在本地安装 wrangler/Node/Git，后续更新只需：
  - 推送代码 → Cloudflare 后台自动部署（Pages/Workers）；
  - VPS 侧如需更新，重复执行 `vps-simple-deploy.sh`（远程一条命令）。
