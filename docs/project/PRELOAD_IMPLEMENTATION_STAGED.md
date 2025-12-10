# 🚀 频道智能预加载功能实施方案 - 阶段化执行文档

**版本**: v1.2 | **创建时间**: 2025-10-27 09:14 | **更新时间**: 2025-10-27 09:59  
**基于**: 预加载方案讨论（优化为精确定时任务）  
**更新日志**: 修正架构图中的调度器描述，移除"每分钟检查"等轮询相关描述

---

## 📖 文档使用说明

### **重要原则**

⚠️ **本文档采用阶段化执行策略** - 每个阶段完成后必须验证通过才能继续

**🚨 执行纪律（必须严格遵守）**：
1. ✅ **绝对禁止跳步** - 必须完成当前阶段的所有步骤（修改→部署→验证→更新状态）后才能进入下一阶段
2. ✅ **验证是强制性的** - 即使代码看起来正确，也必须执行验证步骤确认功能正常
3. ✅ **验证失败必须回滚** - 使用备份文件恢复，不能带着问题继续
4. ✅ **每步更新进度表** - 在下方进度表中实时标记当前状态
5. ✅ **遇到问题立即停止** - 不要继续执行后续阶段

### **关键概念理解** ⭐⭐⭐

在开始执行前，请务必理解以下核心概念：

#### 1️⃣ **预加载与按需转码的关系**
- ✅ 按需转码：用户点击后才启动FFmpeg进程（现有功能）
- ✅ 预加载：提前启动FFmpeg进程，用户点击时0延迟（新增功能）
- ⚠️ 两者共存：预加载进程不受心跳清理影响，按需进程正常清理

#### 2️⃣ **预加载配置存储**
- ✅ 使用Cloudflare KV存储（复用现有存储）
- ✅ 每个频道独立配置：开关、开始时间、结束时间
- ✅ VPS通过Workers API获取配置（保持架构一致性）

#### 3️⃣ **时间调度逻辑**
- ✅ 基于北京时间（UTC+8）判断
- ✅ 为每个频道创建精确的开始/结束定时任务
- ✅ 定时任务准点触发，自动启动/停止预加载进程
- ✅ 配置变更时手动重载调度器，立即生效

**为什么要阶段化**：
- 🔴 本次实施涉及数据库设计、定时任务、前端界面多个层面
- 🔴 一次性修改风险高，难以定位问题
- ✅ 分阶段执行可以及时发现和修复问题
- ✅ 每个阶段都可独立回滚，影响范围小

**AI执行者注意**：
- 📝 **每完成一个阶段，必须更新下方进度表**
- 📝 **在状态列标记 ✅ 并填写完成时间**
- 📝 **如果验证失败，标记 ❌ 并说明原因**

---

## 📊 执行进度追踪

### **总体进度**: 0/6 阶段完成

| 阶段 | 名称 | 状态 | 完成时间 | 验证结果 |
|------|------|------|----------|----------|
| **准备** | 环境配置和文件备份 | ⏳ 未开始 | - | - |
| **阶段1** | KV数据结构设计和API | ⏳ 未开始 | - | - |
| **阶段2** | SimpleStreamManager预加载支持 | ⏳ 未开始 | - | - |
| **阶段3** | VPS定时调度器 | ⏳ 未开始 | - | - |
| **阶段4** | 前端管理界面 | ⏳ 未开始 | - | - |
| **阶段5** | 健康检查和自动重启 | ⏳ 未开始 | - | - |
| **阶段6** | 完整集成测试 | ⏳ 未开始 | - | - |

**状态图例**：⏳ 未开始 | 🔄 进行中 | ✅ 已完成 | ❌ 验证失败 | 🔙 已回滚

---

## 📋 功能概述

### **核心需求**
1. **灵活配置**: 管理员可为每个频道独立设置预加载
2. **定时预加载**: 按北京时间设定开始/结束时间
3. **零延迟播放**: 预加载时段用户点击立即播放（<0.5秒）
4. **资源优化**: 预加载时段外自动停止，节省资源
5. **可视化管理**: 前端界面直观显示预加载状态

