# 🔧 频道录制分段功能 - 阶段化执行文档

**版本**: v1.0 | **日期**: 2025-10-29 | **基于**: RECORDING_SEGMENTATION_DESIGN.md

---

## 📖 执行纪律

⚠️ **必须严格遵守**：
1. ✅ 绝对禁止跳步 - 必须按顺序完成每个阶段
2. ✅ 验证是强制性的 - 每个阶段必须验证通过
3. ✅ 验证失败必须回滚 - 不能带着问题继续
4. ✅ 每步更新进度表 - 实时标记状态

### 核心概念

1. **分段是可选的** - 通过系统设置中的开关控制
2. **文件命名延续现有** - `{名称}_{ID}_{日期}_{开始}_to_{结束}.mp4`
3. **两步法实现** - 录制时用临时名，结束后重命名为正式名
4. **不影响观看** - HLS和MP4并行输出，互不干扰

---

## 📊 进度追踪

| 阶段 | 名称 | 状态 | 完成时间 |
|------|------|------|----------|
| 准备 | 文件备份 | ⏳ 未开始 | - |
| 阶段1 | 前端UI | ⏳ 未开始 | - |
| 阶段2 | Workers API | ⏳ 未开始 | - |
| 阶段3 | VPS录制逻辑 | ⏳ 未开始 | - |
| 阶段4 | 集成测试 | ⏳ 未开始 | - |

---

## 🎯 准备：备份文件

```powershell
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
New-Item -Path "backups\segment_$ts" -ItemType Directory -Force

# 备份关键文件
Copy-Item "vps-transcoder-api\frontend\src\components\admin\SystemSettingsDialog.vue" "backups\segment_$ts\"
Copy-Item "cloudflare-worker\src\index.js" "backups\segment_$ts\"
Copy-Item "vps-transcoder-api\vps-transcoder-api\src\services\SimpleStreamManager.js" "backups\segment_$ts\"
Copy-Item "vps-transcoder-api\vps-transcoder-api\src\services\RecordScheduler.js" "backups\segment_$ts\"
```

---

## 🚀 阶段1：前端UI（1小时）

### 修改SystemSettingsDialog.vue

在视频清理配置后添加：

```vue
<el-divider content-position="left">录制分段配置</el-divider>

<el-form-item label="启用录制分段">
  <el-switch v-model="form.segmentEnabled" />
</el-form-item>

<el-form-item label="分段时长" v-if="form.segmentEnabled">
  <el-input-number v-model="form.segmentDuration" :min="10" :max="240" style="width: 150px" />
  <span style="margin-left: 10px;">分钟</span>
  <div style="margin-top: 10px;">
    <el-button size="small" @click="form.segmentDuration = 30">30分钟</el-button>
    <el-button size="small" @click="form.segmentDuration = 60">1小时</el-button>
    <el-button size="small" @click="form.segmentDuration = 120">2小时</el-button>
  </div>
</el-form-item>
```

扩展form对象：

```javascript
const form = reactive({
  enabled: true,
  retentionDays: 2,
  segmentEnabled: false,  // 🆕
  segmentDuration: 60     // 🆕
})
```

### 验证

- [ ] 设置对话框能打开
- [ ] 分段开关正常工作
- [ ] 开关打开时显示时长输入
- [ ] 预设按钮正常工作

---

## 🚀 阶段2：Workers API（1小时）

### 修改 cloudflare-worker/src/index.js

**GET处理**：

```javascript
// GET /api/admin/cleanup/config
const config = await env.YOYO_USER_DB.get('system:cleanup_config', { type: 'json' });
const configWithDefaults = {
  enabled: config?.enabled ?? true,
  retentionDays: config?.retentionDays ?? 2,
  segmentEnabled: config?.segmentEnabled ?? false,  // 🆕
  segmentDuration: config?.segmentDuration ?? 60    // 🆕
};
```

**PUT处理**：

```javascript
// 验证segmentDuration范围
if (body.segmentDuration !== undefined) {
  const duration = Number(body.segmentDuration);
  if (isNaN(duration) || duration < 10 || duration > 240) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'segmentDuration must be between 10 and 240'
    }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
  }
}

// 保存配置（包含新字段）
const config = {
  enabled: body.enabled,
  retentionDays: body.retentionDays,
  segmentEnabled: body.segmentEnabled ?? false,
  segmentDuration: body.segmentDuration ?? 60,
  updatedAt: new Date().toISOString()
};
```

### 部署和验证

```powershell
cd cloudflare-worker
wrangler deploy --env production

# 测试GET
$headers = @{'Authorization' = 'Bearer TOKEN'}
Invoke-RestMethod -Uri 'https://yoyoapi.your-domain.com/api/admin/cleanup/config' -Headers $headers

# 测试PUT
$body = @{enabled=$true; retentionDays=2; segmentEnabled=$true; segmentDuration=60} | ConvertTo-Json
Invoke-RestMethod -Uri 'https://yoyoapi.your-domain.com/api/admin/cleanup/config' -Method Put -Headers $headers -Body $body -ContentType 'application/json'
```

---

## 🚀 阶段3：VPS录制逻辑（2-3小时）

### 3.1 修改RecordScheduler.js

**获取系统配置**：

```javascript
async fetchSystemSettings() {
  const response = await axios.get(`${this.workersApiUrl}/api/admin/cleanup/config`, {
    headers: {'X-API-Key': this.apiKey}
  });
  const settings = response.data.data;
  return {
    segmentEnabled: settings.segmentEnabled || false,
    segmentDuration: settings.segmentDuration || 60
  };
}
```

**传递给SimpleStreamManager**：

