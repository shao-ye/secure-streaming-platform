# 🗑️ 视频文件定时清理功能 - 阶段化执行文档

**版本**: v1.0 | **创建时间**: 2025-10-28 17:12  
**目标**: 实现视频文件自动清理，释放存储空间

---

## 📖 文档使用说明

### **重要原则**

⚠️ **本文档采用阶段化执行策略** - 每个阶段完成后必须验证通过才能继续

**🚨 执行纪律（必须严格遵守）**：
1. ✅ **绝对禁止跳步** - 必须完成当前阶段的所有步骤后才能进入下一阶段
2. ✅ **验证是强制性的** - 每个阶段必须执行验证步骤确认功能正常
3. ✅ **验证失败必须回滚** - 使用备份文件恢复，不能带着问题继续
4. ✅ **每步更新进度表** - 在下方进度表中实时标记当前状态

---

## 🎯 核心需求

### **功能描述**
- ✅ 定时执行：每天凌晨1点（北京时间）
- ✅ 清理规则：删除两天前的视频文件
- ✅ 删除范围：按日期文件夹整体删除
- ✅ 配置来源：从Cloudflare KV读取所有频道配置
- ✅ 操作方式：遍历每个频道的存储路径

### **当前目录结构**
```
/var/www/recordings/
  ├── stream_gkg5hknc/        # 频道ID目录
  │   ├── 20251024/           # 日期目录（待删除）
  │   ├── 20251025/           # 日期目录（待删除）
  │   ├── 20251026/           # 日期目录（保留）
  │   ├── 20251027/           # 日期目录（保留）
  │   └── 20251028/           # 日期目录（保留-今天）
  └── stream_xxx/
```

### **清理逻辑**
- 今天：2025-10-28
- 保留天数：2天
- 删除：20251026及之前的所有日期文件夹
- 保留：20251027、20251028

---

## 📊 执行进度追踪

| 阶段 | 名称 | 状态 | 完成时间 | 验证结果 |
|------|------|------|----------|----------|
| **准备** | 环境检查和备份 | ✅ 已完成 | 2025-10-28 17:42 | ✅ 依赖已安装，目录已创建，备份完成 |
| **阶段1** | 后端VideoCleanupScheduler服务 | ✅ 已完成 | 2025-10-28 17:48 | ✅ 模块验证通过，日期验证正确 |
| **阶段2** | Workers API扩展 | ✅ 已完成 | 2025-10-28 17:53 | ✅ API部署成功，KV存储验证通过 |
| **阶段3** | 前端配置界面 | ⏳ 未开始 | - | - |
| **阶段4** | 服务集成和启动 | ⏳ 未开始 | - | - |
| **阶段5** | 完整测试验证 | ⏳ 未开始 | - | - |

---

## 🎯 准备阶段

### **目标**
- 检查环境依赖
- 备份现有文件
- 验证系统状态

### **操作步骤**

```bash
# 1. 备份关键文件
mkdir -p /tmp/backup/cleanup-$(date +%Y%m%d)
cd /opt/yoyo-transcoder
cp src/app.js /tmp/backup/cleanup-$(date +%Y%m%d)/

# 2. 验证依赖
node -e "console.log(require('node-cron'))" # 应该有输出
node -e "console.log(require('moment-timezone'))" # 应该有输出

# 3. 检查录制目录
ls -la /var/www/recordings/
df -h /var/www/recordings/  # 查看磁盘空间
```

### **验证清单**
- [ ] node-cron已安装
- [ ] moment-timezone已安装
- [ ] 录制目录存在且可访问
- [ ] 备份文件已创建

---

## 🎯 阶段1：后端VideoCleanupScheduler服务

**目标**：创建视频清理调度器服务  
**风险**：🟢 低（新建服务，不影响现有功能）  
**时间**：60分钟

### **1.1 创建服务文件**

**新建文件**：`vps-transcoder-api/src/services/VideoCleanupScheduler.js`

### **1.2 核心实现逻辑**

#### **类结构**
```javascript
class VideoCleanupScheduler {
  constructor() {
    this.cronTask = null;
    this.workersApiUrl = process.env.WORKERS_API_URL;
    this.workersApiKey = process.env.WORKERS_API_KEY;
    this.isRunning = false;
  }
}
```

#### **关键方法说明**

