# 小白一键部署分步执行计划（Cloudflare Pages + Workers + VPS）

> 目标：零本地工具（不安装 wrangler/Node/Git）。仅在 Cloudflare 控制台点点配置 + VPS 执行“一条命令” + 浏览器访问一次初始化，即可完成上线。
> 更新时间：2025-12-06

---

## 0. 基线确认（输入与资源）

- 域名与子域
  - 前端：`yoyo.<你的域名>`（Pages 自定义域名）
  - API：`yoyoapi.<你的域名>`（Workers 自定义域名）
  - VPS：`yoyo-vps.<你的域名>`（A 记录指向 VPS，橙色云）
- 仓库与分支：`main` 或 `master`（与 Cloudflare 项目设置一致）
- Cloudflare 资源
  - KV 命名空间：与仓库 wrangler.toml 保持一致
  - R2 桶：`proxy-test-history`、`yoyo-login-logs`（示例）
- VPS 系统：CentOS/RHEL 9（现成脚本）或 Ubuntu/Debian（可选新增脚本）
- 交付物：基线清单（以上参数确认表）

---

## 1. Cloudflare Pages（UI 配置）

- 是否需要项目优化：否（已兼容 Pages 默认构建）
- 如何优化（若你要自定义）：可在 `frontend/vite.config.*` 中调整 `base`，但当前无需修改
- Cloudflare UI 配置步骤：
  - 控制台 → Workers & Pages → Pages → Create project → Connect to Git
  - Build 配置：Root=`frontend`，Build=`npm run build`，Output=`dist`，Node=`18`
  - 生产环境变量：
    - `VITE_API_BASE_URL=https://yoyoapi.<你的域名>`
    - `VITE_WORKER_URL=https://yoyoapi.<你的域名>`
    - 其余参考：`docs/CLOUDFLARE_PAGES_DEPLOYMENT_GUIDE.md`
  - 自定义域名：绑定 `yoyo.<你的域名>`
- 完成判定与验收：
  - Pages 构建成功并可通过 `yoyo.<你的域名>` 打开首页
  - 无需 API 即可看到静态页面（API 连通性后续步骤中验证）

---

## 2. Cloudflare Workers（UI 配置）

- 是否需要项目优化：否（已兼容零本地工具部署）
- 如何优化（若你要自定义）：可在 `cloudflare-worker/wrangler.toml` 的 env.vars 中调整展示域名；默认可用
- Cloudflare UI 配置步骤：
  - 控制台 → Workers & Pages → Create application → 选择 Worker → Connect to Git（Working directory=`cloudflare-worker`）
    - 若“连接仓库”入口不可用：采用 GitHub Actions（网页点选官方 wrangler-action），仍零本地工具
  - 绑定资源：
    - KV 命名空间：`YOYO_USER_DB`
    - R2 桶（可选）：`proxy-test-history`、`yoyo-login-logs`
  - Variables：
    - `FRONTEND_DOMAIN=https://yoyo.<你的域名>`
    - `WORKER_DOMAIN=https://yoyoapi.<你的域名>`
    - `VPS_API_URL=https://yoyo-vps.<你的域名>`
    - 可选 `TUNNEL_*`（使用隧道时）
  - Secrets：
    - `VPS_API_KEY`
    - `EMERGENCY_ADMIN_PASSWORD`
    - `INIT_SECRET`（用于初始化路由校验）
- 完成判定与验收：
  - `https://yoyoapi.<你的域名>/health` 返回 200

---

## 3. 初始化路由设计评审

- 是否需要项目优化：是（新增初始化端点）
- 如何优化（项目改动）：
  - 在 `cloudflare-worker/src/index.js` 增加 `GET /api/admin/init` 与 `GET /api/admin/init/:secret`（已实现）
  - 校验 `INIT_SECRET`，幂等创建索引/管理员/默认配置，写入 `system:version` 和 `system:init_done`
- Cloudflare UI 配置步骤：
  - 在 Workers → Settings → Secrets 增加 `INIT_SECRET`
- 完成判定与验收：
  - 通过浏览器访问（见阶段4），返回 `status=success`，重复访问不报错

---

## 4. 初始化路由实现（Workers）

- 是否需要项目优化：已完成（本仓库已实现）
- 如何优化（实现要点）：
  - 校验 `INIT_SECRET`（URL 或 Header）
  - 幂等：存在即跳过；失败仅记录日志不中断其他步骤
  - 写入系统标记：`system:init_done=true`、`system:version=<env.VERSION>`
