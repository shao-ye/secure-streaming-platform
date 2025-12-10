# YOYO VPS 一键卸载脚本使用说明

> 本文档说明如何使用仓库内提供的 `vps-uninstall.sh` 脚本，对已部署的 YOYO VPS 转码服务进行安全卸载与清理。
>
> 脚本路径：`vps-server/scripts/vps-uninstall.sh`
>
> 版本示例：`2.1.0`

---

## 1. 适用场景

- 需要在同一台 VPS 上 **重装 YOYO 转码服务**；
- 需要将 YOYO 服务 **迁移到新 VPS**，清理旧环境；
- 需要 **临时关闭或删除** YOYO 相关进程、配置和数据目录。

脚本默认仅删除 YOYO 自己的程序和配置，不会卸载系统级软件包（例如不会执行 `dnf remove nginx`）。

---

## 2. 交互式一键卸载（推荐）

在需要卸载的 VPS 上执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/shao-ye/secure-streaming-platform/master/vps-server/scripts/vps-uninstall.sh)
```

> 如果你在自己的账号下 Fork 了仓库，可以将上面的 `shao-ye/secure-streaming-platform` 替换为你的 GitHub 仓库路径。

### 2.1 顶层模式选择

脚本启动后，会先打印版本信息与当前运行参数，然后在 **交互模式** 下询问整体模式：

- **仅卸载服务并保留数据（默认）**
  - 删除程序目录：`/opt/yoyo-transcoder`；
  - **保留** HLS 目录：`/var/www/hls`；
  - **保留** 日志目录：`/var/log/yoyo-transcoder`；
  - 不清理 `cloudflared` systemd 服务，只给出提示。

- **彻底清除（含数据）**
  - 在你确认后，会进入「彻底清除模式」，可选择删除：
    - 程序目录：`/opt/yoyo-transcoder`；
    - HLS 目录：`/var/www/hls`；
    - 日志目录：`/var/log/yoyo-transcoder`；
    - 以及 YOYO 使用的 `cloudflared` systemd 服务配置。

### 2.2 环境检查

在真正删除前，脚本会做一次简单的环境检查，并输出检测结果：

- 是否存在程序目录：`/opt/yoyo-transcoder`；
- 是否存在 HLS 目录：`/var/www/hls`；
- 是否存在日志目录：`/var/log/yoyo-transcoder`；
- 是否存在 YOYO 的 Nginx 配置：`/etc/nginx/conf.d/yoyo-transcoder.conf`。

如果所有这些都不存在，会提示「可能已经卸载过或尚未安装」。

### 2.3 逐项确认的 4 类资源

在交互模式下，脚本会对以下 4 类资源做 **逐项确认**，你可以根据实际情况选择是否删除。所有确认问题都可以通过输入 `Y`/`y` 或 `N`/`n` 来回答，直接回车会使用默认值（通常是 `Y`）。

#### 2.3.1 PM2 进程（`stop_pm2`）

- 当检测到系统安装了 `pm2` 时，脚本会询问：

  ```text
  检测到 PM2 进程名称为 yoyo-transcoder，是否停止并从 PM2 中删除？[Y/n]
  ```

- 选择 `Y`（或直接回车）：
  - 执行 `pm2 stop yoyo-transcoder`；
  - 执行 `pm2 delete yoyo-transcoder`；
  - 执行 `pm2 save`；

- 选择 `N`：
  - 保留 PM2 中的 `yoyo-transcoder` 进程与配置，脚本只会给出警告提示，不再对 PM2 做删除操作。

#### 2.3.2 Nginx 配置（`remove_nginx`）

- 当检测到 YOYO 的 Nginx 配置文件存在时：

  ```text
  检测到 YOYO 的 Nginx 配置（/etc/nginx/conf.d/yoyo-transcoder.conf），是否删除并重载 Nginx？[Y/n]
  ```

- 选择 `Y`：
  - 删除 `/etc/nginx/conf.d/yoyo-transcoder.conf`；
  - 若系统存在 `nginx` 命令，则执行 `nginx -t` 检测配置，并执行 `systemctl reload nginx` 重载服务；

- 选择 `N`：
  - 保留该配置文件，不删除、不重载 Nginx；
  - 仅输出一条警告提示，说明你选择了保留配置。

> 中文注释：这样可以减少对其他站点/程序复用同一 Nginx 的影响。

#### 2.3.3 Cloudflared systemd 服务（`remove_cloudflared`）

> **仅在你选择了 `--purge` 模式（彻底清除）时才会调用此步骤。**

- 当检测到 `/etc/systemd/system/cloudflared.service` 存在时：

  ```text
  检测到 cloudflared systemd 服务配置，是否停止并移除？[Y/n]
  ```

- 选择 `Y`：
  - 使用 `systemctl stop cloudflared` 停止服务；
  - 使用 `systemctl disable cloudflared` 禁用服务；
  - 删除 `/etc/systemd/system/cloudflared.service`；
  - 执行 `systemctl daemon-reload` 重新加载 systemd 配置；

- 选择 `N`：
  - 保留 cloudflared 的 systemd 服务配置，不做进一步删除；
  - 脚本只输出一条警告提示。

> 中文注释：脚本只移除 systemd 服务单元文件，不会删除 `cloudflared` 可执行文件本身。

#### 2.3.4 程序与数据目录（`remove_files`）

根据你在顶层模式选择的是“保留数据”还是“彻底清除”，脚本对目录的处理会有所不同：

##### 保留数据模式（默认）

- 仅对程序目录 `INSTALL_DIR=/opt/yoyo-transcoder` 进行确认：

  ```text
  检测到程序目录 /opt/yoyo-transcoder，是否删除？[Y/n]
  ```

- 选择 `Y`：删除该目录；
- 选择 `N`：保留该目录，脚本只输出一条警告提示。

> HLS 与日志目录在此模式下 **始终保留**，不会被删除。

##### 彻底清除模式（`--purge`）

在彻底清除模式下，脚本会对以下目录分别进行确认：

- 程序目录：`/opt/yoyo-transcoder`
- HLS 目录：`/var/www/hls`
- 日志目录：`/var/log/yoyo-transcoder`

示例提示：

```text
检测到程序目录 /opt/yoyo-transcoder，是否删除？[Y/n]
检测到 HLS 目录 /var/www/hls，是否删除？[Y/n]
检测到日志目录 /var/log/yoyo-transcoder，是否删除？[Y/n]
```

- 你可以对每一项单独选择是否删除；
- 脚本会汇总所有你选择删除的目录，并一次性执行 `rm -rf`；
- 如果你全部选择保留，脚本会提示“未选择删除任何目录（程序/数据均已保留）”。

---

## 3. 非交互/自动化卸载示例

对于自动化脚本或 CI 场景，你可以使用 **本地脚本文件 + 非交互模式**：

```bash
# 先确保你已经在服务器上克隆了仓库，并进入 vps-server/scripts 目录
cd /path/to/secure-streaming-platform/vps-server/scripts