### **关键技术决策**

#### 1. 预加载标记机制 ⭐
- **策略**: 给预加载频道打标记，心跳清理逻辑跳过这些频道
- **优势**: 实现简单，不影响现有按需转码逻辑
- **代码量**: 仅需修改SimpleStreamManager约20行代码

#### 2. KV存储结构 ⭐
- **Key格式**: `PRELOAD_CONFIG:${channelId}`
- **Value结构**: JSON对象包含enabled、startTime、endTime
- **访问方式**: 
  - 🖥️ VPS端：通过Workers API获取
  - ☁️ Workers端：直接访问`env.YOYO_USER_DB`

#### 3. 时间调度策略 ⭐⭐⭐（精确定时任务）
- **策略**: 为每个频道创建2个cron任务（开始+结束）
- **执行频率**: 每天仅执行2次/频道（例如：07:40启动，17:20停止）
- **资源消耗**: 3个频道 = 6次/天（相比轮询节省99.6%）
- **配置变更**: 调用重载API，立即更新定时任务
- **服务重启**: 自动检测当前是否应该预加载，立即启动
- **跨天支持**: 完整支持（如23:00-01:00）

**示例**：
```javascript
// 频道1配置：07:40-17:20
cron.schedule('40 7 * * *', () => startPreload('channel1'));  // 每天7:40
cron.schedule('20 17 * * *', () => stopPreload('channel1')); // 每天17:20
```

#### 4. 健康检查机制 ⭐
- **检查频率**: 每5分钟检查一次
- **检查内容**: 预加载进程是否存活、HLS文件是否正常生成
- **自动修复**: 进程崩溃自动重启，最多重试3次

### **预加载配置数据结构**

```javascript
// KV存储格式
Key: PRELOAD_CONFIG:stream_ensxma2g
Value: {
  channelId: "stream_ensxma2g",
  channelName: "二楼教室1",
  enabled: true,              // 预加载开关
  startTime: "07:00",         // 北京时间开始（HH:MM）
  endTime: "17:30",           // 北京时间结束（HH:MM）
  updatedAt: "2025-10-27T09:00:00Z",
  updatedBy: "admin"
}
```

### **系统架构图**

```
┌─────────────────────────────────────────────────────────┐
│                    前端界面                              │
│  频道列表 → [配置按钮] → 预加载配置对话框                │
│  - 开关: ON/OFF                                         │
│  - 开始时间: 07:00                                       │
│  - 结束时间: 17:30                                       │
└──────────────────┬──────────────────────────────────────┘
                   │ API调用
                   ↓
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Workers                          │
│  - GET /api/preload/config/:channelId                   │
│  - PUT /api/preload/config/:channelId                   │
│  - GET /api/preload/status                              │
│                                                           │
│  存储: Cloudflare KV (PRELOAD_CONFIG:*)                 │
└──────────────────┬──────────────────────────────────────┘
                   │ VPS启动时获取配置
                   │ 配置变更时主动通知
                   ↓
┌─────────────────────────────────────────────────────────┐
│                  VPS转码服务                             │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  PreloadScheduler (定时调度器)                │        │
│  │  - 服务启动时检测并启动预加载                 │        │
│  │  - 为每个频道创建精确定时任务                 │        │
│  │  - 定时任务准点触发启动/停止                  │        │
│  │  - 支持配置热重载(reload API)                │        │
│  └────────────┬────────────────────────────────┘        │
│               │                                           │
│               ↓                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  SimpleStreamManager (改造)                  │        │
│  │  - preloadChannels: Set<channelId>          │        │
│  │  - startPreload(channelId, rtmpUrl)         │        │
│  │  - stopPreload(channelId)                   │        │
│  │  - cleanupIdleChannels() 跳过预加载频道      │        │
│  └─────────────────────────────────────────────┘        │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  PreloadHealthCheck (健康检查)               │        │
│  │  - 每5分钟检查预加载进程                      │        │
│  │  - 崩溃自动重启(最多3次)                      │        │
│  └─────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 准备阶段：环境配置和文件备份

⚠️ **在开始任何修改前，必须先完成准备工作！**

**目标**：配置环境变量，备份关键文件  
**影响范围**：全局配置  
**风险等级**：🟢 低  
**预计时间**：15分钟

### 准备1：备份关键文件

```bash
# SSH到VPS
ssh root@<VPS_IP>

