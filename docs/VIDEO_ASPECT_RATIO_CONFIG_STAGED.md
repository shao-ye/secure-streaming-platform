# 🔧 视频比例配置功能 - 阶段化执行文档

**版本**: v1.0 | **创建时间**: 2025-11-05 23:30

---

## 📊 执行进度追踪

| 阶段 | 名称 | 状态 | 完成时间 | 验证结果 |
|------|------|------|----------|---------|
| **准备** | 文件备份 | ⏳ 未开始 | - | - |
| **阶段1** | 前端UI配置界面 | ⏳ 未开始 | - | - |
| **阶段2** | Workers API处理 | ⏳ 未开始 | - | - |
| **阶段3** | VPS转码逻辑 | ⏳ 未开始 | - | - |
| **阶段4** | 集成测试验证 | ⏳ 未开始 | - | - |

---

## 📋 修改原因

**核心需求**：当前所有频道统一16:9转码，需要支持按频道独立配置视频比例

**配置位置**：频道列表 → 点击频道右侧"设置"按钮 → 频道配置对话框

**KV存储结构**（在现有频道对象中增加一个字段）：
```javascript
// channel:{channelId}
{
  "id": "stream_xxx",
  "name": "频道名称",
  "rtmpUrl": "rtmp://...",
  "preloadConfig": { ... },
  "recordConfig": { ... },
  "videoAspectRatio": "original"  // 🆕 新增字段: "original" | "4:3" | "16:9"
}
```

**FFmpeg映射**：
- `original` → 无滤镜
- `4:3` → `-vf scale=ih*4/3:ih`
- `16:9` → `-vf scale=ih*16/9:ih`

---

## 🎯 准备：备份文件

```bash
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = "backups\video_aspect_$timestamp"
New-Item -ItemType Directory -Path $backupDir

Copy-Item frontend\src\components\admin\ChannelConfigDialog.vue "$backupDir\"
Copy-Item cloudflare-worker\src\handlers\channelConfigHandler.js "$backupDir\"
Copy-Item vps-server\src\services\SimpleStreamManager.js "$backupDir\"
Copy-Item vps-server\src\routes\simple-stream.js "$backupDir\"
```

---

## 🎯 阶段1：前端UI

**文件**: `frontend/src/components/admin/ChannelConfigDialog.vue`

**修改1**：在"录制配置"分隔符前增加UI（找到 `<el-divider>录制配置</el-divider>` 这一行，在它之前插入）

```vue
<!-- ========== 视频格式配置 ========== -->
<el-divider content-position="left">
  <span style="font-weight: bold;">视频格式</span>
</el-divider>

<el-form-item label="视频比例">
  <el-radio-group v-model="form.videoAspectRatio">
    <el-radio label="original">原始比例</el-radio>
    <el-radio label="4:3">4:3 标准</el-radio>
    <el-radio label="16:9">16:9 宽屏</el-radio>
  </el-radio-group>
  <div style="margin-top: 8px; font-size: 12px; color: #909399;">
    原始比例：保持源视频比例 | 4:3/16:9：拉伸到指定比例（观看和录制均生效）
  </div>
</el-form-item>
```

**修改2**：form数据增加字段
```javascript
const form = reactive({
  videoAspectRatio: 'original'  // 🆕
})
```

**修改3**：loadConfig增加
```javascript
form.videoAspectRatio = data.videoAspectRatio || 'original'
```

**修改4**：configData提交
```javascript
const configData = {
  videoAspectRatio: form.videoAspectRatio
}
```

**部署**：
```bash
git add frontend/src/components/admin/ChannelConfigDialog.vue
git commit -m "feat(frontend): 增加视频比例配置UI"
git push
```

**验证**：打开频道配置→检查UI显示→切换选项无错误

---

## 🎯 阶段2：Workers API

**文件**: `cloudflare-worker/src/handlers/channelConfigHandler.js`

**修改1**：`getChannelConfig()` 函数 - 读取配置时返回视频比例

在返回的 data 对象中增加：
```javascript
return {
  status: 'success',
  data: {
    channelId: channelData.id,
    channelName: channelData.name,
    preloadConfig: channelData.preloadConfig || { ... },
    recordConfig: channelData.recordConfig || { ... },
    videoAspectRatio: channelData.videoAspectRatio || 'original'  // 🆕 返回视频比例配置
  }
};
```

**修改2**：`updateChannelConfig()` 函数 - 保存配置时处理视频比例

在 `if (data.recordConfig)` 代码块**之后**增加：
```javascript
// 🆕 更新视频比例配置
if (data.videoAspectRatio) {
  const validRatios = ['original', '4:3', '16:9'];
  if (!validRatios.includes(data.videoAspectRatio)) {
    throw new Error(`Invalid videoAspectRatio: ${data.videoAspectRatio}`);
  }
  
  channelData.videoAspectRatio = data.videoAspectRatio;
  console.log('✅ [updateChannelConfig] VideoAspectRatio updated:', data.videoAspectRatio);
}
```

**修改3**：返回结果中也包含视频比例

