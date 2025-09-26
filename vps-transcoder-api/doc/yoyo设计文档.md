好的，当然。基于我们已经确定的需求文档，下面是一份完整的、详细的技术设计文档。

这份文档将深入到技术细节，描述系统的各个组成部分将**如何**实现，包括组件设计、API接口、数据模型和关键的工作流程。

---

### **技术设计说明书 (Technical Design Document)**

项目名称: 多用户、多频道安全流媒体Web播放平台  
版本: 1.0  
日期: 2025年9月18日  
关联需求文档版本: 1.0

---

#### **1\. 引言**

##### **1.1. 文档目的**

本文档旨在为“多用户、多频道安全流媒体Web播放平台”项目提供详细的技术设计和实现方案。本文档基于V1.0版的需求规格说明书，将详细阐述系统架构、组件设计、数据模型、API接口和安全策略，作为开发团队后续开发、测试和部署工作的核心技术指南。

---

#### **2\. 系统架构设计**

系统采用前后端分离、职责分离的微服务思想进行设计，由三个核心部分组成：转码服务(VPS)、数据层(Cloudflare KV)和业务逻辑/Web层(Cloudflare Worker)。

*（这是一个描述性的图示链接，实际图内容如下）*

**架构图说明:**

1. **用户浏览器** 与 **Cloudflare Worker** 之间通过HTTPS进行所有通信。  
2. **Cloudflare Worker** 作为中心枢纽：  
   * 与 **Cloudflare KV** 进行交互，用于读写用户、会话和流配置数据。  
   * 向 **VPS转码服务** 的安全API发送指令（启动/停止转码）。  
   * 作为反向代理，将HLS视频流请求安全地转发给VPS上的Nginx服务。  
3. **VPS转码服务** 的IP地址不向公网暴露，仅允许来自Cloudflare IP段的流量，进一步增强安全性。

---

#### **3\. 组件详细设计**

##### **3.1. 转码服务 (VPS)**

* **技术栈:**  
  * 操作系统: Ubuntu 22.04 LTS (或其他Linux发行版)  
  * 核心工具: FFmpeg  
  * Web服务器: Nginx  
  * API服务: Node.js \+ Express.js  
* **API接口设计:**  
  * API服务监听本地3000端口。所有请求必须在Header中包含 X-API-Key 以进行认证。  
  * **Endpoint: POST /start-stream**  
    * **描述:** 接收指令，启动一个新的FFmpeg转码进程。如果同名streamId的进程已在运行，则会先终止旧进程再启动新进程。  
    * **Request Body (JSON):**  
      JSON  
      {  
        "streamId": "cam1",  
        "rtmpUrl": "rtmp://source.server/live/stream1"  
      }

    * **Success Response (200 OK):**  
      JSON  
      { "status": "success", "message": "Stream cam1 started." }

    * **Error Response (400/500):**  
      JSON  
      { "status": "error", "message": "Error description." }

* **进程管理:**  
  * Node.js服务内部将使用一个Map对象（runningStreams \= new Map())来存储和管理所有由child\_process.spawn创建的FFmpeg进程。Map的键为streamId，值为Process对象，以便于后续查询和终止。  
* **文件系统结构:**  
  * Nginx的Web根目录为/var/www/hls。  
  * 每个转码流将在该目录下创建一个与streamId同名的子目录，用于存放其.m3u8和.ts文件，例如：/var/www/hls/cam1/stream.m3u8。

##### **3.2. 数据存储 (Cloudflare KV)**

* **命名空间绑定:** 在Worker中绑定为 USER\_DB。  
* **数据模型:**  
  * **用户数据:**  
    * **Key:** user:{username} (e.g., user:admin)  
    * **Value (JSON):**  
      JSON  
      {  
        "username": "admin",  
        "salt": "a1b2c3d4...",  
        "hashedPassword": "e5f6g7h8...",  
        "role": "admin"   
      }

  * **会话数据:**  
    * **Key:** session:{sessionId} (e.g., session:uuid-v4-string)  
    * **Value (JSON):**  
      JSON  
      {  
        "sessionId": "uuid-v4-string",  
        "username": "admin",  
        "expiresAt": 1758169420000   
      }

    * **KV选项:** 设置TTL（生存时间）为24小时，使其自动过期。  
  * **流配置数据:**  
    * **Key:** streams\_config  
    * **Value (JSON Array):**  
      JSON  
      \[  
        { "id": "cam1", "name": "大厅摄像头", "rtmpUrl": "rtmp://..." },  
        { "id": "cam2", "name": "后院摄像头", "rtmpUrl": "rtmp://..." }  
      \]

