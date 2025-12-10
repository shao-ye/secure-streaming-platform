# VPS部署指南

本文档提供了完整的VPS部署解决方案，包括处理各种异常情况的脚本。

## 📋 脚本概览

### 1. `vps-robust-deploy.sh` - 强力部署脚本 (推荐)
**功能**: 完整的部署解决方案，处理Git损坏、环境配置、服务重启等
**适用场景**: 首次部署、完整更新、解决复杂问题

### 2. `vps-git-fix.sh` - Git修复专用脚本
**功能**: 专门处理Git仓库损坏问题
**适用场景**: 出现"unable to read sha1 file"等Git错误时

### 3. `vps-simple-deploy.sh` - 原有简单部署脚本
**功能**: 基础的代码更新和服务重启
**适用场景**: 日常更新（当Git仓库健康时）

## 🚀 使用方法

### 场景1: 首次部署或完整部署
```bash
# 上传脚本到VPS
scp vps-robust-deploy.sh root@your-vps:/root/

# 在VPS上执行
chmod +x /root/vps-robust-deploy.sh
/root/vps-robust-deploy.sh
```

### 场景2: Git仓库损坏修复
```bash
# 上传Git修复脚本
scp vps-git-fix.sh root@your-vps:/root/

# 在VPS上执行
chmod +x /root/vps-git-fix.sh

# 自动修复
/root/vps-git-fix.sh --auto

# 或交互式修复
/root/vps-git-fix.sh

# 或强制重建
/root/vps-git-fix.sh --rebuild
```

### 场景3: 日常更新
```bash
# 如果Git仓库健康，可以使用简单脚本
./vps-simple-deploy.sh
```

## 🔧 脚本功能详解

### vps-robust-deploy.sh 功能
- ✅ **Git健康检查**: 自动检测并修复Git仓库问题
- ✅ **完全重新克隆**: 当Git损坏时自动重新克隆仓库
- ✅ **代码备份**: 部署前自动备份当前代码
- ✅ **环境配置**: 自动配置.env文件和API密钥
- ✅ **目录创建**: 创建必要的系统目录
- ✅ **文件验证**: 验证关键文件是否存在
- ✅ **服务重启**: 智能重启PM2服务
- ✅ **健康检查**: 全面的服务健康检查
- ✅ **API测试**: 测试API认证功能

### vps-git-fix.sh 功能
- 🔍 **状态检查**: 全面检查Git仓库健康状态
- 🔧 **轻量级修复**: 尝试修复索引和对象问题
- 🚨 **完全重建**: 删除损坏仓库并重新克隆
- 🤖 **自动模式**: 自动选择最佳修复策略
- 💬 **交互模式**: 提供用户选择修复方式

## 🛠️ 常见问题解决

### 问题1: "unable to read sha1 file" 错误
**原因**: Git仓库对象损坏
**解决**: 
```bash
./vps-git-fix.sh --auto
```

### 问题2: PM2服务启动失败
**原因**: 环境配置问题或代码错误
**解决**: 
```bash
./vps-robust-deploy.sh  # 完整重新部署
```

### 问题3: API认证失败
**原因**: API密钥配置错误
**解决**: 脚本会自动配置正确的API密钥 `<API_SECRET_KEY>`

### 问题4: 目录权限问题
**原因**: 系统目录权限不正确
**解决**: 脚本会自动创建并设置正确权限

## 📊 部署验证

部署完成后，脚本会自动执行以下验证：

### 1. 服务状态检查
```bash
pm2 status
```

### 2. 健康检查
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/simple-stream/health
```

### 3. API认证测试
```bash
# 测试正确API密钥
curl -X POST http://localhost:3000/api/simple-stream/start-watching \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <API_SECRET_KEY>' \
  -d '{"channelId":"test","rtmpUrl":"rtmp://test.com/live/test"}'
```

## 🔐 安全配置

### API密钥配置
- **生产密钥**: `<API_SECRET_KEY>`
- **配置文件**: `/opt/yoyo-transcoder/.env`
- **环境变量**: `API_SECRET_KEY`

### IP白名单
- **开发阶段**: 已禁用 (`ENABLE_IP_WHITELIST=false`)
- **生产环境**: 可根据需要启用Cloudflare IP验证

## 📁 目录结构

```
/opt/yoyo-transcoder/          # 主应用目录
├── src/                       # 源代码目录
├── .env                       # 环境配置文件
└── backup-YYYYMMDD_HHMMSS/   # 自动备份目录

/var/www/hls/                  # HLS输出目录
/var/log/transcoder/           # 日志目录
/tmp/github/secure-streaming-platform/  # Git仓库目录
```

## 🚨 紧急恢复

如果部署出现严重问题，可以使用备份恢复：

```bash
# 查看备份目录
ls -la /opt/yoyo-transcoder/backup-*

# 恢复备份（替换YYYYMMDD_HHMMSS为实际备份时间）
cp -r /opt/yoyo-transcoder/backup-YYYYMMDD_HHMMSS/* /opt/yoyo-transcoder/src/

# 重启服务
pm2 restart vps-transcoder-api
```

## 📞 技术支持

如果遇到脚本无法解决的问题：

1. **查看详细日志**: `pm2 logs vps-transcoder-api`
2. **检查系统资源**: `top`, `df -h`, `free -m`
3. **验证网络连接**: `ping github.com`
4. **检查Git状态**: `./vps-git-fix.sh --check`

## 🎯 最佳实践

1. **定期备份**: 脚本会自动备份，但建议定期手动备份重要配置
2. **监控日志**: 定期检查PM2日志和系统日志
3. **更新策略**: 在低峰期进行部署更新
4. **测试验证**: 部署后务必验证API功能正常

---

**版本**: v1.0
**更新时间**: 2025-10-21
**维护者**: YOYO平台开发团队
