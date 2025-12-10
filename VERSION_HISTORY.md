# YOYO流媒体平台 - 版本历史

## 稳定版本标记说明

本文档记录所有稳定版本的标记（Git Tag），用于版本回退和参考。

---

## v3.0.0-stable (2025-10-31)

**标签名**: `v3.0.0-stable`  
**提交ID**: `cd344f9a`  
**发布时间**: 2025-10-31 11:40  
**状态**: ✅ 当前稳定版本

### 🎯 核心修复

- 修复分段录制文件只能播放2-4秒的关键问题
- 修复RecordingRecoveryService修复后文件无法完整播放的问题
- 统一录制文件处理逻辑（正常完成和异常恢复）

### 🔥 关键改进

#### 1. Fragmented MP4 → 标准MP4自动转换机制
- 分段完成时自动转换（`renameCompletedSegment`）
- 异常恢复时自动转换（`RecordingRecoveryService`）
- 使用 `-c copy` 避免重新编码，保证速度和质量

#### 2. 双重保护机制
- **录制时**：Fragmented MP4（防程序崩溃导致文件损坏）
- **完成后**：标准MP4（确保所有播放器兼容，完整播放）

#### 3. 降级保护
- 转换失败时自动降级为直接重命名
- 60秒超时保护
- 完善的错误处理

### 📋 新增文档
- `RECORDING_RECOVERY_TEST.md` - 完整的测试文档和自动化脚本

### ✅ 测试验证
- ✅ 正在录制的文件可以播放（Fragmented MP4防崩溃）
- ✅ 完成后的文件可以完整播放（标准MP4）
- ✅ VPS重启后自动修复，文件可完整播放
- ✅ 分段时长支持3-240分钟（方便测试）

### 🔧 技术栈
- FFmpeg Fragmented MP4
- FFmpeg 标准MP4转换（-c copy）
- RecordingRecoveryService
- SimpleStreamManager

### 📦 关键提交
- `cd344f9a`: docs: 添加录制文件修复功能测试文档
- `fa964981`: fix(critical): RecordingRecoveryService转换Fragmented MP4为标准MP4
- `a5d39cb8`: fix(critical): 修复segment muxer关闭Fragmented MP4导致的播放问题

### ⚠️ 回退方法
```bash
# 切换到此稳定版本
git checkout v3.0.0-stable

# 或者回退到此版本（创建新分支）
git checkout -b stable-v3.0.0 v3.0.0-stable

# 强制回退master分支到此版本（谨慎使用）
git reset --hard v3.0.0-stable
git push origin master --force
```

### 📝 已知问题
- 无

### 🎯 推荐用途
- ✅ 生产环境稳定版本
- ✅ 录制功能完整可用
- ✅ 经过内部测试验证

---

## v5.3-deployment-api-stable (2025-10-14)

**标签名**: `v5.3-deployment-api-stable`  
**状态**: ⚠️ 已过时（存在录制文件播放问题）

### 已知问题
- ❌ 分段录制文件只能播放2-4秒
- ❌ RecordingRecoveryService修复后文件无法完整播放

### 备注
建议升级到 v3.0.0-stable

---

## v2.7.0-stable (较早版本)

**标签名**: `v2.7.0-stable`  
**状态**: ⚠️ 已过时

---

## v2.2-user-auth-unified

**标签名**: `v2.2-user-auth-unified`  
**功能**: 用户认证统一

---

## 版本命名规范

### 稳定版本标记格式
```
v{major}.{minor}.{patch}-stable
```

例如：`v3.0.0-stable`

### 功能版本标记格式
```
v{major}.{minor}-{feature-name}
```

例如：`v2.2-user-auth-unified`

### 备份标记格式
```
backup-{branch}-{date}-{time}
```

例如：`backup-master-20251014-1117`

---

## 如何使用稳定版本

### 查看所有标签
```bash
git tag -l
```

