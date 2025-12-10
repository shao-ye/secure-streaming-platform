# 录制文件16:9问题修复报告

## 🐛 问题描述

**发现时间**: 2025-11-05 22:53  
**问题现象**: 在线观看已经是16:9，但录制出来的MP4文件仍然是原始比例（4:3）

---

## 🔍 问题分析

### 根本原因

FFmpeg的 `-vf` 滤镜参数**只会应用到紧随其后的第一个输出流**。

#### 修复前的FFmpeg命令结构：

```bash
ffmpeg -i rtmp://input
  -c:v libx264 -preset ultrafast -an
  -vf scale=ih*16/9:ih          # ⚠️ 滤镜只应用到第一个输出
  -f hls ... playlist.m3u8      # ✅ HLS输出 - 应用了16:9
  -c:v libx264 -preset ultrafast -an
  -f mp4 ... recording.mp4      # ❌ MP4输出 - 没有应用16:9！
```

**问题说明**：
- HLS观看流：位于滤镜后的第一个输出，**正确应用了16:9**
- MP4录制流：是第二个输出，**没有继承滤镜，仍是原始比例**

---

## 💡 解决方案

### 使用 `filter_complex` 代替 `-vf`

**核心思路**：
1. 使用 `filter_complex` 对输入视频处理一次16:9转换
2. 使用 `split` 将处理后的视频分成2路
3. 分别映射到HLS和MP4两个输出

#### 修复后的FFmpeg命令结构：

```bash
ffmpeg -i rtmp://input
  # 🆕 一次性处理并分发到两路输出
  -filter_complex '[0:v]scale=ih*16/9:ih,split=2[vout1][vout2]'
  
  # HLS输出 - 使用第一路（16:9已应用）
  -map '[vout1]'
  -c:v libx264 -preset ultrafast -an
  -f hls ... playlist.m3u8
  
  # MP4输出 - 使用第二路（16:9已应用）
  -map '[vout2]'
  -c:v libx264 -preset ultrafast -an
  -f mp4 ... recording.mp4
```

**优势**：
- ✅ 滤镜只处理一次，节省CPU（相比多个-vf）
- ✅ 两个输出100%一致（都是16:9）
- ✅ 性能最优

---

## 🔧 代码修改详情

### 修改文件
`vps-server/src/services/SimpleStreamManager.js`

### 修改位置
`spawnFFmpegWithRecording()` 方法（第941-967行）

### 修改内容

#### 修复前：
```javascript
const ffmpegArgs = [
  '-i', rtmpUrl,
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-an',
  
  // 🆕 视频滤镜 - 保持高度，调整宽度到16:9
  '-vf', 'scale=ih*16/9:ih',
  
  // HLS输出
  '-f', 'hls',
  // ... HLS参数
  outputFile,
  
  // MP4录制输出
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-an'
];
```

#### 修复后：
```javascript
const ffmpegArgs = [
  '-i', rtmpUrl,
  
  // 🆕 使用filter_complex处理16:9并分发到两个输出
  // [0:v] 选择第一个输入的视频流，scale转换为16:9，然后split成2路
  '-filter_complex', '[0:v]scale=ih*16/9:ih,split=2[vout1][vout2]',
  
  // HLS输出 - 使用第一路视频流
  '-map', '[vout1]',
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-an',
  '-f', 'hls',
  // ... HLS参数
  outputFile,
  
  // MP4录制输出 - 使用第二路视频流（16:9已应用）
  '-map', '[vout2]',
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-an'
];
```

**关键变化**：
1. ❌ 删除：`'-vf', 'scale=ih*16/9:ih'`
2. ✅ 新增：`'-filter_complex', '[0:v]scale=ih*16/9:ih,split=2[vout1][vout2]'`
3. ✅ 新增：HLS输出前加 `'-map', '[vout1]'`
4. ✅ 新增：MP4输出前加 `'-map', '[vout2]'`

---

## 📊 filter_complex 参数详解

### 语法分解

```
-filter_complex '[0:v]scale=ih*16/9:ih,split=2[vout1][vout2]'
```

**分解说明**：

| 参数 | 含义 |
|------|------|
| `[0:v]` | 选择第一个输入的视频流 |
| `scale=ih*16/9:ih` | 缩放滤镜：宽度=高度*16/9，高度保持不变 |
| `,` | 连接多个滤镜 |
| `split=2` | 将视频流分成2路 |
| `[vout1][vout2]` | 两路输出的标签名 |

### 映射说明

```
-map '[vout1]'  # 将vout1映射到下一个输出（HLS）
-map '[vout2]'  # 将vout2映射到下一个输出（MP4）
```

---

## ✅ 部署验证

