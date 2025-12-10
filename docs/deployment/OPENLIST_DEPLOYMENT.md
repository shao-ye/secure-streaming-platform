# OpenList 文件管理系统部署文档

## 📋 概述

OpenList是Alist的社区增强版本，支持多存储的文件列表程序，用于管理录制视频文件并上传到中国移动云盘。

---

## 🚀 安装信息

### 基本信息

| 项目 | 信息 |
|------|------|
| **版本** | v4.1.6 |
| **构建时间** | 2025-11-03 03:40:51 +0000 |
| **Go版本** | go1.25.1 linux/amd64 |
| **安装方式** | 二进制直接安装 |
| **安装目录** | `/opt/openlist_new` |
| **数据目录** | `/opt/openlist_new/data` |
| **配置文件** | `/opt/openlist_new/data/config.json` |
| **服务管理** | systemd |
| **服务名称** | openlist.service |

### 访问信息

| 项目 | 信息 |
|------|------|
| **外网访问** | https://alist.your-domain.com/ |
| **内网访问** | http://<VPS_IP>:5266 |
| **监听端口** | 5266 |
| **监听地址** | 0.0.0.0:5266 |
| **用户名** | admin |
| **密码** | ⚠️ 请联系管理员获取 |

---

## 📦 安装步骤

### 步骤1：下载安装

```bash
# 创建安装目录
mkdir -p /opt/openlist_new

# 下载最新版本（从OpenList官方下载）
cd /opt/openlist_new
wget https://github.com/openlist-project/openlist/releases/latest/download/openlist-linux-amd64.tar.gz -O openlist.tar.gz

# 解压
tar -zxvf openlist.tar.gz
rm openlist.tar.gz

# 设置执行权限
chmod +x openlist

# 验证安装
./openlist version
```

### 步骤2：设置管理员密码

```bash
cd /opt/openlist_new
./openlist admin set '你的安全密码'

# 或随机生成密码
./openlist admin random
```

### 步骤3：创建systemd服务

```bash
# 创建服务文件
cat > /etc/systemd/system/openlist.service << 'EOF'
[Unit]
Description=OpenList service
Wants=network.target
After=network.target network.service

[Service]
Type=simple
WorkingDirectory=/opt/openlist_new
ExecStart=/opt/openlist_new/openlist server
KillMode=process
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
```

### 步骤4：启动服务

```bash
# 重载systemd配置
systemctl daemon-reload

# 启动服务
systemctl start openlist

# 设置开机自启
systemctl enable openlist

# 查看状态
systemctl status openlist
```

---

## ⚙️ 服务管理

### 常用命令

```bash
# 查看服务状态
systemctl status openlist

# 启动服务
systemctl start openlist

# 停止服务
systemctl stop openlist

# 重启服务
systemctl restart openlist

# 查看实时日志
journalctl -u openlist -f

# 查看最近日志
journalctl -u openlist -n 100

# 查看端口占用
ss -tlnp | grep 5266
```

### 手动管理

```bash
# 进入安装目录
cd /opt/openlist_new

# 查看版本
./openlist version

# 重置管理员密码
./openlist admin set '新密码'

# 随机生成密码
./openlist admin random

# 手动启动（调试用）
./openlist server
```

---

## 🗂️ 存储配置

### 配置1：本地录制视频存储

```yaml
存储名称：📹 录制视频
驱动：本地存储
挂载路径：/recordings
启用签名：否
排序方式：按修改时间倒序
根文件夹路径：/srv/filebrowser/yoyo-k
缩略图：关闭
Web代理：否
Webdav策略：本地代理
备注：所有频道的录制视频（只读）
```

**目录结构**：
```
/recordings/
├── stream_gkg5hknc/          ← 二楼教室2
│   ├── 20251101/             ← 日期文件夹
│   │   ├── xxx_151739_to_152039.mp4
│   │   └── xxx_152039_to_152339.mp4
│   ├── 20251102/
│   └── 20251104/
├── stream_abc123/            ← 其他频道
│   └── 20251104/
└── ...
```

### 配置2：中国移动云盘存储

```yaml
存储名称：☁️ 移动云盘
驱动：中国移动云盘
挂载路径：/cloud139
类型：个人云 / 家庭云 / 新个人云（根据实际情况选择）
Authorization：[从浏览器开发者工具获取]
根文件夹ID：root（个人云）或留空（家庭云）
备注：视频文件上传目标
```

