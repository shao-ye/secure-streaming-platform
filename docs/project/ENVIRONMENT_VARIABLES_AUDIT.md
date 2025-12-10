# Cloudflare Pages 环境变量使用情况审计报告

> **生成时间**: 2025-11-03  
> **审计范围**: frontend/ 目录下的所有源代码  
> **目的**: 检查Cloudflare Pages配置的环境变量使用情况，发现硬编码问题

---

## 📋 配置的环境变量清单

根据Cloudflare Pages配置截图，当前配置了以下8个环境变量：

| 序号 | 变量名 | 配置值 | 类型 | 用途 |
|------|--------|--------|------|------|
| 1 | `VITE_APP_VERSION` | `20` | 纯文本 | 应用版本号 |
| 2 | `VITE_API_BASE_URL` | `https://yoyoapi.your-domain.com` | 纯文本 | API基础URL |
| 3 | `VITE_APP_TITLE` | `YOYO流媒体平台` | 纯文本 | 应用标题 |
| 4 | `VITE_DEBUG` | `false` | 纯文本 | 调试开关 |
| 5 | `VITE_ENVIRONMENT` | `production` | 纯文本 | 运行环境 |
| 6 | `VITE_HLS_PROXY_URL` | `https://yoyoapi.your-domain.com` | 纯文本 | HLS代理URL |
| 7 | `VITE_LOG_LEVEL` | `error` | 纯文本 | 日志级别 |
| 8 | `VITE_WORKER_URL` | `https://yoyoapi.your-domain.com` | 纯文本 | Worker URL |

---

## ✅ 正确使用的环境变量

### 1. config.js（统一配置文件）✅

**文件位置**: `frontend/src/utils/config.js`

**使用情况**: ✅ **完全正确**

```javascript
export const config = {
  // 应用信息
  app: {
    title: getEnvVar('VITE_APP_TITLE', 'YOYO流媒体平台'),        // ✅
    version: getEnvVar('VITE_APP_VERSION', '1.0.0'),            // ✅
    environment: getEnvVar('VITE_ENVIRONMENT', 'development'),  // ✅
  },

  // API配置
  api: {
    baseURL: getEnvVar('VITE_API_BASE_URL', 'http://localhost:8787'), // ✅
  },

  // HLS配置
  hls: {
    proxyURL: getEnvVar('VITE_HLS_PROXY_URL', 'http://localhost:8787/hls'), // ✅
  },

  // Cloudflare Worker配置
  worker: {
    url: getEnvVar('VITE_WORKER_URL', 'https://your-worker.your-subdomain.workers.dev'), // ✅
  },

  // 调试配置
  debug: {
    enabled: getEnvVar('VITE_DEBUG', 'false') === 'true',      // ✅
    logLevel: getEnvVar('VITE_LOG_LEVEL', 'info'),             // ✅
  },
}
```

**评价**: 
- ✅ 所有8个环境变量都正确引用
- ✅ 提供了合理的默认值
- ✅ 使用了统一的`getEnvVar`函数

---

## ❌ 存在问题的代码

### 问题1: api.js 硬编码API URL

**文件位置**: `frontend/src/services/api.js`

**问题代码**:
```javascript
export class APIService {
  constructor() {
    this.baseURL = 'https://yoyoapi.your-domain.com' // ❌ 硬编码
  }
}
```

**问题分析**:
- ❌ 直接硬编码了API URL
- ❌ 没有使用 `VITE_API_BASE_URL` 环境变量
- ❌ 没有使用 `config.js` 中的配置

**建议修复**:
```javascript
import { config } from '../utils/config'

export class APIService {
  constructor() {
    this.baseURL = config.api.baseURL // ✅ 使用配置
  }
}
```

---

### 问题2: streamingApi.js 使用错误的环境变量前缀

**文件位置**: `frontend/src/services/streamingApi.js`

**问题代码**:
```javascript
// API基础配置
const API_BASE_URL = process.env.VUE_APP_API_BASE_URL || 'https://yoyoapi.your-domain.com'
```

**问题分析**:
- ❌ 使用了 `VUE_APP_*` 前缀（Vue CLI的环境变量格式）
- ❌ 项目使用的是 Vite，应该使用 `VITE_*` 前缀
- ❌ `process.env.VUE_APP_API_BASE_URL` 在Vite中始终为 `undefined`
- ❌ 导致永远使用硬编码的fallback值

