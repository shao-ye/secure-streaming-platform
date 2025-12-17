# YOYO 安全实时直播与监控平台部署指南（Cloudflare + VPS）

> 本文档面向希望在自己 VPS + Cloudflare 环境中部署本项目的用户。
> 适用于家庭、校园、门店、机房等多种实时监控与直播场景。

---

## 1. 系统与架构概览

- **前端 Web**：授权用户/管理员使用的浏览界面（推荐部署到 Cloudflare Pages）。
- **Cloudflare Workers**：统一的 API 网关 + 鉴权 + HLS 隧道代理。
- **VPS 转码服务**：运行在 VPS 上的转码 + HLS 服务（Node.js + FFmpeg + Nginx）。
- **Cloudflare Tunnel（可选，推荐）**：将 VPS 的 HLS/API 暴露给 Worker，而无需在防火墙上开放 VPS 端口。

> 建议整体架构为：浏览器 → Cloudflare Pages（前端）→ Cloudflare Workers（API/HLS 代理）→ Cloudflare Tunnel → VPS（Nginx + Node.js + FFmpeg）。

---

## 2. 域名与角色规划

以下是**推荐的占位示例**，请用你自己的域名替换 `your-domain.com`：

- `https://yoyo.your-domain.com`  
  前端访问域名（授权用户/管理员访问的地址）。

- `https://yoyoapi.your-domain.com`  
  绑定到 Cloudflare Worker，用作 **API + HLS 隧道入口**（下文称 *Workers API 域名*）。

- `https://tunnel.your-domain.com`（可选，但推荐）  
  Cloudflare Tunnel 的 Public Hostname，指向 VPS 上 Nginx 端口（默认 52535）。

- （可选直连）`https://yoyo-vps.your-domain.com`  
  如需“绕过 Cloudflare Tunnel 的直连模式”，可以额外配置到 VPS/Nginx。

后文统一使用以下占位：

- `FRONTEND_DOMAIN = https://yoyo.your-domain.com`
- `WORKER_DOMAIN / WORKERS_API_URL = https://yoyoapi.your-domain.com`
- `VPS_API_URL = https://tunnel.your-domain.com`

---

## 3. 前置条件

- 一台国外 VPS（推荐）：
    - Linux：Ubuntu 20+ / Debian 11+ / CentOS 7+
    - 内存建议 ≥ 2G
    - 拥有 `root` 或 sudo 权限
- 一个已接入 Cloudflare 的域名（已把 NS 修改到 Cloudflare）
- GitHub 账号（用于 Fork 本仓库）
- Cloudflare 账号，并已开启 Workers & Pages / Zero Trust（如需 Tunnel）

---

## 4. 部署步骤总览

1. **Fork GitHub 仓库并获取代码**
2. **在 Cloudflare 中接入域名并配置 DNS 解析**
3. **部署 Cloudflare Pages 前端，并配置环境变量**
4. **部署 Cloudflare Workers API 网关，并配置环境变量与密钥**
5. **在 VPS 上运行一键部署脚本，完成转码服务部署（可选使用 Cloudflare Tunnel）**
6. **初始化系统，并登录管理后台完成频道/预加载等配置**

> 下文将按以上顺序展开说明。

---

## 5. 步骤一：Fork 仓库并获取代码

