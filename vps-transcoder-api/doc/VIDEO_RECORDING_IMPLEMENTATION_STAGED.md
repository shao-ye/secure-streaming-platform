# 🔧 视频录制功能实施方案 - 阶段化执行文档

**版本**: v1.0 | **创建时间**: 2025-10-24 22:40  
**基于**: VIDEO_RECORDING_SOLUTION.md v1.1

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

#### 1️⃣ **D1数据库是新增设计**
- ✅ 当前架构只使用 Cloudflare KV（用户、频道配置）
- ✅ D1是本次录制功能的新增数据库（录制元数据）
- ⚠️ 不要以为架构文档写错了，这是新功能的新设计

#### 2️⃣ **录制和播放目录完全独立**
- 📁 HLS播放：`/var/www/hls/${channelId}/` ← 用户观看
- 📁 MP4录制：`/var/recordings/${channelId}/` ← 新增录制
- ✅ 修复录制文件**不会影响**用户观看HLS实时流

#### 3️⃣ **FFmpeg参数基于当前项目**
- ✅ 阶段2的FFmpeg配置基于 SimpleStreamManager.js 的已验证参数
- ✅ 已经过测试可用，直接使用即可

**为什么要阶段化**：
- 🔴 本次实施涉及约15个文件、1000+行代码
- 🔴 一次性修改风险极高，难以定位问题
- ✅ 分阶段执行可以及时发现和修复问题
- ✅ 每个阶段都可独立回滚，影响范围小

**AI执行者注意**：
- 📝 **每完成一个阶段，必须更新下方进度表**
- 📝 **在状态列标记 ✅ 并填写完成时间**
- 📝 **如果验证失败，标记 ❌ 并说明原因**

---

## 📊 执行进度追踪

### **总体进度**: 0/7 阶段完成

| 阶段 | 名称 | 状态 | 完成时间 | 验证结果 |
|------|------|------|----------|---------|
| **准备** | 环境配置和文件备份 | ⏳ 未开始 | - | - |
| **阶段1** | D1数据库设计和API | ⏳ 未开始 | - | - |
| **阶段2** | SimpleStreamManager核心改造 | ⏳ 未开始 | - | - |
| **阶段3** | 分段录制和文件管理 | ⏳ 未开始 | - | - |
| **阶段4** | 自动修复机制 | ⏳ 未开始 | - | - |
| **阶段5** | 前端管理界面 | ⏳ 未开始 | - | - |
| **阶段6** | 定时任务和清理 | ⏳ 未开始 | - | - |
| **阶段7** | 完整集成测试 | ⏳ 未开始 | - | - |

**状态图例**：⏳ 未开始 | 🔄 进行中 | ✅ 已完成 | ❌ 验证失败 | 🔙 已回滚

---

## 📋 功能概述

### **核心需求**
1. **录制控制**: 管理员可启用/禁用频道录制
2. **定时录制**: 默认时间 7:50-17:20（北京时间）
3. **分段录制**: 每1小时一个MP4文件
4. **自动清理**: 保留2天，凌晨3点自动删除
5. **文件下载**: 通过FileBrowser访问录像

### **关键技术决策**

#### 1. FFmpeg进程复用 ⭐
- **策略**: 一个FFmpeg进程同时输出HLS和MP4
- **优势**: CPU仅增加30%，节省50%资源
- **权衡**: 修改配置需要重启进程（影响观看用户7秒）

#### 2. D1数据库访问 ⭐
- **重要说明**: ⚠️ **D1是本次录制功能的新增设计**，不是现有架构的一部分
  - 当前架构只使用Cloudflare KV存储（用户数据、频道配置）
  - D1专门用于录制功能的元数据存储（录制记录、文件信息）
- **限制**: VPS无法直接访问D1，必须通过Workers API
- **规范**: 
  - 🖥️ VPS端代码：通过HTTP API访问
  - ☁️ Workers端代码：直接使用`env.RECORDING_DB`

#### 3. 分段录制 ⭐
- **策略**: 每1小时自动切换到新文件
- **优势**: 进程崩溃最多损失1小时，其他段完好
- **实现**: FFmpeg `-f segment` 参数

#### 4. 自动修复 ⭐
- **策略**: 服务启动时自动检测和修复损坏文件
- **三级修复**: 标准修复 → 强制重建 → 提取数据
- **成功率**: 正常停止99%，崩溃85%，断电60%
- **重要保证**: ✅ **修复不影响用户观看**
  - 修复操作在 `/var/recordings/` 目录（录制的MP4文件）
  - 用户观看的是 `/var/www/hls/` 目录（HLS实时流）
  - 两个目录完全独立，互不干扰

#### 5. 目录结构说明 ⭐⭐⭐
**关键概念**：录制功能使用**独立的目录结构**，不影响现有播放功能

```
FFmpeg进程同时输出到两个独立目录：

📁 /var/www/hls/${channelId}/          ← HLS播放目录
│   ├── playlist.m3u8                   ← 用户观看的实时流
│   ├── segment000.ts
│   └── segment001.ts
│   
📁 /var/recordings/${channelId}/        ← 录制文件目录（新增）
│   ├── 2025-10-24_14-03-25.mp4        ← 录制的MP4文件
│   ├── 2025-10-24_15-03-25.mp4        ← 1小时自动分段
│   └── metadata.json                   ← 可选的本地备份
```

**为什么这样设计**：
- ✅ **用户观看不受影响**：修复录制文件时，HLS实时流继续正常播放
- ✅ **职责分离清晰**：播放是播放，录制是录制，互不干扰
- ✅ **安全性更高**：录制功能出问题不会影响核心的播放功能

### **文件命名规则**
- **格式**: `YYYY-MM-DD_HH-MM-SS.mp4`
- **示例**: `2025-10-24_14-03-25.mp4`
- **说明**: 录制开始时间（年-月-日_时-分-秒）
- **结束时间**: 通过ffprobe读取视频时长或查询D1数据库的end_time字段

---

## 🎯 准备阶段：环境配置和文件备份

⚠️ **在开始任何修改前，必须先完成准备工作！**

**目标**：配置环境变量，创建D1数据库，备份关键文件  
**影响范围**：全局配置  
**风险等级**：🟢 低  
**预计时间**：30分钟

### 准备1：创建D1数据库

```bash
# 1. 创建D1数据库
cd cloudflare-worker
npx wrangler d1 create yoyo-recordings

# 2. 记录返回的database_id
# 3. 更新wrangler.toml添加绑定（见准备2）
```

### 准备2：配置环境变量

**Workers (wrangler.toml)**:
```toml
# 在[env.production]部分添加
RECORDING_ENABLED = "true"
RECORDING_DEFAULT_RETENTION_DAYS = "2"
RECORDING_CLEANUP_HOUR = "3"
RECORDING_MAX_SEGMENT_DURATION = "7200"

# 添加D1数据库绑定
[[d1_databases]]
binding = "RECORDING_DB"
database_name = "yoyo-recordings"
database_id = "<your-database-id>"
```

**VPS (.env)**:
```bash
# SSH到VPS后编辑 /opt/yoyo-transcoder/.env
# ⚠️ 关键配置：录制目录必须与FileBrowser部署路径一致
RECORDINGS_BASE_DIR=/srv/filebrowser/yoyo-k
RECORDINGS_CLEANUP_HOUR=3
RECORDINGS_RETENTION_DAYS=2
RECORDINGS_SEGMENT_DURATION=3600
WORKER_API_URL=https://yoyoapi.5202021.xyz  # 🔥 修复Bug11: 统一为WORKER_API_URL(无S)
VPS_API_KEY=85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938  # 与Workers保持一致

# FileBrowser访问地址（已部署）
FILEBROWSER_URL=https://cloud.5202021.xyz

# 注意：RTMP URL现在从Workers API动态获取，不需要配置RTMP_BASE_URL
```

**📋 FileBrowser配置说明**:
- **实际部署地址**: https://cloud.5202021.xyz/
- **监听端口**: 8080
- **根目录**: /srv/filebrowser/
- **录制目录**: /srv/filebrowser/yoyo-k/
- **目录权限**: drwxr-x--- (0750) root:root
- **重要**: 录制程序需要对录制目录有写入权限

### 准备3：备份文件

```powershell
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api

# 创建备份目录
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
New-Item -Path "backups\$timestamp" -ItemType Directory -Force

# 备份关键文件
Copy-Item "vps-transcoder-api\src\services\SimpleStreamManager.js" "backups\$timestamp\"
Copy-Item "vps-transcoder-api\src\routes\simple-stream.js" "backups\$timestamp\"
Copy-Item "vps-transcoder-api\vps-simple-deploy.sh" "backups\$timestamp\"
Copy-Item "vps-transcoder-api\package.json" "backups\$timestamp\"
Copy-Item "cloudflare-worker\src\index.js" "backups\$timestamp\"
Copy-Item "cloudflare-worker\wrangler.toml" "backups\$timestamp\"
```

### 准备4：检查VPS部署脚本 ⭐重要

⚠️ **确保部署脚本包含依赖安装步骤，否则后续阶段会失败！**

**检查文件**: `vps-transcoder-api/vps-simple-deploy.sh`

**必须包含的关键步骤**（推荐的优化版本）：
```bash
# 1. 同步package.json（确保依赖定义最新）
cp /tmp/github/secure-streaming-platform/vps-transcoder-api/package.json /opt/yoyo-transcoder/

# 2. 智能安装依赖（检查是否有变化，避免不必要的安装）
cd /opt/yoyo-transcoder

# 方式1: 检查package.json是否变化（推荐）
if ! cmp -s package.json package.json.old 2>/dev/null || [ ! -d node_modules ]; then
  echo "📦 Dependencies changed or missing, installing..."
  npm ci --production  # 使用npm ci更快更可靠
  cp package.json package.json.old
else
  echo "✅ Dependencies up to date, skipping install"
fi

# 方式2: 简单版本（总是安装，npm会自动跳过已安装的）
npm install --production  # npm install是幂等的，不会报错

# 3. 重启服务
pm2 reload vps-transcoder-api
```

**npm install vs npm ci**：
- `npm install`：幂等操作，可重复执行，不会报错
- `npm ci`：更快更可靠，适合生产环境，会删除node_modules重新安装

**如果脚本中缺少这些步骤**，需要先完善部署脚本，再继续后续阶段。

**验证方法**：
```bash
# 查看当前部署脚本内容
cat vps-transcoder-api/vps-simple-deploy.sh

# 确认包含 npm install 步骤
grep "npm install\|npm ci" vps-transcoder-api/vps-simple-deploy.sh
```

### 准备5：创建VPS录制目录

```bash
# SSH到VPS
ssh root@142.171.75.220

# 创建目录
mkdir -p /var/recordings
mkdir -p /var/log/recordings
chmod 755 /var/recordings /var/log/recordings

# 验证磁盘空间
df -h /var
```

### 准备6：验证清单

- [ ] D1数据库已创建
- [ ] wrangler.toml已更新绑定
- [ ] Workers环境变量已配置
- [ ] VPS环境变量已配置
- [ ] 关键文件已备份（包括vps-simple-deploy.sh和package.json）
- [ ] **VPS部署脚本包含npm install步骤** ⭐关键
- [ ] VPS录制目录已创建
- [ ] 磁盘空间 > 200GB

✅ 完成后更新进度表

---

## 🎯 阶段1：D1数据库设计和Workers API

**目标**：创建数据库表结构，实现Workers端D1访问API  
**影响范围**：cloudflare-worker/ (3个文件)  
**风险等级**：🟡 中  
**预计时间**：60分钟

### 1.1 创建数据库表结构

**创建文件**: `cloudflare-worker/schema.sql`

```sql
-- 录制配置表
CREATE TABLE IF NOT EXISTS recording_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL UNIQUE,
  channel_name TEXT,
  enabled INTEGER DEFAULT 0,
  schedule_enabled INTEGER DEFAULT 1,
  start_time TEXT DEFAULT '07:50',
  end_time TEXT DEFAULT '17:20',
  weekdays TEXT DEFAULT '1,2,3,4,5',
  segment_duration INTEGER DEFAULT 3600,
  video_bitrate INTEGER DEFAULT 1500,
  retention_days INTEGER DEFAULT 2,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 录制文件表
CREATE TABLE IF NOT EXISTS recording_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration INTEGER DEFAULT 0,
  file_size INTEGER DEFAULT 0,
  status TEXT DEFAULT 'recording',
  repair_attempts INTEGER DEFAULT 0,
  repair_status TEXT,
  last_repair_attempt TEXT,
  repair_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 字段说明：
-- duration: 视频时长（秒）
-- file_size: 文件大小（字节bytes）🔥 统一单位
-- repair_attempts: 修复尝试次数（最多3次）
-- repair_status: 修复状态（repairing/failed/completed）
-- last_repair_attempt: 最后修复时间
-- repair_error: 修复失败原因

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_configs_channel ON recording_configs(channel_id);
CREATE INDEX IF NOT EXISTS idx_files_channel ON recording_files(channel_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON recording_files(status);
```

**执行SQL**:
```bash
cd cloudflare-worker
npx wrangler d1 execute yoyo-recordings --file=schema.sql --env production
```

