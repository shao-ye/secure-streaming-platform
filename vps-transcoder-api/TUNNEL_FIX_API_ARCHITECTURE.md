# 🏗️ 隧道模式修复 - 三层架构与API分析

**创建时间**: 2025-10-23 13:35  
**目的**: 分析本次修复涉及的三层架构和API定义完整性

---

## 📊 **三层架构涉及范围**

### **第一层：前端展示层 (Frontend)** 🟢

**涉及文件**: 
- `frontend/src/components/VideoPlayer.vue`

**修改内容**:
1. ✅ 数据结构重构
   - 拆分单一状态为双维度状态
   - 增加故障转移信息变量

2. ✅ UI显示更新
   - 两个独立的标签（前端路径 + 后端路径）
   - 故障警告图标和悬停提示

3. ✅ 响应头解析
   - 解析前端路径状态
   - 解析后端路径状态
   - 解析故障转移信息

**依赖**:
- 依赖Workers层返回的响应头信息
- 不直接调用VPS API

---

### **第二层：业务逻辑层 (Workers)** 🔴 (核心修复)

**涉及文件**:
- `cloudflare-worker/src/utils/tunnel-router.js`
- `cloudflare-worker/src/handlers/streams.js`
- `cloudflare-worker/src/handlers/proxy.js`
- `cloudflare-worker/src/index.js`

**修改内容**:

#### **2.1 tunnel-router.js** (核心重构)
```javascript
// 新增/修改的函数：

1. getWorkersToVPSRoute(env, request)
   - 功能：静态路由决策（基于隧道开关和地理位置）
   - 返回：{ type: 'tunnel'|'direct', endpoints: {...}, reason: '...' }
   - 调用：streams.js 和 proxy.js

2. getVPSProxyStatus(env)
   - 功能：查询VPS代理状态（仅用于信息展示）
   - API调用：GET /api/proxy/status (VPS端)
   - 返回：{ enabled: true|false, proxyName: '...', reason: '...' }
   - 调用：streams.js 和 proxy.js

3. buildVPSUrl(env, path, service, request)
   - 功能：构建VPS API URL
   - 依赖：getWorkersToVPSRoute()
   - 返回：{ url: '...', workersRoute: {...} }
```

#### **2.2 streams.js** (简化重构)
```javascript
// 删除的函数：
- callVPSDirectly()
- callVPSThroughProxy()
- callVPSThroughTunnel()
- callVPSWithIntelligentRouting()

// 新增的统一函数：
callVPSAPI(env, endpoint, requestData, request)
  - 功能：统一的VPS API调用
  - 依赖：TunnelRouter.getWorkersToVPSRoute()
  - 依赖：TunnelRouter.getVPSProxyStatus()
  - 调用VPS API：POST /api/${endpoint}
  - 返回：{ vpsResponse, workersRoute, vpsProxy }

// 修改的处理器：
startWatching处理器
  - 使用：callVPSAPI(env, 'simple-stream/start-watching', ...)
  - 调用VPS API：POST /api/simple-stream/start-watching
  - URL包装：只包装前端路径（tunnel/direct）
  - 响应头：包含前端和后端路径完整信息
```

#### **2.3 proxy.js** (响应头扩展 + 保留故障转移)
```javascript
// 保留的功能：
1. 智能故障转移逻辑
   - 内容有效性验证（M3U8/TS文件）
   - 自动降级重试（tunnel → direct）
   - 不依赖TunnelRouter

// 新增的功能：
2. 完整响应头
   - 前端路径信息：X-Route-Via, X-Tunnel-Optimized
   - 后端路径信息：X-VPS-Proxy-Status, X-Proxy-Name
   - 故障转移信息：X-Fallback-Occurred, X-Fallback-Reason
   - 性能信息：X-Response-Time, X-Country

// 依赖的VPS API：
- GET /api/proxy/status (通过TunnelRouter.getVPSProxyStatus调用)
```

#### **2.4 index.js** (路由清理)
```javascript
// 删除的路由：
router.get('/tunnel-proxy/hls/:streamId/:file', ...)

// 保留的路由：
router.get('/hls/:streamId/:file', ...)  // 统一的HLS代理路由
```

---

### **第三层：转码服务层 (VPS)** 🟢 (无需修改)

**涉及文件**:
- `src/routes/proxy.js` (已存在，无需修改)

**已有API** (已验证存在):

