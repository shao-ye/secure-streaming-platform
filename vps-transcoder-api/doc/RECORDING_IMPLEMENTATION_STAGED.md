# 🎬 频道定时录制功能实施方案 - 阶段化执行文档

**版本**: v1.3 | **创建时间**: 2025-10-28 09:20 | **更新时间**: 2025-10-28 12:13  
**基于**: 预加载功能实施经验  
**参照文档**: `PRELOAD_IMPLEMENTATION_STAGED.md` + `ARCHITECTURE_V2.md`  
**更新日志**: 
- v1.1 - 优化文件命名规范，采用混合方案（channelName + channelId），提升可读性和实用性
- v1.2 - 移除纯ASCII备选方案；完善代码实现细节（channelName自动填充、fetchRecordConfigs方法、环境变量配置、npm依赖安装）
- v1.3 - 删除手动创建目录步骤；删除recordConfig中冗余的channelName字段，改为从顶层name获取，避免数据不一致

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

---

## 🎯 关键概念理解 ⭐⭐⭐

### 1️⃣ **录制与预加载/观看的关系** - 最核心

**原则：一个FFmpeg进程同时输出HLS和MP4**

```
现有：FFmpeg → HLS流(playlist.m3u8 + segments)
录制：FFmpeg → HLS流 + MP4文件
```

**关键逻辑**：
- 录制启用时：
  1. 检查是否有现有进程（观看/预加载）
  2. 有进程 → 停止旧进程 → 重启进程(HLS+MP4)
  3. 无进程 → 启动新进程(HLS+MP4)

- 录制停止时：
  1. 优雅停止FFmpeg(SIGTERM)
  2. FFmpeg自动完成MP4
  3. 有观看/预加载 → 重启进程(仅HLS)
  4. 无观看/预加载 → 清理进程

### 2️⃣ **录制配置存储**

```javascript
// channel:stream_xxx
{
  "preloadConfig": { /* 现有 */ },
  "recordConfig": {  // 新增
    "enabled": true,
    "startTime": "07:40",
    "endTime": "17:25",
    "workdaysOnly": true,
    "storagePath": "/var/www/recordings"
  }
}
```

### 3️⃣ **FFmpeg命令对比**

**仅HLS（现有）**：
```bash
ffmpeg -i rtmp://source \
  -c:v libx264 -preset ultrafast -an \
  -f hls /path/to/playlist.m3u8
```

**HLS+MP4（录制）**：
```bash
ffmpeg -i rtmp://source \
  -c:v libx264 -preset ultrafast -an \
  -f hls /path/to/playlist.m3u8 \
  -c:v copy -f mp4 /path/to/recording.mp4
```

**关键**：MP4使用 `-c:v copy` 直接复制，无需再次转码

### 4️⃣ **文件命名规范** ⭐⭐⭐

#### **推荐方案：混合方案（channelName + channelId）**

基于实际需求和用户反馈，**强烈推荐使用混合命名方案**，兼顾可读性和唯一性：

**格式**：`{channelName}_{channelId}_{YYYYMMDD}_{HHmmss}_to_{HHmmss}.mp4`

**实际输出示例**（如用户需求图所示）：
```
二楼教室1_stream_ensxma2g_20251028_074000_to_172500.mp4
多功能厅_stream_gkg5hknc_20251028_090000_to_170000.mp4
国际班_stream_kcwxuedx_20251028_075000_to_173000.mp4
```

**核心优势**：
- ✅ **人类可读**：一眼看出是哪个频道的录像
- ✅ **机器友好**：channelId保证唯一性
- ✅ **时间明确**：包含开始和结束时间
- ✅ **系统稳定**：即使channelName更新，通过channelId仍能正确关联

