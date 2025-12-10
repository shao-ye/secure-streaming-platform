# 录制文件修复功能测试文档

**版本**: v1.0  
**日期**: 2025-10-31  
**测试目标**: 验证VPS重启后录制文件能否正确修复并完整播放

---

## 📋 测试概述

### 测试场景
模拟录制过程中VPS意外重启，验证RecordingRecoveryService能否：
1. 自动识别未完成的temp文件
2. 转换Fragmented MP4为标准MP4
3. 正确计算文件时间范围并重命名
4. 确保修复后的文件可以完整播放

### 前置条件
- [ ] VPS服务正常运行
- [ ] 已配置至少一个频道的录制功能
- [ ] 录制存储路径正常（`/srv/filebrowser/yoyo-k`）
- [ ] RecordingRecoveryService已启用

---

## 🎯 测试步骤

### 阶段1：启动录制（0-60秒）

#### 步骤1.1：开启录制
```bash
# 1. 打开管理后台
# 2. 选择测试频道（如：二楼教室2）
# 3. 编辑频道配置
# 4. 启用录制功能
# 5. 设置录制时间：当前时间开始，持续10分钟
# 6. 保存配置
```

#### 步骤1.2：验证录制已启动
```bash
# 检查FFmpeg进程
ssh root@<VPS_IP> "ps aux | grep ffmpeg | grep -v grep"

# 预期输出：应该看到ffmpeg进程，包含录制参数
# - 包含频道ID
# - 包含temp文件路径
# - 包含movflags=+frag_keyframe+empty_moov+default_base_moof
```

**验证点**：
- [ ] FFmpeg进程存在
- [ ] 进程参数包含正确的频道ID
- [ ] 使用Fragmented MP4参数

#### 步骤1.3：检查temp文件生成
```bash
# 获取当前日期（北京时间）
DATE=$(TZ='Asia/Shanghai' date +%Y%m%d)

# 检查文件
ssh root@<VPS_IP> "ls -lh /srv/filebrowser/yoyo-k/stream_gkg5hknc/${DATE}/"

# 预期输出：
# 二楼教室2_stream_gkg5hknc_20251031_110915_temp_000.mp4  2.5M
#                                      ^^^^^^ (开始时间)
```

**验证点**：
- [ ] temp_000.mp4文件已生成
- [ ] 文件名包含开始时间戳（HHMMSS格式）
- [ ] 文件大小持续增长

#### 步骤1.4：等待1分钟
```bash
# 等待60秒，让视频录制足够内容
echo "⏳ 等待60秒..."
sleep 60
echo "✅ 等待完成，录制了约60秒内容"
```

#### 步骤1.5：记录temp文件信息
```bash
# 再次检查文件大小
ssh root@<VPS_IP> "ls -lh /srv/filebrowser/yoyo-k/stream_gkg5hknc/${DATE}/ | grep temp"

# 记录输出（预期约3-5MB for 60秒视频）
# 示例：二楼教室2_stream_gkg5hknc_20251031_110915_temp_000.mp4  4.2M
```

**验证点**：
- [ ] 文件大小在3-5MB范围（60秒录制）
- [ ] 文件仍在持续增长

---

### 阶段2：模拟崩溃（60秒时刻）

#### 步骤2.1：重启VPS服务
```bash
# 重启PM2服务（模拟程序崩溃）
echo "⚠️ 重启VPS服务（模拟崩溃）..."
ssh root@<VPS_IP> "pm2 restart vps-transcoder-api"

# 记录重启时间
echo "🕐 重启时间: $(date '+%Y-%m-%d %H:%M:%S')"
```

**验证点**：
- [ ] PM2服务成功重启
- [ ] 无错误日志输出

#### 步骤2.2：等待RecordingRecoveryService启动
```bash
# 等待10秒（RecoveryService延迟5秒启动 + 执行时间）
echo "⏳ 等待RecoveryService启动并执行修复..."
sleep 10
echo "✅ 等待完成"
```

---

### 阶段3：验证修复（70-100秒）

