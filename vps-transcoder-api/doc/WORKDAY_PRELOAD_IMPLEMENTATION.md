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
3. 失败降级 → 基础模式（周一至周五=工作日，无法识别节假日）
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

### 3.1 修改点概述

需要在3个关键位置加入工作日判断：
1. **构造函数** - 初始化WorkdayChecker
2. **start()** - 启动时初始化工作日数据
3. **shouldPreloadNow()** - 改为异步，加入工作日检查
4. **initializePreloads()** - 启动时检查工作日
5. **scheduleChannel()** - 定时任务触发时检查工作日

### 3.2 构造函数修改

```javascript
const WorkdayChecker = require('./WorkdayChecker');

class PreloadScheduler {
  constructor(streamManager) {
    this.streamManager = streamManager;
    this.cronTasks = new Map();
    
    // 🆕 初始化工作日检测器
    this.workdayChecker = new WorkdayChecker();
    
    this.workersApiUrl = process.env.WORKERS_API_URL || 'https://yoyoapi.5202021.xyz';
    this.workersApiKey = process.env.WORKERS_API_KEY || '';
  }
}
```

### 3.3 start() 方法修改

```javascript
async start() {
  try {
    logger.info('Starting PreloadScheduler...');
    
    // 🆕 1. 初始化工作日检测器（预取当前月+下月数据）
    logger.info('Initializing WorkdayChecker...');
    await this.workdayChecker.initialize();
    logger.info('WorkdayChecker initialized successfully');
    
    // 2. 获取所有预加载配置
    const configs = await this.fetchPreloadConfigs();
    
    // ... 现有代码
  }
}
```

### 3.4 shouldPreloadNow() 方法改造 ⭐

**关键修改**：从同步改为异步，加入工作日检查

```javascript
// 旧版本（同步）
shouldPreloadNow(config, currentTime) {
  const { startTime, endTime } = config;
  // 只检查时间段...
  return inTimeRange;
}

// 🆕 新版本（异步，含工作日检查）
async shouldPreloadNow(config, currentTime) {
  const { startTime, endTime, workdaysOnly } = config;
  
  // 步骤1: 检查时间段
  const inTimeRange = this.isInTimeRange(currentTime, startTime, endTime);
  if (!inTimeRange) {
    return false;
  }
  
  // 步骤2: 🆕 检查工作日（如果启用）
  if (workdaysOnly) {
    try {
      const isWorkday = await this.workdayChecker.isWorkday();
      
      if (!isWorkday) {
        logger.info('Today is not a workday, skipping preload', { 
          channelId: config.channelId 
        });
        return false;
      }
      
      logger.info('Today is a workday, preload allowed', { 
        channelId: config.channelId 
      });
      
    } catch (error) {
      // 容错：API失败时降级为基础模式
      logger.warn('Workday check failed, falling back to basic mode', { 
        channelId: config.channelId,
        error: error.message 
      });
      // 继续执行（降级为每日预加载）
    }
  }
  
  return true;
}

// 🆕 辅助方法：时间段检查（从shouldPreloadNow提取）
isInTimeRange(currentTime, startTime, endTime) {
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  
  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  
  // 处理跨天情况
  if (endMinutes < startMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
}
```

### 3.5 initializePreloads() 方法修改

```javascript
async initializePreloads(configs) {
  const currentTime = this.getBeijingTime().format('HH:mm');
  
  logger.info('Initializing preloads at startup', { currentTime });
  
  for (const config of configs) {
    // 🆕 改为await异步调用（支持工作日检查）
    if (await this.shouldPreloadNow(config, currentTime)) {
      logger.info('Starting preload at startup', { 
        channelId: config.channelId,
        currentTime,
        startTime: config.startTime,
        endTime: config.endTime,
        workdaysOnly: config.workdaysOnly  // 🆕 记录工作日设置
      });
      
      await this.startPreload(config);
    }
  }
}
```

### 3.6 scheduleChannel() 定时任务修改