### 查看特定标签详情
```bash
git tag -n50 v3.0.0-stable
```

### 切换到稳定版本
```bash
# 方法1：临时查看（不创建分支）
git checkout v3.0.0-stable

# 方法2：创建新分支
git checkout -b my-stable-branch v3.0.0-stable

# 方法3：回退当前分支
git reset --hard v3.0.0-stable
```

### 在VPS上部署稳定版本
```bash
# 1. SSH到VPS
ssh root@<VPS_IP>

# 2. 进入项目目录
cd /tmp/github/secure-streaming-platform

# 3. 拉取最新标签
git fetch --tags

# 4. 切换到稳定版本
git checkout v3.0.0-stable

# 5. 部署
cd vps-transcoder-api
bash vps-simple-deploy.sh
```

---

## 创建新的稳定版本

### 步骤1：确保代码已提交
```bash
git status
# 确保工作目录干净
```

### 步骤2：创建标签
```bash
git tag -a v3.1.0-stable -m "稳定版本 v3.1.0 - 新功能描述

🎯 核心功能：
- 功能1描述
- 功能2描述

✅ 测试验证：
- 测试项1
- 测试项2

部署时间：$(date '+%Y-%m-%d %H:%M')
测试状态：已通过内部测试
推荐用途：生产环境稳定版本"
```

### 步骤3：推送标签
```bash
git push origin v3.1.0-stable
```

### 步骤4：更新此文档
在本文档顶部添加新版本记录，保持按时间倒序排列。

---

## 紧急回退流程

### 场景：生产环境出现严重问题

#### 步骤1：确定回退目标版本
```bash
# 查看版本历史
git tag -l | grep stable

# 查看版本详情
git tag -n50 v3.0.0-stable
```

#### 步骤2：本地回退
```bash
# 创建紧急修复分支
git checkout -b emergency-rollback-$(date +%Y%m%d-%H%M) v3.0.0-stable

# 推送到远程
git push origin emergency-rollback-$(date +%Y%m%d-%H%M)
```

#### 步骤3：VPS回退
```bash
# SSH到VPS
ssh root@<VPS_IP>

# 进入项目目录
cd /tmp/github/secure-streaming-platform

# 强制切换到稳定版本
git fetch --tags
git checkout -f v3.0.0-stable

# 重新部署
cd vps-transcoder-api
bash vps-simple-deploy.sh

# 验证服务状态
pm2 status
pm2 logs vps-transcoder-api --lines 50
```

#### 步骤4：验证回退成功
```bash
# 检查服务健康
curl http://<VPS_IP>:3000/health

# 检查录制功能
# 启动一个测试录制，验证文件可以正常播放
```

#### 步骤5：记录问题
在本文档中记录：
- 问题现象
- 回退时间
- 回退原因
- 后续计划

---

## 版本对比

| 版本 | 录制功能 | 分段功能 | 文件修复 | 播放完整性 | 推荐度 |
|------|---------|---------|---------|-----------|--------|
| v3.0.0-stable | ✅ | ✅ | ✅ | ✅ 完整播放 | ⭐⭐⭐⭐⭐ |
| v5.3-deployment-api-stable | ✅ | ⚠️ | ⚠️ | ❌ 只播放2-4秒 | ⚠️ 不推荐 |
| v2.7.0-stable | ✅ | ❌ | ❌ | - | ⚠️ 已过时 |

---

## 联系方式

如有问题，请联系开发团队或查看相关文档：
- 录制功能测试：`doc/RECORDING_RECOVERY_TEST.md`
- 架构文档：`doc/ARCHITECTURE_V2.md`
- 分段功能：`doc/RECORDING_SEGMENTATION_IMPLEMENTATION.md`
- 修复功能：`doc/RECORDING_RECOVERY_IMPLEMENTATION.md`

---

**最后更新**: 2025-10-31 11:40  
**维护者**: AI Assistant  
**文档版本**: 1.0