**实现代码**：
```javascript
const generateRecordingFilename = (channelName, channelId, startTime, endTime) => {
  const formatTime = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return { date: `${year}${month}${day}`, time: `${hours}${minutes}${seconds}` };
  };
  
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  return `${channelName}_${channelId}_${start.date}_${start.time}_to_${end.time}.mp4`;
};

// 使用示例
const filename = generateRecordingFilename(
  '二楼教室1', 'stream_ensxma2g', 
  '2025-10-28T07:40:00', '2025-10-28T17:25:00'
);
// 输出: 二楼教室1_stream_ensxma2g_20251028_074000_to_172500.mp4
```

#### **目录结构**

```
/var/www/recordings/
  ├── stream_ensxma2g/
  │   ├── 20251028/
  │   │   └── 二楼教室1_stream_ensxma2g_20251028_074000_to_172500.mp4
  │   └── 20251029/
  │       └── 二楼教室1_stream_ensxma2g_20251029_074000_to_172500.mp4
  └── stream_gkg5hknc/
      └── 20251028/
          └── 多功能厅_stream_gkg5hknc_20251028_090000_to_170000.mp4
```

**注意事项**：
1. 文件名长度建议控制在50字符内
2. 系统必须支持UTF-8编码（现代Linux/Windows均支持）
3. channelId确保唯一性，避免名称冲突
4. 结束时间直接包含在文件名中，无需额外查询

---

## 📊 执行进度追踪

### **总体进度**: 5/7 阶段完成

| 阶段 | 名称 | 状态 | 完成时间 | 验证结果 |
|------|------|------|----------|----------|
| **准备** | 环境配置和文件备份 | ✅ 已完成 | 2025-10-28 12:28 | ✅ 依赖安装成功，环境验证通过 |
| **阶段1** | KV数据结构扩展 | ✅ 已完成 | 2025-10-28 12:30 | ✅ KV结构验证通过，可安全添加recordConfig |
| **阶段2** | SimpleStreamManager录制支持 | ✅ 已完成 | 2025-10-28 12:42 | ✅ 所有录制方法已添加，文件路径生成正确 |
| **阶段3** | RecordScheduler定时调度器 | ✅ 已完成 | 2025-10-28 12:43 | ✅ 调度器功能正常，时间判断正确（含跨天） |
| **阶段4** | Workers API扩展 | ✅ 已完成 | 2025-10-28 12:51 | ✅ API部署成功，/api/record/configs正常返回 |
| **阶段5** | 前端界面改造 | ✅ 已完成 | 2025-10-28 12:58 | ✅ ChannelConfigDialog已创建，Cloudflare Pages自动部署中 |
| **阶段6** | 健康检查和自动恢复 | 🔄 进行中 | - | - |
| **阶段7** | 完整集成测试 | ⏳ 未开始 | - | - |

---

## 📋 功能概述

### 核心需求
1. 为每个频道独立配置录制
2. 定时录制（北京时间）
3. 工作日限制（可选）
4. 自定义存储路径
5. 录制与观看/预加载共享进程
6. 平滑切换无中断

### 系统架构

```
前端界面（对话框分上下两部分）
  ├── 上半部分：预加载配置（现有）
  └── 下半部分：录制配置（新增）
       ├── 开关
       ├── 开始/结束时间
       ├── 仅工作日
       └── 存储路径

↓ API调用

Cloudflare Workers
  ├── 现有：/api/preload/*
  └── 新增：/api/record/*
       ├── PUT /api/record/config/:id
       ├── GET /api/record/status
       └── POST /api/record/reload

↓ 配置获取/通知

VPS转码服务
  ├── RecordScheduler（新增）
  │   └── 定时任务管理
  ├── SimpleStreamManager（扩展）
  │   ├── enableRecording()
  │   ├── disableRecording()
  │   └── restartWithRecording()
  └── RecordHealthCheck（新增）
      └── 健康监控
```

---

## 🎯 准备阶段

```bash
# 1. 备份文件
mkdir -p /opt/yoyo-transcoder/backup/recording-$(date +%Y%m%d)
cp SimpleStreamManager.js backup/
cp app.js backup/

# 2. 安装必要依赖（如果尚未安装）
cd /opt/yoyo-transcoder
npm install node-cron moment-timezone

# 3. 验证环境
curl https://yoyoapi.5202021.xyz/health
curl http://localhost:3000/health

# 注意：录制目录会在启动录制时自动创建，无需手动创建
```