1. 在浏览器中打开本项目的 GitHub 页面：[https://github.com/shao-ye/secure-streaming-platform](https://github.com/shao-ye/secure-streaming-platform)。
2. 如下图所示，在页面右上角点击 **Fork** 按钮（标记为 ①），将仓库 Fork 到你自己的 GitHub 账号下。
3. Fork 完成后，GitHub 会自动跳转到你自己账号下的仓库页面，地址类似：`https://github.com/<your-account>/secure-streaming-platform`，<your-account>是你自己的github账号。你也可以顺手点一下 **Star**（标记为 ②），方便以后在 GitHub 中快速找到这个仓库。
4. 记住这个新仓库的地址，后续在 Cloudflare Pages、VPS 一键脚本等界面中，只需要在表单里填写这个地址即可，全程通过网页完成配置，不需要在自己电脑上安装 Git 或执行命令行。

![ScreenShot_2025-12-12_121611_576.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_121611_576.png)
> **说明**：本部署指南默认用户只需要通过浏览器网页操作即可完成部署；如果你是进阶用户，也可以根据需要在本地克隆这个仓库进行二次开发，但这不是必需步骤。

---

## 6. 步骤二：在 Cloudflare 中配置域名与 DNS

1. 登录 Cloudflare Dashboard，确保你的根域名（如 `your-domain.com`）已经接入。
2. 在 **DNS** 页面确认：
    - 可以创建子域名 `yoyo.your-domain.com`、`yoyoapi.your-domain.com`、`tunnel.your-domain.com`；
    - 一般情况下，Workers 自定义域名和 Tunnel Public Hostname 会自动为你创建对应 DNS 记录，你只需要在对应功能里选好域名即可。
      ![ScreenShot_2025-12-12_121828_289.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_121828_289.png)
典型配置思路：

- `yoyo.your-domain.com`：
    - 作为前端访问域名，用于绑定到 Cloudflare Pages 项目；
    - 在 Pages 项目中添加自定义域名后，Cloudflare 会自动创建 CNAME 记录。

- `yoyoapi.your-domain.com`：
    - 作为 Workers API 对外域名，在 Workers 中添加自定义域名时选择；
    - Cloudflare 会为你创建一条指向 Worker 的 DNS 记录。

- `tunnel.your-domain.com`（可选）：
    - 在 Cloudflare Zero Trust 的 Tunnel 配置中，添加 Public Hostname 时选择该子域名；
    - Cloudflare 也会自动管理对应 CNAME 记录。

> 如果你不熟悉 Cloudflare DNS 细节，可以优先通过 Workers/Pages/Tunnel 的向导添加自定义域名，Cloudflare 一般会帮你创建所需记录。

---

## 7. 步骤三：部署 Cloudflare Pages（前端）

前端源码位于仓库的 `frontend` 目录。

### 7.1 通过 Git 集成创建 Pages 项目

1. 登录 Cloudflare Dashboard → 计算和AI ① → Workers和Pages ② → **创建应用程序** ③。
   ![ScreenShot_2025-12-12_122103_820.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_122103_820.png)
2. 点击 **Get started** ①，调整Pages创建页面。
   ![ScreenShot_2025-12-12_122309_261.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_122309_261.png)
3. 选择 **导入现有Git存储库**，点击‘**开始使用**’①，授权访问你 Fork 后的 GitHub 仓库。
   ![ScreenShot_2025-12-12_122437_037.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_122437_037.png)
4. 选择包含本项目的Git仓库，选择刚才Fork的项目①，点击‘**开始设置**’②。
   ![ScreenShot_2025-12-12_122753_119.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_122753_119.png)
5. ‘**框架预设**’选择 ‘**Vue**’①,会自动填充下面的‘**构建命令**’和‘**构建输出目录**’的值，点击‘**根目录（高级）**’，‘**路径**’里输入`frontend`②，然后点击‘**保存并部署**’③ 。
   ![ScreenShot_2025-12-12_123315_042.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_123315_042.png)
6. 等待部署完成，点击 **继续处理项目** ①查看项目。
   ![ScreenShot_2025-12-12_124802_852.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_124802_852.png)
7. 

### 7.2 配置Pages自定义域

1. 在部署完成的Pages项目中，点击 **自定义域** ①，进入自定义域设置页面，点击 **设置自定义域** ②。
   ![ScreenShot_2025-12-12_125301_045.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_125301_045.png)
2. 输入前面准备好的自定义域名，设置子域为 `yoyo.your-domain.com`，点击 **继续** ③（`your-domain.com` 替换成你的域名）。
   ![ScreenShot_2025-12-12_125804_851.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_125804_851.png)
3. 点击 **激活域** ①，等待完成。
   ![ScreenShot_2025-12-12_130131_994.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_130131_994.png)
4. 在浏览器中访问刚才设置的自定义域名 `https://yoyo.your-domain.com`，如果显示如下页面，则说明部署成功。
   ![ScreenShot_2025-12-12_130337_968.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_130337_968.png)

### 7.3 环境变量（推荐配置）

1. 在部署完成的Pages项目中，点击 **设置** ①，进入设置页面，点击 **变量和机密** ②，在‘**变量和机密**’标签下，点击**‘+添加’**按钮，如下变量，下面有添加后的图示。

其中`VITE_API_BASE_URL`、`VITE_HLS_PROXY_URL`、`VITE_WORKER_URL`这三个变量与workers配置的域名地址相关，等workers配置完成后，再进行配置。

![ScreenShot_2025-12-12_131130_177.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_131130_177.png)

| Key                  | 示例值                                                       | 说明                       |
|----------------------|--------------------------------------------------------------|--------------------------|
| `VITE_API_BASE_URL`  | `https://yoyoapi.your-domain.com`                           | 后端 API 基础 URL（Worker 域名） |
| `VITE_HLS_PROXY_URL` | `https://yoyoapi.your-domain.com/hls`                       | HLS 播放代理 URL             |
| `VITE_WORKER_URL`    | `https://yoyoapi.your-domain.com`                           | Cloudflare Worker 对外访问域名 |
| `VITE_APP_TITLE`     | `YOYO流媒体平台`                                            | 前端应用标题                   |
| `VITE_APP_VERSION`   | `1.0.0`                                                      | 应用版本号                    |
| `VITE_ENVIRONMENT`   | `production`                                                 | 运行环境标识                   |
| `VITE_DEBUG`         | `false`                                                      | 是否启用调试日志                 |
| `VITE_LOG_LEVEL`     | `error`                                                      | 日志级别（debug/info/warn/error） |

> 请使用你自己的域名替换 `your-domain.com`，不要在开源仓库中提交真实域名配置。

![ScreenShot_2025-12-12_172429_441.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_172429_441.png)

部署完成后，可以在 Pages 项目中为其绑定 `yoyo.your-domain.com` 作为前端最终访问域名。

---

## 8. 步骤四：部署 Cloudflare Workers（API 网关）

### 8.1 创建 KV 与 R2（可选但推荐）

1. （必须）创建 KV 存储资源，登录 Cloudflare Dashboard → 存储和数据库 ① → Workers KV ② → **Create Instance** ③。
   ![ScreenShot_2025-12-12_134328_038.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_134328_038.png)
2. **命名空间名称**输入 `YOYO_USER_DB` ①，点击 **创建** 按钮②。（存储用户、频道、预加载/录制配置等）
   ![ScreenShot_2025-12-12_134720_062.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_134720_062.png)
3. （如需）创建 R2 存储资源，登录 Cloudflare Dashboard → 存储和数据库 → R2对象存储  → 概述 ① → **创建存储桶** ②。
   ![ScreenShot_2025-12-12_135344_495.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_135344_495.png)
4. **存储桶名称**输入 `login-logs`（可随便输入） ①，点击 **创建存储桶** 按钮②。（登录日志）
   ![ScreenShot_2025-12-12_135925_002.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_135925_002.png)
5. （可选）然后再退出来重新进入创建第二个存储桶，**存储桶名称**输入 `proxy-test-history`（可随便输入） ①，点击 **创建存储桶** 按钮②。（代理诊断记录）
   ![ScreenShot_2025-12-12_140202_848.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_140202_848.png)

### 8.2 创建 Tunnel（可选但推荐）

1. 登录 Cloudflare Dashboard → Zero Trust ① 。
   ![ScreenShot_2025-12-12_150212_719.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_150212_719.png)
2. 进入 **Zero Trust** 页面后，点击左侧菜单 **网络** → **连接器** ②  → **创建隧道** 按钮 ③。
      ![ScreenShot_2025-12-12_150842_739.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_150842_739.png)
3. 点击 **选择Cloudflared** ①。
   ![ScreenShot_2025-12-12_151210_824.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_151210_824.png)
4. 填写 **隧道名称** 输入 `yoyo-tunnel`（可随便输入） ①，点击 **保存隧道** 按钮③。
   ![ScreenShot_2025-12-12_151523_320.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_151523_320.png)
5. 点击 **4.运行以下命令** 后面的复制按钮 ①，粘贴到记事本中记录秘钥，后面部署VPS时需要用到，然后点击 **下一步** 按钮 ②。
   ![ScreenShot_2025-12-12_151918_506.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_151918_506.png)
6. 设置填写 **子域** 输入 `tunnel`（可随便输入） ①，**域** 选择前面准备好的域名 ②， **类型** 选择 **HTTP** ③，**URL** 输入 `127.0.0.1:52535` ④，（52535是部署VPS的默认端口，可以自定义，后面部署VPS时需要保持一致），点击 **完成设置** 按钮。
   ![ScreenShot_2025-12-12_152531_257.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_152531_257.png)

后面步骤中会将创建的资源绑定到 Workers。

Workers 代码位于仓库的 `cloudflare-worker` 目录。

### 8.2 创建 Worker 并部署代码

1. 登录 Cloudflare Dashboard → 计算和AI ① → Workers和Pages ② → **创建应用程序** ③。
   ![ScreenShot_2025-12-12_122103_820.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_122103_820.png)
2. 点击 **Continue with GitHub** ①，调整 Workers 创建页面。
   ![ScreenShot_2025-12-12_131747_990.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_131747_990.png)
3. 选择包含本项目的Git仓库，选择刚才Fork的项目①，点击‘**下一步**’②。
   ![ScreenShot_2025-12-12_132032_646.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_132032_646.png)
4. 在 Cloudflare 这个“创建 Worker（Git 集成）”页面中，可以这样填：

    项目名称：yoyo-streaming-worker（或默认）

   ① 构建命令：npm install

   ② 部署命令：npx wrangler deploy

   ③ 非生产分支支持构建：先关闭

   ④路径： cloudflare-worker
    
    其他默认即可，点击页面下方的 **部署**按钮等待部署完成。
   ![ScreenShot_2025-12-12_133409_505.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_133409_505.png)
5. 部署成功后进入Workers 的 **绑定**页面，点击**绑定**按钮。
   ![ScreenShot_2025-12-12_141119_448.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_141119_448.png)
6. 点击 **添加绑定** 页面左侧菜单中的 **KV命名空间**① ，然后点击 **添加绑定** ② 按钮。 
   ![ScreenShot_2025-12-12_141437_674.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_141437_674.png)
7. 填写 **变量名称** 输入 `YOYO_USER_DB` ①，**KV命名空间** 选择之前创建好的KV ②，点击 **添加绑定** 按钮③。
   ![ScreenShot_2025-12-12_141750_313.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_141750_313.png)
8. 添加成功后再继续添加 R2 存储桶。继续点击 **绑定** ①，然后点击 **添加绑定** ②。
   ![ScreenShot_2025-12-12_142117_561.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_142117_561.png)
9. 点击 **添加绑定** 页面左侧菜单中的 **R2存储桶**① ，然后点击 **添加绑定** ② 按钮。
   ![ScreenShot_2025-12-12_142332_652.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_142332_652.png)
10. 填写 **变量名称** 输入 `LOGIN_LOGS` ①，**R2存储桶** 选择之前创建好的存储桶`login-logs` ②，点击 **部署** 按钮③。
    ![ScreenShot_2025-12-12_142642_804.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_142642_804.png)
11. 同样的方式添加第二个 R2 存储桶。填写 **变量名称** 输入 `PROXY_TEST_HISTORY` ①，**R2存储桶** 选择之前创建好的存储桶`proxy-test-history` ②，点击 **部署** 按钮③。
    ![ScreenShot_2025-12-12_143135_794.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_143135_794.png)
12. 


4. 在 Worker 的 **Triggers → Custom Domains** 中，为其绑定 `https://yoyoapi.your-domain.com`。



### 8.3 配置 Worker 环境变量

在 Worker 的 **Settings → Variables** 中添加：
#### 8.3.1 Workers域名绑定

1. 进入Workers 的 **设置** ① 页面，点击**域和路由**的 **+添加** ② 按钮。
   ![ScreenShot_2025-12-12_143356_319.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_143356_319.png)
2. 选择 **自定义域** ①。
   ![ScreenShot_2025-12-12_144020_658.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_144020_658.png)
3. 输入前面准备好的自定义域名，设置子域为 `yoyoapi.your-domain.com`，点击 **添加域** ③，（`your-domain.com` 替换成你的域名）。
   ![ScreenShot_2025-12-12_144225_994.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_144225_994.png)
4. 在浏览器中访问该域名，如果出现如下页面则说明绑定成功。**（Workers域名配置完成后，别忘了要回到之前配置好的Pagers中补充遗留的三个环境变量对Workers域名绑定）**
   ![ScreenShot_2025-12-12_144652_703.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_144652_703.png)

#### 8.3.2 业务相关变量（普通变量）

1. 继续在Workers项目 **设置** 页面中，点击 **变量和机密** ②，在 **变量和机密** 后面的 **添加** 按钮，如下变量，下面有添加后的图示。
   ![ScreenShot_2025-12-12_144954_749.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_144954_749.png)

| Key               | 示例值                              | 说明                                      |
|-------------------|-------------------------------------|-------------------------------------------|
| `FRONTEND_DOMAIN` | `https://yoyo.your-domain.com`      | 前端访问域名，用于 CORS 校验             |
| `PAGES_DOMAIN`    | `https://yoyo.pages.dev`（可选）    | 如前端托管在 Pages 默认域名时填写         |
| `WORKER_DOMAIN`   | `https://yoyoapi.your-domain.com`   | Worker 对外访问域名，用于生成 HLS 播放 URL |
| `VPS_API_URL`     | `https://tunnel.your-domain.com`    | Worker 通过 Tunnel 访问 VPS API/Nginx    |

> 其中 `VPS_API_URL` 一般指向 Cloudflare Tunnel 的 Public Hostname（如 `tunnel.your-domain.com`），Worker 会通过该地址访问 VPS 上的 Nginx/API。

#### 8.3.3 安全相关变量（建议配置为 Secret）

下列敏感信息建议在 Cloudflare Dashboard 中使用 **Secret** 类型保存：

| Key                        | 说明                                                           |
|----------------------------|--------------------------------------------------------------|
| `VPS_API_KEY`              | Worker 访问 VPS API 时使用的鉴权密钥，由 VPS 一键脚本生成                      |
| `EMERGENCY_ADMIN_USERNAME` | 紧急管理员账号用户名，不设置默认 `admin`                                       |
| `EMERGENCY_ADMIN_PASSWORD` | 紧急管理员账号初始密码，用于首次登录管理后台                                       |
| `INIT_SECRET`              | 调用 `/api/admin/init` 初始化接口时使用的安全 Token，对应请求头 `X-Init-Secret` |

> 其中 `VPS_API_KEY`是在部署完VPS后生成的，后续再进行添加。

1. 可以先添加这些变量，如图所示。
   ![ScreenShot_2025-12-12_154159_198.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_154159_198.png)

##### 使用 INIT_SECRET 执行初始化

配置好 `INIT_SECRET` 后，可以通过类似下面的命令初始化系统（一般只需执行一次）。

接口会根据 Worker 配置自动创建管理员账号、初始化 KV 索引等。初始化完成后，请妥善保管或更新相关密钥。

1. 可以通过浏览器访问 `https://<yoyoapi.your-domain.com>/api/admin/init/<INIT_SECRET>` 初始化系统, `<yoyoapi.your-domain.com>`要替换成你的workers配置的域名，`<INIT_SECRET>`要替换成你在workers中配置的`<INIT_SECRET>`变量，如下图所示。
   ![ScreenShot_2025-12-12_154819_472.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_154819_472.png)

2. 也可以通过命令行执行初始化：
```bash
curl "https://yoyoapi.your-domain.com/api/admin/init" \
  -H "X-Init-Secret: <INIT_SECRET>"
```

3. 完成管理员账号密码初始化后，就可以通过配置好的Pagers域名访问页面进行登录系统了。
   ![ScreenShot_2025-12-15_133025_547.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-15_133025_547.png)
4. 使用workers中配置的`EMERGENCY_ADMIN_PASSWORD`变量密码登录系统，即可完成登录，登录成功后就可以删除workers中配置的`INIT_SECRET`变量和`EMERGENCY_ADMIN_USERNAME`变量（如果配置了的话）和`EMERGENCY_ADMIN_PASSWORD`变量了（admin的账号和密码已经被写到了kv中，所以可以删除了，如果想修改admin的密码的话，可以到kv中修改admin的密码，重新添加workers配置中的`INIT_SECRET`变量和`EMERGENCY_ADMIN_PASSWORD`变量，再次执行初始化接口即可）。
   ![ScreenShot_2025-12-12_171852_478.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_171852_478.png)


## 9. 步骤五：部署 VPS 转码服务（一键脚本）

VPS 端代码位于仓库的 `vps-server` 目录，你可以通过一键脚本在 VPS 上完成安装与配置。

### 9.1 连接到 VPS

登录 VPS

```bash
ssh root@your-vps-ip
```

### 9.2 执行一键部署脚本

在 VPS 上执行（以实际仓库地址为准，可放在你自己的 GitHub 仓库）：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/shao-ye/secure-streaming-platform/master/vps-server/scripts/vps-oneclick.sh)
```

也可以执行你自己Fork到自己的仓库中的一键部署脚本，将下方命令 `<your-account>`替换成你的账号：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/<your-account>/secure-streaming-platform/master/vps-server/scripts/vps-oneclick.sh)
```