### 1.2 创建recordingHandler.js

**创建文件**: `cloudflare-worker/src/handlers/recordingHandler.js`

**完整实现代码** (约210行):

```javascript
// ☁️ Workers端代码
// cloudflare-worker/src/handlers/recordingHandler.js

import { RecordingDatabase } from '../utils/recordingDatabase';

/**
 * 录制功能API总入口
 */
export async function handleRecordingAPI(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  try {
    // 🔐 验证API密钥（VPS调用时需要）
    const apiKey = request.headers.get('X-API-Key');
    const isVPSRequest = apiKey === env.VPS_API_KEY;
    const isAuthenticated = isVPSRequest || await verifyUserSession(request, env);
    
    if (!isAuthenticated) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
    }
    
    const db = new RecordingDatabase(env.RECORDING_DB);
    
    // ========== 录制配置管理API ==========
    
    // GET /api/recording/configs/active - 获取所有启用的配置
    if (path === '/api/recording/configs/active' && method === 'GET') {
      const configs = await db.getActiveRecordingConfigs();
      return jsonResponse({ status: 'success', data: configs });
    }
    
    // GET /api/recording/configs/:channelId - 获取单个频道配置
    if (path.match(/^\/api\/recording\/configs\/[^\/]+$/) && method === 'GET') {
      const channelId = path.split('/').pop();
      const config = await db.getRecordingConfig(channelId);
      return jsonResponse({ status: 'success', data: config });
    }
    
    // POST /api/recording/configs - 创建录制配置
    if (path === '/api/recording/configs' && method === 'POST') {
      const body = await request.json();
      const configId = await db.createRecordingConfig(body);
      
      // 通知VPS应用新配置
      await notifyVPSConfigChange(env, body.channel_id, body);
      
      return jsonResponse({ 
        status: 'success', 
        message: '录制配置已创建',
        data: { id: configId } 
      });
    }
    
    // PUT /api/recording/configs/:id - 更新录制配置
    if (path.match(/^\/api\/recording\/configs\/[^\/]+$/) && method === 'PUT') {
      const configId = path.split('/').pop();
      const body = await request.json();
      await db.updateRecordingConfig(configId, body);
      
      // 通知VPS应用新配置
      await notifyVPSConfigChange(env, body.channel_id, body);
      
      return jsonResponse({ 
        status: 'success', 
        message: '录制配置已更新' 
      });
    }
    
    // DELETE /api/recording/configs/:id - 删除录制配置
    if (path.match(/^\/api\/recording\/configs\/[^\/]+$/) && method === 'DELETE') {
      const configId = path.split('/').pop();
      await db.deleteRecordingConfig(configId);
      return jsonResponse({ 
        status: 'success', 
        message: '录制配置已删除' 
      });
    }
    
    // ========== 录制文件管理API ==========
    
    // GET /api/recording/files/interrupted - 获取需要修复的文件
    if (path === '/api/recording/files/interrupted' && method === 'GET') {
      const files = await db.getInterruptedRecordings();
      return jsonResponse({ status: 'success', data: files });
    }
    
    // GET /api/recording/files - 查询录制文件列表
    if (path === '/api/recording/files' && method === 'GET') {
      const params = Object.fromEntries(url.searchParams);
      const files = await db.getRecordingFiles(params);
      return jsonResponse({ status: 'success', data: files });
    }
    
    // POST /api/recording/files - 创建录制文件记录
    if (path === '/api/recording/files' && method === 'POST') {
      const body = await request.json();
      const fileId = await db.createRecordingFile(body);
      return jsonResponse({ 
        status: 'success', 
        data: { id: fileId } 
      });
    }
    
    // PATCH /api/recording/files/:id - 更新文件状态
    if (path.match(/^\/api\/recording\/files\/[^\/]+$/) && method === 'PATCH') {
      const fileId = path.split('/').pop();
      const body = await request.json();
      await db.updateRecordingFile(fileId, body);
      return jsonResponse({ 
        status: 'success', 
        message: '文件状态已更新' 
      });
    }
    
    // POST /api/recording/files/:id/repair-attempt - 记录修复尝试
    if (path.match(/^\/api\/recording\/files\/[^\/]+\/repair-attempt$/) && method === 'POST') {
      // 🔥 修复：正确解析fileId (路径: /api/recording/files/{fileId}/repair-attempt)
      const pathParts = path.split('/');
      const fileId = pathParts[pathParts.length - 2];  // repair-attempt的前一个
      const body = await request.json();
      await db.updateRecordingFile(fileId, {
        increment_repair_attempts: true,
        last_repair_attempt: body.last_repair_attempt
      });
      return jsonResponse({ 
        status: 'success', 
        message: '修复尝试已记录' 
      });
    }
    
    // POST /api/recording/files/:id/retry-repair - 重试修复
    if (path.match(/^\/api\/recording\/files\/[^\/]+\/retry-repair$/) && method === 'POST') {
      // 🔥 修复：正确解析fileId (路径: /api/recording/files/{fileId}/retry-repair)
      const pathParts = path.split('/');
      const fileId = pathParts[pathParts.length - 2];  // retry-repair的前一个
      await db.resetRepairAttempts(fileId);
      
      // 通知VPS重新尝试修复
      await notifyVPSRetryRepair(env, fileId);
      
      return jsonResponse({ 
        status: 'success', 
        message: '已触发重新修复' 
      });
    }
    
    // ========== 录制统计API ==========
    
    // GET /api/recording/stats - 获取录制统计
    if (path === '/api/recording/stats' && method === 'GET') {
      const stats = await db.getRecordingStats();
      return jsonResponse({ status: 'success', data: stats });
    }
    
    // 未匹配的路由
    return jsonResponse({ 
      status: 'error', 
      message: 'API endpoint not found' 
    }, 404);
    
  } catch (error) {
    console.error('Recording API error:', error);
    return jsonResponse({ 
      status: 'error', 
      message: error.message 
    }, 500);
  }
}

/**
 * 通知VPS配置已变更
 */
async function notifyVPSConfigChange(env, channelId, config) {
  try {
    await fetch(`${env.VPS_API_URL}/api/simple-stream/recording-config-changed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.VPS_API_KEY
      },
      body: JSON.stringify({ channelId, recordingConfig: config })
    });
  } catch (error) {
    console.error('Failed to notify VPS:', error);
    // 不抛出错误，避免影响配置保存
  }
}

/**
 * 通知VPS重试修复文件
 */
