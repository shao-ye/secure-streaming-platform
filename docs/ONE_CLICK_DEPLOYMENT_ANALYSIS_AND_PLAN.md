# YOYO 三端一键部署分析与方案（Cloudflare Pages + Cloudflare Workers + VPS）

> 文档目标：基于现有代码与部署脚本，设计“全栈一键部署”和“分端一键部署”两种方案，帮助小白用户最少操作完成上线与更新。
> 更新时间：2025-12-06

---

## 1. 现状盘点（代码与部署能力）

- **Cloudflare Pages（前端）**
  - 目录：`frontend/`（Vite + Vue3 + Element Plus + hls.js）
  - 构建脚本：`npm run build`（产物：`dist/`）
  - 文档：`docs/CLOUDFLARE_PAGES_DEPLOYMENT_GUIDE.md`
  - 环境变量（Pages 项目中配置）：`VITE_API_BASE_URL`、`VITE_WORKER_URL` 等
  - Pages 已支持 Monorepo：Root Directory = `frontend`，推送即可触发构建

- **Cloudflare Workers（业务层）**
  - 目录：`cloudflare-worker/`
  - 配置：`wrangler.toml`（含 `env.production`、KV/R2 绑定、域名路由、变量）
  - 部署：`npm run deploy` 或 `wrangler deploy --env production`
  - Secrets（需在 Dashboard 或 CLI 注入）：`VPS_API_KEY`、`EMERGENCY_ADMIN_PASSWORD`
  - 关键特性：`/tunnel-proxy/hls/...` 代理与分片缓存、KV 索引、R2 登录日志

- **VPS（转码与HLS服务）**
  - 目录：`vps-server/`（Express + FFmpeg + PM2 + Nginx + 可选 cloudflared）
  - 主进程：`src/app.js`，PM2 配置：`vps-server/ecosystem.config.js`
  - 环境配置：`.env`（参考 `.env.example`），严格校验见 `config/index.js`
  - “一键部署（远程）”脚本：`vps-server/scripts/vps-simple-deploy.sh`
    - 自愈式同步 `/tmp/github/secure-streaming-platform` → `/opt/yoyo-transcoder`
    - 校验依赖与关键文件、PM2 启停、健康检查
  - 端口与域名：推荐使用 Cloudflare Origin Rules 将 `443 → 52535`（见 Legacy 文档）

---

## 2. 目标定义

- 为小白用户提供：
  - 方案A：一条命令“全栈一键部署”（Pages + Workers + VPS 编排执行）
  - 方案B：三端各自“一键部署”（需要哪个发哪个）
- 包含：前置检查、Secrets/环境变更提示、自动验证、失败提示与回滚建议

---

## 3. 方案A：全栈一键部署（推荐，半自动可落地）

- 建议新增脚本（Windows 环境）：`scripts/one-click-deploy.ps1`
  - 前置条件
    - 本地已安装 Node.js（≥18）与 `npm`
    - 已安装 `wrangler` 且完成 `wrangler login`，或设置环境变量 `CLOUDFLARE_API_TOKEN`
    - Git 远程仓库已配置，Pages 项目已连接该仓库（Root=frontend）
    - 已准备 VPS SSH 免密（或密码）
  - 变量约定（在 PowerShell 脚本顶部声明并可从用户输入读取）
    - `CF_ACCOUNT_ID`（可选）
    - `CLOUDFLARE_API_TOKEN`（可选，非交互部署 Workers）
    - `VPS_HOST`、`VPS_USER`（如 `root`）、`VPS_SSH_KEY` 或 `VPS_PASSWORD`
    - `GIT_BRANCH`（默认 `main`/`master`，与 Pages 对齐）
  - 执行步骤（脚本内部顺序）
    1. Git 检查：提示确认“已 commit 并 push（或脚本可选自动 `git push`）”
    2. 部署 Workers：`wrangler deploy --env production`（如无登录则提示手工登录/设置 Token）
       - 若需要设置 Secrets：提示执行 `wrangler secret put VPS_API_KEY` 等；或从本地安全变量管道注入
    3. 远程部署 VPS：`ssh` 执行 `vps-server/scripts/vps-simple-deploy.sh`
    4. 触发 Pages 构建：通常 Git Push 已触发；如需立即触发，可调用 Cloudflare Pages API（可选）
    5. 验证：并行探测
       - `https://yoyoapi.你的域名/health`（Workers）
       - `https://yoyo-vps.你的域名/health`（VPS 经 Origin Rules）
       - `https://yoyoapi.你的域名/tunnel-proxy/test`（Workers 隧道代理）
    6. 结果汇总：成功/失败项、下一步建议
  - 回滚策略（简化版）
    - Workers：`wrangler` 支持重新部署上一个 commit（脚本给出命令提示）
    - Pages：在 Dashboard 中一键回滚到上次成功构建
    - VPS：当前脚本已保留 `src.backup` 替换逻辑，建议增强为“Release 目录 + 符号链接”以支持快速回滚

> 说明：完全无交互的 Secrets 注入需用户本地已安全配置变量。对小白用户，更安全的做法是在第一次运行时给出清单并跳转到 Cloudflare Dashboard 页面手动设置，脚本仅校验与提示。

---

## 4. 方案B：分端一键部署（就地可用）

- **Workers 一键（本地）**
  - 直接使用现有脚本：`cd cloudflare-worker && npm run deploy` 或 `wrangler deploy --env production`
  - 首次部署前在 Dashboard 设置 Secrets：`VPS_API_KEY`、`EMERGENCY_ADMIN_PASSWORD`
  - 检查 `wrangler.toml` 中的 `KV/R2` 绑定是否与账号资源匹配（新账号需替换 ID 与 bucket）