脚本将自动完成：

- 安装 Node.js 18 / FFmpeg / Nginx / PM2；
- 下载 `vps-server` 子目录代码到 `/opt/yoyo-transcoder`；
- 生成 `.env` 配置文件；
- 启动 `vps-transcoder-api`（默认监听 `3000`，仅本机访问）；
- 生成 Nginx 配置，默认监听 `52535` 端口。

### 9.3 交互参数说明（重点）

脚本会依次询问：

- **API 端口**（默认 `3000`）：
    - Node.js API 内部监听端口；
    - 仅本机访问，无需对外开放防火墙端口。

- **Nginx 暴露端口**（默认 `52535`）： (如果前面创建的隧道tunnel时填写了其他端口，这个地方要与创建的隧道tunnel的端口一致)
    - Cloudflare Tunnel / 直连都连到这个端口；
    - 若只使用 Tunnel，可以在防火墙中仅允许 `cloudflared` 本地访问。

- **是否安装 Cloudflare Tunnel（Token）**：
    - 如果选择 `y`，需要粘贴 Cloudflare Zero Trust 中 Tunnel 的 Token；（前面创建的隧道tunnel时保存到记事本文件中的秘钥）
    - 脚本会自动安装并启动 `cloudflared`。

- **Tunnel Hostname（可选）**：
    - 用于自动健康检查，例如 `tunnel.your-domain.com`；（前面创建的隧道tunnel域名）
    - 建议与上文 `VPS_API_URL` 对应。