**1. start() - 启动定时任务**
- 使用 `cron.schedule('0 1 * * *', ...)` 设置每天1点执行
- 时区设置为 `'Asia/Shanghai'`
- 调用 `executeCleanup()` 执行清理

**2. executeCleanup() - 执行清理主流程**
```
流程：
1. 计算清理日期: cutoffDate = 今天 - 2天 (格式: YYYYMMDD)
2. 调用Workers API获取所有频道配置
3. 遍历每个频道:
   - 如果有recordConfig且enabled=true
   - 获取storagePath（优先用配置，否则用默认）
   - 调用cleanupChannelVideos清理该频道
4. 记录日志
```

**3. cleanupChannelVideos(channelId, storagePath, cutoffDate) - 清理单个频道**
```
流程：
1. 检查存储路径是否存在
2. 读取该路径下所有项
3. 筛选日期格式的文件夹 (正则: /^\d{8}$/)
4. 比较日期: if (folderName <= cutoffDate) 则删除
5. 使用 fs.rmSync(path, {recursive: true, force: true}) 删除
6. 记录日志
```

**4. fetchChannelConfigs() - 获取频道配置**
- 调用 Workers API: `${workersApiUrl}/api/admin/streams`
- 带上 API Key 认证
- 返回频道数组


### **1.3 安全机制**

#### **日期格式严格验证（核心安全保障）**
```javascript
// 只匹配严格的 YYYYMMDD 格式
// 年份：19xx 或 20xx
// 月份：01-12
// 日期：01-31
isValidDateFolder(folderName) {
  return /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(folderName);
}

// 使用示例：
isValidDateFolder('20251028')  // true  - 正确的日期
isValidDateFolder('20251301')  // false - 月份错误
isValidDateFolder('20250001')  // false - 日期错误
isValidDateFolder('videos')    // false - 不是日期
isValidDateFolder('backup')    // false - 不是日期
isValidDateFolder('2025')      // false - 格式不对
```

**安全性说明**：
- ✅ 不限制存储路径（用户可以配置任意路径如 `/data/videos`、`/mnt/storage` 等）
- ✅ 只删除严格匹配 YYYYMMDD 格式的文件夹
- ✅ 任何非日期格式的文件夹都会跳过，不会误删
- ✅ 即使用户配置错误的路径，也只会删除日期文件夹，不会影响其他内容

#### **错误隔离**
- 单个频道清理失败不影响其他频道
- 路径不存在时跳过，记录警告日志
- 所有错误都记录到日志中

### **1.4 验证步骤**

```bash
# 1. 创建测试数据
mkdir -p /var/www/recordings/test_channel/20251024
mkdir -p /var/www/recordings/test_channel/20251025
mkdir -p /var/www/recordings/test_channel/20251026
echo "test" > /var/www/recordings/test_channel/20251024/test.mp4
echo "test" > /var/www/recordings/test_channel/20251025/test.mp4

# 2. 测试日期计算
node -e "
const moment = require('moment-timezone');
const cutoff = moment().tz('Asia/Shanghai').subtract(2, 'days').format('YYYYMMDD');
console.log('Cutoff date:', cutoff);
"

# 3. 验证路径验证函数
node -e "
const isValid = (path) => path.startsWith('/var/www/recordings');
console.log('/var/www/recordings/test:', isValid('/var/www/recordings/test'));
console.log('/tmp/test:', isValid('/tmp/test'));
"
```

### **验证清单**
- [ ] VideoCleanupScheduler.js文件已创建
- [ ] 所有方法都已实现
- [ ] 日期计算正确
- [ ] 路径验证有效
- [ ] 测试数据创建成功

---

## 🎯 阶段2：Workers API扩展

**目标**：添加清理配置API  
**风险**：🟢 低（新增API端点）  
**时间**：45分钟

### **2.1 API设计**

#### **新增端点1：获取清理配置**
```
GET /api/admin/cleanup/config
响应: { retentionDays: 2, enabled: true }
```

#### **新增端点2：更新清理配置**
```
PUT /api/admin/cleanup/config
请求: { retentionDays: 2, enabled: true }
响应: { status: "success" }
```

#### **新增端点3：手动触发清理**
```
POST /api/admin/cleanup/trigger
响应: { status: "success", stats: {...} }
```

### **2.2 KV存储结构**

