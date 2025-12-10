# 硬编码清理策略与实施计划

**生成日期**: 2025-11-09  
**背景**: 开源准备 - 敏感信息清理

---

## 📊 硬编码分布与清理状态

### 已完成清理 ✅

| 区域 | 文件数 | 清理日期 | 状态 |
|------|--------|----------|------|
| 前端运行时代码 | 4个 | 2025-11-03 | ✅ 完成 |
| - api.js | 1 | 2025-11-03 | ✅ 使用config |
| - streamingApi.js | 1 | 2025-11-03 | ✅ 修复环境变量 |
| - axios.js | 1 | 2025-11-03 | ✅ 移除硬编码 |
| - VideoPlayer.vue | 1 | 2025-11-03 | ✅ 动态获取 |

**影响**: 前端应用运行时已无硬编码，可通过环境变量配置

---

### 待清理内容 ❌

| 类型 | 匹配数 | VPS IP | 域名 | 优先级 | 影响 |
|------|--------|--------|------|--------|------|
| 📄 文档文件 | ~120 | ~40 | ~100 | 🔴 高 | 开源安全 |
| 🔧 脚本文件 | ~25 | ~8 | ~30 | 🟡 中 | 运维便利 |
| ⚙️ 配置文件 | ~5 | ~2 | ~10 | 🔴 高 | 功能性 |
| 📦 备份归档 | ~20 | - | ~15 | 🟢 低 | 可删除 |

---

## 🎯 分层清理策略

### 第1层：核心配置文件 🔴 高优先级

**必须立即清理** - 影响功能和安全

#### 1.1 Cloudflare Workers配置

**文件**: `cloudflare-worker/wrangler.toml`

```toml
# 当前硬编码（7处）
[env.production]
name = "yoyo-streaming-worker-production"
vars = { 
  VPS_API_URL = "https://yoyo-vps.your-domain.com"  # ❌ 硬编码
}

# 修复方案
[env.production]
name = "yoyo-streaming-worker-production"
# 移除硬编码，使用Cloudflare Dashboard配置环境变量
# 或在wrangler.toml.example中提供示例
```

**创建**: `cloudflare-worker/wrangler.toml.example`
```toml
name = "your-worker-name"

[env.production]
name = "your-worker-name-production"

[[env.production.kv_namespaces]]
binding = "YOYO_USER_DB"
id = "your-kv-namespace-id"

[[env.production.r2_buckets]]
binding = "VIDEO_STORAGE"
bucket_name = "your-r2-bucket-name"

# 环境变量请在Cloudflare Dashboard设置：
# - VPS_API_URL: https://your-vps-domain.example.com
# - VPS_API_KEY: your-secure-api-key
# - ADMIN_PASSWORD: your-admin-password
```

#### 1.2 Cloudflare Tunnel配置

**文件**: `config/tunnel-config.yml`

```yaml
# 当前硬编码（6处）
ingress:
  - hostname: yoyo-vps.your-domain.com  # ❌
    service: http://localhost:3000
  - hostname: yoyo.your-domain.com      # ❌
    service: http://localhost:8080

# 修复方案 - 创建示例文件
```

**创建**: `config/tunnel-config.yml.example`
```yaml
tunnel: your-tunnel-id
credentials-file: /root/.cloudflared/your-tunnel-id.json

ingress:
  - hostname: vps-api.example.com
    service: http://localhost:3000
    originRequest:
      noTLSVerify: false
  
  - hostname: frontend.example.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: false
  
  - service: http_status:404
```

#### 1.3 VPS环境配置

**创建**: `vps-server/.env.example`
```bash
# VPS API配置
NODE_ENV=production
PORT=3000
API_KEY=your-secure-api-key-here

# 视频存储
VIDEO_STORAGE_PATH=/opt/videos
HLS_OUTPUT_PATH=/opt/hls

# Cloudflare配置
CLOUDFLARE_ACCOUNT_ID=your-account-id
R2_BUCKET_NAME=your-video-storage-bucket

# 代理配置（可选）
PROXY_ENABLED=false
```

---