```javascript
async startRecording(config) {
  const systemSettings = await this.fetchSystemSettings();
  await this.streamManager.enableRecording(
    config.channelId,
    config.channelName,
    config.rtmpUrl,
    {...config, ...systemSettings}
  );
}
```

### 3.2 修改SimpleStreamManager.js

**添加重命名方法**：

```javascript
async renameSegmentFiles(channelId, channelName, recordConfig, sessionStartTime) {
  const dateStr = moment().format('YYYYMMDD');
  const outputDir = path.join(recordConfig.storagePath, channelId, dateStr);
  const tempFiles = fs.readdirSync(outputDir).filter(f => f.includes('_temp_')).sort();
  
  for (let i = 0; i < tempFiles.length; i++) {
    const tempPath = path.join(outputDir, tempFiles[i]);
    const startTime = sessionStartTime.clone().add(i * recordConfig.segmentDuration, 'minutes');
    const endTime = (i === tempFiles.length - 1) ? moment() : startTime.clone().add(recordConfig.segmentDuration, 'minutes');
    
    const finalFilename = `${channelName}_${channelId}_${dateStr}_${startTime.format('HHmmss')}_to_${endTime.format('HHmmss')}.mp4`;
    const finalPath = path.join(outputDir, finalFilename);
    
    fs.renameSync(tempPath, finalPath);
    logger.info(`Renamed: ${tempFiles[i]} → ${finalFilename}`);
  }
}
```

**修改buildFFmpegCommand（recordConfig参数）**：

```javascript
if (recordConfig.segmentEnabled) {
  // 分段录制
  const segmentSeconds = recordConfig.segmentDuration * 60;
  const tempFilename = `${channelName}_${channelId}_${dateStr}_temp_%03d.mp4`;
  const outputPath = path.join(outputDir, tempFilename);
  
  ffmpegArgs.push(
    '-c:v', 'copy', '-c:a', 'copy',
    '-f', 'segment',
    '-segment_time', segmentSeconds.toString(),
    '-segment_format', 'mp4',
    '-reset_timestamps', '1',
    outputPath
  );
} else {
  // 单文件录制（现有逻辑）
  ffmpegArgs.push('-c:v', 'copy', '-c:a', 'copy', '-f', 'mp4', outputPath);
}
```

**在disableRecording中触发重命名**：

```javascript
async disableRecording(channelId) {
  const recordInfo = this.recordingConfigs.get(channelId);
  if (recordInfo && recordInfo.segmentEnabled) {
    await this.renameSegmentFiles(
      channelId,
      recordInfo.channelName,
      recordInfo,
      recordInfo.sessionStartTime
    );
  }
  // ... 其他逻辑
}
```

### 3.3 部署到VPS

```powershell
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform
git add .
git commit -m "feat: VPS录制分段逻辑（阶段3）"
git push origin master

# SSH到VPS
ssh root@<VPS_IP>

# 拉取代码
cd /root/vps-transcoder-api
git pull origin master

# 重启服务
pm2 reload vps-transcoder-api
pm2 logs vps-transcoder-api --lines 50
```

---

## 🚀 阶段4：集成测试（1小时）

### 4.1 配置测试

```powershell
# 1. 打开前端设置对话框
# 2. 启用录制分段
# 3. 设置分段时长为10分钟（便于测试）
# 4. 保存配置

# 验证配置
$headers = @{'Authorization' = 'Bearer TOKEN'}
$config = Invoke-RestMethod -Uri 'https://yoyoapi.your-domain.com/api/admin/cleanup/config' -Headers $headers
$config | ConvertTo-Json
```

### 4.2 录制测试

```powershell
# 1. 选择一个测试频道
# 2. 编辑频道配置，启用录制
# 3. 设置录制时间（如当前时间开始，持续30分钟）
# 4. 保存配置

# 等待录制开始，观察VPS日志
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 100"

# 检查临时文件生成
ssh root@<VPS_IP> "ls -lh /srv/filebrowser/yoyo-k/stream_xxx/$(date +%Y%m%d)/"
```

### 4.3 验证清单

- [ ] 录制开始时生成temp_001.mp4
- [ ] 10分钟后切换到temp_002.mp4
- [ ] temp_001.mp4停止增长
- [ ] 用户观看无卡顿
- [ ] 录制结束后文件被重命名
- [ ] 文件名格式正确：`{名称}_{ID}_{日期}_{开始}_to_{结束}.mp4`
- [ ] 文件可以正常播放

### 4.4 关闭分段测试

```powershell
# 1. 打开设置对话框
# 2. 关闭录制分段开关
# 3. 保存配置

# 再次启动录制，验证生成单个文件
```

---

## ✅ 完成检查

全部完成后提交稳定版本：

```powershell
git tag -a v2.8.0-segment-stable -m "录制分段功能稳定版本

功能：
- 系统设置中新增录制分段配置
- 支持10-240分钟可配置分段时长
- 文件命名完全延续现有规则
- 两步法实现（临时→正式）
- 不影响用户观看

测试：
- ✅ 配置保存和读取
- ✅ 分段文件生成
- ✅ 文件重命名
- ✅ 文件可播放
- ✅ 用户观看无影响"

git push origin v2.8.0-segment-stable
```

---

## 🔙 回滚方案

如需回滚：

```powershell
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform
git checkout v2.7.0-stable

# 恢复备份文件
$backupDir = "backups\segment_TIMESTAMP"  # 替换为实际备份目录
Copy-Item "$backupDir\*" -Destination ".\" -Recurse -Force

# 重新部署
wrangler deploy --env production
# SSH到VPS重启服务
```