在 response 的 data 中增加：
```javascript
return {
  status: 'success',
  message: 'Channel config updated successfully',
  data: {
    preloadConfig: channelData.preloadConfig,
    recordConfig: channelData.recordConfig,
    videoAspectRatio: channelData.videoAspectRatio  // 🆕 返回保存的值
  }
};
```

**部署**：
```bash
cd cloudflare-worker
npx wrangler deploy --env production
git add . && git commit -m "feat(workers): 支持视频比例存储" && git push
```

**验证**：保存配置→重新打开→值正确保留

---

## 🎯 阶段3：VPS转码逻辑

### 文件1: `vps-server/src/services/SimpleStreamManager.js`

**修改1**：增加滤镜生成方法（建议放在 `spawnFFmpegProcess` 方法之前）

```javascript
/**
 * 根据频道配置生成视频滤镜
 * @param {Object} channelConfig - 频道配置（含videoAspectRatio）
 * @returns {string|null} FFmpeg滤镜参数
 */
getVideoFilter(channelConfig) {
  const aspectRatio = channelConfig?.videoAspectRatio || 'original';
  
  switch (aspectRatio) {
    case '4:3':
      return 'scale=ih*4/3:ih';
    case '16:9':
      return 'scale=ih*16/9:ih';
    case 'original':
    default:
      return null;  // 不使用滤镜
  }
}
```

**修改2**：修改 `spawnFFmpegProcess()` 方法 - 观看转码

**删除**硬编码的滤镜行：
```javascript
// ❌ 删除这行
'-vf', 'scale=ih*16/9:ih',
```

**替换为**动态滤镜（在 `-an` 之后）：
```javascript
'-an',

// 🆕 根据配置动态添加滤镜
...(this.videoFilter ? ['-vf', this.videoFilter] : []),

'-f', 'hls',
```

**修改3**：修改 `spawnFFmpegWithRecording()` 方法 - 录制转码

**删除**硬编码的 filter_complex：
```javascript
// ❌ 删除这行
'-filter_complex', '[0:v]scale=ih*16/9:ih,split=2[vout1][vout2]',
```

**替换为**动态逻辑：
```javascript
const ffmpegArgs = ['-i', rtmpUrl];

if (this.videoFilter) {
  // 有滤镜：使用filter_complex
  ffmpegArgs.push(
    '-filter_complex', `[0:v]${this.videoFilter},split=2[vout1][vout2]`,
    '-map', '[vout1]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
    '-f', 'hls',
    // ... HLS参数
    outputFile,
    '-map', '[vout2]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-an'
  );
} else {
  // 原始比例：可以优化性能
  ffmpegArgs.push(
    '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
    '-f', 'hls',
    // ... HLS参数
    outputFile,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-an'
  );
}
```

**修改4**：修改 `startWatching()` 方法 - 启动时设置滤镜

增加参数和滤镜设置：
```javascript
async startWatching(channelId, rtmpUrl, channelConfig = null) {
  // 🆕 设置当前频道的滤镜
  this.videoFilter = this.getVideoFilter(channelConfig);
  logger.info('Video filter for channel', { 
    channelId, 
    aspectRatio: channelConfig?.videoAspectRatio || 'original',
    filter: this.videoFilter || 'none'
  });
  
  // ... 原有逻辑
}
```

### 文件2: `vps-server/src/routes/simple-stream.js`

**修改**：在 `/start` 路由中增加配置查询

```javascript
router.post('/start', async (req, res) => {
  const { channelId, rtmpUrl } = req.body;
  
  try {
    // 🆕 从Workers获取频道配置
    let channelConfig = null;
    try {
      const configUrl = `${process.env.WORKERS_API_URL}/api/channel/${channelId}/config`;
      const response = await axios.get(configUrl, { timeout: 3000 });
      if (response.data.status === 'success') {
        channelConfig = response.data.data;
        logger.info('Fetched channel config', { 
          channelId, 
          videoAspectRatio: channelConfig.videoAspectRatio 
        });
      }
    } catch (error) {
      logger.warn('Failed to fetch channel config, using defaults', { 
        channelId, 
        error: error.message 
      });
    }
    
    // 启动观看，传递配置
    const hlsUrl = await streamManager.startWatching(channelId, rtmpUrl, channelConfig);
    
    res.json({ status: 'success', hlsUrl });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});
```

**部署**：
```bash
git add vps-server && git commit -m "feat(vps): 动态视频比例" && git push
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-server/scripts && ./vps-simple-deploy.sh"
```

**验证**：
```bash
ssh root@<VPS_IP> "ps aux | grep ffmpeg"
# 原始：无-vf | 4:3：-vf scale=ih*4/3:ih | 16:9：-vf scale=ih*16/9:ih
```

---

## 🎯 阶段4：集成测试验证

### 测试矩阵

| 频道配置 | FFmpeg命令 | 预期效果 |
|---------|-----------|---------|
| 原始比例 | 无`-vf`参数 | 保持源视频原始比例 |
| 4:3 标准 | `-vf scale=ih*4/3:ih` | 拉伸到4:3比例 |
| 16:9 宽屏 | `-vf scale=ih*16/9:ih` | 拉伸到16:9比例 |