- **Cloudflare Worker API URL（非常关键）**：
    - 请输入：`https://yoyoapi.your-domain.com`；（前面创建的workers域名）
    - 写入 `.env` 中的 `WORKERS_API_URL`，用于 VPS 反向调用 Worker（读取预加载/录制配置等）。

> 如果这里直接回车使用默认占位值：
> - 直播基础播放 **不会受影响**；
> - 但 VPS 无法从 Worker 读取预加载/录制配置，高级调度功能会失效；
> - 后续可在 `/opt/yoyo-transcoder/.env` 中修改 `WORKERS_API_URL`，再执行：
>
> ```bash
> pm2 restart vps-transcoder-api --update-env
> ```
 
 1. VPS执行一键部署脚本执行过程与输入内容如下图所示，安装脚本执行完成后，需要将脚本输出的`VPS_API_KEY`和`VPS_API_URL` ① 的值添加到workers的环境变量中。：
 
 ![ScreenShot_2025-12-12_174307_264.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_174307_264.png)

2. 登录 Cloudflare Dashboard → 计算和AI ① → Workers和Pages ② → 选择之前创建的 workers ③。
   ![ScreenShot_2025-12-12_175020_380.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_175020_380.png)
3. 添加 workers 环境变量配置，将脚本输出的`VPS_API_KEY`和`VPS_API_URL`添加到 **变量和密钥** 中，`VPS_API_KEY`的 **类型** 推荐选为 **密钥**类型，防止密钥泄露。
   ![ScreenShot_2025-12-12_175429_014.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_175429_014.png)