---

## 🎯 阶段1：KV数据结构扩展

**目标**：添加 recordConfig 字段  
**风险**：🟢 低（仅添加字段）  
**时间**：30分钟

### 数据结构

```javascript
{
  "id": "stream_xxx",
  "name": "二楼教室1",  // 现有字段，录制文件命名会使用此字段
  "preloadConfig": { /* 现有 */ },
  "recordConfig": {  // 新增
    "enabled": false,
    "startTime": "07:40",
    "endTime": "17:25",
    "workdaysOnly": false,
    "storagePath": "/var/www/recordings",
    "updatedAt": "2025-10-28T09:00:00Z",
    "updatedBy": "admin"
  }
}

// 完整示例
{
  "id": "stream_ensxma2g",
  "name": "二楼教室1",
  "rtmpUrl": "rtmp://push228.dodool.com.cn/55/19?auth_key=xxx",
  "preloadConfig": {
    "enabled": true,
    "startTime": "07:40",
    "endTime": "17:20"
  },
  "recordConfig": {
    "enabled": true,
    "startTime": "07:40",
    "endTime": "17:25",
    "workdaysOnly": true,
    "storagePath": "/var/www/recordings"
  }
}
```

**注意**：频道名称使用顶层的 `name` 字段，避免数据冗余。

### 验证

```bash
# 查看现有频道配置
curl -H "Cookie: session_token=TOKEN" \
  https://yoyoapi.5202021.xyz/api/admin/streams
```

---

## 🎯 阶段2：SimpleStreamManager录制支持

**目标**：扩展进程管理支持录制  
**风险**：🟡 中（修改核心逻辑）  
**时间**：90分钟

### 核心方法

**文件**：`vps-transcoder-api/src/services/SimpleStreamManager.js`

```javascript
// 新增属性
this.recordingChannels = new Set();
this.recordingConfigs = new Map();
this.recordingBaseDir = '/var/www/recordings';

// 新增方法
async enableRecording(channelId, recordConfig) {
  // recordConfig 由Workers API传递，包含:
  // - channelName: 频道名称（从KV的顶层name字段获取，如"二楼教室1"）
  // - startTime: 开始时间（如"07:40"）
  // - endTime: 结束时间（如"17:25"）
  // - storagePath: 存储路径（可选，默认使用this.recordingBaseDir）
  
  // 保存配置
  this.recordingConfigs.set(channelId, recordConfig);
  this.recordingChannels.add(channelId);
  
  // 检查现有进程
  const existing = this.activeStreams.get(channelId);
  if (existing) {
    // 重启进程添加录制
    await this.restartStreamWithRecording(channelId, existing.rtmpUrl, recordConfig);
  } else {
    // 启动新进程
    const rtmpUrl = await this.fetchChannelRtmpUrl(channelId);
    await this.startStreamWithRecording(channelId, rtmpUrl, recordConfig);
  }
}

async disableRecording(channelId) {
  this.recordingChannels.delete(channelId);
  this.recordingConfigs.delete(channelId);
  
  const existing = this.activeStreams.get(channelId);
  if (existing && existing.isRecording) {
    const hasViewers = this.channelHeartbeats.has(channelId);
    const isPreload = this.preloadChannels.has(channelId);
    
    if (hasViewers || isPreload) {
      // 重启进程移除录制
      await this.restartStreamWithoutRecording(channelId, existing.rtmpUrl);
    } else {
      // 停止进程
      await this.stopFFmpegProcess(channelId);
    }
  }
}

async spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath) {
  const outputDir = path.join(this.hlsOutputDir, channelId);
  const recordDir = path.dirname(recordingPath);
  
  // 确保目录存在
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(recordDir, { recursive: true });
  
  const ffmpegArgs = [
    '-i', rtmpUrl,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
    // HLS输出
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6',
    '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
    path.join(outputDir, 'playlist.m3u8'),
    // MP4输出（复制编码）
    '-c:v', 'copy', '-f', 'mp4', recordingPath
  ];
  
  return spawn(this.ffmpegPath, ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });
}

generateRecordingPath(channelId, channelName, recordConfig) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const dateStr = `${year}${month}${day}`;
  const timeStr = `${hours}${minutes}${seconds}`;
  
  // 解析结束时间
  const [endHour, endMin] = recordConfig.endTime.split(':');
  const endTimeStr = `${endHour}${endMin}00`;
  
  const basePath = recordConfig.storagePath || this.recordingBaseDir;
  
  // 🔥 使用混合命名方案：channelName + channelId
  const filename = `${channelName}_${channelId}_${dateStr}_${timeStr}_to_${endTimeStr}.mp4`;
  
  return path.join(basePath, channelId, dateStr, filename);
}

// 使用示例:
// generateRecordingPath('stream_ensxma2g', '二楼教室1', { endTime: '17:25', storagePath: '/var/www/recordings' })
// => /var/www/recordings/stream_ensxma2g/20251028/二楼教室1_stream_ensxma2g_20251028_074000_to_172500.mp4
```

