# 🔧 频道录制分段功能 - 阶段化执行文档

**历史版本**: v1.0 | **原始日期**: 2025-10-29
**现行规则核对**: 2026-10-19 | **代码基线**: `66e5339`

本文保留最初的阶段计划、进度表和发布操作记录；这些历史记录不代表本次已执行构建、部署或验收。分段配置、方法和命名说明已按上述本地代码更新，完整规则以 [录制分段与命名规范](RECORDING_SEGMENTATION_DESIGN.md) 为准。本次只核对静态代码，未验证线上配置或录制文件。

### 现行实现摘要

- 分段配置为全局配置，默认 `segmentEnabled=false`、`segmentDuration=60` 分钟，允许范围 **3–240 分钟**；KV 键为 `system:cleanup:config`。
- 保存系统设置后，下次启动录制才读取新分段配置，已有 FFmpeg 录制进程不即时切换，无需为此重启整个服务。
- 分段临时名为 `{频道名}_{频道ID}_{YYYYMMDD}_{本次路径生成HHMMSS}_temp_%03d.mp4`，编号从 `000` 开始；正式名为 `{频道名}_{频道ID}_{YYYYMMDD}_{段开始HHMMSS}_to_{段结束HHMMSS}.mp4`。
- 分段切换后约 2 秒处理上一段；停止录制或录制进程退出时处理剩余临时文件。正常路径通常先重封装，再派发上传事件；转换失败时存在直接改名降级。
- 单文件录制从开始就使用正式格式，末尾最初是计划结束时间，因此仅凭正式文件名不能认定已完成。

对应代码：[系统设置](../../frontend/src/components/admin/SystemSettingsDialog.vue)、[Worker 配置 API](../../cloudflare-worker/src/index.js)、[录制调度器](../../vps-server/src/services/RecordScheduler.js)、[录制管理器](../../vps-server/src/services/SimpleStreamManager.js)。

---

## 📖 历史执行纪律（2025-10-29）

⚠️ **必须严格遵守**：
1. ✅ 绝对禁止跳步 - 必须按顺序完成每个阶段
2. ✅ 验证是强制性的 - 每个阶段必须验证通过
3. ✅ 验证失败必须回滚 - 不能带着问题继续
4. ✅ 每步更新进度表 - 实时标记状态

### 核心概念

1. **分段是可选的** - 通过系统设置中的开关控制
2. **文件命名延续现有** - `{名称}_{ID}_{日期}_{开始}_to_{结束}.mp4`
3. **分段文件最终化** - 录制时用临时名，切换或收尾时重封装并改为正式名；单文件模式不使用临时名
4. **不影响观看** - HLS和MP4并行输出，互不干扰

---

## 📊 历史进度追踪（保留原记录，非当前状态）

| 阶段 | 名称 | 状态 | 完成时间 |
|------|------|------|----------|
| 准备 | 文件备份 | ⏳ 未开始 | - |
| 阶段1 | 前端UI | ⏳ 未开始 | - |
| 阶段2 | Workers API | ⏳ 未开始 | - |
| 阶段3 | VPS录制逻辑 | ⏳ 未开始 | - |
| 阶段4 | 集成测试 | ⏳ 未开始 | - |

---

## 🎯 历史准备方案：备份文件

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
  <el-input-number v-model="form.segmentDuration" :min="3" :max="240" style="width: 150px" />
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

**当前 GET / PUT 行为**：

- GET 从 `system:cleanup:config` 读取配置，并与 `getDefaultSystemConfig()` 合并；分段默认值为 `false / 60`。默认配置定义位于 `cloudflare-worker/src/handlers/cloudDriveHandler.js`。
- PUT 校验 `segmentEnabled` 为布尔值；`Number(segmentDuration)` 必须在 3–240 之间，单位为分钟。当前代码没有额外要求整数。
- 保存完整系统设置时分段字段取 `body.segmentEnabled ?? false`、`body.segmentDuration ?? 60`，写回同一 KV 键。该接口还维护清理、恢复和云盘设置，不能用只有分段字段的示例替代完整保存逻辑。
- 此 PUT 不向 VPS 下发进程重启通知；新的分段规则由下次 `RecordScheduler.startRecording()` 读取。

### 历史部署与验证方案（未在本次执行）

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

### 3.1 当前 RecordScheduler 配置传递

`fetchSystemSettings()` 使用 `fetch` 请求 `/api/admin/cleanup/config`，携带 `X-API-Key`，正常读取或请求失败时的默认分段配置均为 `false / 60`。启动录制时合并全局配置：

```javascript
async startRecording(config) {
  const systemSettings = await this.fetchSystemSettings();
  const fullConfig = {
    ...config,
    segmentEnabled: systemSettings.segmentEnabled,
    segmentDuration: systemSettings.segmentDuration
  };
  await this.streamManager.enableRecording(config.channelId, fullConfig);
}
```

