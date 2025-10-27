# 🗓️ 工作日预加载功能实施方案

**版本**: v1.0 | **创建时间**: 2025-10-27  
**依赖**: 预加载功能已完成  
**目标**: 添加"仅工作日"预加载选项

---

## 📊 执行进度

| 阶段 | 名称 | 状态 | 验证 |
|------|------|------|------|
| 准备 | 环境配置 | ⏳ | - |
| 阶段1 | WorkdayChecker服务 | ⏳ | - |
| 阶段2 | Workers API更新 | ⏳ | - |
| 阶段3 | PreloadScheduler集成 | ⏳ | - |
| 阶段4 | 前端界面 | ⏳ | - |
| 阶段5 | 集成测试 | ⏳ | - |

---

## 📋 核心设计

### **数据源**
- API: `https://timor.tech/api/holiday/year/YYYY-MM-DD`
- 免费、稳定、准确

### **数据预取策略**（用户建议）
```
1. 服务启动: 预取当前月+下月
2. 每月25号凌晨1点: 自动预取下月数据
3. 优先从缓存读取，减少API调用
```

### **容错降级**（用户建议）
```
场景1: 运行时API失败 + workdaysOnly=true
  → 自动降级为每日预加载模式
  → 不修改KV配置
  → 日志记录降级原因

场景2: 预取失败（25号获取下月数据失败）
  → 标记该月份为"待重试"
  → 每天凌晨1点自动重试
  → 成功后清除重试标记
  → 直到成功为止（无最大重试次数限制）
```

### **失败重试机制**（用户建议）⭐
```javascript
// WorkdayChecker内部状态
this.failedMonths = new Set();  // {'2025-11', '2025-12'}

// 每天凌晨1点检查重试
cron.schedule('0 1 * * *', async () => {
  // 1. 检查是否是25号（正常预取）
  if (today.getDate() === 25) {
    await prefetchNextMonth();
  }
  
  // 2. 检查是否有失败的月份需要重试
  if (failedMonths.size > 0) {
    console.log(`🔄 重试获取失败的月份: ${Array.from(failedMonths)}`);
    for (const monthKey of failedMonths) {
      const success = await retryPrefetchMonth(monthKey);
      if (success) {
        failedMonths.delete(monthKey);  // 成功后移除
        console.log(`✅ ${monthKey} 数据获取成功`);
      }
    }
  }
});
```

### **KV存储结构**
```json
{
  "workdaysOnly": false  // 🆕 新增字段，默认false
}
```

---

## 🎯 阶段1：WorkdayChecker服务

**文件**: `src/services/WorkdayChecker.js`

### 核心方法
```javascript
class WorkdayChecker {
  // 检查是否工作日（含缓存）
  async isWorkday(date)
  
  // 预取月度数据（25号自动调用）
  async prefetchMonthData(year, month)
  
  // 🆕 重试预取（失败月份重试）
  async retryPrefetchMonth(monthKey)
  
  // 初始化（启动时调用）
  async initialize()
  
  // 内部状态
  failedMonths = new Set()  // 🆕 跟踪失败的月份
}
```

### 关键逻辑1：isWorkday()
```
1. 检查缓存 → 命中返回
2. 调用API → type=0或3为工作日
3. 失败降级 → 周一到周五=工作日
4. 写入缓存
```

### 关键逻辑2：prefetchMonthData() 预取逻辑
```javascript
async prefetchMonthData(year, month) {
  const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
  
  try {
    // 获取该月所有日期数据
    // ...
    console.log(`✅ ${monthKey} 数据预取成功`);
    
    // 🆕 成功后从失败列表移除
    this.failedMonths.delete(monthKey);
    
  } catch (error) {
    console.error(`❌ ${monthKey} 数据预取失败`, error);
    
    // 🆕 失败时添加到待重试列表
    this.failedMonths.add(monthKey);
  }
}
```