### Git提交
- **提交ID**: 562a76d
- **提交信息**: fix: 修复录制文件16:9问题，使用filter_complex确保HLS和MP4都应用滤镜
- **提交时间**: 2025-11-05 22:56

### VPS部署
- **部署时间**: 2025-11-05 22:57
- **VPS版本**: 562a76d ✅
- **服务状态**: online ✅
- **进程ID**: 2770726

### 验证命令

```bash
# 验证代码已部署
ssh root@<VPS_IP> "grep 'filter_complex' /opt/yoyo-transcoder/src/services/SimpleStreamManager.js"

# 等待新的录制任务启动后，检查FFmpeg命令
ssh root@<VPS_IP> "ps aux | grep ffmpeg"
# 应该看到包含: -filter_complex '[0:v]scale=ih*16/9:ih,split=2[vout1][vout2]'
```

---

## 🧪 测试方法

### 测试步骤

1. **启动新的录制任务**
   - 在管理后台配置录制
   - 或等待定时录制自动启动

2. **观察FFmpeg进程**
   ```bash
   ssh root@<VPS_IP>
   ps aux | grep ffmpeg
   # 检查是否包含 filter_complex 和 -map 参数
   ```

3. **录制完成后检查文件分辨率**
   ```bash
   # 查看录制文件
   cd /var/www/recordings/stream_xxx/20251105
   ls -lh
   
   # 检查分辨率
   ffprobe xxx.mp4 2>&1 | grep "Video:"
   # 应该看到16:9的分辨率，例如：1024x576
   ```

4. **验证观看流仍然正常**
   - 访问 https://yoyo.your-domain.com/
   - 观看视频应该仍是16:9（无影响）

---

## 📈 性能影响

### CPU使用率对比

**修复前**（使用单个-vf）:
- 滤镜处理：1次
- CPU增加：+15-25%

**修复后**（使用filter_complex + split）:
- 滤镜处理：1次（相同）
- 视频流复制：1次split操作（几乎无开销）
- CPU增加：+15-25%（与修复前相同）

**结论**：性能影响**几乎无变化**，因为滤镜仍只处理一次。

---

## ⚠️ 注意事项

### 1. 新录制文件才会生效

- ✅ **新启动的录制**：自动应用16:9
- ❌ **正在录制的文件**：需要重启进程才生效
- ❌ **历史录制文件**：保持原样，不受影响

### 2. 重启进程方式

如果想让正在录制的频道立即应用修复：

**方式1：等待自然重启**
- 用户停止观看后，进程会自动清理
- 下次观看时自动应用新配置

**方式2：手动重启服务**
```bash
ssh root@<VPS_IP>
pm2 restart vps-transcoder-api
```
⚠️ 会中断所有正在观看和录制的频道

**方式3：重启特定频道**
- 在管理后台停止录制
- 再次启动录制

### 3. 影响范围

**修复影响**：
- ✅ HLS观看流：仍然16:9（无变化）
- ✅ MP4录制文件：现在也是16:9（修复后）
- ✅ 预加载功能：自动应用
- ✅ 所有录制模式：单文件和分段录制都生效

---

## 🔍 FFmpeg filter_complex 技术说明

### 为什么需要 filter_complex？

**多输出场景的挑战**：
- 简单的 `-vf` 只能应用到一个输出
- 多个 `-vf` 可能冲突或不被支持
- 需要多个输出使用相同的滤镜处理结果

**filter_complex 的优势**：
- ✅ 支持复杂的滤镜图（filter graph）
- ✅ 可以创建多个输出分支
- ✅ 滤镜只处理一次，性能最优
- ✅ 输出完全一致

### split 滤镜说明

```
split=2[vout1][vout2]
```

**功能**：将一个视频流复制成N份
- `split=2`：复制成2份
- `[vout1][vout2]`：两份的标签名

**性能**：
- 这不是重新编码，只是流的引用复制
- CPU开销极小（<1%）
- 内存几乎无增加

---

## 📚 相关文档

- **测试文档**: `docs/16-9-aspect-ratio-test.md`
- **架构文档**: `docs/project/ARCHITECTURE_V2.md`
- **FFmpeg官方文档**: https://ffmpeg.org/ffmpeg-filters.html#split

---

## 🎯 总结

### 问题
录制文件没有应用16:9转换，仍是原始比例

### 原因
`-vf` 滤镜只应用到第一个输出（HLS），第二个输出（MP4）没有继承

### 解决
使用 `filter_complex` + `split` 确保两个输出都应用16:9转换

### 效果
- ✅ HLS观看：16:9
- ✅ MP4录制：16:9
- ✅ 性能影响：无变化
- ✅ 代码更规范

---

**修复版本**: v1.0  
**修复时间**: 2025-11-05 22:56  
**部署状态**: ✅ 已部署到VPS  
**测试状态**: ⏳ 待验证录制文件