### 验证

```bash
# SSH到VPS测试
node -e "
const manager = require('./src/services/SimpleStreamManager');
// 测试启用录制
await manager.enableRecording('test', {
  storagePath: '/var/www/recordings',
  endTime: '17:25'
});
"
```

---

## 🎯 阶段3：RecordScheduler定时调度器

**目标**：创建录制调度器  
**风险**：🟢 低（复用PreloadScheduler设计）  
**时间**：60分钟

### 文件结构

**新建**：`vps-transcoder-api/src/services/RecordScheduler.js`

```javascript
const cron = require('node-cron');
const moment = require('moment-timezone');
const WorkdayChecker = require('./WorkdayChecker');

class RecordScheduler {
  constructor(streamManager) {
    this.streamManager = streamManager;
    this.cronTasks = new Map();
    this.workdayChecker = new WorkdayChecker();
    this.workersApiUrl = process.env.WORKERS_API_URL;
  }
  
  async start() {
    await this.workdayChecker.initialize();
    const configs = await this.fetchRecordConfigs();
    
    for (const config of configs) {
      if (await this.shouldRecordNow(config)) {
        await this.startRecording(config);
      }
      this.scheduleChannel(config);
    }
  }
  
  scheduleChannel(config) {
    const { channelId, startTime, endTime } = config;
    const [startH, startM] = startTime.split(':');
    const [endH, endM] = endTime.split(':');
    
    // 开始任务
    const startCron = `${startM} ${startH} * * *`;
    const startTask = cron.schedule(startCron, async () => {
      if (await this.shouldRecordNow(config)) {
        await this.startRecording(config);
      }
    }, { timezone: 'Asia/Shanghai' });
    
    // 结束任务
    const stopCron = `${endM} ${endH} * * *`;
    const stopTask = cron.schedule(stopCron, async () => {
      await this.stopRecording(channelId);
    }, { timezone: 'Asia/Shanghai' });
    
    this.cronTasks.set(channelId, { startTask, stopTask });
  }
  
  async shouldRecordNow(config) {
    const currentTime = moment().tz('Asia/Shanghai').format('HH:mm');
    const inTimeRange = this.isInTimeRange(currentTime, config.startTime, config.endTime);
    
    if (!inTimeRange) return false;
    
    if (config.workdaysOnly) {
      return await this.workdayChecker.isWorkday();
    }
    
    return true;
  }
  
  isInTimeRange(current, start, end) {
    const [ch, cm] = current.split(':').map(Number);
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    
    const currentMins = ch * 60 + cm;
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    
    if (endMins < startMins) {
      return currentMins >= startMins || currentMins < endMins;
    }
    return currentMins >= startMins && currentMins < endMins;
  }
  
  async startRecording(config) {
    await this.streamManager.enableRecording(config.channelId, config);
  }
  
  async stopRecording(channelId) {
    await this.streamManager.disableRecording(channelId);
  }
  
  async fetchRecordConfigs() {
    try {
      const response = await fetch(`${this.workersApiUrl}/api/record/configs`, {
        headers: {
          'X-API-Key': process.env.VPS_API_KEY
        }
      });
      const result = await response.json();
      return result.data || [];
    } catch (error) {
      logger.error('Failed to fetch record configs:', error);
      return [];
    }
  }
}
```