### 关键逻辑3：initialize() 初始化
```
1. 预取当前月数据（失败自动加入failedMonths）
2. 预取下个月数据（失败自动加入failedMonths）
3. 设置定时任务: cron '0 1 * * *'
   - 每天凌晨1点执行
   - 如果是25号 → 预取下月
   - 如果有失败月份 → 自动重试
```

### 关键逻辑4：重试机制 🆕
```javascript
// 每天凌晨1点统一执行
cron.schedule('0 1 * * *', async () => {
  const today = new Date();
  
  // 步骤1: 25号正常预取下月
  if (today.getDate() === 25) {
    const next = getNextMonth();
    await prefetchMonthData(next.year, next.month);
  }
  
  // 步骤2: 重试失败的月份
  if (this.failedMonths.size > 0) {
    console.log(`🔄 检测到 ${this.failedMonths.size} 个月份需要重试`);
    
    for (const monthKey of this.failedMonths) {
      const [year, month] = monthKey.split('-');
      await prefetchMonthData(parseInt(year), parseInt(month));
      // 成功会自动从failedMonths移除
    }
  }
});
```

### 验证
```bash
node test-workday.js
# ✅ 预取两个月数据
# ✅ 工作日判断准确
# ✅ 缓存正常
```

---

## 🎯 阶段2：Workers API更新

**文件**: `cloudflare-worker/src/index.js`

### 修改点
```javascript
// GET /api/preload/config/:channelId
return {
  ...config,
  workdaysOnly: config.workdaysOnly ?? false
};

// PUT /api/preload/config/:channelId
await env.YOYO_USER_DB.put(key, JSON.stringify({
  ...existingFields,
  workdaysOnly  // 🆕 保存新字段
}));
```

### 验证
```bash
# 测试保存
curl -X PUT .../api/preload/config/test -d '{"workdaysOnly":true}'
# ✅ 返回成功

# 测试读取
curl .../api/preload/config/test
# ✅ 包含workdaysOnly字段
```

---

## 🎯 阶段3：PreloadScheduler集成

**文件**: `src/services/PreloadScheduler.js`

### 修改点
```javascript
// 1. 构造函数
this.workdayChecker = new WorkdayChecker();

// 2. start()
await this.workdayChecker.initialize();

// 3. shouldStartPreloadNow()
if (config.workdaysOnly) {
  try {
    const isWorkday = await this.workdayChecker.isWorkday();
    if (!isWorkday) {
      console.log('非工作日，跳过');
      return false;
    }
  } catch (error) {
    console.warn('API失败，降级为每日预加载');
    // 继续执行
  }
}
```

### 验证
```bash
pm2 logs
# ✅ 初始化工作日检测器
# ✅ 预取数据成功
# ✅ 工作日/非工作日判断正确
```

---

## 🎯 阶段4：前端界面

**文件**: `frontend/src/components/admin/PreloadConfigDialog.vue`

### UI组件
```vue
<el-switch 
  v-model="formData.workdaysOnly" 
  active-text="仅工作日"
  inactive-text="每天"
/>

<el-tooltip content="自动识别法定节假日和调休" />
```

### 验证
```
打开管理后台 → 预加载配置
✅ 显示"仅工作日"开关
✅ 提示信息清晰
✅ 保存配置成功
```

---

## 🎯 阶段5：集成测试

### 测试场景

#### 场景1：工作日预加载
```
配置: workdaysOnly=true, 08:00-18:00
当前: 周一（工作日）
期望: 8:00启动预加载 ✅
```

#### 场景2：周末跳过
```
配置: workdaysOnly=true
当前: 周六
期望: 跳过预加载，日志显示原因 ✅
```

#### 场景3：运行时API失败降级
```
模拟: isWorkday()调用时API返回500
期望: 降级为每日预加载模式 ✅
日志: "工作日API失败，降级为每日预加载模式"
```

#### 场景4：预取失败自动重试 🆕
```
模拟: 10月25号凌晨1点预取11月数据失败
步骤:
  1. 10-25 01:00 预取失败 → failedMonths.add('2025-11')
  2. 10-26 01:00 自动重试 → 失败继续保留
  3. 10-27 01:00 自动重试 → 失败继续保留
  4. 10-28 01:00 自动重试 → 成功，failedMonths.delete('2025-11')

期望:
✅ 失败后每天自动重试
✅ 日志显示"🔄 重试获取失败的月份: ['2025-11']"
✅ 成功后自动清除重试标记
✅ 无最大重试次数限制
```