- **VPS 一键（远程）**
  - 已提供脚本：
    ```bash
    ssh root@你的VPS "cd /tmp/github/secure-streaming-platform/vps-server && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"
    ```
  - 该脚本会：修复/克隆仓库 → 同步到 `/opt/yoyo-transcoder` → 校验依赖 → PM2 启停 → 健康检查
  - VPS 必需环境：`Node.js ≥18`、`npm`、`ffmpeg`、`pm2`、（可选）`cloudflared`、Nginx 已配置 52535 端口

- **Pages 一键（云端）**
  - Git 推送即自动构建（Monorepo Root=frontend）
  - 在 Pages 项目中配置环境变量：
    - `VITE_API_BASE_URL=https://yoyoapi.你的域名`
    - `VITE_WORKER_URL=https://yoyoapi.你的域名`
    - 其他 `VITE_` 变量按 `docs/CLOUDFLARE_PAGES_DEPLOYMENT_GUIDE.md`

---

## 5. 关键配置与密钥清单（一次性准备）

- **Cloudflare Workers（wrangler.toml 已示例）**
  - `env.production.vars`：`FRONTEND_DOMAIN`、`PAGES_DOMAIN`、`WORKER_DOMAIN`、`VPS_API_URL`、`TUNNEL_*`
  - Secrets（Dashboard/CLI）：`VPS_API_KEY`、`EMERGENCY_ADMIN_PASSWORD`
  - 资源绑定：
    - KV：`YOYO_USER_DB`（新账号需在 Dashboard 或 `wrangler kv namespace create` 创建后写入 ID）
    - R2：`PROXY_TEST_HISTORY`、`LOGIN_LOGS`（新账号需 `wrangler r2 bucket create`）

- **VPS（`.env`，严格校验）**
  - 必填：`PORT`、`NODE_ENV`、`VPS_BASE_URL`、`WORKERS_API_URL`、`VPS_API_KEY`、`HLS_OUTPUT_DIR`、`LOG_DIR`
  - 可选：`TUNNEL_BASE_URL`、`SOCKS5_PORT`、`HOLIDAY_API_URL` 等

- **DNS 与 Origin Rules**（直连模式强烈建议）
  - `yoyo-vps.你的域名`：A 记录（橙色云，启用代理）
  - Origin Rules：将 `443 → 52535` 转发到 VPS Nginx（参考 Legacy 文档现成示例）

- **Cloudflare Tunnel（可选）**
  - PM2 中可托管 `cloudflared`（见根目录 `ecosystem.config.js` 示例）；用于中国用户优化的隧道域名

---

## 6. 验证与故障排查清单

- Workers
  - `GET https://yoyoapi.你的域名/health` → 200 + 版本信息
  - `GET https://yoyoapi.你的域名/tunnel-proxy/test` → 成功提示

- VPS
  - `GET https://yoyo-vps.你的域名/health`（经 Origin Rules）→ 200
  - `GET https://yoyo-vps.你的域名/hls/<channelId>/playlist.m3u8` → 返回 m3u8

- Pages
  - 打开 `https://yoyo.你的域名`，登录、频道列表、播放是否正常

- 常见问题
  - 502/404：检查 DNS 橙色云、Origin Rules、Nginx/PM2 进程、`.env` 必填项
  - HLS 卡顿：确认 Workers 分片缓存路由 `/tunnel-proxy/hls/...` 命中、VPS 带宽/CPU
  - KV/R2 报错：检查绑定 ID 与 Bucket 名称

---

## 7. CI/CD 增强建议（可选）

- Workers：GitHub Actions 使用 `wrangler-action`，以 `CLOUDFLARE_API_TOKEN` 非交互部署
- Pages：保持 Git Push 触发构建
- VPS：GitHub Actions 通过 `ssh + scp` 或直接远程执行 `vps-simple-deploy.sh`（需注意密钥安全）
- 版本发布：建议增加 `release` 目录结构与 `current` 符号链接，支持 VPS 快速回滚

---

## 8. 最小落地路径（建议）

1) 先用现有“分端一键”：
   - Workers：`wrangler deploy --env production`
   - VPS：远程执行 `vps-simple-deploy.sh`
   - Pages：推送前端代码触发构建
2) 确认稳定后，再新增 `scripts/one-click-deploy.ps1` 将三步编排在一起（半自动提示 Secrets 与登录）。

---

## 9. 附：命令参考（可直接使用）

- Workers 部署（本地）
```bash
cd cloudflare-worker
npx wrangler deploy --env production
# 首次：wrangler secret put VPS_API_KEY / EMERGENCY_ADMIN_PASSWORD
```

- VPS 部署（远程）
```bash
ssh root@<你的VPS IP或域名> "cd /tmp/github/secure-streaming-platform/vps-server && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"
```

- Pages 构建触发
```bash
git add -A && git commit -m "deploy: pages" && git push origin <主分支>
# Pages 项目 Root=frontend，推送后自动构建
```

---

## 10. 结论

- 代码仓内已具备“分端一键部署”的所有必要条件：Workers（wrangler）、VPS（自愈脚本）、Pages（Push触发）。
- 建议通过新增一个 PowerShell 编排脚本实现“全栈一键部署”，对小白用户更友好；脚本以“前置提示 + 自动化执行 + 结果汇总”为主，Secrets 仍建议首次手动配置后长期复用。