##### **3.3. 业务逻辑与Web层 (Cloudflare Worker)**

* 路由设计:  
  | 路径 | 方法 | 权限 | 描述 |  
  | :--- | :--- | :--- | :--- |  
  | / | GET | 已登录用户 | 显示主页（频道列表或管理员面板） |  
  | /login | GET | 公开 | 显示登录页面HTML |  
  | /login | POST | 公开 | 处理登录表单提交 |  
  | /logout | POST | 已登录用户 | 清除会话并登出 |  
  | /api/streams | GET | 已登录用户 | 获取对用户可见的频道列表 |  
  | /api/play/:id | POST | 已登录用户 | 请求播放指定ID的频道 |  
  | /api/admin/streams | GET, POST | 管理员 | 获取或添加新的频道配置 |  
  | /api/admin/streams/:id| DELETE | 管理员 | 删除指定的频道配置 |  
  | /hls/\* | GET | 已登录用户 | 代理HLS视频流文件请求到VPS |  
* **核心工作流程 \- 用户请求播放 (POST /api/play/:id):**  
  1. **验证会话:** Worker首先验证请求Cookie中的sessionId是否有效。  
  2. **获取配置:** 从KV中读取streams\_config，根据URL中的:id找到对应的频道配置及其rtmpUrl。  
  3. **指令下发:** Worker使用fetch向VPS的POST /start-stream接口发送一个内部API请求。请求中包含streamId和rtmpUrl，并在Header中附上预设的X-API-Key。  
  4. **响应前端:** VPS确认启动成功后，Worker向用户浏览器返回一个JSON响应，其中包含可播放的HLS地址。  
     JSON  
     {  
       "status": "success",  
       "hlsUrl": "/hls/cam1/stream.m3u8"  
     }

  5. **开始播放:** 前端播放器收到此URL后，开始请求HLS文件，这些请求将被Worker的/hls/\*路由捕获并代理到VPS。

---

#### **4\. 前端设计**

* **技术栈:** 推荐使用Vue.js或React等现代JavaScript框架构建单页面应用(SPA)。视频播放核心库使用hls.js。  
* **组件划分:**  
  * App.vue: 应用根组件，管理整体布局和路由。  
  * Login.vue: 登录表单页面。  
  * Dashboard.vue: 用户登录后的主仪表板。  
  * StreamList.vue: 展示可播放的频道列表。  
  * VideoPlayer.vue: 封装hls.js的视频播放器组件。  
  * AdminPanel.vue: 管理员独有的功能区。  
  * StreamManager.vue: 管理员用于CRUD频道配置的组件。  
* **状态管理:** 使用Pinia (for Vue)或Redux/Zustand (for React)来管理用户的登录状态、角色和频道列表等全局状态。

---

#### **5\. 安全设计**

* **认证 (Authentication):** 采用基于Cookie的会话管理。sessionId为crypto.randomUUID()生成的随机字符串，无实际意义，仅作为KV中的查找键。  
* **授权 (Authorization):** Worker在处理需要特定权限的API请求时（如/api/admin/\*），会先验证会话，然后从会话数据中读取用户角色，进行权限判断。  
* **密码安全:** 在创建用户时，Worker将使用Web Crypto API (crypto.subtle)中的PBKDF2算法，结合随机生成的salt，对密码进行哈希，然后将salt和hash存入KV。登录验证时执行相同的流程进行比对。  
* **基础设施安全:**  
  * **源站保护:** 在Cloudflare防火墙规则中设置，只允许来自Cloudflare IP段的流量访问VPS的Web端口，阻止一切直接访问。  
  * **API密钥:** Worker与VPS之间的通信，通过在HTTP Header中添加一个预共享的X-API-Key（存储在Worker的Secrets中）进行保护。  
  * **HTTPS:** 强制所有面向用户的流量使用HTTPS。

---

#### **6\. 部署与运维**

* **VPS部署:**  
  1. 安装Nginx, Node.js, FFmpeg。  
  2. 配置Nginx服务和防火墙。  
  3. 部署并使用pm2等进程守护工具运行Node.js转码API服务。  
* **Worker部署:**  
  1. 使用wrangler CLI工具进行开发和部署。  
  2. 在wrangler.toml中配置KV命名空间绑定。  
  3. 将VPS的IP地址和API密钥作为Secrets（加密的环境变量）添加到Worker中，避免硬编码。