#### 场景5：节假日跳过
```
当前: 国庆节（10月1日周二）
期望: 识别为非工作日，跳过 ✅
```

### 性能验证
```
启动时间: +200ms（预取数据）
内存占用: +20KB（缓存数据）
API调用: 1次/月/频道
运行时性能: 无影响（读缓存）
```

---

## 📝 实施清单

### 代码文件
- [ ] `src/services/WorkdayChecker.js` - 新建
- [ ] `src/services/PreloadScheduler.js` - 修改
- [ ] `cloudflare-worker/src/index.js` - 修改
- [ ] `frontend/.../PreloadConfigDialog.vue` - 修改

### 依赖
- [ ] axios（已有）
- [ ] node-cron（已有）

### 配置
- [ ] KV: 添加workdaysOnly字段
- [ ] 默认值: false（保持兼容）

### 测试
- [ ] 单元测试: WorkdayChecker
- [ ] 集成测试: 4个场景
- [ ] 性能测试: 启动时间、内存

---

## ⚠️ 风险缓解（用户建议方案）

### 风险1：运行时API不可用
**场景**: `isWorkday()`调用时API返回错误  
**方案**: 降级为每日预加载模式

```javascript
async isWorkday(date) {
  try {
    // 调用API
    const response = await axios.get(apiUrl);
    return parseWorkday(response);
    
  } catch (error) {
    console.warn('⚠️ 工作日API失败，降级为每日预加载模式', error);
    
    // 降级：周一到周五=工作日
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }
}
```

**特点**:
- ✅ 不修改KV配置（保持用户设置）
- ✅ 运行时自动降级
- ✅ API恢复后自动恢复

---

### 风险2：预取数据失败
**场景**: 25号凌晨1点预取下月数据失败  
**方案**: 失败标记 + 每天自动重试

```javascript
async prefetchMonthData(year, month) {
  const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
  
  try {
    // 预取逻辑...
    console.log(`✅ ${monthKey} 数据预取成功`);
    this.failedMonths.delete(monthKey);  // 成功移除
    
  } catch (error) {
    console.error(`❌ ${monthKey} 数据预取失败`, error);
    this.failedMonths.add(monthKey);  // 失败标记
  }
}

// 每天凌晨1点统一任务
cron.schedule('0 1 * * *', async () => {
  // 1. 25号正常预取
  if (today.getDate() === 25) {
    await prefetchNextMonth();
  }
  
  // 2. 重试失败的月份 🆕
  if (this.failedMonths.size > 0) {
    console.log(`🔄 重试失败的月份: ${Array.from(this.failedMonths)}`);
    for (const monthKey of this.failedMonths) {
      await retryPrefetch(monthKey);  // 成功会自动移除
    }
  }
});
```

**特点**:
- ✅ 失败后每天凌晨1点自动重试
- ✅ 成功后自动清除标记
- ✅ 无最大重试次数限制（直到成功）
- ✅ 多个月份可同时重试

**重试流程示例**:
```
10-25 01:00: 预取2025-11失败 → failedMonths = {'2025-11'}
10-26 01:00: 自动重试2025-11失败 → failedMonths = {'2025-11'}
10-27 01:00: 自动重试2025-11失败 → failedMonths = {'2025-11'}
10-28 01:00: 自动重试2025-11成功 → failedMonths = {}
```

---

## 📖 API参考

### Timor API
```bash
# 请求
GET https://timor.tech/api/holiday/year/2025-10-27

# 响应
{
  "code": 0,
  "type": {
    "type": 0,        # 0=工作日, 1=周末, 2=节假日, 3=调休工作日
    "name": "周一",
    "week": 1
  }
}
```

---

**文档维护者**: AI Assistant  
**最后更新**: 2025-10-27 13:35