- Cloudflare UI 配置步骤（执行初始化）：
  - 方式一（简单，适合小白）：浏览器访问 `https://yoyoapi.<你的域名>/api/admin/init/<INIT_SECRET>`
  - 方式二（更安全）：访问 `https://yoyoapi.<你的域名>/api/admin/init`，并在请求头加入 `X-Init-Secret: <INIT_SECRET>`（需用 Postman 等工具）
- 完成判定与验收：
  - 返回 `status=success`，`executed` 数组中包含 `...: created` 或 `...: exists`
  - 再次访问返回“系统已初始化”或继续幂等执行，不覆盖历史数据

---

## 5. 初始化联调与自测

- 是否需要项目优化：否
- 如何优化（若异常）：根据返回 `executed` 项定位失败模块（索引/管理员/R2）；可加 `?force=true` 重跑
- Cloudflare UI 配置步骤：无（仅浏览器触发）
- 完成判定与验收：
  - 首次与重复访问均成功
  - 前端可拉到频道列表、播放 `.m3u8/.ts` 通过 Workers 代理

---

## 6. VPS 一键安装/部署

- 适配系统：CentOS/RHEL 9（现成）；Ubuntu/Debian（可选新增）
- 一条命令（示例）
  - CentOS/RHEL9：
    ```bash
    curl -fsSL https://raw.githubusercontent.com/shao-ye/secure-streaming-platform/main/vps-server/scripts/setup-vps.sh | bash \
      && bash -lc 'cd /tmp/github/secure-streaming-platform/vps-server && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh'
    ```
  - 如默认分支为 master，将 URL 中的 `main` 改为 `master`
- `.env`：按 `vps-server/.env.example` 填写关键项（`VPS_API_KEY` 与 Workers Secrets 一致）
- 验收：`https://yoyo-vps.<你的域名>/health` 返回 200

---

## 7. DNS 与 Origin Rules（建议）

- 是否需要项目优化：否
- 如何优化（可选）：若使用 Tunnel，在 `tunnel_config` 中开启（Workers 已提供 API）
- Cloudflare UI 配置步骤：
  - DNS：`yoyo-vps.<你的域名>` 橙色云（代理）
  - Origin Rules：主机名匹配 `yoyo-vps.<你的域名>` → 覆写源端口 52535（将443→52535）
- 完成判定与验收：
  - 通过 443 访问 `https://yoyo-vps.<你的域名>/health` 与 HLS 资源成功

---

## 8. 文档更新

- 在 `docs/ZERO_CLI_DEPLOYMENT_GUIDE.md` 增补“访问 init 完成初始化”的步骤
- 增补 FAQ：
  - Workers 连接仓库入口不可用 → 用 GitHub Actions（wrangler-action）
  - URL secret 泄露风险 → 建议使用 Header 模式，初始化完成后禁用 URL 模式
  - KV/R2 绑定错误 → 对照命名空间 ID 与桶名
- 验收：文档审核通过

---

## 9. 端到端验收（E2E）

- Pages：主页与登录可用，静态资源正常
- Workers：`/health`、`/tunnel-proxy/hls/...` 正常，`.ts` 分片缓存命中
- VPS：HLS 清单与分片可经 443 访问（Origin Rules）、PM2 进程健康
- 初始化路由：已完成，重复访问幂等
- 结论：完成本文档所有步骤后，Cloudflare 侧（Pages + Workers）配置部署即完成；VPS 侧执行“一条命令”上线后，全链路可用

---

## 风险与缓解

- Workers 无法“Connect to Git”
  - 缓解：采用 GitHub Actions（官方 wrangler-action），全程网页配置
- secret 泄露风险
  - 缓解：优先 Header 模式；初始化成功后禁用 URL 模式或仅允许 `?force=true` 且需二次校验
- KV 配额与 list 限制
  - 缓解：使用索引键 + get/put，避免 list；迁移脚本幂等与分批

---

## 里程碑

- M1：完成初始化路由（阶段4）
- M2：VPS 一条命令上线（阶段6）
- M3：E2E 全链路通过（阶段9）

---

## 参考文档

- 《零命令行部署指南》：`docs/ZERO_CLI_DEPLOYMENT_GUIDE.md`
- 《一键部署分析与方案》：`docs/ONE_CLICK_DEPLOYMENT_ANALYSIS_AND_PLAN.md`