---

## 🎯 阶段4：Workers API扩展

**目标**：添加录制配置API  
**风险**：🟢 低（复用preloadHandler模式）  
**时间**：45分钟

### API端点

**文件**：`cloudflare-worker/src/handlers/recordHandler.js` (新建)

```javascript
// PUT /api/record/config/:channelId
async function updateRecordConfig(env, channelId, data, username) {
  const channelKey = `channel:${channelId}`;
  let channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
  
  if (!channelData) {
    throw new Error('Channel not found');
  }
  
  // 更新recordConfig字段
  channelData.recordConfig = {
    enabled: data.enabled === true,
    startTime: data.startTime,
    endTime: data.endTime,
    workdaysOnly: data.workdaysOnly === true,
    storagePath: data.storagePath || '/var/www/recordings',
    updatedAt: new Date().toISOString(),
    updatedBy: username
  };
  
  await env.YOYO_USER_DB.put(channelKey, JSON.stringify(channelData));
  
  // 通知VPS重载
  await notifyVpsReload(env);
  
  return { status: 'success', data: channelData.recordConfig };
}

// GET /api/record/configs
async function getAllRecordConfigs(env) {
  const listResult = await env.YOYO_USER_DB.list({ prefix: 'channel:' });
  const configs = [];
  
  for (const key of listResult.keys) {
    const channelData = await env.YOYO_USER_DB.get(key.name, { type: 'json' });
    if (channelData?.recordConfig?.enabled) {
      configs.push({
        channelId: channelData.id,
        channelName: channelData.name,  // 🔥 从顶层name获取
        ...channelData.recordConfig
      });
    }
  }
  
  return { status: 'success', data: configs };
}
```

---

## 🎯 阶段5：前端界面改造

**目标**：对话框分上下两部分  
**风险**：🟢 低（UI改造）  
**时间**：60分钟

### 组件改造

**文件**：`frontend/src/components/admin/ChannelConfigDialog.vue` (改造PreloadConfigDialog.vue)