# 完全清除（含程序 + HLS + 日志 + cloudflared systemd），不进行交互确认
bash vps-uninstall.sh --purge --non-interactive
```

说明：

- `--purge`：表示彻底清除，会在不询问的情况下删除程序与数据目录，并清理 cloudflared systemd；
- `--keep-data`（或默认不带 `--purge`）：只删除 `/opt/yoyo-transcoder` 程序目录，保留 HLS 与日志目录。

> 中文注释：非交互模式适合脚本化运维，使用前建议先在交互模式下体验一遍整个卸载流程，确认行为符合预期。

---

## 4. 卸载结果自检建议

卸载脚本运行完成后，建议在 VPS 上做一次自查，确认环境与预期一致。

### 4.1 检查程序与数据目录

```bash
# 检查程序与数据目录是否仍存在（不存在会报错到 stderr，可忽略）
ls -ld /opt/yoyo-transcoder /var/www/hls /var/log/yoyo-transcoder 2>/dev/null
```

- 若目录不存在，说明已被成功删除；
- 若目录仍然存在，说明你在交互过程中选择了保留或脚本未对其进行删除。

### 4.2 检查 Nginx 配置

```bash
# 检查 YOYO 的 Nginx 配置是否已删除
ls -l /etc/nginx/conf.d/yoyo-transcoder.conf 2>/dev/null
```

- 无输出或提示文件不存在：说明配置已被删除；
- 有文件信息输出：说明配置仍存在，你可以根据需要手动编辑或删除。

### 4.3 检查 PM2 状态

```bash
# 检查 PM2 中是否仍有 yoyo-transcoder 进程
pm2 list
```

- 若列表中已无 `yoyo-transcoder` 项，说明 PM2 进程已被成功停止并删除；
- 若仍然存在，可能是你在交互过程中选择了保留，也可以手动执行：

  ```bash
  pm2 stop yoyo-transcoder
  pm2 delete yoyo-transcoder
  pm2 save
  ```

---

## 5. 注意事项

- 脚本只会操作 YOYO 相关的目录与配置：
  - 程序目录：`/opt/yoyo-transcoder`；
  - HLS 目录：`/var/www/hls`；
  - 日志目录：`/var/log/yoyo-transcoder`；
  - Nginx 配置：`/etc/nginx/conf.d/yoyo-transcoder.conf`；
  - `cloudflared` 的 systemd 服务单元：`/etc/systemd/system/cloudflared.service`。

- 脚本 **不会卸载系统级软件包**，例如不会调用 `dnf remove nginx` 或 `apt-get remove nginx`，以避免影响同机上的其他站点或服务。

- 在生产环境操作前，建议先在测试环境演练一次卸载流程，熟悉交互提示和实际效果。