#### **GET /api/proxy/status** ✅
```javascript
// 功能：获取VPS代理状态
// 认证：需要 X-API-Key
// 响应格式：
{
  "status": "success",
  "data": {
    "connectionStatus": "connected" | "disconnected",
    "currentProxy": {
      "id": "proxy_001",
      "name": "US Proxy",
      "protocol": "vmess",
      "server": "us.proxy.example.com",
      "port": 443
    },
    "lastUpdate": "2025-10-23T13:00:00.000Z",
    "testResults": {...}
  }
}

// Workers调用示例：
const response = await fetch(`${env.VPS_API_URL}/api/proxy/status`, {
  headers: { 'X-API-Key': env.VPS_API_KEY },
  signal: AbortSignal.timeout(3000)
});
```

#### **POST /api/simple-stream/start-watching** ✅
```javascript
// 功能：启动频道转码
// 认证：需要 X-API-Key
// 请求格式：
{
  "channelId": "stream_xxx"
}

// 响应格式：
{
  "status": "success",
  "data": {
    "channelId": "stream_xxx",
    "channelName": "频道名称",
    "hlsUrl": "http://localhost:52535/hls/stream_xxx/playlist.m3u8",
    "pid": 12345,
    "startTime": "2025-10-23T13:00:00.000Z"
  }
}
```

**VPS端结论**: ✅ **无需修改**，所有需要的API已存在且正常工作。

---

## 🔄 **数据流与API调用链**

### **场景1：用户开始观看频道**

```
1. 用户操作
   └─> 前端：点击频道播放按钮

2. 前端层 → Workers层
   └─> API调用：无直接API调用
   └─> 前端通过 <video> 标签请求HLS URL

3. Workers层：接收start-watching请求
   └─> TunnelRouter.getWorkersToVPSRoute(env, request)
       ├─ 读取KV：RUNTIME_TUNNEL_ENABLED
       ├─ 检查地理位置：request.cf.country
       └─ 返回：{ type: 'tunnel'|'direct', endpoints: {...} }
   
   └─> callVPSAPI(env, 'simple-stream/start-watching', {channelId}, request)
       ├─ 4a. Workers层 → VPS层
       │   └─> POST ${VPS_API_URL}/api/simple-stream/start-watching
       │       Headers: { 'X-API-Key': VPS_API_KEY }
       │       Body: { "channelId": "stream_xxx" }
       │
       ├─ 4b. Workers层 → VPS层（并行查询）
       │   └─> GET ${VPS_API_URL}/api/proxy/status
       │       Headers: { 'X-API-Key': VPS_API_KEY }
       │
       └─ 整合结果并返回

5. VPS层处理
   ├─> 从KV读取频道配置
   ├─> 启动FFmpeg转码进程
   └─> 返回本地HLS URL

6. Workers层处理响应
   ├─> 包装HLS URL（基于前端路径）
   │   ├─ tunnel: https://tunnel-hls.yoyo-vps.5202021.xyz/hls/...
   │   └─ direct: https://yoyoapi.5202021.xyz/hls/...
   │
   └─> 返回给前端（包含完整响应头）

7. 前端层接收响应
   ├─> 解析HLS URL
   ├─> 解析响应头（前端路径 + 后端路径）
   └─> 显示连接状态标签
```

---

### **场景2：前端播放HLS视频**

```
1. 前端请求HLS文件
   └─> GET https://tunnel-hls.yoyo-vps.5202021.xyz/hls/stream_xxx/playlist.m3u8

2. Workers层：proxy.js处理
   ├─> TunnelRouter.buildVPSUrl(env, path, 'HLS', request)
   │   └─ 决定使用tunnel还是direct端点
   │
   ├─> TunnelRouter.getVPSProxyStatus(env)
   │   └─> 3. Workers层 → VPS层
   │       └─> GET ${VPS_API_URL}/api/proxy/status
   │
   ├─> 从VPS获取HLS文件
   │   └─> 4. Workers层 → VPS层
   │       └─> GET ${tunnel_endpoint}/hls/stream_xxx/playlist.m3u8
   │
   ├─> 内容有效性验证（故障转移逻辑）
   │   └─ 如果invalid: 自动切换到direct端点重试
   │
   └─> 返回给前端（附带完整响应头）

5. 前端接收HLS文件
   ├─> hls.js解析播放
   └─> 读取响应头更新状态显示
```

---

## 📋 **Workers层API定义清单**

### **对外API（前端调用）**

| API端点 | 方法 | 功能 | 状态 |
|--------|------|------|------|
| `/api/simple-stream/start-watching` | POST | 启动频道观看 | ✅ 需修改 |
| `/hls/:streamId/:file` | GET | HLS文件代理 | ✅ 需修改 |