**获取Authorization方法**：
1. 打开 https://yun.139.com/ 并登录
2. 按F12打开开发者工具
3. 切换到"网络"标签
4. 刷新页面，随意点击操作
5. 在请求列表中找到任意请求
6. 查看请求头中的 `Authorization` 字段
7. 复制 `Basic` 后面的内容（不包括Basic）
8. 填入OpenList配置中

---

## 🌐 Cloudflare Tunnel配置

### Tunnel配置

在Cloudflare Tunnel配置文件中添加：

```yaml
# 配置文件路径：~/.cloudflared/config.yml
tunnel: <your-tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  # OpenList文件管理
  - hostname: alist.your-domain.com
    service: http://localhost:5266
  
  # VPS转码服务
  - hostname: yoyo-vps.your-domain.com
    service: http://localhost:3000
  
  # 默认规则
  - service: http_status:404
```

### Cloudflare DNS配置

在Cloudflare DNS中添加CNAME记录：

| 类型 | 名称 | 内容 | 代理状态 |
|------|------|------|---------|
| CNAME | alist | <tunnel-id>.cfargotunnel.com | 已代理 |

### 重启Tunnel

```bash
# 查看tunnel状态
systemctl status cloudflare-tunnel

# 重启tunnel
systemctl restart cloudflare-tunnel

# 查看tunnel日志
journalctl -u cloudflare-tunnel -f
```

---

## 📖 使用说明

### 首次登录

1. 访问：https://alist.your-domain.com/
2. 点击右上角"登录"
3. 输入用户名：`admin`
4. 输入密码：`[联系管理员获取]`
5. **立即修改密码**：管理 → 设置 → 修改密码

### 配置存储

1. 登录后点击"管理"
2. 进入"存储"页面
3. 点击"添加"按钮
4. 按照上述配置填写信息
5. 点击"保存"

### 日常使用流程

#### 备份录制视频到移动云盘

1. **查看录制文件**：
   - 访问 `/recordings/`
   - 选择频道（如 `stream_gkg5hknc/`）
   - 选择日期文件夹（如 `20251103/`）

2. **选择要备份的文件**：
   - 勾选需要上传的视频文件
   - 或点击文件预览确认内容

3. **上传到云盘**：
   - 点击"复制"按钮
   - 选择目标存储：`/cloud139/`
   - 选择或创建目标文件夹
   - 点击"确定"开始上传

4. **查看上传进度**：
   - 点击底部"任务"
   - 查看上传状态
   - 等待完成

#### 文件预览

OpenList支持在线预览：
- ✅ 视频文件（MP4）
- ✅ 图片文件
- ✅ 文本文件
- ✅ PDF文档

---

## ⚠️ 注意事项

### 时间窗口管理

| 时间段 | 清理状态 | 建议操作 |
|--------|---------|---------|
| 00:00-01:00 | ❌ 清理前 | ⚠️ 避免大量上传 |
| 01:00-01:30 | ✅ 正在清理 | ❌ **禁止操作** |
| 01:30-23:59 | ❌ 清理后 | ✅ 安全上传 |

### 备份策略

假设清理保留7天：

```
今天：2025-11-05
清理：2025-10-28及之前
保留：2025-10-29 到 2025-11-05（共7天）

建议：
✅ 每天备份前2-3天的视频（如11-03、11-02）
✅ 给自己留3-4天缓冲期
❌ 避免在第7天才备份（太紧张）
```

### 文件选择原则

**✅ 备份这些文件**：
```
xxx_151739_to_152039.mp4  ← 已完成的最终文件
xxx_152039_to_152339.mp4  ← 已重命名的文件
```

**❌ 不要备份这些文件**：
```
xxx_temp_001.mp4  ← 正在录制的临时文件
xxx_temp_002.mp4  ← 未完成的文件
```

### 云盘配置维护

- ⚠️ Authorization会定期过期
- ⚠️ 过期后需要重新获取
- ⚠️ 定期检查存储状态
- ⚠️ 注意云盘剩余空间

---

## 🔧 故障排查

### 无法访问OpenList

```bash
# 检查服务状态
systemctl status openlist

# 检查端口监听
ss -tlnp | grep 5266

# 检查日志
journalctl -u openlist -n 50

# 测试本地访问
curl http://localhost:5266
```

### 无法连接移动云盘

1. 检查Authorization是否过期
2. 重新从浏览器获取Authorization
3. 更新OpenList中的存储配置
4. 保存并重新连接