```javascript
scheduleChannel(config) {
  const { channelId, startTime, endTime } = config;
  
  // ... 取消旧任务代码
  
  // 创建开始任务
  const startCron = `${startMinute} ${startHour} * * *`;
  const startTask = cron.schedule(startCron, async () => {
    logger.info('Cron triggered: Starting preload', { 
      channelId, 
      time: startTime,
      workdaysOnly: config.workdaysOnly  // 🆕 记录设置
    });
    
    // 🆕 实时检查是否应该启动（包含工作日检查）
    const currentTime = this.getBeijingTime().format('HH:mm');
    const shouldStart = await this.shouldPreloadNow(config, currentTime);
    
    if (shouldStart) {
      await this.startPreload(config);
    } else {
      logger.info('Preload skipped by shouldPreloadNow check', { 
        channelId,
        reason: config.workdaysOnly ? 'Not a workday' : 'Out of time range'
      });
    }
  }, {
    timezone: 'Asia/Shanghai'
  });
  
  // ... 创建结束任务代码（无需修改）
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

### 4.1 UI组件设计（用户建议）

**核心需求**：
1. 工作日开关切换时立即获取工作日状态
2. 在配置旁边实时显示当前状态
3. 显示数据获取成功/失败状态

**UI布局**：
```vue
<el-form-item label="预加载策略">
  <!-- 工作日开关 -->
  <el-switch 
    v-model="formData.workdaysOnly" 
    active-text="仅工作日"
    inactive-text="每天"
    @change="handleWorkdayToggle"
  />
  
  <!-- 🆕 状态指示器 -->
  <el-tag 
    v-if="formData.workdaysOnly && workdayStatus"
    :type="workdayStatus.type"
    size="small"
    style="margin-left: 10px"
  >
    {{ workdayStatus.text }}
  </el-tag>
  
  <!-- 提示信息 -->
  <el-tooltip placement="top">
    <template #content>
      开启后，仅在工作日的设置时段内预加载<br>
      自动识别法定节假日和调休
    </template>
    <el-icon><QuestionFilled /></el-icon>
  </el-tooltip>
</el-form-item>

<!-- 🆕 详细状态信息（展开显示） -->
<el-alert 
  v-if="formData.workdaysOnly && workdayDetails"
  :type="workdayDetails.alertType"
  :closable="false"
  show-icon
>
  <template #title>
    {{ workdayDetails.title }}
  </template>
  <div v-if="workdayDetails.failedMonths.length > 0">
    <p>待重试月份: {{ workdayDetails.failedMonths.join(', ') }}</p>
    <p>将在每天凌晨1点自动重试</p>
  </div>
</el-alert>
```

### 4.2 状态获取逻辑

```javascript
const workdayStatus = ref(null);
const workdayDetails = ref(null);

// 🆕 开关切换时获取状态
const handleWorkdayToggle = async (enabled) => {
  if (enabled) {
    // 立即获取工作日状态
    await fetchWorkdayStatus();
  } else {
    // 关闭时清除状态
    workdayStatus.value = null;
    workdayDetails.value = null;
  }
};

