# Cloudflare Dashboard 界面部署指南

**适用人群**: 不熟悉命令行的小白用户  
**参考项目**: [Cloud Mail](https://doc.skymail.ink/guide/via-ui.html)

---

## 📋 部署方式对比

| 方式 | 适用人群 | 难度 | 灵活性 | API Key |
|------|---------|------|--------|---------|
| **界面部署** | 小白用户 | ⭐ | ⭐⭐ | ❌ 不需要 |
| **命令行部署** | 开发者 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 需要 |

---

## 🎯 界面部署流程（推荐给小白）

### **前提条件**
- ✅ 有GitHub账号
- ✅ 有Cloudflare账号
- ✅ 域名已添加到Cloudflare

---

### **第1步：Fork项目到你的GitHub**

1. 访问项目仓库（假设已开源）
2. 点击右上角 **Fork** 按钮
3. 项目会复制到你的GitHub账号下

---

### **第2步：在Cloudflare创建Worker项目**

#### 2.1 进入Workers & Pages

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击左侧菜单 **Workers & Pages**
3. 点击 **Create Application** → **Create Worker**

#### 2.2 连接GitHub

1. 选择 **Connect to Git**
2. 选择 **GitHub**
3. 授权Cloudflare访问你的GitHub
4. 选择你Fork的项目仓库
5. 选择要部署的分支（通常是`main`或`master`）

#### 2.3 配置构建设置

| 配置项 | 值 |
|-------|---|
| **项目名称** | `your-streaming-platform` |
| **生产分支** | `main` |
| **构建命令** | `npm run build`（如果需要） |
| **构建输出目录** | `cloudflare-worker/` |
| **根目录** | `cloudflare-worker/` |

点击 **Save and Deploy**

---

### **第3步：配置环境变量**

部署完成后，进入Worker设置页面：

#### 3.1 基础环境变量

点击 **Settings** → **Environment Variables** → **Add Variable**

| 变量名 | 类型 | 值 | 说明 |
|--------|------|---|------|
| `ENVIRONMENT` | 纯文本 | `production` | 运行环境 |
| `VERSION` | 纯文本 | `2.0.0` | 版本号 |
| `FRONTEND_DOMAIN` | 纯文本 | `https://your-app.pages.dev` | 前端域名 |
| `WORKER_DOMAIN` | 纯文本 | `https://api.your-domain.com` | Worker API域名 |
| `VPS_API_URL` | 纯文本 | `https://vps.your-domain.com` | VPS服务器地址 |

#### 3.2 敏感配置（Secrets）

点击 **Settings** → **Environment Variables** → **Add Variable** → **Encrypt**

| 变量名 | 类型 | 值 | 说明 |
|--------|------|---|------|
| `VPS_API_KEY` | Secret | `your-vps-api-key` | VPS API密钥 |
| `EMERGENCY_ADMIN_PASSWORD` | Secret | `your-admin-password` | 应急管理员密码 |

---

### **第4步：创建和绑定KV数据库**

#### 4.1 创建KV Namespace

1. 在Cloudflare Dashboard，点击 **Workers & Pages** → **KV**
2. 点击 **Create a namespace**
3. 名称：`yoyo-user-db`
4. 点击 **Add**

#### 4.2 绑定到Worker

1. 回到你的Worker设置页面
2. 点击 **Settings** → **Bindings** → **Add Binding**
3. 类型选择 **KV Namespace**
4. 变量名：`YOYO_USER_DB`
5. KV Namespace：选择刚创建的 `yoyo-user-db`
6. 点击 **Save**

---

### **第5步：创建和绑定R2存储桶**

#### 5.1 创建R2 Buckets

1. 在Cloudflare Dashboard，点击 **R2**
2. 点击 **Create bucket**
3. 创建以下存储桶：
   - `proxy-test-history` - 代理测试历史
   - `yoyo-login-logs` - 登录日志
   - （可选）`video-storage` - 视频存储

#### 5.2 绑定到Worker

1. 回到Worker设置页面
2. 点击 **Settings** → **Bindings** → **Add Binding**
3. 类型选择 **R2 Bucket**
4. 依次添加：
   - 变量名：`PROXY_TEST_HISTORY`，Bucket：`proxy-test-history`
   - 变量名：`LOGIN_LOGS`，Bucket：`yoyo-login-logs`
5. 点击 **Save**

---

### **第6步：设置自定义域名**

#### 6.1 添加Worker域名路由

1. Worker设置页面，点击 **Triggers**
2. 点击 **Add Custom Domain**
3. 输入你的API域名：`api.your-domain.com`
4. 点击 **Add Domain**

Cloudflare会自动创建DNS记录并配置SSL证书。

---

### **第7步：初始化数据库**

1. 浏览器访问：
   ```
   https://api.your-domain.com/api/init/your-secret-key
   ```
   
2. 看到成功消息说明初始化完成

---

### **第8步：部署前端（Cloudflare Pages）**

#### 8.1 创建Pages项目

1. Cloudflare Dashboard → **Workers & Pages** → **Create Application**
2. 选择 **Pages** → **Connect to Git**
3. 选择你Fork的仓库
4. 配置构建：

| 配置项 | 值 |
|-------|---|
| **项目名称** | `your-streaming-platform-frontend` |
| **生产分支** | `main` |
| **构建命令** | `cd frontend && npm install && npm run build` |
| **构建输出目录** | `frontend/dist` |
| **根目录** | `/` |

#### 8.2 配置前端环境变量

在Pages项目的 **Settings** → **Environment Variables** 添加：

| 变量名 | 值 |
|--------|---|
| `VITE_API_BASE_URL` | `https://api.your-domain.com` |
| `VITE_APP_TITLE` | `YOYO流媒体平台` |
| `VITE_ENVIRONMENT` | `production` |
| `VITE_HLS_PROXY_URL` | `https://api.your-domain.com/hls` |
| `VITE_WORKER_URL` | `https://api.your-domain.com` |

#### 8.3 添加自定义域名

1. Pages设置页面 → **Custom domains** → **Set up a custom domain**
2. 输入：`your-app.com`
3. 点击 **Continue** 并按提示配置DNS

---

## ✅ 验证部署

### 1. 检查Worker状态

访问：`https://api.your-domain.com/health`

应该返回：
```json
{
  "status": "ok",
  "version": "2.0.0",
  "environment": "production"
}
```

### 2. 检查前端

访问：`https://your-app.com`

应该能看到登录页面。

### 3. 测试注册登录

1. 注册一个账号
2. 登录成功
3. 进入管理后台

---

## 🆚 界面部署 vs 命令行部署

### **界面部署的优势**

✅ **无需技术背景**
- 不需要安装Node.js
- 不需要安装wrangler
- 不需要管理API Key
- 所有操作在浏览器完成

✅ **自动化程度高**
- GitHub推送自动触发部署
- SSL证书自动配置
- DNS记录自动创建

✅ **可视化管理**
- 清楚看到所有环境变量
- 清楚看到所有绑定的资源
- 部署日志实时查看

### **界面部署的劣势**

❌ **灵活性较低**
- 无法使用脚本批量操作
- 无法在CI/CD中自动部署
- 配置分散在Dashboard各处

❌ **多环境管理困难**
- 需要在界面上分别配置dev/staging/prod
- 配置无法版本控制

❌ **团队协作不便**
- 配置无法通过Git共享
- 需要截图或文档记录配置

---

## 💡 建议的部署策略

### **对于个人/小白用户**
推荐使用 **界面部署**：
1. Fork项目
2. 在Cloudflare Dashboard点击部署
3. 在界面配置环境变量和资源绑定
4. 享受自动部署

### **对于团队/开发者**
推荐使用 **命令行部署**：
1. 使用`wrangler.toml`统一配置
2. 配置版本控制
3. 支持多环境管理
4. 集成到CI/CD流程

### **混合方式（最佳实践）**
1. **首次部署**：使用界面部署，快速上手
2. **后续管理**：学习使用wrangler，提升效率
3. **团队协作**：迁移到命令行部署，配置版本化

---

## 📚 参考资料

- [Cloudflare Pages部署指南](https://developers.cloudflare.com/pages/get-started/)
- [Workers & Pages Dashboard](https://dash.cloudflare.com/?to=/:account/workers)
- [环境变量配置](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Cloud Mail部署教程](https://doc.skymail.ink/guide/via-ui.html) - 参考案例

---

**创建日期**: 2025-11-09  
**更新日期**: 2025-11-09  
**适用版本**: v2.0.0+