#### 步骤3.1：检查文件列表
```bash
# 检查文件夹内容
ssh root@<VPS_IP> "ls -lh /srv/filebrowser/yoyo-k/stream_gkg5hknc/${DATE}/"

# 预期输出：
# 二楼教室2_stream_gkg5hknc_20251031_110915_to_111015.mp4  4.1M  ← 修复后的文件
# 二楼教室2_stream_gkg5hknc_20251031_111025_temp_000.mp4  1.2M  ← 新录制的文件
```

**验证点**：
- [ ] 旧的temp_000.mp4已消失
- [ ] 生成了正式命名的文件（包含_to_时间）
- [ ] 新的temp_000.mp4已生成（录制恢复）

#### 步骤3.2：检查修复日志
```bash
# 查看RecoveryService日志
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 100 --nostream | grep -A 5 -B 5 'Recovery'"

# 预期日志关键词：
# 🚀 Starting recovery service...
# 📦 Found temp file: 二楼教室2_stream_gkg5hknc_20251031_110915_temp_000.mp4
# 🔄 Converting temp file to standard MP4...
# ✅ Segment converted to standard MP4
# ✅ Temp file converted and renamed
# Recovery completed
```

**验证点**：
- [ ] 显示"Starting recovery service"
- [ ] 显示"Found temp file"
- [ ] 显示"Converting temp file to standard MP4"
- [ ] 显示"Segment converted to standard MP4"
- [ ] 显示"Recovery completed"
- [ ] 无转换失败错误

#### 步骤3.3：检查转换日志（详细）
```bash
# 查看FFmpeg转换过程
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 200 --nostream | grep -E 'convertSegmentToStandardMp4|Segment converted'"

# 预期输出：
# ✅ Segment converted to standard MP4 from: xxx_temp_000.mp4 to: xxx_to_111015.mp4
```

**验证点**：
- [ ] 转换成功完成
- [ ] 无"conversion failed"错误
- [ ] 无"timeout"错误

---

### 阶段4：验证播放（70-100秒）

#### 步骤4.1：下载修复后的文件
```bash
# 获取文件名（替换为实际文件名）
FIXED_FILE="二楼教室2_stream_gkg5hknc_20251031_110915_to_111015.mp4"

# 下载到本地
scp root@<VPS_IP>:/srv/filebrowser/yoyo-k/stream_gkg5hknc/${DATE}/${FIXED_FILE} ./

echo "✅ 文件已下载到当前目录"
```

#### 步骤4.2：验证文件格式
```bash
# 使用ffprobe检查文件信息（需要本地安装FFmpeg）
ffprobe -v error -show_format -show_streams "${FIXED_FILE}"

# 关键检查点：
# - format_name: mov,mp4,m4a,3gp,3g2,mj2 (标准MP4格式)
# - duration: 约60秒
# - video codec: h264
```

**验证点**：
- [ ] 文件格式为标准MP4
- [ ] duration约60秒（不是4秒）
- [ ] codec正确（h264）

#### 步骤4.3：播放测试
```bash
# 方法1：使用VLC播放器
vlc "${FIXED_FILE}"

# 方法2：使用Windows Media Player
# 双击文件播放

# 方法3：使用FFplay
ffplay "${FIXED_FILE}"
```

**验证点（关键）**：
- [ ] **文件可以播放** ✅
- [ ] **播放时长约60秒**（不是4秒） ✅
- [ ] 画面清晰，无花屏
- [ ] 播放流畅，无卡顿
- [ ] 播放进度条可以拖动
- [ ] 可以播放到文件末尾

#### 步骤4.4：验证正在录制的文件
```bash
# 等待30秒，让新录制文件有足够内容
sleep 30

# 下载新的temp文件
NEW_TEMP=$(ssh root@<VPS_IP> "ls -t /srv/filebrowser/yoyo-k/stream_gkg5hknc/${DATE}/*temp*.mp4 | head -1")
scp root@<VPS_IP>:${NEW_TEMP} ./new_temp.mp4

# 播放测试
ffplay ./new_temp.mp4
```

**验证点**：
- [ ] 新temp文件可以播放（Fragmented MP4防崩溃保护生效）
- [ ] 内容为重启后的新录制
- [ ] 播放流畅

---

## ✅ 测试结果记录