### 完整测试流程

**1. 配置保存测试**
- 打开频道A的配置对话框
- 选择"原始比例"，保存
- 重新打开，验证选项正确
- 修改为"16:9"，保存
- 重新打开，验证选项正确

**2. 转码应用测试**
- 频道A配置为"原始比例"，启动观看
- SSH验证：`ps aux | grep ffmpeg | grep channelA` 无 `-vf` 参数
- 停止观看
- 频道A配置为"16:9"，重新启动观看
- SSH验证：包含 `-vf scale=ih*16/9:ih`

**3. 多频道独立配置测试**
- 频道A配置为"原始比例"
- 频道B配置为"16:9"
- 同时启动两个频道观看
- 验证：频道A无滤镜，频道B有16:9滤镜

**4. 录制文件测试**
- 频道A配置为"4:3"，启用录制
- 录制完成后：`ffprobe xxx.mp4`
- 验证：分辨率符合4:3比例

**5. 默认值测试**
- 新建频道（从未配置过）
- 打开配置对话框
- 验证：默认选中"原始比例"
- 启动观看，验证无滤镜

**6. 配置失败降级测试**
- 临时修改VPS配置，让API请求失败
- 启动观看
- 验证：仍能正常启动，使用"original"默认值

### 验收清单

**功能验证**：
- [ ] 配置对话框显示3个视频比例选项
- [ ] 配置能正确保存到KV
- [ ] 配置能正确从KV读取
- [ ] 3种比例都能正确应用到FFmpeg
- [ ] 观看和录制都应用相同配置
- [ ] 不同频道可以独立配置
- [ ] 旧频道/新频道默认"原始比例"
- [ ] API失败时有降级（使用original）

**性能验证**：
- [ ] 配置查询延迟<500ms
- [ ] 原始比例性能最优（无滤镜）
- [ ] 4:3/16:9 CPU增加<5%

**用户体验**：
- [ ] UI操作流畅
- [ ] 提示信息清晰
- [ ] 配置修改后重启观看生效
- [ ] 无错误弹窗

---

## 🔄 回滚方案

### 完整回滚命令

```bash
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform

# 找到最新的备份目录
$backupDir = (Get-ChildItem backups -Directory | Where-Object {$_.Name -like "video_aspect_*"} | Sort-Object -Descending | Select-Object -First 1).FullName

# 回滚前端
Copy-Item "$backupDir\ChannelConfigDialog.vue" frontend\src\components\admin\ChannelConfigDialog.vue

# 回滚Workers
Copy-Item "$backupDir\channelConfigHandler.js" cloudflare-worker\src\handlers\channelConfigHandler.js

# 回滚VPS
Copy-Item "$backupDir\SimpleStreamManager.js" vps-server\src\services\SimpleStreamManager.js
Copy-Item "$backupDir\simple-stream.js" vps-server\src\routes\simple-stream.js

# 部署回滚
cd cloudflare-worker
npx wrangler deploy --env production

cd ..
git add .
git commit -m "revert: 回滚视频比例配置功能"
git push origin master

# VPS部署
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-server/scripts && ./vps-simple-deploy.sh"

Write-Host "✅ 回滚完成"
```

### 部分回滚（按阶段）

**只回滚前端**（阶段1）：
```bash
git revert <commit-hash-of-stage1>
git push origin master
```

**只回滚Workers**（阶段2）：
```bash
cd cloudflare-worker
git revert <commit-hash-of-stage2>
npx wrangler deploy --env production
```

**只回滚VPS**（阶段3）：
```bash
git revert <commit-hash-of-stage3>
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-server/scripts && ./vps-simple-deploy.sh"
```

---

## 📝 修改总结

### 修改的文件：4个

1. `frontend/src/components/admin/ChannelConfigDialog.vue` - UI配置界面（增加视频比例选项）
2. `cloudflare-worker/src/handlers/channelConfigHandler.js` - KV存储逻辑（读写videoAspectRatio）
3. `vps-server/src/services/SimpleStreamManager.js` - FFmpeg滤镜动态生成
4. `vps-server/src/routes/simple-stream.js` - 配置查询传递

### 关键改进

1. ✅ **按频道配置**：每个频道可以独立设置视频比例
2. ✅ **极简存储**：只在channel对象中增加一个videoAspectRatio字段
3. ✅ **默认值**：原始比例（original），向后兼容
4. ✅ **降级策略**：配置获取失败自动使用original
5. ✅ **性能优化**：原始比例不使用滤镜，性能最优

### 技术优势

- **灵活性**：不同频道可以使用不同的视频比例
- **兼容性**：旧频道自动使用原始比例，不影响现有功能
- **安全性**：配置验证，只接受合法值
- **可维护性**：代码逻辑清晰，易于调试

### 完成后效果

- 管理员在频道配置对话框中设置视频比例
- 配置存储在KV的频道对象中
- VPS根据频道配置动态应用FFmpeg滤镜
- 观看和录制都使用相同的比例配置
- 修改配置后，重启观看即生效