```javascript
// Key: "system:cleanup:config"
{
  "retentionDays": 2,  // 保留天数
  "enabled": true      // 是否启用自动清理
}
```

### **2.3 实现要点**

**文件位置**：`cloudflare-worker/src/index.js`

**关键逻辑**：
1. 在路由中添加新的API端点
2. 从KV读取/写入清理配置
3. 手动触发时通过HTTP调用VPS的清理端点
4. 添加权限验证（X-API-Key）

### **2.4 验证步骤**

```bash
# 1. 测试获取配置
curl -H "X-API-Key: YOUR_KEY" \
  https://yoyoapi.5202021.xyz/api/admin/cleanup/config

# 2. 测试更新配置
curl -X PUT \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"retentionDays":3,"enabled":true}' \
  https://yoyoapi.5202021.xyz/api/admin/cleanup/config

# 3. 验证KV存储
wrangler kv:key get "system:cleanup:config" --namespace-id=YOUR_NS_ID
```

### **验证清单**
- [ ] API端点已添加
- [ ] KV结构正确
- [ ] 获取配置API正常
- [ ] 更新配置API正常
- [ ] 手动触发API正常

---

## 🎯 阶段3：前端配置界面

**目标**：在频道列表添加"设置"按钮和清理配置弹窗  
**风险**：🟢 低（UI改造）  
**时间**：60分钟

### **3.1 界面设计**

#### **位置**
频道列表右上角添加"设置"按钮（录制操作按钮旁边）

#### **弹窗内容**
```
┌─────────────────────────────┐
│  系统设置                    │
├─────────────────────────────┤
│  视频清理配置                │
│                             │
│  ☑ 启用自动清理             │
│                             │
│  保留天数: [2] 天           │
│  (删除N天前的视频文件)       │
│                             │
│  清理时间: 每天01:00(北京时间)│
│                             │
├─────────────────────────────┤
│  [手动清理]    [取消] [保存] │
│  (立即执行)                  │
└─────────────────────────────┘
```

**按钮说明**：
- **手动清理**：独立操作按钮，点击后立即触发一次清理任务（不需要先保存配置）
- **保存**：保存配置修改（启用开关、保留天数）
- **取消**：关闭弹窗，不保存配置修改

### **3.2 实现要点**

**文件位置**：`frontend/src/components/StreamManager.vue`

**改动点**：
1. 添加"设置"按钮（el-button with icon）
2. 创建 SystemSettingsDialog 组件
3. 调用清理配置API
4. 手动清理按钮触发清理

### **3.3 组件逻辑**

```javascript
// 1. 获取配置（打开弹窗时调用）
const fetchCleanupConfig = async () => {
  const res = await axios.get('/api/admin/cleanup/config');
  form.value = res.data;
};

// 2. 保存配置（点击"保存"按钮）
const saveConfig = async () => {
  await axios.put('/api/admin/cleanup/config', form.value);
  ElMessage.success('配置已保存');
  dialogVisible.value = false; // 关闭弹窗
};

// 3. 手动清理（点击"手动清理"按钮）
const triggerCleanup = async () => {
  // 确认对话框
  await ElMessageBox.confirm(
    '确定要立即执行视频清理吗？',
    '确认操作',
    { type: 'warning' }
  );
  
  // 执行清理
  await axios.post('/api/admin/cleanup/trigger');
  ElMessage.success('清理任务已触发，正在后台执行');
  // 注意：不关闭弹窗，用户可能还需要修改配置
};

// 4. 取消（点击"取消"按钮）
const handleCancel = () => {
  dialogVisible.value = false; // 直接关闭弹窗，不保存
};
```

**交互流程**：
1. 用户点击"设置"按钮 → 弹窗打开 → 加载配置
2. 用户修改配置（启用/保留天数）→ 点击"保存" → 配置更新 → 弹窗关闭
3. 用户点击"手动清理" → 确认对话框 → 执行清理 → 弹窗保持打开
4. 用户点击"取消" → 弹窗关闭，配置修改不保存

### **3.4 验证步骤**

```bash
# 1. 检查前端编译
cd frontend
npm run build

# 2. 验证按钮可见性
# 浏览器打开频道列表，查看右上角是否有"设置"按钮

# 3. 验证弹窗功能
# 点击"设置"按钮，检查弹窗是否正常显示

# 4. 验证配置保存
# 修改保留天数，保存，刷新页面验证是否生效
```