### 测试信息
- **测试日期**：____________________
- **测试人员**：____________________
- **频道名称**：____________________
- **频道ID**：____________________

### 阶段1：启动录制
- [ ] 录制成功启动
- [ ] temp文件生成正常
- [ ] 文件大小持续增长
- [ ] 录制时长：____秒
- [ ] temp文件大小：____MB

### 阶段2：模拟崩溃
- [ ] 服务成功重启
- [ ] 无启动错误

### 阶段3：验证修复
- [ ] temp文件已转换为正式文件
- [ ] 文件命名正确（包含时间范围）
- [ ] 新temp文件已生成（录制恢复）
- [ ] 日志显示转换成功
- [ ] 修复后文件大小：____MB

### 阶段4：验证播放（⭐ 核心验证）
- [ ] ✅ 修复后的文件可以播放
- [ ] ✅ 播放时长正确（约60秒，不是4秒）
- [ ] 画面清晰无花屏
- [ ] 播放流畅无卡顿
- [ ] 进度条可以拖动
- [ ] 可以播放到末尾
- [ ] 新temp文件可以播放

---

## 🐛 问题记录

### 问题1：修复后的文件只能播放4秒（已修复）

**现象**：
- 录制60秒，VPS重启
- 修复后文件4.1MB，但只能播放4秒
- 预期应该播放60秒

**根本原因**：
- RecordingRecoveryService只重命名，不转换格式
- temp文件使用Fragmented MP4（防崩溃保护）
- segment muxer异常关闭的Fragmented MP4只保留第一个fragment索引
- 结果：只能播放第一个fragment（约4秒）

**解决方案**：
- RecordingRecoveryService调用`streamManager.convertSegmentToStandardMp4`
- 与分段完成逻辑保持一致
- 使用`-c copy`避免重新编码
- 转换失败时降级为直接重命名

**修复版本**：fa964981  
**修复时间**：2025-10-31 11:23

---

## 📊 预期结果 vs 实际结果

| 验证项 | 预期结果 | 实际结果 | 状态 |
|-------|---------|---------|------|
| temp文件转换 | 自动转换为标准MP4 | _______ | ☐ 通过 ☐ 失败 |
| 文件命名 | 包含正确时间范围 | _______ | ☐ 通过 ☐ 失败 |
| 播放时长 | 约60秒 | _______ | ☐ 通过 ☐ 失败 |
| 播放质量 | 清晰流畅 | _______ | ☐ 通过 ☐ 失败 |
| 录制恢复 | 新temp文件生成 | _______ | ☐ 通过 ☐ 失败 |

---

## 🔧 故障排查

### 如果修复失败

#### 问题A：temp文件未被修复
```bash
# 检查RecoveryService是否启动
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 50 | grep 'Recovery service'"

# 检查扫描范围配置
# 默认扫描48小时内的文件，如果temp文件创建时间超过48小时则不会被修复
```

#### 问题B：转换失败
```bash
# 查看转换错误日志
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 200 | grep -A 10 'conversion failed'"

# 检查FFmpeg是否可用
ssh root@<VPS_IP> "which ffmpeg && ffmpeg -version"
```

#### 问题C：文件仍然只能播放4秒
```bash
# 检查是否使用了旧版本代码
ssh root@<VPS_IP> "cd /root/vps-transcoder-api && git log --oneline -5"

# 应该看到提交：fa964981 fix(critical): RecordingRecoveryService转换Fragmented MP4为标准MP4

# 如果看不到，重新部署：
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && bash vps-simple-deploy.sh"
```

---

## 📝 测试结论

### 通过标准
- [ ] 所有阶段验证点全部通过
- [ ] 修复后的文件可以完整播放（60秒+）
- [ ] 录制自动恢复
- [ ] 无错误日志

### 测试结论
- ☐ **测试通过** - 所有功能正常
- ☐ **测试失败** - 存在问题，需要修复
- ☐ **部分通过** - 主要功能正常，存在次要问题

### 测试签名
- **测试人员**：____________________
- **审核人员**：____________________
- **日期**：____________________

---

## 📚 参考文档

