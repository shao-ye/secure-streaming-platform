# YOYO流媒体平台 - 运维与开发指南

> **实用手册** - 专注于日常开发、部署和运维操作  
> **更新时间**: 2025-10-24  
> **文档版本**: v1.0

---

## 📋 目录

- [快速部署](#-快速部署)
- [开发注意事项](#-开发注意事项)
- [常用脚本工具](#-常用脚本工具)
- [问题排查指南](#-问题排查指南)
- [代码质量标准](#-代码质量标准)

---

## 🚀 快速部署

### 完整部署流程（推荐）

**正确的部署顺序** ⭐：

```bash
# 步骤1：提交代码到Git（必须先执行！）
git add .
git commit -m "描述本次更新内容"
git push origin master

# 步骤2：部署Cloudflare Workers
cd cloudflare-worker
npx wrangler deploy --env production

# 步骤3：部署VPS（一键部署脚本）
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"

# 步骤4：前端自动部署
# git push 已触发Cloudflare Pages自动部署，无需额外操作
```

### VPS一键部署命令（记住这条）

```bash
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"
```

**自动完成**:
- ✅ Git检查和修复
- ✅ 代码同步
- ✅ 环境配置
- ✅ 服务重启
- ✅ 健康验证

### 部署注意事项 ⚠️

1. **必须先 git push**: VPS部署脚本会从Git仓库拉取最新代码
2. **部署顺序**: Workers → VPS → 验证（前端自动）
3. **Git仓库损坏**: 脚本会自动检测并修复

---

## 💻 开发注意事项

### 开发基本规则

#### 1. 语言规范
- ✅ **请始终使用中文回答**: 所有文档、注释、日志信息均使用中文

#### 2. 调试与部署规范

**⚠️ 注意特定命令的退出点**:
- 使用 `pm2 logs` 命令时必须带上限制参数，否则会卡死对话
- ❌ 错误: `pm2 logs vps-transcoder-api` (会持续等待)
- ✅ 正确: `pm2 logs vps-transcoder-api --lines 20 --nostream`

**⚠️ 避免SSH双重嵌套命令**:
- 双重嵌套命令会导致需要验证密码，卡死会话
- 使用单层SSH命令执行操作

#### 3. Git认证配置（一次性配置）

```bash
# 在VPS上配置Personal Access Token认证
cd /tmp/github/secure-streaming-platform/vps-transcoder-api
git remote set-url origin https://shao-ye:YOUR_GITHUB_TOKEN@github.com/shao-ye/secure-streaming-platform.git

# 验证配置
git pull origin master  # 应该无需输入密码
```

#### 4. 代码修改流程

**⚠️ 重要**: 调试VPS上的程序时，要先修改本地代码，上传git，再将代码从git上拉取到VPS上，再执行。**不要直接在VPS上修改代码**，保证项目代码是最新有效的。

**目录结构**:
- **本地Git目录**: `D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api`
- **VPS Git目录**: `/tmp/github/secure-streaming-platform/vps-transcoder-api`
- **VPS运行目录**: `/opt/yoyo-transcoder`

**正确的开发流程**:
```bash
1. 本地修改代码
2. 测试验证功能
3. 提交到Git: git push origin master
4. VPS拉取代码: 使用vps-simple-deploy.sh脚本
5. 验证部署结果
```

### 三层架构路由规范

#### 路由映射关系

```
前端API调用 → Workers路由 → VPS端点

例如：代理连接功能
1. 前端: proxyApi.enableProxy(proxy)
   └→ POST /api/admin/proxy/control
2. Workers: /api/admin/proxy/control
   └→ POST /api/proxy/connect (VPS)
3. VPS: /api/proxy/connect
   └→ ProxyManager.connect()
```

#### API开发检查清单

**新增API时必须**:
- [ ] 前端 `services/` 添加API方法
- [ ] Workers `handlers/` 添加路由处理
- [ ] VPS `routes/` 添加端点实现
- [ ] 更新API文档
- [ ] 运行完整性测试

### 代码提交规范

**提交信息格式**:
```bash
<type>: <subject>

# type类型
- feat: 新功能
- fix: 修复bug
- docs: 文档更新
- refactor: 重构
- perf: 性能优化
- test: 测试相关
- chore: 构建/工具变动

# 示例
git commit -m "feat: 实现双维度路由功能"
git commit -m "fix: 修复隧道SSL握手问题"
git commit -m "docs: 更新架构文档V2.0"
```

### 文档维护规范

#### API变更时必须更新

- [ ] 更新架构文档
- [ ] 更新API路由映射
- [ ] 更新测试脚本
- [ ] 更新版本说明

#### 文档更新模板

```markdown
### 新增功能: [功能名称]

#### 路由信息
- 前端方法: `apiName.methodName()`
- Workers路由: `METHOD /api/path`
- VPS端点: `METHOD /api/path`

#### 实现文件
- 前端: `frontend/src/services/[service].js`
- Workers: `cloudflare-worker/src/handlers/[handler].js`
- VPS: `src/routes/[route].js`

#### 测试验证
- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 端到端测试通过
```

---

## 🛠️ 常用脚本工具

### VPS部署脚本

#### vps-simple-deploy.sh - 通用VPS部署脚本

**功能概述**:
- 一键更新VPS项目代码
- 自动处理Git同步和文件替换
- 验证关键文件和路由配置
- 重启服务并进行健康检查
- Git仓库损坏自动修复

**使用方法**:
```bash
# 方式1: 远程SSH执行（推荐）
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"

# 方式2: 在VPS上直接执行
cd /tmp/github/secure-streaming-platform/vps-transcoder-api
chmod +x vps-simple-deploy.sh
./vps-simple-deploy.sh
```

**Git仓库管理逻辑**:
1. 检测Git仓库健康状态
2. 发现SHA1损坏等问题，自动删除并重新克隆
3. 使用SSH方式克隆避免认证问题
4. 强制重置到最新版本，避免合并冲突
5. 验证Git仓库完整性

**脚本特性**:
- 📥 强制拉取最新代码（避免合并冲突）
- 🔄 使用rsync可靠同步文件
- 🔍 验证关键文件存在性
- ✅ 检查代理路由配置
- 📦 自动安装系统依赖（nc, V2Ray）
- 🔄 重启PM2服务
- 📡 服务健康检查

**关键验证点**:
- ✅ 检查 `proxy.js` 中的 connect/disconnect 路由
- ✅ 验证 `ProxyManager` 引用正确性
- ✅ 确认关键文件同步完成
- ✅ PM2服务状态检查
- ✅ HTTP健康检查通过

**故障排除**:
```bash
# 常见问题和解决方案
1. Git同步失败 → 强制重置本地状态
2. 文件权限问题 → 使用rsync或备用cp方案
3. 依赖缺失 → 自动检测并安装nc/V2Ray
4. 服务启动失败 → 显示PM2日志便于调试
```

**使用场景**:
- 🚀 **日常代码部署**: 推送代码后快速同步到VPS
- 🔧 **问题修复**: 修复代码后立即部署验证
- 📦 **环境初始化**: 新VPS环境的快速配置
- 🔄 **版本回退**: 配合Git版本管理进行回退

### API测试脚本

#### test-api-routes-completeness.ps1

**功能概述**:
- 自动化测试所有关键API端点
- 验证三层架构路由完整性
- 检测404错误和路由缺失问题
- 生成详细的测试报告

**测试覆盖**:
```powershell
# 测试端点列表
✅ GET  /api/admin/proxy/config     # 代理配置获取
✅ GET  /api/admin/proxy/status     # 代理状态查询
✅ POST /api/admin/proxy/connect    # 代理连接测试
✅ POST /api/admin/proxy/disconnect # 代理断开测试
✅ POST /api/admin/proxy/test       # 代理延迟测试
```

**使用方法**:
```powershell
# 在本地执行
.\test-api-routes-completeness.ps1
```

**PowerShell最佳实践**:
```powershell
# ✅ 正确的URL处理
$proxyConfig = 'vless://test@example.com:443?encryption=none&security=tls&type=tcp#test'

# ✅ 正确的哈希表语法
$testData = @{
    proxyConfig = @{
        config = 'vless://...'  # 使用单引号避免特殊字符
    }
} | ConvertTo-Json -Depth 3
```

**测试结果解读**:
- ✅ **HTTP 200**: 端点正常工作
- ⚠️ **HTTP 401/500**: 端点存在但有业务逻辑错误
- ❌ **HTTP 404**: 端点不存在，需要检查路由配置

---

## 🔍 问题排查指南

### API调用失败排查步骤

#### 1. 检查前端调用
```javascript
// 检查网络请求
console.log('API调用:', url, method, data);
```

#### 2. 检查Workers路由
```javascript
// 确认路由是否存在
if (path === '/api/admin/proxy/connect' && method === 'POST') {
  // 路由处理逻辑
}
```

#### 3. 检查VPS端点
```bash
# 直接测试VPS端点
curl -X POST http://localhost:3000/api/proxy/connect
```

#### 4. 检查完整链路
```bash
# 运行完整性测试脚本
.\test-api-routes-completeness.ps1
```

### 常见问题和解决方案

#### 问题1: VPS部署后代码未更新

**症状**: 部署成功但功能未生效

**排查**:
```bash
# 1. 检查Git是否真的拉取了最新代码
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && git log -1"

# 2. 检查运行目录代码版本
ssh root@<VPS_IP> "ls -l /opt/yoyo-transcoder/src/"

# 3. 手动同步代码
ssh root@<VPS_IP> "rsync -av /tmp/github/secure-streaming-platform/vps-transcoder-api/vps-transcoder-api/src/ /opt/yoyo-transcoder/src/"

# 4. 重启PM2服务
ssh root@<VPS_IP> "pm2 restart vps-transcoder-api"
```

#### 问题2: Workers API返回404

**症状**: 前端调用API返回404

**排查**:
```bash
# 1. 检查Workers是否部署成功
cd cloudflare-worker
npx wrangler tail --env production

# 2. 重新部署Workers
npx wrangler deploy --env production

# 3. 检查路由是否存在
# 查看 cloudflare-worker/src/index.js 和相关 handlers
```

#### 问题3: 前端自动部署失败

**症状**: git push后前端未更新

**排查**:
```bash
# 1. 检查Cloudflare Pages部署状态
# 访问 https://dash.cloudflare.com → Pages → yoyo-streaming

# 2. 查看构建日志

# 3. 手动触发重新部署
# 在Cloudflare Pages控制台点击 "Retry deployment"
```

### 开发环境问题

#### Node.js版本不兼容

**症状**: npm install失败或运行报错

**解决**:
```bash
# 检查Node.js版本
node -v  # 应该是 v18.x

# 使用nvm切换版本
nvm install 18
nvm use 18
```

#### Wrangler认证问题

**症状**: wrangler deploy失败，提示未登录

**解决**:
```bash
# 重新登录
npx wrangler login

# 或使用API Token
npx wrangler whoami
```

---

## 📏 代码质量标准

### 错误处理规范

```javascript
// ✅ 正确的错误处理
try {
  const result = await apiCall();
  return { status: 'success', data: result };
} catch (error) {
  console.error('API调用失败:', error);
  return { 
    status: 'error', 
    message: error.message,
    code: error.code 
  };
}
```

### 日志记录规范

```javascript
// ✅ 完整的日志记录
console.log('🚀 开始处理请求:', { 
  path, 
  method, 
  timestamp: new Date().toISOString() 
});

console.log('✅ 请求处理成功:', { 
  result, 
  duration: Date.now() - startTime 
});

console.error('❌ 请求处理失败:', { 
  error: error.message, 
  stack: error.stack 
});
```

### 性能监控规范

```javascript
// ✅ 性能监控
const startTime = Date.now();

// ... 业务逻辑

const duration = Date.now() - startTime;
if (duration > 5000) {
  console.warn('⚠️ API响应时间过长:', { path, duration });
}
```

### PowerShell脚本编写规范

```powershell
# ❌ 错误：URL中的特殊字符会导致解析错误
$proxyConfig = "vless://test@example.com:443?encryption=none&security=tls&type=tcp#test"

# ✅ 正确：使用单引号包裹完整URL，避免特殊字符解析
$proxyConfig = 'vless://test@example.com:443?encryption=none&security=tls&type=tcp#test'

# ✅ 或者使用转义字符
$proxyConfig = "vless://test@example.com:443?encryption=none`&security=tls`&type=tcp#test"

# ✅ 最佳实践：复杂URL使用Here-String
$proxyConfig = @'
vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=XSIEcTZ1NnjyY-BhYuiW74fAwFfve-8YJ-T855r0f1c&type=tcp&headerType=none#JP-Evoxt
'@
```

### PowerShell常见错误和解决方案

```powershell
# 问题1: & 字符被解释为命令操作符
# 错误: config = "vless://test@example.com:443?encryption=none&security=tls"
# 解决: config = 'vless://test@example.com:443?encryption=none&security=tls'

# 问题2: 哈希表语法错误
# 错误: 
$data = @{
    config = "url&with&ampersands"
}
# 解决:
$data = @{
    config = 'url&with&ampersands'
}

# 问题3: JSON转换中的特殊字符
# 正确做法:
$jsonData = @{
    proxyConfig = @{
        config = 'vless://...'  # 使用单引号
    }
} | ConvertTo-Json -Depth 3
```

---

## 🔐 安全注意事项

### 环境变量管理

```bash
# ❌ 错误：硬编码敏感信息
const API_KEY = '<VPS_API_KEY>';

# ✅ 正确：使用环境变量
const API_KEY = process.env.VPS_API_KEY;
```

### API密钥保护

**Workers环境变量**:
```bash
# 设置环境变量
npx wrangler secret put VPS_API_KEY

# 使用环境变量
export default {
  async fetch(request, env) {
    const apiKey = env.VPS_API_KEY;
  }
}
```

### Git提交注意

```bash
# ❌ 不要提交
- .env 文件
- API密钥
- 密码和token
- 私钥文件

# ✅ 使用 .gitignore
.env
.env.*
*.key
*.pem
secrets/
```

---

## 📊 开发流程规范

### 分支管理策略

#### 分支类型
- **master分支**: 生产环境分支，只接受经过测试的稳定代码
- **feature/xxx分支**: 功能开发分支，用于新功能开发和测试
- **分支命名**: `feature/功能描述`，例如 `feature/user-proxy-config`

#### 临时合并策略（生产测试）

```bash
# 1. 创建功能分支进行开发
git checkout -b feature/功能名称
# ... 开发代码 ...
git add .
git commit -m "功能描述"

# 2. 需要生产环境测试时，临时合并到master
git checkout master
git merge feature/功能名称
git push origin master
# 触发Cloudflare Pages自动部署，进行生产测试

# 3. 测试完成后，如果有问题需要修复
git checkout feature/功能名称
# ... 修复问题 ...
git add .
git commit -m "修复问题描述"

# 4. 再次合并测试
git checkout master
git merge feature/功能名称
git push origin master

# 5. 测试通过后，保持master状态，删除功能分支
git branch -d feature/功能名称
```

#### 紧急回滚流程

```bash
# 如果生产测试发现严重问题
1. 记录当前问题commit: git log --oneline -1
2. 回滚到稳定版本: git reset --hard <stable-commit-id>
3. 强制推送: git push --force-with-lease origin master
4. 验证回滚结果
```

### 功能开发流程

```
1. 需求分析
   └→ 明确功能需求和技术方案

2. 设计阶段
   └→ 确定API接口
   └→ 设计数据结构
   └→ 规划路由映射

3. 开发阶段
   └→ 前端实现
   └→ Workers实现
   └→ VPS实现

4. 测试阶段
   └→ 单元测试
   └→ 集成测试
   └→ 端到端测试

5. 部署发布
   └→ Git提交
   └→ 部署各层服务
   └→ 生产验证
```

### 部署流程规范

#### VPS转码服务部署
```bash
# 推荐使用一键部署脚本
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && ./vps-simple-deploy.sh"
```

#### Cloudflare Workers部署
```bash
# 独立部署，不依赖Git分支
1. 修改cloudflare-worker目录下的代码
2. 运行: npx wrangler deploy --env production
3. 验证API端点响应
```

#### 前端部署（Cloudflare Pages）
```bash
# 只有master分支会触发自动部署
1. 功能分支开发: git checkout -b feature/xxx
2. 开发完成后合并到master: git merge feature/xxx
3. 推送到远程: git push origin master
4. Cloudflare Pages自动构建部署
5. 在 https://yoyo.your-domain.com 验证功能
```

### 代码审查检查清单

**提交前自查**:
- [ ] 代码符合项目规范
- [ ] 没有硬编码敏感信息
- [ ] 错误处理完善
- [ ] 日志记录清晰
- [ ] 注释充分
- [ ] 测试通过

**部署前检查**:
- [ ] Git提交已推送
- [ ] 本地测试通过
- [ ] 文档已更新
- [ ] 影响范围已评估
- [ ] 回滚方案已准备

---

## 🔧 重要技术细节

### 系统参数配置

| 参数 | 值 | 说明 |
|------|---|------|
| 会话超时 | 5分钟 | 无活动自动清理 |
| FFmpeg启动超时 | 15秒 | 转码进程启动限制 |
| HLS分片大小 | 2秒 | 平衡延迟和稳定性 |
| API认证方式 | X-API-Key | 头部认证 |
| CORS配置 | * | 支持跨域访问HLS文件 |

### 端口配置

| 服务 | 端口 | 说明 |
|------|------|------|
| Node.js API | 3000 | VPS内部API服务 |
| Nginx | 52535 | HLS文件服务（通过Origin Rules映射到443） |
| File Browser | 8080 | 内部文件管理（不对外） |

### 文档维护要求

#### 5. 架构文档更新
每次会话完成后，如果产生重要的配置信息或项目重要信息，要同步更新到架构文档中。

#### 6. 项目进度更新
每次对话结束后必须更新项目进度文档，记录最新的完成状态和待办事项。

---

## 💾 备份和恢复

### 备份策略

- **代码备份**: 所有修改前自动创建备份目录
- **配置备份**: 定期备份Nginx和PM2配置
- **数据备份**: Cloudflare KV数据自动备份

### 恢复流程

```bash
# 1. 停止服务
pm2 stop vps-transcoder-api

# 2. 恢复代码
cp -r /opt/yoyo-transcoder-backup-* /opt/yoyo-transcoder/

# 3. 重启服务
pm2 start vps-transcoder-api

# 4. 验证服务
curl https://yoyo-vps.your-domain.com/health
```

### 备份位置

- **VPS代码备份**: `/opt/yoyo-transcoder-backup-YYYYMMDD`
- **本地Git备份**: 所有提交都保存在Git历史中
- **配置文件备份**: `/etc/nginx/nginx.conf.backup`

---

## 🔄 持续改进

### 定期检查

- **每周**: 运行API完整性测试
- **每月**: 检查文档更新情况
- **每季度**: 评估架构优化需求

### 问题反馈

1. **发现问题**: 立即记录到Issues
2. **解决问题**: 更新相关文档
3. **预防措施**: 完善检查清单

### 知识积累

- **经验总结**: 记录常见问题和解决方案
- **最佳实践**: 提炼开发和部署经验
- **工具改进**: 优化测试和部署脚本

---

## 📖 相关文档

### 核心文档
- **架构文档**: `doc/ARCHITECTURE_V2.md` - 系统架构概览
- **双维度路由**: `doc/DUAL_DIMENSION_ROUTING_ARCHITECTURE.md` - 路由详细实现
- **本文档**: `doc/OPERATIONS_GUIDE.md` - 运维开发指南

### 历史文档
- **旧版架构**: `doc/YOYO_PLATFORM_ARCHITECTURE_LEGACY.md` - 完整详细版

### 脚本文件
- **VPS部署**: `vps-simple-deploy.sh` - 一键部署脚本
- **API测试**: `test-api-routes-completeness.ps1` - 路由测试

---

## 🎯 快速查找

### 常用命令速查

| 操作 | 命令 |
|------|------|
| **VPS部署** | `ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && ./vps-simple-deploy.sh"` |
| **Workers部署** | `cd cloudflare-worker && npx wrangler deploy --env production` |
| **查看PM2日志** | `ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 50"` |
| **重启PM2服务** | `ssh root@<VPS_IP> "pm2 restart vps-transcoder-api"` |
| **VPS健康检查** | `curl https://yoyo-vps.your-domain.com/health` |
| **API测试** | `.\test-api-routes-completeness.ps1` |

### 常见问题速查

| 问题 | 解决方案 |
|------|---------|
| 代码未更新 | 检查Git → 手动同步 → 重启PM2 |
| API返回404 | 检查路由 → 重新部署Workers |
| 前端未更新 | 检查Pages → 手动触发部署 |
| VPS无响应 | 检查服务状态 → 重启PM2 |

---

**文档维护**: 本文档应随项目演进持续更新  
**最后更新**: 2025-10-24 13:42 (UTC+8)  
**文档状态**: ✅ 当前版本
