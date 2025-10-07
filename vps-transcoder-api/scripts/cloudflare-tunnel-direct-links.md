# Cloudflare 隧道创建直达链接

## 🎯 直接访问链接

### 方法1: 域名Dashboard路径
1. 访问: https://dash.cloudflare.com/
2. 点击域名: `5202021.xyz`
3. 左侧菜单: **Traffic** → **Cloudflare Tunnel**

### 方法2: Zero Trust Dashboard
1. 访问: https://one.dash.cloudflare.com/
2. 左侧菜单: **Networks** → **Tunnels**
3. 点击: **Create a tunnel**

### 方法3: 直达隧道创建页面
访问: https://one.dash.cloudflare.com/networks/tunnels

## 📋 创建步骤详解

### Step 1: 选择隧道类型
- 选择: **Cloudflared**
- 点击: **Next**

### Step 2: 命名隧道
- 隧道名称: `yoyo-streaming`
- 点击: **Save tunnel**

### Step 3: 安装连接器
- 选择操作系统: **Linux**
- 复制安装命令 (类似):
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
sudo cloudflared service install <YOUR_TOKEN>
```

### Step 4: 配置Public Hostnames
添加以下3个规则:

| Type | Subdomain | Domain | Path | Service |
|------|-----------|--------|------|---------|
| HTTP | tunnel-api | yoyo-vps.5202021.xyz | | http://localhost:3000 |
| HTTP | tunnel-hls | yoyo-vps.5202021.xyz | | http://localhost:8080 |
| HTTP | tunnel-health | yoyo-vps.5202021.xyz | | http://localhost:3000/health |

### Step 5: 保存并启动
- 点击: **Save tunnel**
- 在VPS执行安装命令
- 启动服务: `sudo systemctl start cloudflared`

## 🔍 如果找不到隧道选项

### 检查账户类型
- 免费账户可能需要先启用Zero Trust
- 访问: https://dash.cloudflare.com/sign-up/teams
- 选择免费计划

### 备用方案: 使用命令行
如果Dashboard方式不可用，回到VPS继续命令行配置:
```bash
# 中断当前登录 (Ctrl+C)
# 使用token方式
cloudflared tunnel login --url
# 然后访问提供的URL完成授权
```