# 创建备份目录
mkdir -p /opt/yoyo-transcoder/backup/preload-$(date +%Y%m%d)

# 备份关键文件
cp /opt/yoyo-transcoder/src/services/SimpleStreamManager.js \
   /opt/yoyo-transcoder/backup/preload-$(date +%Y%m%d)/

cp /opt/yoyo-transcoder/src/app.js \
   /opt/yoyo-transcoder/backup/preload-$(date +%Y%m%d)/

echo "✅ 备份完成"
```

### 准备2：环境变量配置

**Cloudflare Workers (wrangler.toml)**:
```toml
# 不需要新增环境变量，复用现有的
# - YOYO_USER_DB (已存在)
# - VPS_API_KEY (已存在)
```

**VPS (.env)**:
```bash
# SSH到VPS后编辑 /opt/yoyo-transcoder/.env
# 不需要新增环境变量，复用现有的
# WORKER_API_URL=https://yoyoapi.your-domain.com (已存在)
# VPS_API_KEY=<VPS_API_KEY> (已存在)
```

### 准备3：验证现有环境

```bash
# 检查Workers环境
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  https://yoyoapi.your-domain.com/health

# 检查VPS环境
curl http://localhost:3000/health

# ✅ 两者都返回 {"status":"healthy"} 表示正常
```

✅ 完成后更新进度表

---

## 🎯 阶段1：KV数据结构设计和API

**目标**：创建预加载配置的存储结构和API端点  
**影响范围**：Cloudflare Workers  
**风险等级**：🟢 低  
**预计时间**：45分钟

### 1.1 创建预加载配置Handler

**新建文件**: `cloudflare-worker/src/handlers/preloadHandler.js`

```javascript
/**
 * 预加载配置管理Handler
 * 
 * API端点：
 * - GET  /api/preload/config/:channelId  - 获取单个频道预加载配置
 * - PUT  /api/preload/config/:channelId  - 更新频道预加载配置
 * - GET  /api/preload/configs             - 获取所有预加载配置
 * - GET  /api/preload/status              - 获取预加载系统状态
 */

import { verifyAuth } from '../auth/verify';

const KV_PREFIX = 'PRELOAD_CONFIG:';

/**
 * 处理预加载配置相关请求
 */