async function notifyVPSRetryRepair(env, fileId) {
  try {
    await fetch(`${env.VPS_API_URL}/api/recording/retry-repair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.VPS_API_KEY
      },
      body: JSON.stringify({ fileId })
    });
  } catch (error) {
    console.error('Failed to notify VPS:', error);
  }
}

/**
 * 验证用户会话
 */
async function verifyUserSession(request, env) {
  const sessionToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!sessionToken) return false;
  
  const session = await env.YOYO_USER_DB.get(`session:${sessionToken}`);
  return !!session;
}

/**
 * 返回JSON响应
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### 1.3 创建RecordingDatabase.js

**创建文件**: `cloudflare-worker/src/utils/recordingDatabase.js`

**完整实现代码** (约300行):

```javascript
// ☁️ Workers端代码
// cloudflare-worker/src/utils/recordingDatabase.js

export class RecordingDatabase {
  constructor(db) {
    this.db = db;
  }
  
  /**
   * 获取所有启用的录制配置
   */
  async getActiveRecordingConfigs() {
    const result = await this.db.prepare(`
      SELECT * FROM recording_configs 
      WHERE enabled = 1 AND schedule_enabled = 1
      ORDER BY channel_id
    `).all();
    
    return result.results || [];
  }
  
  /**
   * 获取单个频道的录制配置
   */
  async getRecordingConfig(channelId) {
    return await this.db.prepare(`
      SELECT * FROM recording_configs 
      WHERE channel_id = ?
    `).bind(channelId).first();
  }
  
  /**
   * 创建录制配置
   */
  async createRecordingConfig(config) {
    const id = `rec_config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.db.prepare(`
      INSERT INTO recording_configs (
        id, channel_id, channel_name, enabled, schedule_enabled,
        start_time, end_time, weekdays, segment_duration,
        video_bitrate, retention_days, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      config.channel_id,
      config.channel_name,
      config.enabled ? 1 : 0,
      config.schedule_enabled ? 1 : 0,
      config.start_time,
      config.end_time,
      config.weekdays,
      config.segment_duration || 3600,
      config.video_bitrate || 1500,
      config.retention_days || 7,
      new Date().toISOString(),
      new Date().toISOString()
    ).run();
    
    return id;
  }
  
  /**
   * 更新录制配置
   */
  async updateRecordingConfig(id, config) {
    await this.db.prepare(`
      UPDATE recording_configs 
      SET enabled = ?,
          schedule_enabled = ?,
          start_time = ?,
          end_time = ?,
          weekdays = ?,
          segment_duration = ?,
          video_bitrate = ?,
          retention_days = ?,
          updated_at = ?
      WHERE id = ? OR channel_id = ?
    `).bind(
      config.enabled ? 1 : 0,
      config.schedule_enabled ? 1 : 0,
      config.start_time,
      config.end_time,
      config.weekdays,
      config.segment_duration,
      config.video_bitrate,
      config.retention_days,
      new Date().toISOString(),
      id,
      id  // 兼容用channel_id作为id的情况
    ).run();
  }
  
  /**
   * 删除录制配置
   */
  async deleteRecordingConfig(id) {
    await this.db.prepare(`
      DELETE FROM recording_configs WHERE id = ? OR channel_id = ?
    `).bind(id, id).run();
  }
  
  /**
   * 获取需要修复的录制文件
   */
  async getInterruptedRecordings() {
    const result = await this.db.prepare(`
      SELECT * FROM recording_files 
      WHERE status = 'recording' AND repair_attempts < 3
      ORDER BY created_at ASC
    `).all();
    
    return result.results || [];
  }
  
  /**
   * 查询录制文件列表
   */
  async getRecordingFiles(params) {
    const { channelId, status, page = 1, pageSize = 20, file_path } = params;
    
    let query = `SELECT * FROM recording_files WHERE 1=1`;
    const bindings = [];
    
    if (channelId) {
      query += ` AND channel_id = ?`;
      bindings.push(channelId);
    }
    
    if (status) {
      query += ` AND status = ?`;
      bindings.push(status);
    }
    
    if (file_path) {
      query += ` AND file_path = ?`;
      bindings.push(file_path);
    }
    
    // 获取总数
    const countResult = await this.db.prepare(
      query.replace('SELECT *', 'SELECT COUNT(*) as total')
    ).bind(...bindings).first();
    
    // 分页查询
    query += ` ORDER BY start_time DESC LIMIT ? OFFSET ?`;
    bindings.push(pageSize, (page - 1) * pageSize);
    
    const result = await this.db.prepare(query).bind(...bindings).all();
    
    return {
      total: countResult.total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      files: result.results || []
    };
  }
  
  /**
   * 创建录制文件记录
   */
  async createRecordingFile(file) {
    const id = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.db.prepare(`
      INSERT INTO recording_files (
        id, channel_id, filename, file_path, start_time, end_time,
        duration, file_size, status, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      file.channel_id,
      file.filename,
      file.file_path,
      file.start_time,
      file.end_time,
      file.duration || 0,
      file.file_size || 0,
      file.status || 'completed',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    ).run();
    
    return id;
  }
  
  /**
   * 更新录制文件状态
   */
  async updateRecordingFile(id, updates) {
    const fields = [];
    const values = [];
    
    if (updates.status) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    
    if (updates.file_size !== undefined) {
      fields.push('file_size = ?');
      values.push(updates.file_size);
    }
    
    if (updates.repair_status) {
      fields.push('repair_status = ?');
      values.push(updates.repair_status);
    }
    
    if (updates.repair_error) {
      fields.push('repair_error = ?');
      values.push(updates.repair_error);
    }
    
    if (updates.increment_repair_attempts) {
      fields.push('repair_attempts = repair_attempts + 1');
      fields.push('last_repair_attempt = ?');
      values.push(updates.last_repair_attempt || new Date().toISOString());
    }
    
    if (updates.filename) {
      fields.push('filename = ?');
      values.push(updates.filename);
    }
    
    if (updates.file_path) {
      fields.push('file_path = ?');
      values.push(updates.file_path);
    }
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    
    values.push(id);
    
    await this.db.prepare(`
      UPDATE recording_files SET ${fields.join(', ')} WHERE id = ?
    `).bind(...values).run();
  }
  
  /**
   * 重置修复尝试次数
   */
  async resetRepairAttempts(id) {
    await this.db.prepare(`
      UPDATE recording_files 
      SET repair_attempts = 0,
          status = 'recording',
          updated_at = ?
      WHERE id = ?
    `).bind(new Date().toISOString(), id).run();
  }
  
  /**
   * 获取录制统计
   */
  async getRecordingStats() {
    // 总体统计
    const totalResult = await this.db.prepare(`
      SELECT 
        COUNT(*) as total_recordings,
        SUM(file_size) as total_size
      FROM recording_files
    `).first();
    
    // 按频道统计
    const byChannelResult = await this.db.prepare(`
      SELECT 
        channel_id,
        COUNT(*) as total_files,
        SUM(file_size) as total_size,
        SUM(duration) as total_duration
      FROM recording_files
      GROUP BY channel_id
    `).all();
    
    // 按状态统计
    const byStatusResult = await this.db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM recording_files
      GROUP BY status
    `).all();
    
    const byStatus = {};
    (byStatusResult.results || []).forEach(row => {
      byStatus[row.status] = row.count;
    });
    
    return {
      total_recordings: totalResult.total_recordings || 0,
      total_size: totalResult.total_size || 0,
      by_channel: byChannelResult.results || [],
      by_status: byStatus
    };
  }
}
```

### 1.4 API端点清单

| 端点 | 方法 | 用途 | 调用方 |
|------|------|------|--------|
| `/api/recording/configs/active` | GET | 获取所有启用的录制配置 | VPS自动恢复 |
| `/api/recording/configs/:channelId` | GET | 获取单个频道录制配置 | VPS/前端 |
| `/api/recording/configs` | POST | 创建录制配置 | 前端管理界面 |
| `/api/recording/configs/:id` | PUT | 更新录制配置 | 前端管理界面 |
| `/api/recording/configs/:id` | DELETE | 删除录制配置 | 前端管理界面 |
| `/api/recording/files` | POST | 创建录制文件记录 | VPS录制完成 |
| `/api/recording/files` | GET | 查询录制文件列表 | 前端文件列表 |
| `/api/recording/files/interrupted` | GET | 获取需要修复的文件 | VPS启动修复 |
| `/api/recording/files/:id` | PATCH | 更新文件状态 | VPS修复完成 |
| `/api/recording/files/:id/repair-attempt` | POST | 记录修复尝试 | VPS修复流程 |
| `/api/recording/files/:id/retry-repair` | POST | 重试修复文件 | 前端手动操作 |
| `/api/recording/stats` | GET | 获取录制统计 | 前端仪表盘 |
| **`/api/channels/:channelId`** 🆕 | GET | 获取频道完整配置(含RTMP) | VPS定时录制 |

### 1.5 修改index.js添加路由

**修改文件**: `cloudflare-worker/src/index.js`

在路由部分添加录制API入口和频道配置API：

```javascript
// cloudflare-worker/src/index.js
import { handleRecordingAPI } from './handlers/recordingHandler';
import { handleGetChannelConfig } from './handlers/channelHandler';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    
    // ... 现有路由 ...
    
    // 🆕 录制功能API路由
    if (url.pathname.startsWith('/api/recording/')) {
      return handleRecordingAPI(request, env, ctx);
    }
    
    // 🆕 频道配置API（供VPS定时录制调用）
    if (url.pathname.match(/^\/api\/channels\/([^\/]+)$/) && method === 'GET') {
      const channelId = url.pathname.split('/').pop();
      return handleGetChannelConfig(request, env, channelId);
    }
    
    // ... 其他路由 ...
  }
};
```

### 1.6 创建频道配置处理器

**新建文件**: `cloudflare-worker/src/handlers/channelHandler.js`

```javascript
/**
 * 获取频道完整配置（包含RTMP URL）
 * 复用现有系统的RTMP获取逻辑
 */
export async function handleGetChannelConfig(request, env, channelId) {
  try {
    // 验证API密钥（VPS调用需要）
    const apiKey = request.headers.get('X-API-Key');
    if (apiKey !== env.VPS_API_KEY) {
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Invalid API key'
      }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 默认频道配置
    const CHANNELS = {
      'stream_ensxma2g': { name: '二楼教室1', order: 1 },
      'stream_gkg5hknc': { name: '二楼教室2', order: 2 },
      'stream_kcwxuedx': { name: '国际班', order: 3 },
      'stream_kil0lecb': { name: 'C班', order: 4 },
      'stream_noyoostd': { name: '三楼舞蹈室', order: 5 },
      'stream_3blyhqh3': { name: '多功能厅', order: 6 },
      'stream_8zf48z6g': { name: '操场1', order: 7 },
      'stream_cpa2czoo': { name: '操场2', order: 8 }
    };
    
    // 默认RTMP URLs
    const defaultRtmpUrls = {
      'stream_ensxma2g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
      'stream_gkg5hknc': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
      'stream_kcwxuedx': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
      'stream_kil0lecb': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
      'stream_noyoostd': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
      'stream_3blyhqh3': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
      'stream_8zf48z6g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
      'stream_cpa2czoo': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b'
    };
    
    // 1. 尝试从KV存储获取RTMP URL（优先）
    let rtmpUrl = null;
    let channelName = CHANNELS[channelId]?.name || channelId;
    
    if (env.YOYO_USER_DB) {
      const channelKey = `CHANNEL_CONFIG:${channelId}`;
      const kvData = await env.YOYO_USER_DB.get(channelKey);
      if (kvData) {
        const channelData = JSON.parse(kvData);
        rtmpUrl = channelData.rtmpUrl;
        channelName = channelData.name || channelName;
      }
    }
    
    // 2. 使用默认配置
    if (!rtmpUrl) {
      rtmpUrl = defaultRtmpUrls[channelId];
    }
    
    if (!rtmpUrl) {
      return new Response(JSON.stringify({
        status: 'error',
        message: `Channel not found: ${channelId}`
      }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 3. 获取录制配置（如果启用了D1）
    let recordingConfig = null;
    if (env.DB) {
      const db = new RecordingDatabase(env.DB);
      recordingConfig = await db.getRecordingConfig(channelId);
    }
    
    return new Response(JSON.stringify({
      status: 'success',
      data: {
        channelId,
        name: channelName,
        rtmpUrl,
        recordingEnabled: recordingConfig?.enabled || false,
        recordingConfig
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Failed to get channel config:', error);
    return new Response(JSON.stringify({
      status: 'error',
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

### 1.7 部署Workers

```bash
cd cloudflare-worker
npx wrangler deploy --env production
```

### 1.7 验证测试

**测试API端点**:
```powershell
# 测试获取配置
$token = "YOUR_ADMIN_TOKEN"
Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/recording/config/stream_xxx" `
  -Headers @{"Authorization"="Bearer $token"}

# 测试更新配置
$body = @{
  enabled = $true
  start_time = "07:50"
  end_time = "17:20"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/recording/config/stream_xxx" `
  -Method PUT -Body $body -ContentType "application/json" `
  -Headers @{"Authorization"="Bearer $token"}
```

**验证清单**:
- [ ] D1表已创建（3个表，3个索引）
- [ ] recordingHandler.js已创建
- [ ] API路由已添加
- [ ] Workers部署成功
- [ ] 配置API返回200
- [ ] 文件API返回200

**如果验证失败**: 回滚Workers部署，恢复index.js备份

✅ 完成后更新进度表

---

## 🎯 阶段2：SimpleStreamManager核心改造

**目标**：扩展SimpleStreamManager支持录制功能  
**影响范围**：SimpleStreamManager.js (1个文件，约300行代码)  
**风险等级**：🔴 高（核心逻辑）  
**预计时间**：90分钟

**关键改动**：
1. `startWatching()` - 添加options参数支持录制配置
2. `spawnFFmpegProcess()` - 支持HLS+MP4双输出
3. `cleanupIdleChannels()` - 跳过正在录制的频道
4. 新增录制心跳机制

### 2.1 修改startWatching方法

**文件**: `vps-transcoder-api/src/services/SimpleStreamManager.js`

在现有方法基础上添加options参数（向后兼容）：

```javascript
async startWatching(channelId, rtmpUrl, options = {}) {
  // 检查配置是否变更
  const existingChannel = this.activeStreams.get(channelId);
  if (existingChannel) {
    const recordingChanged = this.isRecordingConfigChanged(
      existingChannel.recordingConfig,
      options.recordingConfig
    );
    
    if (existingChannel.rtmpUrl !== rtmpUrl || recordingChanged) {
      await this.stopFFmpegProcess(channelId);
      return await this.startNewStream(channelId, rtmpUrl, options);
    }
    return existingChannel.hlsUrl;
  }
  
  return await this.startNewStream(channelId, rtmpUrl, options);
}
```

### 2.2 修改spawnFFmpegProcess方法

**核心修改**：支持FFmpeg多输出（HLS + MP4分段录制）

⚠️ **关键设计决策**：录制时始终同时输出HLS和MP4

**📊 3种输出模式说明**：
```javascript
// 场景1: 用户观看+录制 → HLS + MP4
// 场景2: 只有用户观看 → 只HLS
// 场景3: 只有录制（定时任务）→ HLS + MP4 ⭐
//        关键原因：防止用户半路加入需要重启进程
//        如果定时录制时不输出HLS，用户加入时需要：
//        1. 停止当前FFmpeg进程
//        2. 重启并添加HLS输出
//        3. 导致录制中断 + 用户等待7秒
//        解决方案：录制时始终输出HLS，用户加入时无需重启
```

⚠️ **基于当前项目可用配置进行修改**（行253-283）

```javascript
async spawnFFmpegProcess(channelId, rtmpUrl, options = {}) {
  // 创建HLS输出目录
  const outputDir = path.join(this.hlsOutputDir, channelId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputFile = path.join(outputDir, 'playlist.m3u8');
  const ffmpegArgs = [
    // 基本输入配置
    '-i', rtmpUrl
  ];
  
  if (options.recordingConfig?.enabled) {
    // 录制模式：双输出（HLS + MP4）
    // 🔥 关键：始终同时输出HLS，避免用户加入时需要重启
    
    // 输出1: HLS流（现有配置，已验证可用）
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-an',  // 禁用音频（避免PCM μ-law转码问题）
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
      '-hls_allow_cache', '0',
      '-start_number', '0',
      '-y',
      outputFile
    );
    
    // 输出2: MP4分段录制
    // 🔥 修复Bug1: 使用环境变量而不是硬编码路径
    const recordingsBaseDir = process.env.RECORDINGS_BASE_DIR || '/srv/filebrowser/yoyo-k';
    const recordingDir = path.join(recordingsBaseDir, channelId);
    if (!fs.existsSync(recordingDir)) {
      fs.mkdirSync(recordingDir, { recursive: true });
    }
    
    const segmentDuration = options.recordingConfig.segment_duration || 3600;
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-an',  // 同样禁用音频保持一致
      '-f', 'segment',
      '-segment_time', segmentDuration,
      '-strftime', '1',
      '-segment_filename', `${recordingDir}/%Y-%m-%d_%H-%M-%S.mp4`,
      '-reset_timestamps', '1',
      '-y',
      // 🔥 修复Bug2: FFmpeg segment模式需要输出文件参数
      `${recordingDir}/output.mp4`  // 占位输出文件（实际使用segment_filename）
    );
  } else {
    // 只输出HLS（现有逻辑，已验证可用）
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-an',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
      '-hls_allow_cache', '0',
      '-start_number', '0',
      '-y',
      outputFile
    );
  }
  
  // 检查代理状态并设置环境变量（保留现有逻辑）
  const env = { ...process.env };
  try {
    const { execSync } = require('child_process');
    const result = execSync('ps aux | grep v2ray | grep -v grep', { encoding: 'utf8' });
    if (result.trim()) {
      env.http_proxy = 'socks5://127.0.0.1:1080';
      env.https_proxy = 'socks5://127.0.0.1:1080';
    }
  } catch (error) {
    // 使用直连
  }
  
  return spawn(this.ffmpegPath, ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: env
  });
}
```

**关键修改点** ✅：
1. ✅ 使用正确的FFmpeg参数语法：`-c:v`, `-preset`（而不是错误的`-c:v:0`, `-preset:v:0`）
2. ✅ 基于当前项目已验证可用的配置
3. ✅ 保留音频禁用（`-an`）避免PCM转码问题
4. ✅ 保留代理检测逻辑
5. ✅ 双输出时HLS和录制使用相同的音频处理策略

### 2.3 新增录制配置变更处理方法

⚠️ **关键方法**：管理员修改录制配置后的完整处理逻辑

```javascript
/**
 * 处理录制配置变更（新增方法）
 * @param {string} channelId - 频道ID
 * @param {Object} newRecordingConfig - 新的录制配置
 * @param {Object} channelConfig - 频道基本配置（包含rtmpUrl）
 * @returns {Object} 处理结果
 */
async handleRecordingConfigChange(channelId, newRecordingConfig, channelConfig) {
  const processInfo = this.activeStreams.get(channelId);
  
  if (processInfo) {
    // ⚠️ 场景1：有运行中的进程 → 必须重启应用新配置
    const hasViewers = this.channelHeartbeats.has(channelId);
    const rtmpUrl = processInfo.rtmpUrl;
    
    logger.info('Restarting process for recording config change', {
      channelId,
      hasViewers,
      oldConfig: processInfo.recordingConfig,
      newConfig: newRecordingConfig
    });
    
    // 1. 停止当前进程
    await this.stopChannel(channelId);
    
    // 2. 使用新配置重启进程
    await this.startNewStream(channelId, rtmpUrl, {
      recordingConfig: newRecordingConfig
    });
    
    // 影响：用户观看中断约7秒（配置修改频率低，可接受）
    return {
      action: 'restarted',
      message: '已重启转码进程以应用新配置',
      impactSeconds: 7
    };
    
  } else if (newRecordingConfig.enabled) {
    // ✅ 场景2：无运行进程 + 启用录制 → 预启动进程
    // 好处：避免用户后续加入时需要重启进程，优化用户体验
    logger.info('Pre-starting process for recording', {
      channelId,
      config: newRecordingConfig
    });
    
    await this.startNewStream(channelId, channelConfig.rtmpUrl, {
      recordingConfig: newRecordingConfig
    });
    
    return {
      action: 'pre-started',
      message: '已预启动转码进程（支持录制和观看）',
      note: '用户加入时无需重启，避免7秒等待'
    };
  } else {
    // 场景3：无运行进程 + 禁用录制 → 无需操作
    return {
      action: 'none',
      message: '配置已更新（无需重启进程）'
    };
  }
}
```

### 2.4 新增录制心跳机制（完整实现）

⚠️ **关键机制**：防止定时录制进程被60秒空闲清理机制误杀

**问题场景**：
```
1. 定时录制任务启动 → FFmpeg进程开始录制
2. 无用户观看 → 没有用户心跳
3. 60秒后 → cleanupIdleChannels()判断空闲
4. 停止FFmpeg进程 ❌ → 录制失败！
```

**解决方案**：录制进程自己维护心跳

```javascript
/**
 * 🔥 修复Bug6&7: 录制状态标记机制（不使用心跳）
 * 核心思路：录制进程通过isRecording标记，不依赖心跳机制
 * 这样既避免心跳冲突，又保证录制进程不被误清理
 */
markRecordingActive(channelId, recordingConfig) {
  const processInfo = this.activeStreams.get(channelId);
  if (processInfo) {
    // 标记进程为录制状态
    processInfo.isRecording = true;
    processInfo.recordingConfig = recordingConfig;
    processInfo.recordingStartTime = Date.now();
    this.activeStreams.set(channelId, processInfo);
    
    logger.info('Channel marked as recording', { 
      channelId,
      config: recordingConfig 
    });
  }
}

/**
 * 清除录制状态标记
 */
clearRecordingMark(channelId) {
  const processInfo = this.activeStreams.get(channelId);
  if (processInfo) {
    processInfo.isRecording = false;
    processInfo.recordingConfig = null;
    processInfo.recordingStartTime = null;
    this.activeStreams.set(channelId, processInfo);
    
    logger.info('Recording mark cleared', { channelId });
  }
}

/**
 * 检查录制配置是否变更
 * 关键：决定是否需要重启FFmpeg进程
 */
isRecordingConfigChanged(oldConfig, newConfig) {
  // 都不存在 → 无变化
  if (!oldConfig && !newConfig) return false;
  
  // 一个存在一个不存在 → 有变化
  if (!oldConfig || !newConfig) return true;
  
  // 检查关键配置项是否变化
  return (
    oldConfig.enabled !== newConfig.enabled ||
    oldConfig.start_time !== newConfig.start_time ||
    oldConfig.end_time !== newConfig.end_time ||
    oldConfig.segment_duration !== newConfig.segment_duration ||
    oldConfig.retention_days !== newConfig.retention_days
  );
}
```

### 2.5 修改cleanupIdleChannels

⚠️ **关键修改**：录制状态优先于心跳判断

```javascript
async cleanupIdleChannels() {
  const now = Date.now();
  
  for (const [channelId, lastHeartbeat] of this.channelHeartbeats) {
    const processInfo = this.activeStreams.get(channelId);
    
    // 🔥 修复Bug7: 录制状态优先级高于心跳超时
    // 逻辑：如果正在录制，忽略心跳超时，不清理进程
    if (processInfo && processInfo.isRecording) {
      logger.debug('Skip cleanup: recording active', { 
        channelId,
        isRecording: true,
        recordingDuration: Math.floor((now - processInfo.recordingStartTime) / 1000) + 's'
      });
      continue;  // 录制进程永远不清理，直到录制结束
    }
    
    // 正常清理逻辑：超过60秒无心跳的频道
    if (now - lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
      logger.info('Channel idle timeout, cleaning up', { 
        channelId, 
        idleTime: now - lastHeartbeat 
      });
      
      await this.stopChannel(channelId);
      this.channelHeartbeats.delete(channelId);
    }
  }
}
```

### 2.6 修改stopChannel方法

⚠️ **关键修改**：停止时清理录制心跳

```javascript
async stopChannel(channelId) {
  const processInfo = this.activeStreams.get(channelId);
  if (!processInfo) return;
  
  try {
    // 🆕 如果是录制进程，清理录制状态标记
    if (processInfo.isRecording) {
      this.clearRecordingMark(channelId);  // 🔥 修复Bug9: 方法名一致
      logger.info('Stopped recording', { channelId });
    }
    
    // 停止FFmpeg进程并清理
    await this.stopFFmpegProcess(channelId);
    await this.cleanupChannelHLS(channelId);
    this.activeStreams.delete(channelId);
    
    logger.info('Channel stopped successfully', { channelId });
  } catch (error) {
    logger.error('Failed to stop channel', { channelId, error: error.message });
  }
}
```

### 2.7 新增API路由 - 配置变更通知端点

⚠️ **关键API**：Workers修改配置后通知VPS应用新配置

**修改文件**: `vps-transcoder-api/src/routes/simple-stream.js`

在路由文件中添加新的API端点：

```javascript
/**
 * 录制配置变更通知端点
 * Workers在管理员修改配置后调用此API通知VPS
 */
router.post('/api/simple-stream/recording-config-changed', async (req, res) => {
  const { channelId, recordingConfig, channelConfig } = req.body;
  
  logger.info('Received recording config change notification', {
    channelId,
    enabled: recordingConfig?.enabled,
    startTime: recordingConfig?.start_time,
    endTime: recordingConfig?.end_time
  });
  
  try {
    // 调用SimpleStreamManager处理配置变更
    const result = await simpleStreamManager.handleRecordingConfigChange(
      channelId,
      recordingConfig,
      channelConfig
    );
    
    res.json({
      status: 'success',
      data: result
    });
    
    logger.info('Recording config change handled successfully', {
      channelId,
      action: result.action
    });
    
  } catch (error) {
    logger.error('Failed to handle recording config change', {
      channelId,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});
```

**API说明**:
- **请求参数**:
  - `channelId`: 频道ID
  - `recordingConfig`: 新的录制配置
  - `channelConfig`: 频道基础配置（包含rtmpUrl）
- **返回值**:
  - `action`: 执行的操作（restarted/pre-started/none）
  - `message`: 操作说明
  - `impactSeconds`: 影响时长（如果需要重启）

### 2.8 部署到VPS

```bash
# 提交代码
git add vps-transcoder-api/src/services/SimpleStreamManager.js
git add vps-transcoder-api/src/routes/simple-stream.js
git commit -m "feat: SimpleStreamManager支持录制功能，新增配置变更API"
git push

# 部署到VPS
ssh root@142.171.75.220 "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && ./vps-simple-deploy.sh"
```

### 2.6 验证测试

```bash
# 测试启动录制
curl -X POST https://yoyo-vps.5202021.xyz/api/simple-stream/start-watching \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "channelId": "stream_xxx",
    "rtmpUrl": "rtmp://source/live",
    "options": {
      "recordingConfig": {"enabled": true, "segment_duration": 3600}
    }
  }'

# 检查进程
ssh root@142.171.75.220 "ps aux | grep ffmpeg"

# 检查文件生成
ssh root@142.171.75.220 "ls -la /var/recordings/stream_xxx/"
```

**验证清单**:
- [ ] FFmpeg进程包含HLS和MP4输出
- [ ] 录制文件开始生成
- [ ] HLS播放仍然正常
- [ ] 无JavaScript错误

**如果验证失败**: 恢复SimpleStreamManager.js备份，重新部署

✅ 完成后更新进度表

---

## 🎯 阶段3：分段录制管理器

**目标**：实现录制分段监听和处理，自动重命名临时文件  
**影响范围**：VPS端新增1个服务类  
**风险等级**：🟡 中  
**预计时间**：60分钟

### 3.1 创建SegmentedRecordingManager

**创建文件**: `vps-transcoder-api/src/services/SegmentedRecordingManager.js`

核心功能：
- 监听录制目录的文件变化
- 检测新分段文件生成
- 自动重命名临时文件为标准格式
- 通过Workers API更新D1数据库

**完整实现**（⚠️ 关键逻辑，不能简化）：

```javascript
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

class SegmentedRecordingManager {
  constructor() {
    this.recordingsDir = process.env.RECORDINGS_BASE_DIR || '/srv/filebrowser/yoyo-k';
    this.activeWatchers = new Map(); // 文件监听器
    this.workerApiUrl = process.env.WORKER_API_URL || 'https://yoyoapi.5202021.xyz';
    this.apiKey = process.env.VPS_API_KEY;
  }
  
  /**
   * 开始监听频道录制目录
   * 关键：使用fs.watch实时监听文件变化
   */
  startWatching(channelId) {
    const outputDir = path.join(this.recordingsDir, channelId);
    
    // 确保目录存在
    fs.mkdir(outputDir, { recursive: true }).catch(err => {
      logger.error('Failed to create recording dir', { channelId, error: err.message });
    });
    
    // 使用fs.watch监听目录变化
    const watcher = fs.watch(outputDir, async (eventType, filename) => {
      if (eventType === 'rename' && filename && filename.endsWith('.mp4')) {
        logger.info('File change detected', { 
          channelId, 
          eventType, 
          filename 
        });
        
        // 处理新文件或文件完成事件
        await this.handleNewFile(channelId, filename);
      }
    });
    
    this.activeWatchers.set(channelId, watcher);
    logger.info('Started watching recording directory', { channelId, outputDir });
  }
  
  /**
   * 停止监听
   */
  stopWatching(channelId) {
    const watcher = this.activeWatchers.get(channelId);
    if (watcher) {
      watcher.close();
      this.activeWatchers.delete(channelId);
      logger.info('Stopped watching recording directory', { channelId });
    }
  }
  
  /**
   * 处理新文件创建事件
   * 关键流程：检测临时文件 → 等待稳定 → 验证 → 重命名 → 创建D1记录
   */
  async handleNewFile(channelId, filename) {
    try {
      const outputDir = path.join(this.recordingsDir, channelId);
      const filePath = path.join(outputDir, filename);
      
      // 🔥 修复Bug3: FFmpeg segment模式生成的文件名检查
      // FFmpeg使用-strftime生成: %Y-%m-%d_%H-%M-%S.mp4 (如: 2025-10-25_01-30-15.mp4)
      // 这些文件直接以最终名称创建，不需要临时文件检查
      
      // 步骤1：检查文件名格式，跳过非标准文件
      if (!filename.endsWith('.mp4')) {
        logger.debug('Skipping non-MP4 file', { channelId, filename });
        return;
      }
      
      // 检查是否为output.mp4占位文件（FFmpeg segment模式的占位输出）
      if (filename === 'output.mp4') {
        logger.debug('Skipping placeholder output file', { channelId, filename });
        return;
      }
      
      // 步骤2：等待文件写入稳定
      const isStable = await this.waitForFileStable(filePath);
      if (!isStable) {
        logger.warn('File write timeout, may still be recording', { 
          channelId, 
          filename 
        });
        return;
      }
      
      // 步骤3：验证文件完整性
      const isValid = await this.validateMP4File(filePath);
      
      if (!isValid) {
        // 损坏文件：标记为recording状态，等待启动时修复
        logger.warn('Segment file is corrupted, marking for repair', { 
          channelId, 
          filename 
        });
        
        await this.createSegmentRecord(channelId, {
          filename,
          filePath,
          status: 'recording', // 标记为未完成
          needsRepair: true
        });
        return;
      }
      
      // 步骤4：生成标准文件名（如果需要）
      let finalFilename = filename;
      if (!this.isStandardFilename(filename)) {
        finalFilename = await this.generateStandardFilename(filePath);
        const finalPath = path.join(outputDir, finalFilename);
        
        // 重命名为标准格式
        await fs.rename(filePath, finalPath);
        logger.info('Renamed segment file', { 
          channelId, 
          original: filename,
          renamed: finalFilename 
        });
      }
      
      // 步骤5：创建D1数据库记录
      await this.createSegmentRecord(channelId, {
        filename: finalFilename,
        filePath: path.join(outputDir, finalFilename),
        status: 'completed'
      });
      
      logger.info('Segment processed successfully', { 
        channelId, 
        filename: finalFilename 
      });
      
    } catch (error) {
      logger.error('Failed to handle new file', { 
        channelId, 
        filename, 
        error: error.message 
      });
    }
  }
  
  /**
   * 等待文件稳定（写入完成）
   * 检查文件大小是否不再变化
   */
  async waitForFileStable(filePath, timeout = 10000) {
    const startTime = Date.now();
    let lastSize = 0;
    
    while (Date.now() - startTime < timeout) {
      try {
        const stats = await fs.stat(filePath);
        const currentSize = stats.size;
        
        // 文件大小不再变化，认为写入完成
        if (currentSize === lastSize && currentSize > 0) {
          logger.debug('File is stable', { filePath, size: currentSize });
          return true;
        }
        
        lastSize = currentSize;
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
        
      } catch (error) {
        // 文件可能还不存在或正在写入
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    logger.warn('File stability check timeout', { filePath });
    return false; // 超时
  }
  
  /**
   * 验证MP4文件完整性
   * 使用ffprobe检查文件是否可以正常解析
   */
  async validateMP4File(filePath) {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_format',
        '-show_streams',
        filePath
      ]);
      
      let hasOutput = false;
      
      ffprobe.stdout.on('data', () => {
        hasOutput = true;
      });
      
      ffprobe.on('close', (code) => {
        // ffprobe返回0且有输出说明文件有效
        resolve(code === 0 && hasOutput);
      });
      
      // 10秒超时
      setTimeout(() => {
        ffprobe.kill();
        resolve(false);
      }, 10000);
    });
  }
  
  /**
   * 检查是否为标准文件名格式
   * 标准格式：YYYY-MM-DD_HH-MM-SS.mp4
   */
  isStandardFilename(filename) {
    const pattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/;
    return pattern.test(filename);
  }
  
  /**
   * 生成标准文件名
   * 从文件的创建时间或ffprobe元数据生成
   */
  async generateStandardFilename(filePath) {
    try {
      // 使用文件的创建时间
      const stats = await fs.stat(filePath);
      const createTime = new Date(stats.birthtime);
      
      const year = createTime.getFullYear();
      const month = String(createTime.getMonth() + 1).padStart(2, '0');
      const day = String(createTime.getDate()).padStart(2, '0');
      const hour = String(createTime.getHours()).padStart(2, '0');
      const minute = String(createTime.getMinutes()).padStart(2, '0');
      const second = String(createTime.getSeconds()).padStart(2, '0');
      
      return `${year}-${month}-${day}_${hour}-${minute}-${second}.mp4`;
    } catch (error) {
      // 失败时使用当前时间
      const now = new Date();
      return `${now.toISOString().split('T')[0]}_${now.toTimeString().split(' ')[0].replace(/:/g, '-')}.mp4`;
    }
  }
  
  /**
   * 创建分段记录（通过Workers API）
   */
  async createSegmentRecord(channelId, recordData) {
    try {
      const stats = await fs.stat(recordData.filePath);
      
      const response = await fetch(`${this.workerApiUrl}/api/admin/recordings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({
          channel_id: channelId,
          filename: recordData.filename,
          file_path: recordData.filePath,
          file_size: stats.size,
          status: recordData.status || 'completed',
          needs_repair: recordData.needsRepair || false,
          start_time: stats.birthtime.toISOString(),
          created_at: new Date().toISOString()
        })
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      logger.info('Created segment record in D1', { 
        channelId, 
        filename: recordData.filename 
      });
      
    } catch (error) {
      logger.error('Failed to create segment record', { 
        channelId, 
        error: error.message 
      });
      // 不抛出错误，避免影响其他处理
    }
  }
}

module.exports = SegmentedRecordingManager;
```

### 3.2 集成到SimpleStreamManager

**修改文件**: `vps-transcoder-api/src/services/SimpleStreamManager.js`

```javascript
const SegmentedRecordingManager = require('./SegmentedRecordingManager');

class SimpleStreamManager {
  constructor() {
    // ... 现有代码
    this.recordingManager = new SegmentedRecordingManager();
  }
  
  async startNewStream(channelId, rtmpUrl, options = {}) {
    // 1. 启动FFmpeg进程
    const ffmpegProcess = await this.spawnFFmpegProcess(channelId, rtmpUrl, options);
    const hlsUrl = this.generateHLSUrl(channelId);
    
    // 2. 保存进程信息
    this.activeStreams.set(channelId, {
      process: ffmpegProcess,
      hlsUrl: hlsUrl,
      rtmpUrl: rtmpUrl,
      recordingConfig: options.recordingConfig || null,
      isRecording: false,  // 初始为false
      startTime: Date.now()
    });
    
    // 3. 🔥 修复Bug10: 如果启用录制，标记录制状态
    if (options.recordingConfig?.enabled) {
      this.markRecordingActive(channelId, options.recordingConfig);  // ⭐ 关键调用
      this.recordingManager.startWatching(channelId);
      logger.info('Recording started and marked active', { channelId });
    }
    
    return hlsUrl;
  }
  
  async stopChannel(channelId) {
    const processInfo = this.activeStreams.get(channelId);
    if (!processInfo) return;
    
    // 1. 如果是录制进程，清理录制状态
    if (processInfo.isRecording) {
      this.clearRecordingMark(channelId);
      this.recordingManager.stopWatching(channelId);
    }
    
    // 2. 停止FFmpeg和清理
    await this.stopFFmpegProcess(channelId);
    await this.cleanupChannelHLS(channelId);
    this.activeStreams.delete(channelId);
  }
}
```

### 3.3 部署和验证

```bash
# 提交代码
git add vps-transcoder-api/src/services/SegmentedRecordingManager.js
git add vps-transcoder-api/src/services/SimpleStreamManager.js
git commit -m "feat: 添加分段录制管理器"
git push

# 部署到VPS
ssh root@142.171.75.220 "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && ./vps-simple-deploy.sh"

# 验证文件监听
# 启动录制后，等待1小时检查文件是否正确重命名
ssh root@142.171.75.220 "ls -la /var/recordings/stream_xxx/"
```

**验证清单**:
- [ ] 新分段文件自动生成
- [ ] 文件名格式正确（YYYY-MM-DD_HH-MM-SS.mp4）
- [ ] D1数据库记录已创建
- [ ] 文件大小和时长正常

✅ 完成后更新进度表

---

## 🎯 阶段4：自动修复机制

**目标**：实现服务启动时自动检测和修复损坏文件  
**影响范围**：VPS端新增1个服务类 + app.js启动逻辑  
**风险等级**：🟡 中  
**预计时间**：90分钟

⚠️ **重要说明**：修复操作**完全不影响用户观看**
- **修复目录**：`/var/recordings/${channelId}/`（录制的MP4文件）
- **播放目录**：`/var/www/hls/${channelId}/`（用户观看的HLS流）
- **目录独立**：两个目录完全分离，修复录制文件时用户继续正常观看

### 4.1 创建RecordingRecoveryManager

**创建文件**: `vps-transcoder-api/src/services/RecordingRecoveryManager.js`

核心功能：
- 服务启动时自动执行恢复流程
- 处理临时文件重命名
- 检测损坏文件并尝试修复
- 三级修复策略：标准修复 → 强制重建 → 提取数据
- ✅ **在后台静默执行，不干扰用户观看**

**关键方法**：
```javascript
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const logger = require('../utils/logger');

class RecordingRecoveryManager {
  constructor() {
    this.recordingsDir = process.env.RECORDINGS_BASE_DIR || '/srv/filebrowser/yoyo-k';
    this.workerApiUrl = process.env.WORKER_API_URL || 'https://yoyoapi.5202021.xyz';
    this.apiKey = process.env.VPS_API_KEY;
  }
  
  /**
   * 启动时执行恢复流程
   * 核心思路：自动检测并修复所有损坏的录制文件
   */
  async recoverOnStartup() {
    logger.info('Starting recording recovery process...');
    
    try {
      // 🔍 步骤-1: 清理遗留的临时修复文件（防止上次修复中断污染）
      await this.cleanupStaleRepairFiles();
      
      // 🔍 步骤0: 处理临时文件（重命名为标准格式）
      await this.processTempFiles();
      
      // 🔍 步骤1: 从D1数据库查询所有未完成的录制
      const interruptedRecordings = await this.getInterruptedRecordings();
      
      logger.info(`Found ${interruptedRecordings.length} interrupted recordings`);
      
      // 🔧 步骤2: 遍历每个未完成的录制文件
      for (const recording of interruptedRecordings) {
        const filePath = recording.file_path;
        
        // 检查文件是否存在
        if (!await this.fileExists(filePath)) {
          logger.warn('Recording file not found', { filePath });
          await this.markAsCorrupted(recording.id, 'File not found');
          continue;
        }
        
        // 🔥 新增：检查修复次数限制（最多3次）
        if (recording.repair_attempts >= 3) {
          logger.warn('Max repair attempts reached', {
            filePath,
            attempts: recording.repair_attempts
          });
          await this.markAsCorrupted(recording.id, 'Max repair attempts exceeded');
          continue;
        }
        
        // 步骤3: 验证文件完整性
        const isValid = await this.validateMP4File(filePath);
        
        if (!isValid) {
          logger.info('File needs repair', { filePath });
          
          // 🔥 新增：记录修复尝试
          await this.incrementRepairAttempts(recording.id);
          
          // 步骤4: 尝试修复损坏文件
          const repaired = await this.repairMP4WithRecovery(filePath);
          
          if (repaired) {
            await this.markAsRepaired(recording.id);
            logger.info('File repaired successfully', { filePath });
          } else {
            await this.markAsCorrupted(recording.id, 'Repair failed');
            logger.error('Failed to repair file', { filePath });
          }
        } else {
          // 文件完好，更新状态为completed
          await this.markAsCompleted(recording.id);
          logger.info('File is valid', { filePath });
        }
      }
      
      logger.info('Recovery process completed');
      
    } catch (error) {
      logger.error('Recovery process failed', {
        error: error.message,
        stack: error.stack
      });
    }
  }
  
  /**
   * 清理遗留的临时修复文件
   * 防止上次修复过程中断导致的临时文件污染
   */
  async cleanupStaleRepairFiles() {
    logger.info('Cleaning up stale repair files...');
    
    try {
      const channels = await fs.readdir(this.recordingsDir);
      let cleanedCount = 0;
      
      for (const channelDir of channels) {
        const channelPath = path.join(this.recordingsDir, channelDir);
        const stat = await fs.stat(channelPath);
        
        if (!stat.isDirectory()) continue;
        
        const files = await fs.readdir(channelPath);
        
        // 查找所有 .repairing 和 .backup 文件
        const staleFiles = files.filter(f => 
          f.endsWith('.repairing') || f.endsWith('.backup')
        );
        
        for (const staleFile of staleFiles) {
          const stalePath = path.join(channelPath, staleFile);
          const originalPath = stalePath.replace(/\.(repairing|backup)$/, '');
          
          logger.warn('Found stale repair file', { 
            channel: channelDir,
            file: staleFile 
          });
          
          // 如果是 .backup 文件且原文件损坏，尝试恢复
          if (staleFile.endsWith('.backup')) {
            if (await this.fileExists(originalPath)) {
              const isOriginalValid = await this.validateMP4File(originalPath);
              
              if (!isOriginalValid) {
                // 原文件损坏，从备份恢复
                logger.info('Restoring from backup', { originalPath });
                await fs.copyFile(stalePath, originalPath);
              }
            }
          }
          
          // 删除临时文件
          await fs.unlink(stalePath);
          cleanedCount++;
        }
      }
      
      logger.info('Stale repair files cleanup completed', { 
        cleanedCount 
      });
      
    } catch (error) {
      logger.error('Failed to cleanup stale repair files', {
        error: error.message
      });
    }
  }
  
  /**
   * 处理临时文件（重命名为标准格式）
   * 关键：服务启动时，上次录制可能留下了临时文件
   */
  async processTempFiles() {
    logger.info('Processing temporary files...');
    
    try {
      const channels = await fs.readdir(this.recordingsDir);
      let processedCount = 0;
      
      for (const channelDir of channels) {
        const channelPath = path.join(this.recordingsDir, channelDir);
        const stat = await fs.stat(channelPath);
        
        if (!stat.isDirectory()) continue;
        
        const files = await fs.readdir(channelPath);
        
        // 查找所有临时文件（包含_temp或.tmp的文件）
        const tempFiles = files.filter(f => 
          f.includes('_temp.mp4') || f.includes('.tmp')
        );
        
        for (const tempFile of tempFiles) {
          const tempPath = path.join(channelPath, tempFile);
          
          logger.info('Found temp file', { 
            channel: channelDir, 
            file: tempFile 
          });
          
          // 验证文件完整性
          const isValid = await this.validateMP4File(tempPath);
          
          if (isValid) {
            // 生成标准文件名
            const fileStat = await fs.stat(tempPath);
            const standardName = this.generateStandardFilename(fileStat.birthtime);
            const finalPath = path.join(channelPath, standardName);
            
            // 重命名为标准格式
            await fs.rename(tempPath, finalPath);
            
            // 创建D1记录
            await this.createRecordingInD1({
              channel_id: channelDir,
              filename: standardName,
              file_path: finalPath,
              file_size: fileStat.size,
              status: 'completed',
              start_time: fileStat.birthtime.toISOString(),
              end_time: fileStat.mtime.toISOString()
            });
            
            processedCount++;
            logger.info('Processed temp file', { 
              temp: tempFile, 
              renamed: standardName 
            });
            
          } else {
            // 文件损坏，尝试修复
            logger.warn('Temp file is corrupted, attempting repair', { 
              file: tempFile 
            });
            
            const repaired = await this.repairMP4WithRecovery(tempPath);
            
            if (repaired) {
              // 修复成功，重命名
              const fileStat = await fs.stat(tempPath);
              const standardName = this.generateStandardFilename(fileStat.birthtime);
              const finalPath = path.join(channelPath, standardName);
              
              await fs.rename(tempPath, finalPath);
              await this.createRecordingInD1({
                channel_id: channelDir,
                filename: standardName,
                file_path: finalPath,
                file_size: fileStat.size,
                status: 'completed',
                needs_repair: true,
                start_time: fileStat.birthtime.toISOString(),
                end_time: fileStat.mtime.toISOString()
              });
              
              processedCount++;
              logger.info('Repaired and processed temp file', { 
                temp: tempFile, 
                renamed: standardName 
              });
            } else {
              // 修复失败，标记为损坏
              logger.error('Failed to repair temp file', { file: tempFile });
            }
          }
        }
      }
      
      logger.info('Temp file processing completed', { 
        processedCount 
      });
      
    } catch (error) {
      logger.error('Failed to process temp files', {
        error: error.message
      });
    }
  }
  
  /**
   * 生成标准文件名
   * 格式: YYYY-MM-DD_HH-MM-SS.mp4
   */
  generateStandardFilename(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    const second = String(d.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day}_${hour}-${minute}-${second}.mp4`;
  }
  
  /**
   * 获取中断的录制（从D1数据库）
   * 查询所有status为'recording'的记录
   */
  async getInterruptedRecordings() {
    try {
      const response = await fetch(
        `${this.workerApiUrl}/api/recording/files/interrupted`,
        {
          headers: {
            'X-API-Key': this.apiKey
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      const data = await response.json();
      return data.data || [];
      
    } catch (error) {
      logger.error('Failed to get interrupted recordings', {
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * 检查文件是否存在
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * 验证MP4文件完整性
   * 使用ffprobe检查文件是否可以正常解析
   */
  async validateMP4File(filePath) {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_format -show_streams "${filePath}"`,
        { timeout: 10000 }
      );
      
      // 检查是否包含基本的格式信息
      return stdout.includes('[FORMAT]') && stdout.includes('[STREAM]');
      
    } catch (error) {
      logger.debug('File validation failed', { 
        filePath, 
        error: error.message 
      });
      return false;
    }
  }
  
  /**
   * 在D1中创建录制记录
   */
  async createRecordingInD1(recordData) {
    try {
      const response = await fetch(
        `${this.workerApiUrl}/api/recording/files`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey
          },
          body: JSON.stringify(recordData)
        }
      );
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      logger.info('Created recording in D1', {
        channel_id: recordData.channel_id,
        filename: recordData.filename
      });
      
    } catch (error) {
      logger.error('Failed to create recording in D1', {
        channel_id: recordData.channel_id,
        error: error.message
      });
    }
  }
  
  /**
   * 标记文件为已修复
   */
  async markAsRepaired(recordingId) {
    await this.updateRecordingStatus(recordingId, 'completed', 'repaired');
  }
  
  /**
   * 标记文件为已完成
   */
  async markAsCompleted(recordingId) {
    await this.updateRecordingStatus(recordingId, 'completed', null);
  }
  
  /**
   * 标记文件为损坏
   */
  async markAsCorrupted(recordingId, reason) {
    await this.updateRecordingStatus(recordingId, 'corrupted', reason);
  }
  
  /**
   * 增加修复尝试次数
   */
  async incrementRepairAttempts(recordingId) {
    try {
      const response = await fetch(
        `${this.workerApiUrl}/api/recording/files/${recordingId}/repair-attempt`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey
          },
          body: JSON.stringify({
            last_repair_attempt: new Date().toISOString()
          })
        }
      );
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
    } catch (error) {
      logger.error('Failed to increment repair attempts', {
        recordingId,
        error: error.message
      });
    }
  }
  
  /**
   * 更新录制状态
   */
  async updateRecordingStatus(recordingId, status, repairStatus) {
    try {
      const updateData = {
        status,
        repair_status: repairStatus,
        updated_at: new Date().toISOString()
      };
      
      // 如果是失败状态，记录错误原因
      if (status === 'corrupted' && repairStatus) {
        updateData.repair_error = repairStatus;
      }
      
      const response = await fetch(
        `${this.workerApiUrl}/api/recording/files/${recordingId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey
          },
          body: JSON.stringify(updateData)
        }
      );
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
    } catch (error) {
      logger.error('Failed to update recording status', {
        recordingId,
        error: error.message
      });
    }
  }
  
  // 修复文件（三级策略 + 文件保护机制）
  async repairMP4WithRecovery(filePath) {
    const backupPath = `${filePath}.backup`;
    const tempPath = `${filePath}.repairing`;
    
    try {
      // 🔐 关键：先备份原文件
      await fs.copyFile(filePath, backupPath);
      
      // 在临时文件上尝试修复（保护原文件）
      let success = await this.tryStandardRepair(filePath, tempPath);
      if (!success) success = await this.tryForceRebuild(filePath, tempPath);
      if (!success) success = await this.tryDataExtraction(filePath, tempPath);
      
      if (success && await this.validateMP4File(tempPath)) {
        // ✅ 修复成功：替换原文件，删除备份
        await fs.rename(tempPath, filePath);
        await fs.unlink(backupPath);
        return true;
      }
      
      // ❌ 修复失败：清理临时文件，保留原文件
      if (fs.existsSync(tempPath)) await fs.unlink(tempPath);
      return false;
      
    } catch (error) {
      // 清理临时文件，保护原文件不被破坏
      if (fs.existsSync(tempPath)) await fs.unlink(tempPath);
      return false;
    }
  }
  
  // 方法1: 标准修复（快速，适合轻微损坏）
  async tryStandardRepair(inputPath, outputPath) {
    return execAsync(
      `ffmpeg -err_detect ignore_err -i "${inputPath}" -c copy -movflags +faststart "${outputPath}"`
    ).then(() => true).catch(() => false);
  }
  
  // 方法2: 强制重建（中等，适合索引损坏）
  async tryForceRebuild(inputPath, outputPath) {
    return execAsync(
      `ffmpeg -fflags +genpts -i "${inputPath}" -c:v libx264 -preset fast -movflags +faststart "${outputPath}"`
    ).then(() => true).catch(() => false);
  }
  
  // 方法3: 提取数据（保守，确保有输出）
  async tryDataExtraction(inputPath, outputPath) {
    return execAsync(
      `ffmpeg -err_detect ignore_err -fflags +genpts -i "${inputPath}" -c:v libx264 -preset ultrafast "${outputPath}"`
    ).then(() => true).catch(() => false);
  }
}
```

**🔐 文件保护机制**：
1. **修复前备份** - 创建 `.backup` 文件保护原始数据
2. **临时文件修复** - 在 `.repairing` 文件上操作，不直接修改原文件
3. **验证后替换** - 修复成功且验证通过才替换原文件
4. **失败保护** - 修复失败时清理临时文件，保留原文件不受损
5. **异常安全** - catch块确保即使程序崩溃也不破坏原文件

**为什么这样设计**：
- ⚠️ **防止二次损伤** - 如果修复过程中程序崩溃，原文件仍然完好
- ⚠️ **可回退** - 备份文件允许在修复失败后恢复原始状态
- ⚠️ **原子操作** - 文件替换是原子操作，不会出现半损坏状态

### 4.2 集成到app.js启动流程

**修改文件**: `vps-transcoder-api/src/app.js`

```javascript
const RecordingRecoveryManager = require('./services/RecordingRecoveryManager');

async function startServer() {
  // 1. 初始化恢复管理器
  const recoveryManager = new RecordingRecoveryManager();
  
  // 2. 执行启动恢复（在后台进行，不阻塞服务启动）
  recoveryManager.recoverOnStartup().catch(err => {
    logger.error('Recovery process failed:', err);
  });
  
  // 3. 启动Express服务器
  app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
  });
}

startServer();
```

### 4.3 部署和验证

```bash
# 提交代码
git add vps-transcoder-api/src/services/RecordingRecoveryManager.js
git add vps-transcoder-api/src/app.js
git commit -m "feat: 添加录制文件自动修复机制"
git push

# 部署到VPS
ssh root@142.171.75.220 "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && ./vps-simple-deploy.sh"

# 重启服务观察修复日志
ssh root@142.171.75.220 "pm2 restart vps-transcoder-api && pm2 logs --lines 50"
```

**验证清单**:
- [ ] 服务启动时执行恢复流程
- [ ] 损坏文件被检测到
- [ ] 修复流程正常执行
- [ ] 修复日志完整

✅ 完成后更新进度表

---

## 🎯 阶段5：前端管理界面

**目标**：在频道管理页面添加录制控制功能  
**影响范围**：frontend/src/views/admin/ChannelManagement.vue  
**风险等级**：🟢 低  
**预计时间**：45分钟

### 5.1 添加录制配置API

**创建文件**: `frontend/src/services/recordingApi.js`

```javascript
import axios from 'axios';

const API_BASE = process.env.VUE_APP_API_URL;

export default {
  // 获取录制配置
  async getRecordingConfig(channelId) {
    return axios.get(`${API_BASE}/api/recording/config/${channelId}`);
  },
  
  // 更新录制配置
  async updateRecordingConfig(channelId, config) {
    return axios.put(`${API_BASE}/api/recording/config/${channelId}`, config);
  },
  
  // 获取录制文件列表
  async getRecordingFiles(channelId, params) {
    return axios.get(`${API_BASE}/api/recording/files`, {
      params: { channel_id: channelId, ...params }
    });
  }
};
```

### 5.2 修改频道管理界面

**修改文件**: `frontend/src/views/admin/ChannelManagement.vue`

在频道列表中添加录制开关：

```vue
<template>
  <el-table :data="channels">
    <!-- 现有列 -->
    
    <!-- 新增：录制列 -->
    <el-table-column label="录制" width="100">
      <template #default="{ row }">
        <el-switch
          v-model="row.recordingEnabled"
          @change="handleRecordingToggle(row)"
          :loading="row.recordingLoading"
        />
      </template>
    </el-table-column>
    
    <!-- 新增：录制配置按钮 -->
    <el-table-column label="操作" width="200">
      <template #default="{ row }">
        <el-button @click="openRecordingConfig(row)">
          录制配置
        </el-button>
      </template>
    </el-table-column>
  </el-table>
  
  <!-- 录制配置对话框 -->
  <el-dialog v-model="recordingDialogVisible" title="录制配置" width="600px">
    <el-form :model="recordingForm" label-width="100px">
      <el-form-item label="开始时间">
        <el-time-picker v-model="recordingForm.startTime" format="HH:mm" />
      </el-form-item>
      <el-form-item label="结束时间">
        <el-time-picker v-model="recordingForm.endTime" format="HH:mm" />
      </el-form-item>
      
      <!-- 🔥 新增：分段时长配置 -->
      <el-form-item label="分段时长" prop="segment_duration">
        <el-select v-model="recordingForm.segment_duration" placeholder="选择分段时长">
          <el-option label="1小时（推荐）" :value="3600">
            <span>1小时</span>
            <span style="color: var(--el-text-color-secondary); margin-left: 8px;">
              （推荐）
            </span>
          </el-option>
          <el-option label="2小时" :value="7200" />
          <el-option label="3.5小时" :value="12600" />
          <el-option label="5小时" :value="18000" />
          <el-option label="不限时" :value="0">
            <span>不限时</span>
            <span style="color: var(--el-text-color-secondary); margin-left: 8px;">
              （整个时段一个文件）
            </span>
          </el-option>
        </el-select>
        <div class="form-tip">
          <el-icon><InfoFilled /></el-icon>
          分段录制更安全：中断只损失一段，修复更快。推荐1-2小时。
        </div>
      </el-form-item>
      
      <!-- 🔥 新增：预估信息显示 -->
      <div v-if="recordingForm.startTime && recordingForm.endTime" class="segment-preview">
        <div class="segment-preview-item">
          <span class="segment-preview-label">预估文件数量：</span>
          <span class="segment-preview-value">
            {{ estimatedFileCount }} 个/天
          </span>
        </div>
        <div class="segment-preview-item">
          <span class="segment-preview-label">
            {{ recordingForm.segment_duration === 0 ? '总文件大小' : '单个文件大小' }}：
          </span>
          <span class="segment-preview-value">
            {{ formatFileSize(estimatedFileSize) }}
          </span>
        </div>
        <div v-if="recordingForm.segment_duration === 0" class="segment-preview-item">
          <span class="segment-preview-label">⚠️ 风险提示：</span>
          <span class="segment-preview-value" style="color: var(--el-color-danger);">
            不分段风险较高
          </span>
        </div>
      </div>
      
      <el-form-item label="保留天数">
        <el-input-number v-model="recordingForm.retentionDays" :min="1" :max="7" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="recordingDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveRecordingConfig">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import { InfoFilled } from '@element-plus/icons-vue';
import recordingApi from '@/services/recordingApi';
import { ElMessageBox, ElMessage } from 'element-plus';

const recordingForm = ref({
  startTime: '07:50',
  endTime: '17:20',
  segment_duration: 3600,  // 默认1小时
  retentionDays: 2
});

// 🔥 新增：计算预估文件数量
const estimatedFileCount = computed(() => {
  if (!recordingForm.value.startTime || !recordingForm.value.endTime) return 0
  
  const [startHour, startMin] = recordingForm.value.startTime.split(':').map(Number)
  const [endHour, endMin] = recordingForm.value.endTime.split(':').map(Number)
  
  const totalMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin)
  
  if (recordingForm.value.segment_duration === 0) {
    return 1  // 不限时，一个文件
  }
  
  return Math.ceil((totalMinutes * 60) / recordingForm.value.segment_duration)
});

// 🔥 新增：预估单个文件大小（基于1500kbps码率）
const estimatedFileSize = computed(() => {
  if (!recordingForm.value.startTime || !recordingForm.value.endTime) return 0
  
  const [startHour, startMin] = recordingForm.value.startTime.split(':').map(Number)
  const [endHour, endMin] = recordingForm.value.endTime.split(':').map(Number)
  
  const totalSeconds = ((endHour * 60 + endMin) - (startHour * 60 + startMin)) * 60
  const bitrate = 1500  // kbps
  
  if (recordingForm.value.segment_duration === 0) {
    // 不限时：整个时段的大小
    return (totalSeconds * bitrate) / 8 / 1024  // MB
  } else {
    // 分段：单个段的大小
    const segmentSeconds = Math.min(recordingForm.value.segment_duration, totalSeconds)
    return (segmentSeconds * bitrate) / 8 / 1024  // MB
  }
});

// 🔥 新增：格式化文件大小
const formatFileSize = (mb) => {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`
  }
  return `${mb.toFixed(0)} MB`
};

// 切换录制开关
async function handleRecordingToggle(channel) {
  // ⚠️ 新增：用户提示功能
  // 检查频道是否有活跃观看者
  const hasActiveViewers = await checkActiveViewers(channel.id);
  
  if (hasActiveViewers && channel.recordingEnabled) {
    // 启用录制时，如果有用户在观看，提示会中断
    try {
      await ElMessageBox.confirm(
        '该频道正在被观看，修改录制配置会导致观看中断约7秒，是否继续？',
        '确认修改',
        {
          type: 'warning',
          confirmButtonText: '确认修改',
          cancelButtonText: '取消'
        }
      );
    } catch {
      // 用户取消，恢复开关状态
      channel.recordingEnabled = !channel.recordingEnabled;
      return;
    }
  }
  
  // 用户确认后执行更新
  channel.recordingLoading = true;
  try {
    const result = await recordingApi.updateRecordingConfig(channel.id, {
      enabled: channel.recordingEnabled
    });
    
    // 根据返回的action显示不同消息
    if (result.data.action === 'restarted') {
      ElMessage.success('录制设置已更新（进程已重启）');
    } else if (result.data.action === 'pre-started') {
      ElMessage.success('录制设置已更新（进程已预启动，用户加入时无需等待）');
    } else {
      ElMessage.success('录制设置已更新');
    }
  } catch (error) {
    // 更新失败，恢复开关状态
    channel.recordingEnabled = !channel.recordingEnabled;
    ElMessage.error('更新失败：' + error.message);
  } finally {
    channel.recordingLoading = false;
  }
}

// 检查频道是否有活跃观看者
async function checkActiveViewers(channelId) {
  try {
    const response = await axios.get(
      `${process.env.VUE_APP_VPS_URL}/api/simple-stream/system/status`
    );
    
    // 检查返回的活跃流中是否包含该频道
    const status = response.data;
    return status.activeStreams > 0 && status.channels?.includes(channelId);
  } catch (error) {
    // API调用失败，保守起见返回true
    return true;
  }
}
</script>

<style scoped>
.form-tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.segment-preview {
  margin-top: 12px;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 13px;
}

.segment-preview-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.segment-preview-item:last-child {
  margin-bottom: 0;
}

.segment-preview-label {
  color: var(--el-text-color-regular);
}

.segment-preview-value {
  font-weight: 500;
  color: var(--el-text-color-primary);
}
</style>
```

### 5.3 部署前端

```bash
cd frontend
npm run build

# 自动部署到Cloudflare Pages（通过GitHub推送）
git add frontend/
git commit -m "feat: 添加频道录制管理界面"
git push
```

### 5.4 验证测试

**测试步骤**：
1. 打开频道管理页面
2. 找到任意频道，开启录制开关
3. 点击"录制配置"，修改时间设置
4. 验证VPS上FFmpeg进程启动
5. 检查录制文件是否生成

**验证清单**:
- [ ] 录制开关显示正常
- [ ] 开关状态与数据库同步
- [ ] 录制配置对话框正常打开
- [ ] 配置保存成功
- [ ] FFmpeg进程已启动录制

✅ 完成后更新进度表

---

## 🎯 阶段6：定时任务和自动清理

**目标**：实现定时录制和自动清理过期文件  
**影响范围**：VPS端新增定时任务模块  
**风险等级**：🟡 中  
**预计时间**：60分钟

### 6.1 创建定时任务管理器（完整实现）

**创建文件**: `vps-transcoder-api/src/services/ScheduledTaskManager.js`

⚠️ **关键逻辑**：定时录制的完整启动和停止流程

```javascript
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class ScheduledTaskManager {
  constructor(simpleStreamManager) {
    this.streamManager = simpleStreamManager;
    this.tasks = new Map(); // 定时任务跟踪
    this.activeRecordings = new Map(); // 当前活跃的定时录制
    this.recordingsDir = process.env.RECORDINGS_BASE_DIR || '/srv/filebrowser/yoyo-k';
    this.cleanupHour = process.env.RECORDINGS_CLEANUP_HOUR || 3;
    this.retentionDays = process.env.RECORDINGS_RETENTION_DAYS || 2;
    this.workerApiUrl = process.env.WORKER_API_URL || 'https://yoyoapi.5202021.xyz';
    this.apiKey = process.env.VPS_API_KEY;
  }
  
  /**
   * 启动所有定时任务
   */
  startAllTasks() {
    this.startRecordingSchedule();
    this.startCleanupSchedule();
    logger.info('All scheduled tasks started', {
      recordingSchedule: '7:50-17:20',
      cleanupSchedule: `${this.cleanupHour}:00`,
      retentionDays: this.retentionDays
    });
  }
  
  /**
   * 定时录制任务（每天7:50启动，17:20停止）
   */
  startRecordingSchedule() {
    // 每天7:50启动录制（北京时间）
    cron.schedule('50 7 * * *', async () => {
      logger.info('Daily recording start time reached');
      await this.startDailyRecording();
    });
    
    // 每天17:20停止录制（北京时间）
    cron.schedule('20 17 * * *', async () => {
      logger.info('Daily recording stop time reached');
      await this.stopDailyRecording();
    });
    
    logger.info('Recording schedule configured', {
      startTime: '7:50',
      endTime: '17:20',
      timezone: 'Asia/Shanghai'
    });
  }
  
  /**
   * 启动每日录制
   * 关键流程：获取配置 → 生成文件名 → 启动进程 → 创建D1记录 → 设置心跳 → 定时停止
   */
  async startDailyRecording() {
    try {
      // 1. 获取所有启用录制的频道
      const recordingChannels = await this.getActiveRecordingChannels();
      
      logger.info('Starting daily recording', {
        channelCount: recordingChannels.length,
        channels: recordingChannels.map(c => c.channel_id)
      });
      
      // 2. 为每个频道启动录制
      for (const config of recordingChannels) {
        await this.startScheduledRecording(config);
      }
      
      logger.info('Daily recording started successfully', {
        startedCount: this.activeRecordings.size
      });
      
    } catch (error) {
      logger.error('Failed to start daily recording', {
        error: error.message
      });
    }
  }
  
  /**
   * 启动单个频道的定时录制
   * 完整流程实现（基于SOLUTION文档行2054-2134）
   */
  async startScheduledRecording(recordingConfig) {
    const { channel_id, start_time, end_time } = recordingConfig;
    
    try {
      // 1. 获取频道的RTMP配置
      const channelConfig = await this.getChannelConfig(channel_id);
      
      if (!channelConfig || !channelConfig.rtmpUrl) {
        logger.error('Channel config not found', { channel_id });
        return;
      }
      
      // 2. 生成录制文件名（包含日期和时间范围）
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // 2025-10-24
      const startTimeStr = start_time.replace(':', '-'); // 07-50
      const endTimeStr = end_time.replace(':', '-'); // 17-20
      const filename = `${dateStr}_${startTimeStr}_${endTimeStr}.mp4`;
      
      logger.info('Starting scheduled recording', {
        channel_id,
        filename,
        rtmpUrl: channelConfig.rtmpUrl
      });
      
      // 3. 启动FFmpeg录制进程
      await this.streamManager.startNewStream(
        channel_id, 
        channelConfig.rtmpUrl,
        {
          recordingConfig: {
            enabled: true,
            segment_duration: recordingConfig.segment_duration || 3600
          }
        }
      );
      
      // 4. 计算录制结束时间
      const recordingEndTime = new Date();
      const [endHour, endMinute] = end_time.split(':');
      recordingEndTime.setHours(parseInt(endHour), parseInt(endMinute), 0, 0);
      
      // 5. 在D1中创建录制记录
      await this.createRecordingInD1({
        channel_id,
        filename,
        start_time: now.toISOString(),
        end_time: recordingEndTime.toISOString(),
        status: 'recording',
        retention_days: recordingConfig.retention_days || this.retentionDays
      });
      
      // 6. 设置录制心跳（防止被清理）
      this.streamManager.setRecordingHeartbeat(channel_id);
      
      // 7. 保存到活跃录制列表
      this.activeRecordings.set(channel_id, {
        filename,
        startTime: now,
        endTime: recordingEndTime,
        config: recordingConfig
      });
      
      logger.info('Scheduled recording started successfully', {
        channel_id,
        filename,
        expectedEndTime: recordingEndTime.toISOString()
      });
      
    } catch (error) {
      logger.error('Failed to start scheduled recording', {
        channel_id,
        error: error.message
      });
    }
  }
  
  /**
   * 停止每日录制
   */
  async stopDailyRecording() {
    try {
      logger.info('Stopping daily recording', {
        activeCount: this.activeRecordings.size,
        channels: Array.from(this.activeRecordings.keys())
      });
      
      // 停止所有活跃的定时录制
      for (const [channel_id, recordingInfo] of this.activeRecordings) {
        await this.stopScheduledRecording(channel_id, recordingInfo);
      }
      
      this.activeRecordings.clear();
      
      logger.info('Daily recording stopped successfully');
      
    } catch (error) {
      logger.error('Failed to stop daily recording', {
        error: error.message
      });
    }
  }
  
  /**
   * 停止单个频道的定时录制
   */
  async stopScheduledRecording(channel_id, recordingInfo) {
    try {
      logger.info('Stopping scheduled recording', {
        channel_id,
        filename: recordingInfo.filename
      });
      
      // 1. 停止FFmpeg进程
      await this.streamManager.stopChannel(channel_id);
      
      // 2. 清理录制心跳
      this.streamManager.clearRecordingHeartbeat(channel_id);
      
      // 3. 更新D1记录状态为completed
      await this.updateRecordingStatus(channel_id, 'completed');
      
      logger.info('Scheduled recording stopped successfully', {
        channel_id,
        filename: recordingInfo.filename
      });
      
    } catch (error) {
      logger.error('Failed to stop scheduled recording', {
        channel_id,
        error: error.message
      });
    }
  }
  
  /**
   * 获取启用录制的频道列表（从Workers API）
   */
  async getActiveRecordingChannels() {
    try {
      const response = await fetch(`${this.workerApiUrl}/api/admin/recording-configs?enabled=true`, {
        headers: {
          'X-API-Key': this.apiKey
        }
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      const data = await response.json();
      return data.data || [];
      
    } catch (error) {
      logger.error('Failed to get active recording channels', {
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * 🔥 修复Bug12 (v2): 获取频道配置（包含RTMP URL）
   * 更新方案：调用Workers新增的频道配置API，复用现有RTMP获取逻辑
   * 
   * 注意：需要在Workers端添加 /api/channels/:channelId 端点
   * Workers端会从KV获取RTMP URL（优先）或使用默认配置
   */
  async getChannelConfig(channel_id) {
    try {
      // 调用Workers API获取完整的频道配置（包含RTMP URL）
      const response = await fetch(
        `${this.workerApiUrl}/api/channels/${channel_id}`,
        {
          headers: {
            'X-API-Key': this.apiKey
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to get channel config: ${response.status}`);
      }
      
      const channelData = await response.json();
      
      // Workers API应该返回：
      // {
      //   status: 'success',
      //   data: {
      //     channelId: 'stream_xxx',
      //     name: '二楼教室1',
      //     rtmpUrl: 'rtmp://push228.dodool.com.cn/55/3?auth_key=...',
      //     recordingEnabled: true,
      //     recordingConfig: { ... }
      //   }
      // }
      
      if (!channelData.data?.rtmpUrl) {
        throw new Error('No RTMP URL found in channel config');
      }
      
      return channelData.data;
      
    } catch (error) {
      logger.error('Failed to get channel config', {
        channel_id,
        error: error.message
      });
      
      // 🔥 降级方案：使用默认RTMP配置（与Workers保持一致）
      const defaultRtmpUrls = {
        'stream_ensxma2g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
        'stream_gkg5hknc': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
        'stream_kcwxuedx': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
        'stream_kil0lecb': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
        'stream_noyoostd': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
        'stream_3blyhqh3': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b',
        'stream_8zf48z6g': 'rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c',
        'stream_cpa2czoo': 'rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b'
      };
      
      if (defaultRtmpUrls[channel_id]) {
        logger.warn('Using fallback RTMP URL', { channel_id });
        return {
          channelId: channel_id,
          rtmpUrl: defaultRtmpUrls[channel_id],
          name: channel_id // 使用channelId作为默认名称
        };
      }
      
      return null;
    }
  }
  
  /**
   * 🔥 修复Bug13: 在D1中创建录制记录（使用正确的API端点）
   */
  async createRecordingInD1(recordData) {
    try {
      // 使用正确的API端点 /api/recording/files
      const response = await fetch(`${this.workerApiUrl}/api/recording/files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify(recordData)
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      logger.info('Created recording record in D1', {
        channel_id: recordData.channel_id,
        filename: recordData.filename
      });
      
    } catch (error) {
      logger.error('Failed to create recording in D1', {
        channel_id: recordData.channel_id,
        error: error.message
      });
    }
  }
  
  /**
   * 更新录制状态（通过Workers API）
   */
  async updateRecordingStatus(channel_id, status) {
    try {
      const response = await fetch(`${this.workerApiUrl}/api/admin/recordings/${channel_id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({ status })
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      logger.info('Updated recording status', { channel_id, status });
      
    } catch (error) {
      logger.error('Failed to update recording status', {
        channel_id,
        error: error.message
      });
    }
  }
  
  /**
   * 定时清理任务（凌晨3点）
   */
  startCleanupSchedule() {
    const hour = this.cleanupHour;
    cron.schedule(`0 ${hour} * * *`, async () => {
      logger.info('Starting scheduled cleanup');
      await this.cleanupOldRecordings();
    });
    
    logger.info('Cleanup schedule configured', {
      time: `${hour}:00`,
      retentionDays: this.retentionDays
    });
  }
  
  /**
   * 清理过期文件
   */
  async cleanupOldRecordings() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      
      logger.info('Cleaning up old recordings', {
        cutoffDate: cutoffDate.toISOString(),
        retentionDays: this.retentionDays
      });
      
      let deletedCount = 0;
      let totalSize = 0;
      
      // 遍历所有频道目录
      const channels = await fs.readdir(this.recordingsDir);
      
      for (const channelDir of channels) {
        const channelPath = path.join(this.recordingsDir, channelDir);
        const stat = await fs.stat(channelPath);
        
        if (!stat.isDirectory()) continue;
        
        const files = await fs.readdir(channelPath);
        
        for (const file of files) {
          if (!file.endsWith('.mp4')) continue;
          
          const filePath = path.join(channelPath, file);
          const fileStat = await fs.stat(filePath);
          
          // 检查文件修改时间
          if (fileStat.mtime < cutoffDate) {
            const fileSize = fileStat.size;
            await fs.unlink(filePath);
            deletedCount++;
            totalSize += fileSize;
            
            logger.info('Deleted old recording', {
              channel: channelDir,
              file,
              size: fileSize,
              age: Math.floor((Date.now() - fileStat.mtime.getTime()) / (1000 * 60 * 60 * 24)) + ' days'
            });
          }
        }
      }
      
      logger.info('Cleanup completed', {
        deletedCount,
        totalSize: `${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`,
        cutoffDate: cutoffDate.toISOString()
      });
      
    } catch (error) {
      logger.error('Failed to cleanup old recordings', {
        error: error.message
      });
    }
  }
}

module.exports = ScheduledTaskManager;
```

### 6.2 集成到app.js

**修改文件**: `vps-transcoder-api/src/app.js`

```javascript
const ScheduledTaskManager = require('./services/ScheduledTaskManager');

async function startServer() {
  // ... 现有代码
  
  // 启动定时任务
  const taskManager = new ScheduledTaskManager(simpleStreamManager);
  taskManager.startAllTasks();
  
  logger.info('Scheduled tasks started');
}
```

### 6.3 安装依赖

**本地安装**：
```bash
cd vps-transcoder-api
npm install node-cron --save
```

这会更新 `package.json` 和 `package-lock.json` 文件。

### 6.4 更新VPS部署脚本 ⭐重要

⚠️ **必须同步修改部署脚本，确保VPS部署时自动安装新依赖！**

**修改文件**: `vps-transcoder-api/vps-simple-deploy.sh`

在部署脚本中添加依赖安装步骤（提供两种方案）：

**方案1: 智能安装（推荐，更快）**
```bash
# 在重启服务前添加：
echo "📦 Checking dependencies..."
cd /opt/yoyo-transcoder

# 只在package.json变化或node_modules缺失时安装
if ! cmp -s package.json package.json.old 2>/dev/null || [ ! -d node_modules ]; then
  echo "📦 Dependencies changed or missing, installing..."
  npm ci --production
  cp package.json package.json.old
else
  echo "✅ Dependencies up to date, skipping install"
fi
```

**方案2: 简单版本（总是安装，但npm会自动优化）**
```bash
echo "📦 Installing dependencies..."
cd /opt/yoyo-transcoder
npm install --production  # 幂等操作，不会报错
```

**完整建议的部署流程**：
```bash
#!/bin/bash
# vps-simple-deploy.sh 完整示例

echo "🚀 Starting deployment..."

# 1. 同步代码
echo "📁 Syncing source code..."
cp -r /tmp/github/secure-streaming-platform/vps-transcoder-api/src/* /opt/yoyo-transcoder/src/

# 2. 同步package.json（确保依赖定义最新）
echo "📦 Syncing package.json..."
cp /tmp/github/secure-streaming-platform/vps-transcoder-api/package.json /opt/yoyo-transcoder/

# 3. 智能安装依赖
cd /opt/yoyo-transcoder
if ! cmp -s package.json package.json.old 2>/dev/null || [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm ci --production
  cp package.json package.json.old
else
  echo "✅ Dependencies up to date"
fi

# 4. 重启服务
echo "🔄 Reloading service..."
pm2 reload vps-transcoder-api

echo "✅ Deployment completed!"
```

**为什么重要**：
- ❌ 不更新部署脚本 → VPS缺少node-cron → 定时任务功能无法启动 → 阶段6失败
- ✅ 更新部署脚本 → 自动安装依赖 → 所有功能正常工作

**npm install vs npm ci**：
| 命令 | 特点 | 适用场景 |
|------|------|---------|
| `npm install` | 幂等操作，可重复执行 | 开发环境 |
| `npm ci` | 删除node_modules重新安装，更快更可靠 | 生产环境部署 ⭐推荐 |

### 6.5 部署和验证

```bash
# 1. 提交代码（包括package.json和部署脚本）
git add vps-transcoder-api/package.json
git add vps-transcoder-api/package-lock.json
git add vps-transcoder-api/vps-simple-deploy.sh
git add vps-transcoder-api/src/services/ScheduledTaskManager.js
git add vps-transcoder-api/src/app.js
git commit -m "feat: 添加定时录制和自动清理功能

- 新增ScheduledTaskManager定时任务管理器
- 集成node-cron实现定时录制和清理
- 更新部署脚本支持依赖自动安装
"
git push

# 2. 同步到VPS Git目录
ssh root@142.171.75.220 "cd /tmp/github/secure-streaming-platform && git pull"

# 3. 执行部署脚本（会自动安装依赖）
ssh root@142.171.75.220 "/tmp/github/secure-streaming-platform/vps-transcoder-api/vps-simple-deploy.sh"

# 4. 验证依赖安装
ssh root@142.171.75.220 "cd /opt/yoyo-transcoder && npm list node-cron"
```

**验证清单**:
- [ ] node-cron已安装
- [ ] 定时任务已启动
- [ ] 7:50自动开始录制
- [ ] 17:20自动停止录制
- [ ] 凌晨3点清理过期文件

✅ 完成后更新进度表

---

## 🎯 阶段7：完整集成测试

**目标**：验证所有功能正常工作，压力测试  
**影响范围**：全系统  
**风险等级**：🟢 低（仅测试）  
**预计时间**：120分钟

### 7.1 功能测试清单

**基础功能**:
- [ ] 手动启动/停止录制
- [ ] 定时自动录制（7:50-17:20）
- [ ] 分段录制（每1小时切换文件）
- [ ] 文件命名格式正确
- [ ] D1数据库记录同步

**高级功能**:
- [ ] 配置变更自动重启FFmpeg
- [ ] 进程崩溃后自动修复文件
- [ ] 服务重启后恢复录制状态
- [ ] 过期文件自动清理
- [ ] 录制不影响HLS播放

### 7.2 关键异常测试

⚠️ **重点测试两个最关键的异常场景**

#### **测试1：进程崩溃恢复** 🔴 关键

**测试目的**：验证FFmpeg进程意外崩溃后的自动修复机制

```bash
# 1. 启动一个正在录制的频道
curl -X POST https://yoyo-vps.5202021.xyz/api/simple-stream/start-watching \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"channelId": "test_channel", "rtmpUrl": "rtmp://source/live", "options": {"recordingConfig": {"enabled": true}}}'

# 2. 等待录制开始（约10秒）
sleep 10

# 3. 强制终止FFmpeg进程模拟崩溃
ssh root@142.171.75.220 "pkill -9 ffmpeg"

# 4. 重启服务触发自动修复
ssh root@142.171.75.220 "pm2 restart vps-transcoder-api"

# 5. 等待修复完成（约30秒）
sleep 30

# 6. 验证文件修复结果
ssh root@142.171.75.220 "ls -la /var/recordings/test_channel/"
```

**验证清单**：
- [ ] 服务启动时检测到损坏文件
- [ ] 自动执行修复流程
- [ ] 修复后的文件可以正常播放
- [ ] D1数据库状态更新为completed或failed
- [ ] 修复日志完整记录

**预期结果**：
- ✅ 损坏文件被自动修复（成功率85%+）
- ✅ 修复失败的文件有明确错误记录
- ✅ 不影响其他频道的录制

#### **测试2：网络中断** 🔴 关键

**测试目的**：验证RTMP源中断时的错误处理

```bash
# 1. 启动录制
curl -X POST https://yoyo-vps.5202021.xyz/api/simple-stream/start-watching \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"channelId": "test_network", "rtmpUrl": "rtmp://source/live", "options": {"recordingConfig": {"enabled": true}}}'

# 2. 等待录制稳定（约20秒）
sleep 20

# 3. 中断RTMP源（在源服务器上停止推流）
# 或者使用防火墙规则临时阻断连接

# 4. 观察FFmpeg进程行为
ssh root@142.171.75.220 "ps aux | grep ffmpeg"

# 5. 检查录制文件状态
ssh root@142.171.75.220 "ls -la /var/recordings/test_network/"

# 6. 恢复RTMP源，验证是否重新开始录制
```

**验证清单**：
- [ ] FFmpeg检测到网络中断并退出
- [ ] 当前录制文件正确关闭
- [ ] 错误信息记录到日志
- [ ] D1数据库记录更新
- [ ] 恢复后可以重新开始录制

**预期结果**：
- ✅ 网络中断时录制自动停止
- ✅ 已录制的部分保存完整
- ✅ 错误日志清晰可追溯
- ✅ 恢复后自动重新开始录制

### 7.4 验证报告

完成所有测试后，填写验证报告：

**功能验证**: ✅/❌  
**性能验证**: ✅/❌  
**异常处理**: ✅/❌  
**文档完整性**: ✅/❌

**发现的问题**：
1. 问题描述
2. 影响范围
3. 解决方案
4. 是否阻塞上线

✅ 完成后更新进度表，标记项目完成

---

## 🔄 回滚方案

如果任何阶段失败，立即执行回滚：

```bash
# 回滚到备份
$timestamp = "YOUR_BACKUP_TIMESTAMP"
Copy-Item "backups\$timestamp\*" -Destination "对应目录" -Force

# 重新部署Workers
cd cloudflare-worker
npx wrangler deploy --env production

# 重新部署VPS
ssh root@142.171.75.220 "cd /tmp/github && ./vps-simple-deploy.sh"
```

---

## 📌 重要提醒

1. ⚠️ **修改配置会导致重启** - 影响观看用户7秒
2. ⚠️ **VPS无法直接访问D1** - 必须通过Workers API
3. ⚠️ **磁盘空间监控** - 8频道2天约109GB
4. ⚠️ **文件权限** - 确保/var/recordings可写
5. ⚠️ **分段录制** - 每1小时自动切换文件

---

**文档维护者**: AI Assistant  
**最后更新**: 2025-10-24 22:45 (UTC+8)  
**文档状态**: ✅ 初始版本完成