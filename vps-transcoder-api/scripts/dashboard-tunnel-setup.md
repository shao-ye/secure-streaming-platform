# Cloudflare Dashboard 隧道配置指南

## 🌐 通过Web界面配置隧道 (推荐方案)

### 步骤1: 访问Cloudflare Dashboard
1. 登录 https://dash.cloudflare.com
2. 选择域名 `5202021.xyz`
3. 左侧菜单选择 "Zero Trust" → "Networks" → "Tunnels"

### 步骤2: 创建隧道
1. 点击 "Create a tunnel"
2. 选择 "Cloudflared"
3. 输入隧道名称: `yoyo-streaming`
4. 点击 "Save tunnel"

### 步骤3: 安装连接器
1. 选择操作系统: "Linux"
2. 复制提供的安装命令到VPS执行
3. 或者下载配置文件到VPS: `/root/.cloudflared/`

### 步骤4: 配置路由规则
添加以下Public Hostname规则:

| Subdomain | Domain | Path | Service |
|-----------|--------|------|---------|
| tunnel-api | yoyo-vps.5202021.xyz | | http://localhost:3000 |
| tunnel-hls | yoyo-vps.5202021.xyz | | http://localhost:8080 |
| tunnel-health | yoyo-vps.5202021.xyz | | http://localhost:3000/health |

### 步骤5: 启动隧道
在VPS上执行:
```bash
# 使用Dashboard提供的token启动
cloudflared service install <YOUR_TOKEN>
systemctl start cloudflared
systemctl enable cloudflared
```

## 🔧 配置文件方式 (如果需要)

如果你想继续使用配置文件方式，创建 `/root/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: tunnel-api.yoyo-vps.5202021.xyz
    service: http://localhost:3000
  - hostname: tunnel-hls.yoyo-vps.5202021.xyz
    service: http://localhost:8080
  - hostname: tunnel-health.yoyo-vps.5202021.xyz
    service: http://localhost:3000/health
  - service: http_status:404
```

## ✅ 验证隧道状态

配置完成后验证:
```bash
# 检查隧道状态
cloudflared tunnel info yoyo-streaming

# 测试连接
curl https://tunnel-health.yoyo-vps.5202021.xyz
```

## 🎯 优势对比

**Dashboard方式**:
- ✅ 无需命令行登录等待
- ✅ 图形界面操作简单
- ✅ 自动生成配置
- ✅ 实时状态监控

**命令行方式**:
- ⚠️ 需要等待登录授权
- ⚠️ 手动配置复杂
- ✅ 更灵活的配置选项