**实际效果**:
```javascript
// 实际运行时
const API_BASE_URL = undefined || 'https://yoyoapi.your-domain.com'
// 结果: API_BASE_URL = 'https://yoyoapi.your-domain.com' (硬编码)
```

**建议修复**:
```javascript
import { config } from '../utils/config'

// API基础配置
const API_BASE_URL = config.api.baseURL // ✅ 使用统一配置
const API_TIMEOUT = 30000
```

或者：
```javascript
// API基础配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yoyoapi.your-domain.com'
```

---

### 问题3: axios.js 条件硬编码

**文件位置**: `frontend/src/utils/axios.js`

**问题代码**:
```javascript
const getApiBaseURL = () => {
  // 在生产环境中强制使用正确的API URL
  if (window.location.hostname === 'yoyo.your-domain.com') {
    return 'https://yoyoapi.your-domain.com'  // ❌ 硬编码
  }
  // 开发环境使用配置文件中的URL
  return config.api.baseURL  // ✅ 正确使用
}
```

**问题分析**:
- ⚠️ 生产环境硬编码了URL
- ⚠️ 虽然逻辑正确，但违反了"统一使用环境变量"的原则
- ⚠️ 如果域名变更，需要修改代码

**建议修复**:
```javascript
const getApiBaseURL = () => {
  // 始终使用配置文件中的URL（已经从环境变量读取）
  return config.api.baseURL  // ✅ 统一使用
}
```

**说明**: `config.api.baseURL` 已经从 `VITE_API_BASE_URL` 环境变量读取，生产环境配置为 `https://yoyoapi.your-domain.com`，无需额外判断。

---

### 问题4: VideoPlayer.vue 硬编码域名检查

**文件位置**: `frontend/src/components/VideoPlayer.vue`

**问题代码**:
```javascript
} else if (url.includes('yoyoapi.your-domain.com')) {  // ❌ 硬编码
  // 检查是否是代理路径
  if (url.includes('/tunnel-proxy/')) {
    return { 
      reason: '隧道优化端点',
      description: '使用Cloudflare Tunnel加速'
    }
  }
}
```

**问题分析**:
- ❌ 硬编码了域名字符串
- ❌ 如果域名变更，需要修改代码

**建议修复**:
```javascript
import { config } from '../utils/config'

// 检查是否是API域名
const apiDomain = new URL(config.api.baseURL).hostname
if (url.includes(apiDomain)) {  // ✅ 动态判断
  if (url.includes('/tunnel-proxy/')) {
    return { 
      reason: '隧道优化端点',
      description: '使用Cloudflare Tunnel加速'
    }
  }
}
```

---

## 📊 环境变量使用统计

| 环境变量 | 在config.js中引用 | 直接使用次数 | 硬编码替代次数 | 状态 |
|---------|------------------|------------|--------------|------|
| `VITE_APP_VERSION` | ✅ | 0 | 0 | ✅ 正常 |
| `VITE_API_BASE_URL` | ✅ | 0 | 3次 | ⚠️ 被硬编码 |
| `VITE_APP_TITLE` | ✅ | 0 | 0 | ✅ 正常 |
| `VITE_DEBUG` | ✅ | 0 | 0 | ✅ 正常 |
| `VITE_ENVIRONMENT` | ✅ | 0 | 0 | ✅ 正常 |
| `VITE_HLS_PROXY_URL` | ✅ | 0 | 0 | ✅ 正常 |
| `VITE_LOG_LEVEL` | ✅ | 0 | 0 | ✅ 正常 |
| `VITE_WORKER_URL` | ✅ | 0 | 0 | ✅ 正常 |

**总计**:
- ✅ **正确使用**: 8/8个环境变量在 `config.js` 中引用
- ❌ **存在硬编码**: 3处硬编码了 `VITE_API_BASE_URL` 应该使用的值
- ⚠️ **错误的变量前缀**: 1处使用了 `VUE_APP_*` 而非 `VITE_*`

---

## 🔍 其他发现

### 1. 未使用的环境变量配置

目前所有配置的环境变量都被 `config.js` 引用，但是：

- `VITE_WORKER_URL`: 在 `config.worker.url` 中定义，但代码中**未实际使用**
- `VITE_HLS_PROXY_URL`: 在 `config.hls.proxyURL` 中定义，但代码中**未找到实际使用**

**建议**: 检查这两个环境变量是否需要保留，或者补充使用逻辑。

### 2. 硬编码的URL列表

除了环境变量相关的问题，还发现以下硬编码URL：