### 9.4 防火墙与端口策略

- **无需对外开放 3000 端口**（Node.js API 内部端口，仅 Nginx 访问）。
- 对外通常只需：
    - 允许 Cloudflare Tunnel 进程访问 `127.0.0.1:52535`；
    - 若确有直连需求，可考虑开放 52535，对应 `https://yoyo-vps.your-domain.com` 之类的直连域名（生产环境更推荐只通过 Cloudflare 访问）。

---

## 10. 步骤六：初始化与验证

### 10.1 初始化 Worker 配置

参考上文 **8.3.2 使用 INIT_SECRET 执行初始化**，调用：（前面部署过程执行过此步骤即可省略）

```bash
curl "https://yoyoapi.your-domain.com/api/admin/init" \
  -H "X-Init-Secret: <INIT_SECRET>"
```

### 10.2 登录管理后台

1. 在浏览器访问前端域名：`https://yoyo.your-domain.com`；
2. 使用紧急管理员账号（或初始化后生成的账号）登录；
   初始化成功后，会在 KV 中写入必要配置，并创建管理员账号，Workers中配置的`INIT_SECRET`变量和`EMERGENCY_ADMIN_USERNAME`变量（如果配置了的话）和`EMERGENCY_ADMIN_PASSWORD`变量即可删除，以免信息泄露。

    在 **后台管理** → **用户管理** 页面可以添加删除普通用户账号，并为其设置密码。

    ![ScreenShot_2025-12-12_181557_884.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_181557_884.png)