### **验证清单**
- [ ] "设置"按钮已添加
- [ ] 弹窗样式正常（三个按钮布局清晰）
- [ ] 配置读取正常
- [ ] 配置保存功能正常（保存后弹窗关闭）
- [ ] 手动清理功能正常（有确认对话框，执行后弹窗不关闭）
- [ ] 取消按钮正常（关闭弹窗，不保存修改）

---

## 🎯 阶段4：服务集成和启动

**目标**：将清理服务集成到主程序  
**风险**：🟡 中（修改启动流程）  
**时间**：30分钟

### **4.1 集成点**

**文件位置**：`vps-transcoder-api/src/app.js`

### **4.2 实现逻辑**

```javascript
// 1. 引入服务
const VideoCleanupScheduler = require('./services/VideoCleanupScheduler');

// 2. 初始化（在现有服务初始化之后）
const cleanupScheduler = new VideoCleanupScheduler();

// 3. 获取配置并启动
const cleanupConfig = await fetchCleanupConfig(); // 从Workers API获取
if (cleanupConfig.enabled) {
  await cleanupScheduler.start(cleanupConfig);
  logger.info('Video cleanup scheduler started', cleanupConfig);
}

// 4. 添加手动触发端点
app.post('/api/admin/cleanup/execute', async (req, res) => {
  // 验证API Key
  if (req.headers['x-api-key'] !== process.env.VPS_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const stats = await cleanupScheduler.executeCleanup();
  res.json({ status: 'success', data: stats });
});

// 5. 优雅关闭
process.on('SIGTERM', async () => {
  await cleanupScheduler.stop();
});
```

### **4.3 验证步骤**

```bash
# 1. 重启服务
pm2 restart vps-transcoder-api

# 2. 检查日志
pm2 logs vps-transcoder-api --lines 50

# 应该看到：
# ✅ Video cleanup scheduler started
# ✅ Next cleanup scheduled at: 01:00 Asia/Shanghai

# 3. 测试手动触发
curl -X POST \
  -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/cleanup/execute
```

### **验证清单**
- [ ] 服务成功启动
- [ ] 定时任务已调度
- [ ] 日志输出正常
- [ ] 手动触发接口正常
- [ ] 服务可以优雅关闭

---

## 🎯 阶段5：完整测试验证

**目标**：端到端测试所有功能  
**风险**：🟢 低  
**时间**：45分钟

### **5.1 测试场景**

#### **场景1：自动清理测试**
```bash
# 1. 创建测试数据（多个频道，多个日期）
for channel in stream_test1 stream_test2; do
  for date in 20251024 20251025 20251026 20251027; do
    mkdir -p /var/www/recordings/$channel/$date
    dd if=/dev/zero of=/var/www/recordings/$channel/$date/test.mp4 bs=1M count=10
  done
done

# 2. 查看清理前状态
du -sh /var/www/recordings/*/

# 3. 手动触发清理（模拟定时任务）
curl -X POST -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/cleanup/execute

# 4. 验证清理结果
du -sh /var/www/recordings/*/
# 应该只剩下 20251026, 20251027 的文件夹
```

#### **场景2：配置修改测试**
```bash
# 1. 修改保留天数为3天
curl -X PUT \
  -H "X-API-Key: YOUR_KEY" \
  -d '{"retentionDays":3,"enabled":true}' \
  https://yoyoapi.5202021.xyz/api/admin/cleanup/config

# 2. 重启服务使配置生效
pm2 restart vps-transcoder-api

# 3. 再次手动清理，验证保留3天
```

#### **场景3：错误处理测试**
```bash
# 1. 测试无效路径处理
# 在某个频道配置中设置错误的storagePath
# 验证该频道失败不影响其他频道

# 2. 测试权限问题
chmod 000 /var/www/recordings/stream_test1/20251024
# 触发清理，验证错误被记录但不崩溃
```

#### **场景4：定时任务测试**
```bash
# 方法1：修改系统时间（不推荐）
# 方法2：修改cron表达式为2分钟后执行，观察日志

# 临时修改代码
# cron.schedule('*/2 * * * *', ...) # 每2分钟执行一次

# 观察日志
pm2 logs vps-transcoder-api --lines 100
```