### 文件上传失败

1. 检查云盘空间是否充足
2. 检查网络连接状态
3. 查看OpenList任务日志
4. 重试上传

### Cloudflare Tunnel无法访问

```bash
# 检查tunnel服务
systemctl status cloudflare-tunnel

# 查看tunnel日志
journalctl -u cloudflare-tunnel -n 100

# 重启tunnel
systemctl restart cloudflare-tunnel

# 验证本地可访问
curl http://localhost:5266
```

---

## 🔄 升级维护

### 升级OpenList

```bash
# 停止服务
systemctl stop openlist

# 备份数据
cp -r /opt/openlist_new/data /opt/openlist_new/data.backup.$(date +%Y%m%d)

# 备份旧版本可执行文件
mv /opt/openlist_new/openlist /opt/openlist_new/openlist.old

# 下载新版本
cd /opt/openlist_new
wget https://github.com/openlist-project/openlist/releases/latest/download/openlist-linux-amd64.tar.gz -O openlist.tar.gz
tar -zxvf openlist.tar.gz
rm openlist.tar.gz
chmod +x openlist

# 查看新版本
./openlist version

# 启动服务
systemctl start openlist

# 查看服务状态
systemctl status openlist
```

### 回滚到旧版本

```bash
# 如果升级后出现问题，可以回滚
systemctl stop openlist
mv /opt/openlist_new/openlist /opt/openlist_new/openlist.new
mv /opt/openlist_new/openlist.old /opt/openlist_new/openlist
systemctl start openlist
```

### 备份数据

```bash
# 备份配置和数据库
tar -czf openlist-backup-$(date +%Y%m%d).tar.gz -C /opt/openlist_new data/

# 恢复备份
cd /opt/openlist_new
tar -xzf openlist-backup-20251105.tar.gz
```

---

## 📊 性能监控

### 资源占用

| 项目 | 预估值 |
|------|--------|
| **内存** | ~3-10MB（空闲），~50-100MB（传输中） |
| **CPU** | 传输时占用，空闲时几乎无 |
| **磁盘** | ~140MB（程序） + 数据目录 |
| **网络** | 上传时占用带宽 |

### 监控命令

```bash
# 查看进程资源占用
top -p $(pgrep openlist)

# 查看内存占用
ps aux | grep openlist

# 查看磁盘使用
du -sh /opt/openlist_new/data/

# 查看日志大小
du -sh /opt/openlist_new/data/log/

# 查看实时网络占用
iftop -i eth0
```

---

## 🔗 相关链接

- **OpenList GitHub**：https://github.com/openlist-project/openlist
- **Alist官方网站**：https://alist.nn.ci/（OpenList基于Alist）
- **Alist文档**：https://alist.nn.ci/guide/
- **中国移动云盘配置**：https://alist-v3.pages.dev/zh/guide/drivers/139

---

## 📝 更新日志

### 2025-11-05
- ✅ 创建OpenList部署文档
- ✅ 记录当前版本v4.1.6配置
- ✅ 服务运行正常，端口5266
- ✅ 已配置Cloudflare Tunnel访问

### 2025-11-04
- ✅ OpenList服务正常运行
- ✅ 配置systemd服务管理
- ✅ 配置Cloudflare Tunnel
- ✅ 访问域名：https://alist.your-domain.com/

### 待配置
- ⏳ 本地存储挂载（/recordings）
- ⏳ 中国移动云盘存储配置

---

## 💡 OpenList vs Alist

### 为什么选择OpenList

OpenList是Alist的社区增强版本，提供了以下额外特性：
- 🚀 **性能优化**：更快的文件列表加载速度
- 🎨 **界面改进**：更现代化的用户界面
- 🔧 **功能增强**：额外的文件管理功能
- 🐛 **Bug修复**：修复了Alist的一些已知问题
- 🔄 **持续更新**：活跃的社区维护

### 兼容性

- ✅ 完全兼容Alist的配置文件
- ✅ 支持所有Alist的存储驱动
- ✅ 配置和使用方法基本相同
- ✅ 可以从Alist无缝迁移

---

## 📞 技术支持

如遇到问题，请查看：
1. OpenList GitHub Issues
2. Alist官方文档
3. 服务日志：`journalctl -u openlist -f`

---

**文档版本**：v2.0  
**最后更新**：2025-11-05  
**维护人员**：系统管理员  
**服务类型**：OpenList v4.1.6