### **内部函数（Workers内部）**

| 函数 | 位置 | 功能 | 状态 |
|------|------|------|------|
| `getWorkersToVPSRoute()` | tunnel-router.js | 前端路径路由决策 | 🆕 新增 |
| `getVPSProxyStatus()` | tunnel-router.js | 查询VPS代理状态 | 🆕 新增 |
| `buildVPSUrl()` | tunnel-router.js | 构建VPS URL | ✅ 简化 |
| `callVPSAPI()` | streams.js | 统一VPS API调用 | 🆕 新增 |

### **调用VPS API（Workers→VPS）**

| VPS API端点 | 方法 | 调用位置 | 状态 |
|------------|------|---------|------|
| `/api/proxy/status` | GET | tunnel-router.js | ✅ 已存在 |
| `/api/simple-stream/start-watching` | POST | streams.js | ✅ 已存在 |
| `/hls/:streamId/:file` | GET | proxy.js | ✅ 已存在 |

---

## ✅ **API完整性评估**

### **VPS层API** ✅ **完整**

所有需要的VPS API都已存在且正常工作：
- ✅ `GET /api/proxy/status` - 获取代理状态
- ✅ `POST /api/simple-stream/start-watching` - 启动转码
- ✅ `GET /hls/:streamId/:file` - 提供HLS文件

**结论**: VPS层**无需新增或修改**任何API。

---

### **Workers层API** 🔴 **需要重构**

Workers层不需要新增API，但需要重构内部逻辑：

**需要新增的内部函数**:
1. ✅ `TunnelRouter.getWorkersToVPSRoute()` - 新增
2. ✅ `TunnelRouter.getVPSProxyStatus()` - 新增  
3. ✅ `callVPSAPI()` in streams.js - 新增

**需要删除的内部函数**:
1. ❌ `callVPSDirectly()`
2. ❌ `callVPSThroughProxy()`
3. ❌ `callVPSThroughTunnel()`
4. ❌ `callVPSWithIntelligentRouting()`

**需要修改的处理器**:
1. ✅ `startWatching` - 使用新的callVPSAPI()
2. ✅ `proxy.hlsFile` - 添加完整响应头

**结论**: Workers层需要**重构内部逻辑**，但不需要改变对外API接口。

---

### **前端层API** 🟢 **无API变更**

前端层不直接调用API，通过以下方式与Workers交互：
1. ✅ 通过 `<video>` 标签的HLS URL自动请求
2. ✅ 通过HTTP响应头接收路由信息
3. ✅ 无需新增API调用

**结论**: 前端层**无需新增**任何API调用。

---

## 🎯 **API设计验证**

### **设计原则验证** ✅

1. **职责分离** ✅
   - TunnelRouter：只负责路由决策
   - streams.js：负责业务逻辑和API调用
   - proxy.js：负责文件代理和故障转移

2. **信息传递** ✅
   - 前端路径：通过TunnelRouter决策
   - 后端路径：通过VPS API查询
   - 状态信息：通过响应头传递给前端

3. **故障转移** ✅
   - 在proxy.js层面实现
   - 不依赖TunnelRouter
   - 透明的请求级重试

### **API调用链验证** ✅

```
前端 → Workers → VPS
  ↓       ↓       ↓
显示    路由    服务
       决策    提供
```

**每一层职责清晰，API定义完整。**

---

## 📊 **修复影响总结**

| 层次 | 文件数 | API变更 | 复杂度 | 风险 |
|-----|-------|---------|--------|------|
| **前端层** | 1 | 无新增 | 🟢 低 | 🟢 低 |
| **Workers层** | 4 | 无新增（重构） | 🔴 高 | 🟡 中 |
| **VPS层** | 0 | 无变更 | 🟢 无 | 🟢 无 |

---

## ✅ **结论**

### **API完整性** ✅ **通过**

1. ✅ VPS层所有需要的API都已存在
2. ✅ Workers层无需新增对外API
3. ✅ 前端层无需新增API调用
4. ✅ 三层之间的API接口定义清晰完整

### **设计合理性** ✅ **通过**

1. ✅ 职责分离明确
2. ✅ 数据流向清晰
3. ✅ 故障处理完善
4. ✅ 向后兼容性好

### **实施可行性** ✅ **通过**

**无需新增任何API**，只需重构Workers层内部逻辑，可以直接开始实施修复！

---

**文档创建时间**: 2025-10-23 13:35  
**API验证结果**: ✅ **完整且设计合理**