3. 在“频道管理”中添加 RTMP 源地址、频道名称与排序；
   ![ScreenShot_2025-12-12_182137_472.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_182137_472.png)
   
4. 在“预加载与录制配置”中按工作日/时间段配置调度策略。
   
    可以单独为频道设置是否需要进行预加载与录制，并设置预加载与录制时长，也可以设置播放视频比例。
   ![ScreenShot_2025-12-12_182341_331.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_182341_331.png)
   也可以为所有频道统一设置，录制的视频文件保存时长，进行统一清理，以及是否启用视频分段录制，防止单个视频文件过大。
   ![ScreenShot_2025-12-12_182931_784.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_182931_784.png)

### 10.3 验证 HLS 播放（隧道优化）

1. 选择一个已配置 RTMP 的频道，开始向 VPS 推流；
   ![ScreenShot_2025-12-14_104100_096.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-14_104100_096.png)
2. 在前端选择该频道，开启“隧道优化”播放；
   ![ScreenShot_2025-12-12_183614_543.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_183614_543.png)
3. 打开浏览器开发者工具，检查：
    - HLS 请求类似：
      `https://yoyoapi.your-domain.com/tunnel-proxy/hls/<channelId>/playlist.m3u8`；
    - `.ts` 分片返回状态码为 `200`；
    - 无明显 CORS 错误。