这是省略日志和异常处理的流程摘录。当前方法签名为 `enableRecording(channelId, recordConfig)`；`sessionStartTime` 由 `SimpleStreamManager.enableRecording()` 保存。已经在录制的频道在常规调度重载时保持原进程。

### 3.2 当前 SimpleStreamManager 分段与命名流程

| 方法 / 事件 | 当前行为 |
|---|---|
| `generateRecordingPath(channelId, channelName, recordConfig)` | 使用北京时间，路径为 `{storagePath}/{channelId}/{YYYYMMDD}/`；分段输出 `{频道名}_{频道ID}_{YYYYMMDD}_{本次路径生成HHMMSS}_temp_%03d.mp4` |
| `spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath, recordConfig, videoFilter = null)` | `-f segment`、`-segment_time 分钟数×60`、`-reset_timestamps 1`，并以 fragmented MP4 写入；单文件模式直接写正式格式文件 |
| FFmpeg stderr 的 `Opening '..._temp_N.mp4' for writing` | 当 `N > 0`，等待 2 秒后调用 `renameCompletedSegment(channelId, N - 1, recordConfig)`，处理上一段 |
| `renameCompletedSegment(channelId, segmentIndex, recordConfig)` | 开始时间 = 会话开始时间 + 编号 × 配置时长，结束时间 = 开始时间 + 配置时长；不是用 ffprobe 或 mtime 逐段测量 |
| `renameFinalSegment(channelId, recordConfig)` | 等待 2 秒，扫描处理时的北京时间日期目录内全部剩余 `_temp_*.mp4`。新名从临时文件提取会话开始时刻，旧名回退到配置；开始时间仍按编号推算，每个剩余文件都使用本次收尾处理时刻作为结束时间 |
| `disableRecording()` / FFmpeg `exit` | 停止入口先尝试收尾再停止或重启进程；`exit` 回调也经 `handleUnexpectedRecordingExit()` 尝试分段或单文件收尾，不只在非零退出码时触发 |
| `renameRecordingWithActualEndTime(oldPath)` | 单文件直接改名，把计划结束时刻替换为等待 2 秒后的处理时刻；不调用分段重封装方法 |

当前没有 `renameSegmentFiles()` 或 `buildFFmpegCommand()` 这两个旧示例中的录制方法。

**分段输出关键参数**（省略输入、HLS、编码和日志参数）：

```javascript
const segmentSeconds = (recordConfig.segmentDuration || 60) * 60;
ffmpegArgs.push(
  '-f', 'segment',
  '-segment_time', segmentSeconds.toString(),
  '-segment_format', 'mp4',
  '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof',
  '-reset_timestamps', '1',
  '-y',
  recordingPath
);
```

**重封装与异常恢复**：

- `convertSegmentToStandardMp4(inputPath, outputPath)` 使用 `-c copy -movflags faststart` 重封装，成功后删除原临时文件；转换失败、进程错误或 60 秒超时时存在直接改名降级。因此“有正式名”不保证完成了标准 MP4 转换或完整可播放。
- `RecordingRecoveryService.startup()` 走 `runRecoveryWithSizeCheck()`：只扫描 temp 文件，间隔 30 秒比较大小，处理未增长文件。`renameTempFile()` 用 **mtime 作为结束时间，减去探测的视频时长得到开始时间**，与正常分段的配置时长推算不同；恢复时使用环境本地时间格式化，不能据此默认其时区也是北京时间。
- `fixEndTime()` 属于手动 `runRecovery()` 路径，不是服务启动时默认执行的自动修复。
- 上传成功后通常加 `_u.mp4`；同名冲突时为 `_u_<毫秒时间戳>.mp4`。详见 [自动上传实施文档](../录制文件自动上传开发实施文档.md)。

**实现边界**：临时路径生成与 `sessionStartTime` 是两次取时；常规改名按处理时的日期查找目录。因此跨秒、跨日及异常剩余文件不能仅凭理想化时间示例认定准确，详见主规范的边界说明。

### 3.3 历史 VPS 发布方案（保留原命令，未在本次执行）

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

## 🚀 阶段4：待执行的集成验证方案（本次未执行）

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

- [ ] 录制开始时生成带会话时间的 `_temp_000.mp4`
- [ ] 配置为 10 分钟时，达到分段条件后切换到 `_temp_001.mp4`（实际切点受关键帧影响）
- [ ] 上一段停止增长，切换约 2 秒后尝试重封装并改名
- [ ] 用户观看无卡顿
- [ ] 正常切换处理上一段，停止 / 进程退出处理剩余 temp 文件
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

## ✅ 历史完成检查与发布说明

以下保留原版本的标签命令及当时范围（10–240 分钟），不是本次验证结果或当前规则；当前范围为 3–240 分钟。本次未创建标签或执行发布：

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

## 🔙 历史回滚方案（保留原记录）

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