### 第2层：文档文件 🟡 中优先级

**需要清理** - 开源安全

#### 2.1 文档清理原则

- **教程类文档**: 使用`example.com`替换真实域名
- **架构文档**: 使用变量占位符 `${VPS_DOMAIN}`
- **调试文档**: 可保留部分示例，但添加警告
- **遗留文档**: 移动到`docs/archive/`

#### 2.2 批量替换规则

```bash
# VPS IP地址
<VPS_IP> → your-vps-ip.example.com
或 → ${VPS_IP}

# 域名
yoyo.your-domain.com → frontend.example.com
yoyoapi.your-domain.com → api.example.com
yoyo-vps.your-domain.com → vps.example.com

# API密钥
85da076ae24b028b3d1ea1884e6b13c5afe34xxx → ${VPS_API_KEY}
```

#### 2.3 需要清理的核心文档

**高优先级**（影响用户理解）：
- `README.md` - 项目首页
- `docs/QUICK_START.md` - 快速开始（需创建）
- `DEPLOYMENT_GUIDE.md` - 部署指南
- `docs/API_DOCUMENTATION.md` - API文档（需创建）

**中优先级**（技术文档）：
- `docs/project/ARCHITECTURE_V2.md`
- `docs/project/USER_GUIDE.md`
- `docs/project/OPERATIONS_GUIDE.md`

**低优先级**（历史记录）：
- `VERSION_HISTORY.md`
- `docs/project/*_IMPLEMENTATION.md`
- `docs/project/*_FIX.md`

---

### 第3层：脚本文件 🟢 低优先级

**建议清理** - 运维便利

#### 3.1 脚本清理策略

**选项A**: 参数化（推荐）
```powershell
# 修复前
$VPS_IP = "<VPS_IP>"  # ❌ 硬编码
$API_URL = "https://yoyoapi.your-domain.com"

# 修复后
param(
    [string]$VPS_IP = "your-vps-ip",
    [string]$API_URL = "https://your-api-domain.example.com"
)
```

**选项B**: 环境变量
```bash
# 修复前
VPS_IP="<VPS_IP>"  # ❌ 硬编码

# 修复后
VPS_IP="${VPS_IP:-your-vps-ip.example.com}"  # 从环境变量读取
```

**选项C**: 配置文件
```powershell
# 修复前
$config = @{
    VPS_IP = "<VPS_IP>"
}

# 修复后
$config = Get-Content "config.json" | ConvertFrom-Json
```

#### 3.2 脚本清理范围

**必须清理**（用户会使用）：
- `scripts/deploy/deploy-simple.ps1` - 简化部署脚本
- 部署相关的主要脚本

**建议清理**（调试工具）：
- `scripts/test/*.ps1` - 测试脚本
- `scripts/utils/*.ps1` - 工具脚本

**可以保留**（仅供参考）：
- `scripts/vps-legacy/*.sh` - 遗留脚本（移动到legacy文件夹）

---

### 第4层：备份和归档 🟢 低优先级

**建议删除** - 不应提交到开源仓库

#### 4.1 应删除的目录

```
backups/                    # 代码备份 - 删除
├── recovery_20251030_*/   
├── segment_20251029_*/
└── video_aspect_*/

archive/                    # 归档文件 - 删除
├── vps-backups/
└── *-vps-legacy

*.b64                      # Base64文件 - 删除
*.png (非必要)              # 临时截图 - 删除
cloud-cookies*.json        # Cookie文件 - 删除
```

#### 4.2 .gitignore 增强

```gitignore
# 敏感信息
.env
.env.local
*.key
*.pem
*-cookies.json

# 临时文件
backups/
archive/
*.b64
*.tmp

# 遗留代码
*_v2.js
*-legacy.*
```

---

## 🚀 实施计划

### 阶段1: 紧急清理（今天，2小时）⚡

**目标**: 确保核心配置可用

- [ ] 创建 `wrangler.toml.example`
- [ ] 创建 `tunnel-config.yml.example`
- [ ] 创建 `vps-server/.env.example`
- [ ] 移除 `wrangler.toml` 和 `tunnel-config.yml` 中的硬编码
- [ ] 更新 `.gitignore` 忽略真实配置文件