---

## 11. 常见问题（FAQ）

### Q1：VPS 上需要开放 3000 端口吗？

- **不需要，且不建议对外开放。**
- 3000 是 Node.js API 内部端口，仅供 Nginx（本机 `127.0.0.1`）访问。
- 对外只需：
    - Cloudflare Tunnel 连到 Nginx 端口（默认 52535）；
    - 若使用直连模式，则开放 52535 即可。

### Q2：一键脚本时忘记正确填写 Worker API URL 怎么办？

1. 编辑 VPS `.env`：

   ```bash
   nano /opt/yoyo-transcoder/.env
   # 修改为：
   WORKERS_API_URL=https://yoyoapi.your-domain.com
   ```

2. 重启服务并加载新环境：

   ```bash
   pm2 restart vps-transcoder-api --update-env
   ```

### Q3：如何排查播放异常？

- 在浏览器打开开发者工具 → Network 面板：
    - 检查 HLS `.m3u8` 和 `.ts` 请求是否都返回 200；
    - 检查请求域名是否都是 `yoyoapi.your-domain.com`（而不是 VPS 直连 IP）。
- 在 VPS 上查看日志：

  ```bash
  pm2 status
  pm2 logs vps-transcoder-api --lines 50 --nostream
  ```

- 在 Cloudflare Dashboard 查看 Workers 日志，关注是否有 CORS 或鉴权相关错误。

---

## 12. 后续维护与升级

