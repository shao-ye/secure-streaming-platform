# 🚀 YOYO平台快速部署备忘录

## VPS一键部署（推荐 ⭐）

```bash
# 标准VPS部署命令 - 请记住这条命令
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"
```

**这条命令会自动完成**：
- ✅ Git仓库健康检查和修复
- ✅ 代码更新和同步
- ✅ 环境变量配置
- ✅ 服务重启
- ✅ 健康检查验证

## 其他部署命令

### Cloudflare Workers部署
```bash
cd cloudflare-worker
npx wrangler deploy --env production
```

### 前端部署
```bash
git push origin master  # Cloudflare Pages自动部署
```

## 紧急修复

### Git仓库损坏修复
```bash
# 1. 删除损坏的仓库
ssh root@<VPS_IP> "rm -rf /tmp/github/secure-streaming-platform"

# 2. 重新克隆
ssh root@<VPS_IP> "mkdir -p /tmp/github && cd /tmp/github && git clone git@github.com:shao-ye/secure-streaming-platform.git"

# 3. 执行部署
ssh root@<VPS_IP> "cd /tmp/github/secure-streaming-platform/vps-transcoder-api && chmod +x vps-simple-deploy.sh && ./vps-simple-deploy.sh"
```

### 服务状态检查
```bash
# 检查PM2状态
ssh root@<VPS_IP>"pm2 status"

# 检查服务健康
curl https://yoyo-vps.your-domain.com/health

# 检查API认证
curl -H 'X-API-Key: <API_SECRET_KEY>' https://yoyo-vps.your-domain.com/api/simple-stream/health
```

---

**记住**: 优先使用SSH一键部署，简单可靠！

**文档位置**: `doc/YOYO_PLATFORM_ARCHITECTURE.md` - 完整架构文档  
**更新时间**: 2025年10月21日