### 阶段2: 文档清理（明天，4小时）📄

**目标**: 文档可安全开源

- [ ] 批量替换文档中的IP地址（~40处）
- [ ] 批量替换文档中的域名（~100处）
- [ ] 批量替换文档中的API密钥（~15处）
- [ ] 创建清理脚本 `scripts/utils/sanitize-for-opensource.sh`

### 阶段3: 脚本优化（后天，3小时）🔧

**目标**: 脚本可参数化配置

- [ ] 参数化部署脚本（5个核心脚本）
- [ ] 添加配置文件支持
- [ ] 更新脚本使用文档

### 阶段4: 清理验证（第4天，1小时）✅

**目标**: 确保无遗漏

- [ ] 运行 `grep` 搜索验证
- [ ] 测试配置文件示例可用性
- [ ] 检查 `.gitignore` 有效性

---

## 🔍 清理验证脚本

### 检测硬编码脚本

**创建**: `scripts/utils/check-hardcoded.sh`

```bash
#!/bin/bash

echo "🔍 检查硬编码敏感信息..."
echo ""

# 检查VPS IP
echo "1️⃣ 检查VPS IP (<VPS_IP>):"
grep -r "142\.171\.75\.220" \
  --exclude-dir={node_modules,.git,backups,archive} \
  --exclude="*.{md,log}" \
  . | wc -l

# 检查域名
echo "2️⃣ 检查域名 (your-domain.com):"
grep -r "5202021\.xyz" \
  --exclude-dir={node_modules,.git,backups,archive} \
  --exclude="*.{md,log}" \
  . | wc -l

# 检查API密钥
echo "3️⃣ 检查API密钥模式:"
grep -rE "[0-9a-f]{32,}" \
  --exclude-dir={node_modules,.git,backups,archive} \
  --exclude="*.{md,log}" \
  . | grep -v "example" | wc -l

echo ""
echo "✅ 检查完成！运行时代码应该为0匹配"
```

---

## 📊 预期结果

### 清理前
```
VPS IP (<VPS_IP>): 50个文件
域名 (your-domain.com): 150个文件
API密钥: 15个文件
```

### 清理后（阶段1）
```
运行时代码: 0个文件 ✅
配置文件（真实）: 0个文件（已gitignore）✅
配置文件（示例）: 3个文件 ✅
文档: ~120个文件（待清理）
脚本: ~25个文件（待清理）
```

### 清理后（阶段2-3）
```
运行时代码: 0个文件 ✅
配置文件: 仅示例文件 ✅
文档: 使用示例域名 ✅
脚本: 参数化配置 ✅
```

---

## 💡 最佳实践

### 1. 永远不要提交真实配置

```bash
# .gitignore 必须包含
wrangler.toml           # 真实Workers配置
tunnel-config.yml       # 真实Tunnel配置
.env                    # 环境变量
*.key                   # 密钥文件
```

### 2. 使用示例文件

```bash
# 提交到仓库的应该是
wrangler.toml.example
tunnel-config.yml.example
.env.example
```

### 3. 文档使用占位符

```markdown
# ❌ 不要这样
ssh root@<VPS_IP>

# ✅ 应该这样
ssh root@${VPS_IP}
或
ssh root@your-vps-ip.example.com
```

---

## ✅ 验证清单

清理完成后，运行以下检查：

- [ ] `grep -r "<VPS_IP>" --exclude-dir={node_modules,.git} .` 返回0（仅文档外）
- [ ] `grep -r "your-domain.com" --exclude-dir={node_modules,.git} .` 返回0（仅文档外）
- [ ] 所有 `.toml`, `.yml`, `.env` 文件都在 `.gitignore` 中
- [ ] 所有配置文件都有对应的 `.example` 文件
- [ ] 文档使用 `example.com` 或变量占位符
- [ ] 脚本支持参数或环境变量配置

---

**创建日期**: 2025-11-09  
**预计完成**: 2025-11-13 (4天)  
**责任人**: 开发团队