- **更新 VPS 端代码**：

  1. 在GitHub中 Sync fork 仓库，获取最新代码。
     ![ScreenShot_2025-12-12_184722_737.png](https://image.5202021.xyz/api/rfile/ScreenShot_2025-12-12_184722_737.png)
  
  2. 登录VPS，执行一键更新脚本：
    ```bash
  curl -fsSL https://raw.githubusercontent.com/shao-ye/secure-streaming-platform/master/vps-server/scripts/vps-oneclick.sh | bash -s -- --update
    ```

- **更新 Cloudflare Workers 端代码**（管理后台、频道配置、预加载/录制调度等逻辑都在 Workers 中）：

  说明：本项目 Workers 目录为 `cloudflare-worker/`，代码是多文件结构（`src/index.js` + `src/handlers/*`）。
  Workers 的“服务名/项目名”需要保持稳定，否则会出现“代码更新了，但变量/密钥像被清空”的现象。
  本项目默认服务名来自 `cloudflare-worker/wrangler.toml`：
  - `name = "secure-streaming-platform"`
  Git 自动部署/构建时会读取这里的 `name`，并将代码部署到同名 Worker 服务；变量/密钥也绑定在该 Worker 服务的 Production/Preview 环境上。

  方式 A：按部署文档的“页面操作 + Git 自动部署”方式更新（推荐）

  1. 在 GitHub 中 Sync fork / 或向你的仓库 push 新提交。
  2. Cloudflare Dashboard → 计算和 AI → Workers 和 Pages → 进入对应 Worker/项目。
  3. 在 Deployments / 部署记录中确认最新提交已触发新部署（通常会显示提交信息/时间）。

  重要：变量/密钥为什么会“丢”以及怎么避免

  - 变量/密钥不在代码仓库里，属于 Cloudflare 的环境配置。
  - 如果你发现“Sync fork 后自动部署了，但变量没了”，通常是以下原因之一：
    - 你查看的是 Preview/预览环境，但变量只配在 Production/生产环境（或反过来）。
    - 本次部署产物对应了另一个 Worker 名称/项目（例如 `wrangler.toml` 的 `name` 与你在页面里创建的 Worker 不一致），导致部署到“另一个 Worker”，另一个 Worker 自然没有变量。
    - Cloudflare 列表里同时存在 Pages 项目与 Worker 项目（名称可能相同），点错条目也会看到“没有变量”。

  变量/密钥正确配置位置（页面方式，适合小白）

  1. Cloudflare Dashboard → Workers 和 Pages → 进入对应 Worker/项目。
  2. 找到 Settings / 设置 → Variables and Secrets / 变量和密钥。
  3. 分别在 Production（生产）和 Preview（预览）（如果有）里配置需要的变量/密钥（至少包括）：
     - `VPS_API_URL`
     - `VPS_API_KEY`（建议用“密钥/Secret”类型）
  4. 保存后重新触发一次部署（或等待下一次 Git 推送自动部署），变量会随环境持续生效。

  方式 B：本地命令方式更新（稳定、可回滚）

  1. 在本地电脑安装 Node.js（建议 18+）。
  2. 拉取/下载仓库最新代码。
  3. 进入 `cloudflare-worker/` 目录执行：

     ```bash
     npm install
     npm run deploy
     ```

     如果你配置了 wrangler 的 production 环境，可执行：

     ```bash
     npm run deploy:production
     ```

  4. 注意：如果 `wrangler.toml` 的 `name` 与你页面上实际使用的 Worker 名称不一致，wrangler 会部署到另一个 Worker（表现为“变量丢失”）。
     如果你希望 Workers 在 Cloudflare 中显示为 `secure-streaming-platform`，需要把 `cloudflare-worker/wrangler.toml` 的 `name` 改为 `secure-streaming-platform` 并重新部署，然后再在该 Worker 的 Production/Preview 环境下配置变量/密钥。

- **调整预加载/录制策略**：
    - 直接在前端管理后台修改；
    - Worker 会更新 KV，VPS 调度服务会定期拉取最新配置。

- **监控与告警**：
    - 可以结合 Cloudflare Analytics、VPS 上的监控工具，构建自己的告警体系。