### **5.2 性能测试**

```bash
# 1. 大量文件测试
# 创建1000个小文件，测试清理速度
for i in {1..1000}; do
  touch /var/www/recordings/stream_test1/20251024/file$i.mp4
done

# 2. 计时清理
time curl -X POST -H "X-API-Key: YOUR_KEY" \
  http://localhost:3000/api/admin/cleanup/execute

# 预期：< 5秒完成
```

### **5.3 前端界面测试**

```
测试步骤：

场景1：配置保存测试
1. 打开频道列表页面
2. 点击右上角"设置"按钮，弹窗打开
3. 验证当前配置显示正确（启用状态、保留天数）
4. 修改保留天数为3天
5. 点击"保存"按钮
6. 验证提示"配置已保存"，弹窗自动关闭
7. 再次打开弹窗，验证保留天数已变为3

场景2：手动清理测试
1. 打开"设置"弹窗
2. 点击"手动清理"按钮
3. 验证出现确认对话框："确定要立即执行视频清理吗？"
4. 点击"确定"
5. 验证提示"清理任务已触发，正在后台执行"
6. 验证弹窗保持打开（不关闭）
7. SSH到VPS检查日志，确认清理任务已执行
8. 验证旧的日期文件夹已被删除

场景3：取消操作测试
1. 打开"设置"弹窗
2. 修改保留天数为5
3. 点击"取消"按钮
4. 弹窗关闭
5. 再次打开弹窗，验证保留天数未改变（仍是原值）
```

### **5.4 完整测试清单**

- [ ] 自动清理功能正常
- [ ] 保留天数规则正确
- [ ] 多频道并发清理正常
- [ ] 错误不影响其他频道
- [ ] 前端配置界面正常
- [ ] 配置保存生效
- [ ] 手动触发功能正常
- [ ] 定时任务按时执行
- [ ] 日志记录完整
- [ ] 性能满足要求（<5秒）

---

## 📝 关键注意事项

### **1. 安全性**
- ✅ **日期格式严格验证**：只删除严格匹配 YYYYMMDD 格式的文件夹（如 20251024）
- ✅ **不限制路径**：用户可以配置任意存储路径，系统只删除其中的日期文件夹
- ✅ **防误删保护**：任何非日期格式的文件夹（如 videos、backup、temp）都会跳过
- ✅ **单频道失败不影响全局**：一个频道清理失败不会中断其他频道
- ✅ **API需要认证**（X-API-Key）

### **2. 可靠性**
- ✅ 详细的日志记录
- ✅ 错误信息完整记录

### **3. 性能**
- ✅ 按文件夹删除，不逐文件删除
- ✅ 异步处理，不阻塞主服务
- ✅ 凌晨1点执行，业务低峰期

### **4. 维护性**
- ✅ 前端可配置保留天数
- ✅ 手动触发功能，便于调试
- ✅ 日志便于排查问题

---

## 🚀 部署流程

### **完整部署步骤**

```bash
# 1. 提交代码
git add .
git commit -m "feat: 视频文件定时清理功能"
git push

# 2. VPS部署
ssh root@142.171.75.220
cd /tmp/github/secure-streaming-platform/vps-transcoder-api
bash vps-simple-deploy.sh

# 3. 验证部署
pm2 logs vps-transcoder-api --lines 50
curl http://localhost:3000/health

# 4. 前端部署（Cloudflare Pages自动部署）
# 等待3-5分钟后访问前端验证

# 5. Workers部署
cd cloudflare-worker
wrangler deploy
```

---

## 📊 预期结果

### **功能验证成功标准**

✅ **后端服务**
- VideoCleanupScheduler服务成功启动
- 定时任务正确调度（凌晨1点）
- 手动触发功能正常

✅ **API接口**
- 获取配置API正常响应
- 更新配置API保存成功
- 手动触发API正常工作

✅ **前端界面**
- "设置"按钮显示正常
- 配置弹窗功能完整

✅ **清理功能**
- 正确删除两天前的文件
- 保留最近两天的文件
- 多频道并发清理正常
- 错误处理完善

---

**文档状态**: ✅ 已完成  
**预计总时间**: 约4-5小时  
**建议执行时间**: 工作日白天，便于及时验证  
**紧急回滚**: 恢复 `/tmp/backup/` 中的备份文件