export async function handlePreloadAPI(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method;
  const pathname = url.pathname;

  try {
    // 验证管理员权限
    const authResult = await verifyAuth(request, env);
    if (!authResult.isValid) {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Unauthorized'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 只有管理员可以操作预加载配置
    if (authResult.user.role !== 'admin') {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Admin access required'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 路由分发
    if (pathname === '/api/preload/configs' && method === 'GET') {
      return await getAllPreloadConfigs(env);
    }
    
    if (pathname.match(/^\/api\/preload\/config\/[^\/]+$/) && method === 'GET') {
      const channelId = pathname.split('/').pop();
      return await getPreloadConfig(env, channelId);
    }
    
    if (pathname.match(/^\/api\/preload\/config\/[^\/]+$/) && method === 'PUT') {
      const channelId = pathname.split('/').pop();
      const body = await request.json();
      return await updatePreloadConfig(env, channelId, body, authResult.user.username);
    }
    
    if (pathname === '/api/preload/status' && method === 'GET') {
      return await getPreloadStatus(env);
    }

    return new Response(JSON.stringify({
      status: 'error',
      message: 'Not found'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Preload API error:', error);
    return new Response(JSON.stringify({
      status: 'error',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 获取单个频道的预加载配置
 */
async function getPreloadConfig(env, channelId) {
  const key = `${KV_PREFIX}${channelId}`;
  const configStr = await env.YOYO_USER_DB.get(key);
  
  if (!configStr) {
    // 返回默认配置
    return new Response(JSON.stringify({
      status: 'success',
      data: {
        channelId,
        enabled: false,
        startTime: '07:00',
        endTime: '17:30',
        updatedAt: null,
        updatedBy: null
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const config = JSON.parse(configStr);
  return new Response(JSON.stringify({
    status: 'success',
    data: config
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 更新频道预加载配置
 */
async function updatePreloadConfig(env, channelId, data, username) {
  // 验证数据
  if (typeof data.enabled !== 'boolean') {
    throw new Error('enabled must be boolean');
  }
  
  if (data.startTime && !/^\d{2}:\d{2}$/.test(data.startTime)) {
    throw new Error('startTime must be in HH:MM format');
  }
  
  if (data.endTime && !/^\d{2}:\d{2}$/.test(data.endTime)) {
    throw new Error('endTime must be in HH:MM format');
  }
  
  // 获取频道名称
  const channelKey = `CHANNEL_CONFIG:${channelId}`;
  const channelStr = await env.YOYO_USER_DB.get(channelKey);
  let channelName = channelId;
  if (channelStr) {
    const channelData = JSON.parse(channelStr);
    channelName = channelData.name || channelId;
  }
  
  // 构建配置对象
  const config = {
    channelId,
    channelName,
    enabled: data.enabled,
    startTime: data.startTime || '07:00',
    endTime: data.endTime || '17:30',
    updatedAt: new Date().toISOString(),
    updatedBy: username
  };
  
  // 保存到KV
  const key = `${KV_PREFIX}${channelId}`;
  await env.YOYO_USER_DB.put(key, JSON.stringify(config));
  
  return new Response(JSON.stringify({
    status: 'success',
    message: 'Preload config updated',
    data: config
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 获取所有频道的预加载配置
 */
async function getAllPreloadConfigs(env) {
  const configs = [];
  
  // 获取所有PRELOAD_CONFIG:*的键
  const list = await env.YOYO_USER_DB.list({ prefix: KV_PREFIX });
  
  for (const key of list.keys) {
    const configStr = await env.YOYO_USER_DB.get(key.name);
    if (configStr) {
      configs.push(JSON.parse(configStr));
    }
  }
  
  return new Response(JSON.stringify({
    status: 'success',
    data: configs,
    count: configs.length
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 获取预加载系统状态（VPS端调用）
 * 返回当前启用的预加载配置
 */
async function getPreloadStatus(env) {
  const configs = [];
  
  // 获取所有预加载配置
  const list = await env.YOYO_USER_DB.list({ prefix: KV_PREFIX });
  
  for (const key of list.keys) {
    const configStr = await env.YOYO_USER_DB.get(key.name);
    if (configStr) {
      const config = JSON.parse(configStr);
      if (config.enabled) {
        configs.push(config);
      }
    }
  }
  
  return new Response(JSON.stringify({
    status: 'success',
    data: {
      enabledChannels: configs,
      totalEnabled: configs.length
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### 1.2 修改index.js添加路由

**修改文件**: `cloudflare-worker/src/index.js`

在路由部分添加预加载API入口：

```javascript
// cloudflare-worker/src/index.js
import { handlePreloadAPI } from './handlers/preloadHandler';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // ... 现有路由 ...
    
    // 🆕 预加载功能API路由
    if (url.pathname.startsWith('/api/preload/')) {
      return handlePreloadAPI(request, env, ctx);
    }
    
    // ... 其他路由 ...
  }
};
```

### 1.3 部署Workers

```bash
cd cloudflare-worker
npx wrangler deploy --env production
```

### 1.4 验证测试

**测试API端点**:
```powershell
# 获取预加载配置（应返回默认配置）
$token = "YOUR_ADMIN_TOKEN"
Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/preload/config/stream_ensxma2g" `
  -Headers @{"Authorization"="Bearer $token"}

# 更新预加载配置
$body = @{
  enabled = $true
  startTime = "07:00"
  endTime = "17:30"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/preload/config/stream_ensxma2g" `
  -Method PUT `
  -Headers @{"Authorization"="Bearer $token"; "Content-Type"="application/json"} `
  -Body $body

# 获取所有预加载配置
Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/preload/configs" `
  -Headers @{"Authorization"="Bearer $token"}

# ✅ 验证通过标准：
# 1. GET返回配置数据
# 2. PUT成功更新
# 3. 再次GET返回更新后的数据
```

✅ 完成后更新进度表

---

## 🎯 阶段2：SimpleStreamManager预加载支持

**目标**：修改SimpleStreamManager支持预加载标记机制  
**影响范围**：VPS转码服务核心  
**风险等级**：🟡 中等  
**预计时间**：30分钟

### 2.1 修改SimpleStreamManager

**修改文件**: `vps-transcoder-api/src/services/SimpleStreamManager.js`

添加预加载支持（仅需添加约25行代码）：

```javascript
// 在constructor中添加
constructor(options = {}) {
  // ... 现有代码 ...
  
  // 🆕 预加载频道集合
  this.preloadChannels = new Set();
  
  logger.info('SimpleStreamManager initialized with preload support');
}

// 🆕 新增：启动预加载
async startPreload(channelId, rtmpUrl) {
  try {
    // 添加到预加载集合
    this.preloadChannels.add(channelId);
    
    logger.info('Starting preload', { channelId, rtmpUrl });
    
    // 调用现有的startWatching方法
    const result = await this.startWatching(channelId, rtmpUrl);
    
    logger.info('Preload started successfully', { channelId });
    return result;
    
  } catch (error) {
    logger.error('Failed to start preload', { channelId, error: error.message });
    // 失败时从集合中移除
    this.preloadChannels.delete(channelId);
    throw error;
  }
}

// 🆕 新增：停止预加载
async stopPreload(channelId) {
  try {
    // 从预加载集合中移除
    this.preloadChannels.delete(channelId);
    
    logger.info('Stopping preload', { channelId });
    
    // 停止FFmpeg进程
    await this.stopFFmpegProcess(channelId);
    
    logger.info('Preload stopped successfully', { channelId });
    
  } catch (error) {
    logger.error('Failed to stop preload', { channelId, error: error.message });
    throw error;
  }
}

// 🆕 新增：检查是否为预加载频道
isPreloadChannel(channelId) {
  return this.preloadChannels.has(channelId);
}

// 修改现有的cleanupIdleChannels方法
async cleanupIdleChannels() {
  const now = Date.now();
  const timeout = this.HEARTBEAT_TIMEOUT;
  
  for (const [channelId, lastHeartbeat] of this.channelHeartbeats.entries()) {
    // 🔥 跳过预加载频道（关键修改）
    if (this.preloadChannels.has(channelId)) {
      logger.debug('Skipping preload channel cleanup', { channelId });
      continue;
    }
    
    // 正常的按需转码清理逻辑
    if (now - lastHeartbeat > timeout) {
      logger.info('Cleaning up idle channel', { 
        channelId, 
        idleTime: Math.floor((now - lastHeartbeat) / 1000) 
      });
      await this.stopFFmpegProcess(channelId);
    }
  }
}

// 🆕 新增：获取预加载状态
getPreloadStatus() {
  return {
    preloadChannels: Array.from(this.preloadChannels),
    count: this.preloadChannels.size
  };
}
```

**⚠️ 关键点**：只需要在`cleanupIdleChannels`方法开头添加3行代码跳过预加载频道，其他都是新增方法。

### 2.2 部署到VPS

```bash
# 提交代码到Git
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api
git add vps-transcoder-api/src/services/SimpleStreamManager.js
git commit -m "feat: 添加预加载支持到SimpleStreamManager

- 新增preloadChannels集合跟踪预加载频道
- 新增startPreload/stopPreload方法
- 修改cleanupIdleChannels跳过预加载频道
- 新增getPreloadStatus获取预加载状态"
git push

# 部署到VPS
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"
```

### 2.3 验证测试

```bash
# SSH到VPS
ssh root@<VPS_IP>

# 查看日志确认SimpleStreamManager重启成功
pm2 logs vps-transcoder-api --lines 50 | grep -i "preload support"

# ✅ 应看到: "SimpleStreamManager initialized with preload support"
```

✅ 完成阶段2后更新进度表

---

## 🎯 阶段3：VPS定时调度器

**目标**：创建PreloadScheduler，实现基于时间的自动预加载  
**影响范围**：VPS新增服务  
**风险等级**：🟡 中等  
**预计时间**：60分钟

### 3.1 安装依赖

```bash
# SSH到VPS
ssh root@<VPS_IP>

# 安装node-cron
cd /opt/yoyo-transcoder
npm install node-cron

# 验证安装
npm list node-cron
```

### 3.2 创建PreloadScheduler

**新建文件**: `vps-transcoder-api/src/services/PreloadScheduler.js`

**核心功能** ⭐⭐⭐：
1. **服务启动时**：检测当前是否应该预加载，立即启动
2. **为每个频道**：创建2个精确的cron任务（开始+结束）
3. **定时触发**：准点执行启动/停止预加载
4. **配置重载**：支持动态更新定时任务
5. **跨天支持**：完整支持如23:00-01:00的配置

**关键方法**：
- `start()` - 启动调度器，初始化所有定时任务
- `initialize()` - 检测当前状态并创建定时任务
- `scheduleChannel()` - 为单个频道创建开始/结束任务
- `reload()` - 重新加载配置，更新定时任务
- `shouldPreloadNow()` - 判断当前时间是否在预加载时段
- `getBeijingTime()` - 获取北京时间（UTC+8）

**资源消耗对比**：
```
轮询方案：1440次/天 (每分钟检查)
精确定时：  6次/天 (3频道 × 2任务)
节省比例：  99.6%
```

### 3.3 修改app.js集成调度器

**修改文件**: `vps-transcoder-api/src/app.js`

```javascript
// 在文件顶部添加导入
const PreloadScheduler = require('./services/PreloadScheduler');

// 在SimpleStreamManager初始化后
const streamManager = new SimpleStreamManager(streamingConfig);

// 🆕 初始化预加载调度器
const preloadScheduler = new PreloadScheduler(streamManager);

// 在服务器启动回调中
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // 🆕 启动预加载调度器（延迟5秒）
  setTimeout(() => {
    preloadScheduler.start();
    console.log('✅ PreloadScheduler started');
  }, 5000);
});

// 🆕 添加预加载状态API端点
app.get('/api/preload/vps-status', (req, res) => {
  const schedulerStatus = preloadScheduler.getStatus();
  const streamManagerStatus = streamManager.getPreloadStatus();
  
  res.json({
    status: 'success',
    data: {
      scheduler: schedulerStatus,
      streamManager: streamManagerStatus
    }
  });
});

// 🆕 添加重载调度器API（配置变更时调用）
app.post('/api/preload/reload-schedule', async (req, res) => {
  try {
    await preloadScheduler.reload();
    logger.info('Preload scheduler reloaded successfully');
    
    res.json({ 
      status: 'success', 
      message: 'Schedule reloaded',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to reload schedule', { error: error.message });
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});
```

### 3.4 部署到VPS

```bash
# 提交代码
git add vps-transcoder-api/src/services/PreloadScheduler.js
git add vps-transcoder-api/src/app.js
git commit -m "feat: 添加PreloadScheduler精确定时调度器

- 为每个频道创建精确的开始/结束定时任务
- 服务启动时自动检测并启动需要的预加载
- 支持跨天时间段（如23:00-01:00）
- 新增VPS状态API和重载API端点
- 资源消耗节省99.6%（3频道仅需每天6次）"
git push

# 部署
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && ./vps-simple-deploy.sh"
```

### 3.5 验证测试

```bash
# 查看日志
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 100 | grep -E 'Preload|preload'"

# 测试VPS状态API
curl http://localhost:3000/api/preload/vps-status

# 测试重载API
curl -X POST http://localhost:3000/api/preload/reload-schedule

# ✅ 验证通过标准：
# 1. 日志显示"PreloadScheduler started"
# 2. 日志显示为每个频道创建的cron任务
# 3. 状态API返回当前活跃的预加载信息
# 4. 重载API返回成功响应
```

✅ 完成阶段3后更新进度表

---

## 🎯 阶段4：前端管理界面

**目标**：在频道管理页面添加预加载配置功能  
**影响范围**：前端Vue组件  
**风险等级**：🟢 低  
**预计时间**：90分钟

### 4.1 创建预加载配置对话框组件

**新建文件**: `frontend/src/components/PreloadConfigDialog.vue`

核心功能：
- 预加载开关（Switch）
- 开始时间选择器（TimePicker）
- 结束时间选择器（TimePicker）
- 保存/取消按钮

### 4.2 修改频道列表组件

**修改文件**: `frontend/src/views/admin/ChannelManagement.vue`

在频道列表每一行添加"预加载配置"按钮：

```vue
<template>
  <el-table-column label="操作" width="250">
    <template #default="{ row }">
      <!-- 现有按钮 -->
      <el-button size="small" @click="editChannel(row)">编辑</el-button>
      
      <!-- 🆕 预加载配置按钮 -->
      <el-button 
        size="small" 
        type="primary" 
        @click="openPreloadConfig(row)"
        :icon="Timer"
      >
        预加载
      </el-button>
    </template>
  </el-table-column>
</template>
```

### 4.3 创建Pinia Store

**新建文件**: `frontend/src/stores/preload.js`

管理预加载配置的状态和API调用。

### 4.4 添加重新加载调度器功能

**修改文件**: `frontend/src/views/admin/ChannelManagement.vue`

在频道管理页面顶部添加"重新加载调度器"按钮：

```vue
<template>
  <div class="channel-management">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>频道管理</span>
          <div>
            <!-- 🆕 重新加载调度器按钮 -->
            <el-button 
              type="warning" 
              :icon="RefreshRight"
              @click="reloadScheduler"
              :loading="reloadingScheduler"
            >
              重新加载预加载调度器
            </el-button>
            <el-button type="primary" @click="addChannel">添加频道</el-button>
          </div>
        </div>
      </template>
      
      <!-- 频道列表 -->
    </el-card>
  </div>
</template>

<script setup>
import { RefreshRight } from '@element-plus/icons-vue';

const reloadingScheduler = ref(false);

// 重新加载调度器
async function reloadScheduler() {
  try {
    reloadingScheduler.value = true;
    
    // 调用VPS API重新加载调度器
    await api.post('/api/preload/reload-schedule');
    
    ElMessage.success('预加载调度器已重新加载');
  } catch (error) {
    ElMessage.error('重新加载失败: ' + error.message);
  } finally {
    reloadingScheduler.value = false;
  }
}
</script>
```

**使用场景**：
- 修改任何频道的预加载配置后，点击此按钮立即生效
- 不需要重启VPS服务
- 立即更新所有定时任务

### 4.5 部署前端

```bash
cd frontend
npm run build
git add .
git commit -m "feat: 添加频道预加载配置界面

- 新增PreloadConfigDialog组件
- 频道列表添加预加载配置按钮
- 新增preload store管理状态
- 支持设置开始/结束时间
- 新增重新加载调度器按钮"
git push

# Cloudflare Pages自动部署（等待3-5分钟）
```

### 4.6 验证测试

**测试流程**：
1. 打开频道管理页面
2. 点击任意频道的"预加载"按钮
3. 配置预加载：
   - 开启预加载：ON
   - 开始时间：07:40
   - 结束时间：17:20
4. 保存配置（确认保存到KV成功）
5. 点击页面顶部"重新加载预加载调度器"按钮
6. 等待提示"预加载调度器已重新加载"
7. SSH到VPS查看日志，确认定时任务已创建

**验证命令**：
```bash
# 查看VPS日志
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 50 | grep -i schedule"

# 应该看到类似输出：
# Scheduled preload tasks { channelId: 'stream_ensxma2g', startCron: '40 7 * * *', stopCron: '20 17 * * *' }
```

✅ 完成阶段4后更新进度表

---

## 🎯 阶段5：健康检查和自动重启

**目标**：确保预加载进程稳定运行，崩溃自动恢复  
**影响范围**：VPS新增监控服务  
**风险等级**：🟡 中等  
**预计时间**：45分钟

### 5.1 创建PreloadHealthCheck

**新建文件**: `vps-transcoder-api/src/services/PreloadHealthCheck.js`

核心功能：
- 每5分钟检查预加载进程健康状态
- 检查FFmpeg进程是否存活
- 检查HLS文件是否正常生成
- 进程崩溃自动重启（最多3次）
- 发送告警通知（可选）

### 5.2 集成到app.js

启动健康检查服务，在app.js中初始化。

### 5.3 部署和验证

测试崩溃恢复机制（手动杀死FFmpeg进程，观察是否自动重启）。

✅ 完成阶段5后更新进度表

---

## 🎯 阶段6：完整集成测试

**目标**：端到端测试整个预加载功能  
**影响范围**：全系统验证  
**风险等级**：🟢 低  
**预计时间**：60分钟

### 6.1 功能测试清单

**测试场景1：基础配置**
- [ ] 前端配置预加载时间：07:00-17:30
- [ ] 保存成功，KV存储更新
- [ ] VPS调度器获取配置成功

**测试场景2：定时启动**
- [ ] 修改系统时间到06:59（预加载前）
- [ ] 等待1分钟，确认未启动预加载
- [ ] 修改系统时间到07:01（预加载时段内）
- [ ] 等待1分钟，确认启动预加载进程
- [ ] 用户点击频道，<0.5秒开始播放

**测试场景3：定时停止**
- [ ] 修改系统时间到17:31（预加载后）
- [ ] 等待1分钟，确认停止预加载进程
- [ ] 用户点击频道，需要等待10-15秒

**测试场景4：跨天支持**
- [ ] 配置预加载时间：23:00-01:00
- [ ] 23:01时启动预加载
- [ ] 00:30仍在预加载
- [ ] 01:01停止预加载

**测试场景5：崩溃恢复**
- [ ] 手动杀死预加载FFmpeg进程
- [ ] 5分钟内自动重启
- [ ] 重试3次后停止并告警

**测试场景6：多频道并发**
- [ ] 配置3个频道同时预加载
- [ ] 确认3个FFmpeg进程都启动
- [ ] 确认资源消耗在预期范围内

### 6.2 性能测试

| 指标 | 预期值 | 实际值 | 通过 |
|------|--------|--------|------|
| 预加载启动时间 | <30秒 | | |
| 预加载视频延迟 | <0.5秒 | | |
| CPU占用（单频道） | 10-15% | | |
| 内存占用（单频道） | 150-200MB | | |
| 3频道并发CPU | <45% | | |
| 3频道并发内存 | <600MB | | |

### 6.3 回归测试

确保新功能不影响现有功能：
- [ ] 按需转码正常工作
- [ ] 心跳清理机制正常
- [ ] 用户播放体验无影响
- [ ] 频道切换正常

✅ 完成阶段6后更新进度表

---

## 📝 实施总结模板

完成所有阶段后填写：

### 实施结果

- **开始时间**: YYYY-MM-DD HH:MM
- **完成时间**: YYYY-MM-DD HH:MM
- **总耗时**: XX小时
- **遇到的问题**: 
  1. 
  2. 
- **解决方案**:
  1. 
  2. 

### 最终验证

- [ ] 所有6个阶段验证通过
- [ ] 性能指标达标
- [ ] 用户体验良好
- [ ] 文档更新完成

### 后续优化建议

1. 
2. 
3. 

---

**文档版本**: v1.2  
**最后更新**: 2025-10-27 09:59  
**维护者**: AI Assistant

---

## 📋 版本历史

- **v1.2** (2025-10-27 09:59): 修正架构图，将PreloadScheduler从"每分钟检查"改为"精确定时任务"
- **v1.1** (2025-10-27 09:52): 优化调度策略，从轮询改为精确定时cron任务
- **v1.0** (2025-10-27 09:14): 初始版本

---