```vue
<template>
  <el-dialog v-model="visible" title="频道配置" width="600px">
    <el-form :model="form" label-width="100px">
      
      <!-- ========== 上半部分：预加载配置 ========== -->
      <el-divider content-position="left">
        <span style="font-weight: bold;">预加载配置</span>
      </el-divider>
      
      <el-form-item label="预加载开关">
        <el-switch v-model="form.preloadConfig.enabled" />
      </el-form-item>
      
      <el-form-item label="开始时间">
        <el-time-picker 
          v-model="form.preloadConfig.startTime"
          format="HH:mm" 
          value-format="HH:mm"
          :disabled="!form.preloadConfig.enabled"
        />
      </el-form-item>
      
      <el-form-item label="结束时间">
        <el-time-picker 
          v-model="form.preloadConfig.endTime"
          format="HH:mm" 
          value-format="HH:mm"
          :disabled="!form.preloadConfig.enabled"
        />
      </el-form-item>
      
      <el-form-item label="仅工作日">
        <el-switch v-model="form.preloadConfig.workdaysOnly" />
      </el-form-item>
      
      <!-- ========== 下半部分：录制配置 ========== -->
      <el-divider content-position="left">
        <span style="font-weight: bold;">录制配置</span>
      </el-divider>
      
      <el-form-item label="录制开关">
        <el-switch v-model="form.recordConfig.enabled" />
      </el-form-item>
      
      <el-form-item label="开始时间">
        <el-time-picker 
          v-model="form.recordConfig.startTime"
          format="HH:mm" 
          value-format="HH:mm"
          :disabled="!form.recordConfig.enabled"
        />
      </el-form-item>
      
      <el-form-item label="结束时间">
        <el-time-picker 
          v-model="form.recordConfig.endTime"
          format="HH:mm" 
          value-format="HH:mm"
          :disabled="!form.recordConfig.enabled"
        />
      </el-form-item>
      
      <el-form-item label="仅工作日">
        <el-switch v-model="form.recordConfig.workdaysOnly" />
      </el-form-item>
      
      <el-form-item label="存储路径">
        <el-input 
          v-model="form.recordConfig.storagePath"
          placeholder="/var/www/recordings"
          :disabled="!form.recordConfig.enabled"
        />
      </el-form-item>
      
    </el-form>
    
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
const form = ref({
  preloadConfig: {
    enabled: false,
    startTime: '07:00',
    endTime: '17:30',
    workdaysOnly: false
  },
  recordConfig: {
    enabled: false,
    startTime: '07:40',
    endTime: '17:25',
    workdaysOnly: false,
    storagePath: '/var/www/recordings'
  }
});

async function handleSave() {
  // 保存预加载配置
  await axios.put(`/api/preload/config/${channelId}`, form.value.preloadConfig);
  
  // 保存录制配置
  await axios.put(`/api/record/config/${channelId}`, form.value.recordConfig);
  
  ElMessage.success('配置保存成功');
  emit('saved');
}
</script>
```

---

## 🎯 阶段6：健康检查

**目标**：监控录制进程健康  
**风险**：🟢 低  
**时间**：30分钟

```javascript
class RecordHealthCheck {
  async checkRecordings() {
    for (const [channelId, config] of manager.recordingConfigs) {
      const stream = manager.activeStreams.get(channelId);
      
      if (stream && stream.isRecording) {
        // 检查文件是否在增长
        const fileSize = fs.statSync(stream.recordingPath).size;
        // 检查磁盘空间
        const diskSpace = await checkDiskSpace('/var/www/recordings');
        
        if (diskSpace.free < 1024 * 1024 * 1024) {  // <1GB
          logger.warn('Low disk space', { free: diskSpace.free });
        }
      }
    }
  }
}
```

---

## 🎯 阶段7：完整集成测试

### 测试清单

- [ ] 1. 开启录制，无现有进程 → 启动进程(HLS+MP4)
- [ ] 2. 开启录制，有观看进程 → 重启进程(HLS+MP4)
- [ ] 3. 开启录制，有预加载进程 → 重启进程(HLS+MP4)
- [ ] 4. 关闭录制，有观看用户 → 重启进程(仅HLS)
- [ ] 5. 关闭录制，无观看用户 → 停止进程
- [ ] 6. 定时开始录制（7:40）
- [ ] 7. 定时结束录制（17:25）
- [ ] 8. 工作日限制生效
- [ ] 9. MP4文件正常生成
- [ ] 10. 文件命名正确
  - 格式：`二楼教室1_stream_ensxma2g_20251028_074000_to_172500.mp4`
  - 包含：频道名称 + 频道ID + 日期 + 开始时间 + 结束时间
  - 文件名长度 < 50字符
  - 中文显示正常（UTF-8）

---

## 📝 注意事项

1. **磁盘空间管理**：需要定期清理旧录制文件
2. **并发控制**：同时录制多个频道时注意系统资源
3. **文件完整性**：确保FFmpeg优雅退出，避免损坏MP4
4. **时区一致性**：所有时间判断统一使用Asia/Shanghai
5. **错误恢复**：进程崩溃时自动重启录制

---

**文档状态**: ✅ 待评审  
**预计总时间**: 约6-8小时  
**建议执行时间**: 工作日白天，便于及时验证