- [ARCHITECTURE_V2.md](./ARCHITECTURE_V2.md) - 系统架构文档（第998-1261行：录制文件防损坏与修复系统）
- [RECORDING_SEGMENTATION_IMPLEMENTATION.md](./RECORDING_SEGMENTATION_IMPLEMENTATION.md) - 频道录制分段功能
- [RECORDING_RECOVERY_IMPLEMENTATION.md](./RECORDING_RECOVERY_IMPLEMENTATION.md) - 录制文件防损坏与修复功能

---

## 🎯 自动化测试脚本

```bash
#!/bin/bash
# 录制修复功能自动化测试脚本
# 使用方法：bash recording_recovery_test.sh <channelId>

CHANNEL_ID=${1:-"stream_gkg5hknc"}
DATE=$(TZ='Asia/Shanghai' date +%Y%m%d)
RECORD_PATH="/srv/filebrowser/yoyo-k/${CHANNEL_ID}/${DATE}"

echo "🚀 开始录制修复功能测试"
echo "📌 频道ID: ${CHANNEL_ID}"
echo "📅 日期: ${DATE}"
echo ""

# 步骤1：检查录制状态
echo "📝 步骤1: 检查录制状态..."
ssh root@<VPS_IP> "ps aux | grep ffmpeg | grep ${CHANNEL_ID} | grep -v grep"
if [ $? -eq 0 ]; then
    echo "✅ 录制进程存在"
else
    echo "❌ 录制进程不存在，请先启动录制"
    exit 1
fi

# 步骤2：检查temp文件
echo ""
echo "📝 步骤2: 检查temp文件..."
TEMP_FILE=$(ssh root@<VPS_IP> "ls ${RECORD_PATH}/*temp*.mp4 2>/dev/null | head -1")
if [ -n "${TEMP_FILE}" ]; then
    echo "✅ 找到temp文件: $(basename ${TEMP_FILE})"
    TEMP_SIZE=$(ssh root@<VPS_IP> "ls -lh ${TEMP_FILE} | awk '{print \$5}'")
    echo "📊 文件大小: ${TEMP_SIZE}"
else
    echo "❌ 未找到temp文件"
    exit 1
fi

# 步骤3：等待录制
echo ""
echo "⏳ 步骤3: 等待60秒录制..."
sleep 60
echo "✅ 等待完成"

# 步骤4：重启服务
echo ""
echo "⚠️  步骤4: 重启VPS服务（模拟崩溃）..."
ssh root@<VPS_IP> "pm2 restart vps-transcoder-api"
echo "✅ 服务已重启"

# 步骤5：等待修复
echo ""
echo "⏳ 步骤5: 等待修复服务执行..."
sleep 15
echo "✅ 等待完成"

# 步骤6：验证修复
echo ""
echo "📝 步骤6: 验证修复结果..."
FIXED_FILE=$(ssh root@<VPS_IP> "ls ${RECORD_PATH}/*_to_*.mp4 2>/dev/null | tail -1")
if [ -n "${FIXED_FILE}" ]; then
    echo "✅ 找到修复后的文件: $(basename ${FIXED_FILE})"
    FIXED_SIZE=$(ssh root@<VPS_IP> "ls -lh ${FIXED_FILE} | awk '{print \$5}'")
    echo "📊 文件大小: ${FIXED_SIZE}"
else
    echo "❌ 未找到修复后的文件"
    exit 1
fi

# 步骤7：检查日志
echo ""
echo "📝 步骤7: 检查修复日志..."
ssh root@<VPS_IP> "pm2 logs vps-transcoder-api --lines 50 --nostream | grep -E 'Converting temp file|Segment converted'"
if [ $? -eq 0 ]; then
    echo "✅ 日志显示转换成功"
else
    echo "⚠️  未找到转换日志"
fi

echo ""
echo "🎉 测试完成！"
echo "📥 请下载文件并验证播放："
echo "   scp root@<VPS_IP>:${FIXED_FILE} ./"
echo "   ffplay $(basename ${FIXED_FILE})"
```

保存为 `recording_recovery_test.sh` 并执行：
```bash
bash recording_recovery_test.sh stream_gkg5hknc
```