// 🆕 获取工作日状态API
const fetchWorkdayStatus = async () => {
  try {
    const response = await axios.get('/api/preload/workday-status');
    const data = response.data;
    
    // 设置状态标签
    if (data.dataReady) {
      workdayStatus.value = {
        type: 'success',
        text: '✅ 数据已加载'
      };
    } else if (data.failedMonths.length > 0) {
      workdayStatus.value = {
        type: 'warning',
        text: `⚠️ ${data.failedMonths.length}个月份待重试`
      };
    } else {
      workdayStatus.value = {
        type: 'info',
        text: '🔄 正在加载数据'
      };
    }
    
    // 设置详细信息
    workdayDetails.value = {
      alertType: data.failedMonths.length > 0 ? 'warning' : 'success',
      title: data.message,
      failedMonths: data.failedMonths
    };
    
  } catch (error) {
    workdayStatus.value = {
      type: 'danger',
      text: '❌ 获取状态失败'
    };
  }
};
```

### 4.3 状态显示效果

**场景1：数据正常**
```
[仅工作日 ●] [✅ 数据已加载]
ℹ️ 当前月和下月工作日数据已准备就绪
```

**场景2：有失败需要重试**
```
[仅工作日 ●] [⚠️ 1个月份待重试]
⚠️ 部分月份数据获取失败
待重试月份: 2025-11
将在每天凌晨1点自动重试
```

**场景3：完全失败**
```
[仅工作日 ●] [❌ 获取状态失败]
⚠️ 无法连接到工作日服务
将降级为基础模式：周一至周五视为工作日
注意：此模式无法识别法定节假日和调休
```

### 4.4 新增Workers API端点

**文件**: `cloudflare-worker/src/index.js`

```javascript
// 🆕 GET /api/preload/workday-status
router.get('/api/preload/workday-status', async (req, env) => {
  try {
    // 从VPS获取WorkdayChecker状态
    const response = await fetch(
      `${env.VPS_API_URL}/api/preload/workday-status`,
      {
        headers: {
          'X-API-Key': env.VPS_API_KEY
        }
      }
    );
    
    const data = await response.json();
    
    return Response.json({
      dataReady: data.dataReady,
      failedMonths: data.failedMonths || [],
      currentMonth: data.currentMonth,
      nextMonth: data.nextMonth,
      message: data.message
    });
    
  } catch (error) {
    return Response.json({
      dataReady: false,
      failedMonths: [],
      message: '工作日服务暂时不可用'
    }, { status: 503 });
  }
});
```

### 4.5 新增VPS API端点

**文件**: `src/routes/preload.js` (新建)

```javascript
// 🆕 GET /api/preload/workday-status
router.get('/workday-status', (req, res) => {
  try {
    const checker = req.app.get('workdayChecker');
    
    if (!checker) {
      return res.json({
        dataReady: false,
        failedMonths: [],
        message: 'WorkdayChecker未初始化'
      });
    }
    
    // 获取状态
    const failedMonths = Array.from(checker.failedMonths || []);
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    const nextMonth = checker.getNextMonthKey();
    
    const dataReady = failedMonths.length === 0;
    
    res.json({
      dataReady,
      failedMonths,
      currentMonth,
      nextMonth,
      message: dataReady 
        ? '当前月和下月工作日数据已准备就绪' 
        : `${failedMonths.length}个月份数据获取失败，将自动重试`
    });
    
  } catch (error) {
    res.status(500).json({
      error: '获取工作日状态失败',
      message: error.message
    });
  }
});
```

### 验证
```
1. 打开管理后台 → 预加载配置
2. 开启"仅工作日"开关
3. 立即看到状态标签显示
   ✅ 数据正常: "✅ 数据已加载"
   ⚠️ 有重试: "⚠️ 1个月份待重试"
4. 查看详细信息（Alert组件）
5. 关闭开关，状态消失
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

#### 场景6：前端状态显示 🆕
```
操作: 打开预加载配置对话框
步骤:
  1. 开启"仅工作日"开关
  2. 立即调用 /api/preload/workday-status
  3. 显示状态标签

期望效果:
  ✅ 数据正常时: [✅ 数据已加载]
  ⚠️ 有失败时: [⚠️ 1个月份待重试] + Alert详情
  ❌ 服务异常: [❌ 获取状态失败]
  
交互验证:
  ✅ 开关切换立即显示状态
  ✅ 关闭开关状态消失
  ✅ 重新打开重新获取
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
- [ ] `src/services/WorkdayChecker.js` - 新建（含failedMonths机制）
- [ ] `src/services/PreloadScheduler.js` - 修改（集成WorkdayChecker）
- [ ] `src/routes/preload.js` - 🆕 新建（工作日状态API）
- [ ] `cloudflare-worker/src/index.js` - 修改
  - [ ] PUT /api/preload/config - 添加workdaysOnly字段
  - [ ] GET /api/preload/config - 返回workdaysOnly字段
  - [ ] 🆕 GET /api/preload/workday-status - 新增API
- [ ] `frontend/.../PreloadConfigDialog.vue` - 修改
  - [ ] 添加工作日开关
  - [ ] 🆕 添加状态指示器（el-tag）
  - [ ] 🆕 添加详细信息（el-alert）
  - [ ] 🆕 添加状态获取逻辑

### API端点
- [ ] VPS: `GET /api/preload/workday-status` - 返回failedMonths状态
- [ ] Workers: `GET /api/preload/workday-status` - 代理到VPS

### 依赖
- [ ] axios（已有）
- [ ] node-cron（已有）

### 配置
- [ ] KV: 添加workdaysOnly字段（默认false）
- [ ] VPS app.js: 注册WorkdayChecker到app

### 测试
- [ ] 单元测试: WorkdayChecker
- [ ] 集成测试: 6个场景（新增前端状态显示）
- [ ] 性能测试: 启动时间、内存
- [ ] UI测试: 状态标签显示和交互

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
    console.warn('⚠️ 工作日API失败，降级为基础模式', error);
    
    // 降级为基础模式：周一至周五视为工作日
    // 注意：此模式无法识别法定节假日和调休
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