| 文件 | 硬编码值 | 行数 | 问题 |
|------|---------|------|------|
| `api.js` | `https://yoyoapi.your-domain.com` | 第6行 | 应使用 `config.api.baseURL` |
| `streamingApi.js` | `https://yoyoapi.your-domain.com` | 第9行 | 应使用 `config.api.baseURL` |
| `axios.js` | `https://yoyoapi.your-domain.com` | 第10行 | 可移除特殊判断 |
| `VideoPlayer.vue` | `yoyoapi.your-domain.com` | 第644行 | 应动态获取域名 |

---

## 📝 修复优先级建议

### 🔴 高优先级（立即修复）

1. **streamingApi.js**: 修复 `process.env.VUE_APP_API_BASE_URL`
   - **影响**: 环境变量完全失效，始终使用硬编码
   - **风险**: 高

2. **api.js**: 移除硬编码的 `baseURL`
   - **影响**: 新创建的API服务无法动态配置
   - **风险**: 中

### 🟡 中优先级（建议修复）

3. **axios.js**: 移除条件硬编码
   - **影响**: 代码可维护性
   - **风险**: 低

4. **VideoPlayer.vue**: 动态判断域名
   - **影响**: 域名变更时的灵活性
   - **风险**: 低

### 🟢 低优先级（可选）

5. 检查 `VITE_WORKER_URL` 和 `VITE_HLS_PROXY_URL` 的实际使用情况
   - **影响**: 环境变量清理
   - **风险**: 无

---

## 💡 最佳实践建议

### 1. 统一使用 config.js

**原则**: 所有需要配置的值都应该通过 `config.js` 获取

```javascript
// ❌ 不要这样
const API_URL = 'https://yoyoapi.your-domain.com'

// ❌ 不要这样
const API_URL = import.meta.env.VITE_API_BASE_URL

// ✅ 应该这样
import { config } from '@/utils/config'
const API_URL = config.api.baseURL
```

### 2. Vite环境变量规则

**记住**:
- ✅ Vite项目使用 `VITE_*` 前缀
- ✅ 通过 `import.meta.env.VITE_XXX` 访问
- ❌ **不是** `process.env.VUE_APP_XXX`（Vue CLI）

### 3. 避免硬编码

**原则**: 任何可能变化的配置都不应该硬编码

```javascript
// ❌ 硬编码
if (window.location.hostname === 'yoyo.your-domain.com') {
  return 'https://yoyoapi.your-domain.com'
}

// ✅ 使用配置
return config.api.baseURL
```

---

## 📦 修复计划建议

### 阶段1: 立即修复（高优先级）

1. 修复 `streamingApi.js`：
   ```bash
   git checkout -b fix/env-vars-streamingApi
   # 修改代码
   git commit -m "fix: 修复streamingApi.js环境变量前缀错误"
   git push
   ```

2. 修复 `api.js`：
   ```bash
   git checkout -b fix/env-vars-api
   # 修改代码
   git commit -m "fix: 移除api.js硬编码URL，使用config"
   git push
   ```

### 阶段2: 代码优化（中优先级）

3. 优化 `axios.js`
4. 优化 `VideoPlayer.vue`

### 阶段3: 清理与验证

5. 验证所有环境变量是否生效
6. 移除未使用的环境变量配置

---

## ✅ 验证清单

修复完成后，使用以下清单验证：

- [ ] 所有组件都通过 `config.js` 获取配置
- [ ] 没有直接使用 `import.meta.env.VITE_*`（除了config.js）
- [ ] 没有硬编码的URL
- [ ] 没有使用 `process.env.VUE_APP_*`
- [ ] 环境变量在生产环境正确生效
- [ ] 在开发环境可以通过 `.env` 文件配置

---

## 📄 附录：完整的硬编码位置

### 需要修复的硬编码

1. **api.js 第6行**:
   ```javascript
   this.baseURL = 'https://yoyoapi.your-domain.com'
   ```

2. **streamingApi.js 第9行**:
   ```javascript
   const API_BASE_URL = process.env.VUE_APP_API_BASE_URL || 'https://yoyoapi.your-domain.com'
   ```

3. **axios.js 第10行**:
   ```javascript
   return 'https://yoyoapi.your-domain.com'
   ```

4. **VideoPlayer.vue 第644行**:
   ```javascript
   } else if (url.includes('yoyoapi.your-domain.com')) {
   ```

---

**报告生成**: 2025-11-03  
**审计工具**: 人工审查 + Grep搜索  
**审计人**: Cascade AI
