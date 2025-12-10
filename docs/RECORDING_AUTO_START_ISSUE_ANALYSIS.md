# VPS重启后录制未自动启动问题分析

**日期**: 2025-11-17  
**问题**: VPS重启后，频道"二楼教室1"的录制未自动开始，尽管当前时间在设置的录制时间范围内（07:40-17:25）

---

## 问题现象

根据提供的截图：
- 频道名称：二楼教室1
- 定时录制：已启用（enabled: true）
- 开始时间：07:40
- 结束时间：17:25
- 仅工作日：已启用（workdaysOnly: true）
- VPS重启后，当前时间在录制范围内，但录制未自动开始

---

## 代码分析

### 1. RecordScheduler启动流程

```javascript
// vps-server/src/app.js: 386-397
if (recordScheduler) {
  try {
    logger.info('🔄 Starting RecordScheduler...');
    await recordScheduler.start();  // ⚠️ 关键点：这里启动调度器
    logger.info('✅ RecordScheduler started successfully');
  } catch (error) {
    logger.error('❌ Failed to start RecordScheduler', { 
      error: error.message,
      stack: error.stack 
    });
  }
}
```

### 2. RecordScheduler.start() 方法

```javascript
// vps-server/src/services/RecordScheduler.js: 34-78
async start() {
  if (this.isRunning) {
    logger.warn('RecordScheduler already running');
    return;
  }
  
  try {
    logger.info('Starting RecordScheduler...');
    
    // 1. 初始化工作日检查器
    await this.workdayChecker.initialize();
    logger.info('WorkdayChecker initialized');
    
    // 2. 获取所有录制配置
    const configs = await this.fetchRecordConfigs();  // ⚠️ 关键点
    logger.info('Fetched record configs', { count: configs.length });
    
    // 3. 处理每个配置
    for (const config of configs) {
      try {
        // 检查是否应该立即开始录制
        if (await this.shouldRecordNow(config)) {  // ⚠️ 关键判断
          logger.info('Starting immediate recording', { channelId: config.channelId });
          await this.startRecording(config);
        }
        
        // 设置定时任务
        this.scheduleChannel(config);
      } catch (error) {
        logger.error('Failed to process record config', { 
          channelId: config.channelId, 
          error: error.message 
        });
      }
    }
    
    this.isRunning = true;
    logger.info('RecordScheduler started successfully', {
      scheduledChannels: this.cronTasks.size
    });
  } catch (error) {
    logger.error('Failed to start RecordScheduler', { error: error.message });
    throw error;
  }
}
```

### 3. shouldRecordNow() 判断逻辑

```javascript
// vps-server/src/services/RecordScheduler.js: 147-170
async shouldRecordNow(config) {
  const currentTime = moment().tz('Asia/Shanghai').format('HH:mm');
  const inTimeRange = this.isInTimeRange(currentTime, config.startTime, config.endTime);
  
  if (!inTimeRange) {
    logger.debug('Not in time range', { 
      channelId: config.channelId, 
      currentTime, 
      startTime: config.startTime, 
      endTime: config.endTime 
    });
    return false;  // ⚠️ 时间不在范围内
  }
  
  if (config.workdaysOnly) {
    const isWorkday = await this.workdayChecker.isWorkday();
    if (!isWorkday) {
      logger.debug('Not a workday, skipping', { channelId: config.channelId });
      return false;  // ⚠️ 不是工作日
    }
  }
  
  return true;
}
```

### 4. WorkdayChecker 实现

```javascript
// vps-server/src/services/WorkdayChecker.js: 96-163
async isWorkday(date = new Date()) {
  const dateStr = this.formatDate(date);
  
  // 1. 检查缓存
  if (this.cache.has(dateStr)) {
    const cached = this.cache.get(dateStr);
    if (Date.now() - cached.cachedAt < this.cacheExpiry) {
      logger.debug('Workday check from cache', { date: dateStr, isWorkday: cached.isWorkday });
      return cached.isWorkday;
    }
  }
  
  // 2. 调用API获取
  try {
    const response = await fetch(`${this.apiUrl}/${dateStr}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 ...'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // 解析工作日状态
    // type: 0=工作日, 1=周末, 2=节假日, 3=调休工作日
    const isWorkday = (data.type.type === 0 || data.type.type === 3);
    
    // 3. 写入缓存
    this.cache.set(dateStr, {
      isWorkday,
      cachedAt: Date.now()
    });
    
    return isWorkday;
    
  } catch (error) {
    // 4. 容错：降级为基础模式 ⚠️ 关键点
    logger.warn('⚠️ Workday API failed, falling back to basic mode', { 
      date: dateStr,
      error: error.message 
    });
    
    // 降级为基础模式：周一至周五视为工作日
    const dayOfWeek = date.getDay();
    const isWorkday = dayOfWeek >= 1 && dayOfWeek <= 5;
    
    this.cache.set(dateStr, {
      isWorkday,
      cachedAt: Date.now()
    });
    
    return isWorkday;
  }
}
```

---

## 可能的原因

### 1. **Timor API调用失败**（最可能）

VPS重启后，`WorkdayChecker`在初始化时需要调用 `https://timor.tech/api/holiday/info` 来获取工作日信息。

可能的失败场景：
- ✅ **API超时或网络问题**：VPS刚重启时网络可能还未完全稳定
- ✅ **API速率限制**：Timor API可能有请求频率限制
- ✅ **Cloudflare Bot防护**：API可能拦截了VPS的请求

当API调用失败时，代码会降级到"基础模式"（周一至周五=工作日），但：
- ⚠️ **如果今天是周末**，基础模式会返回 `false`
- ⚠️ **如果今天是调休工作日**（如周六周日上班），基础模式无法识别

### 2. **Workers API配置获取失败**

```javascript
// RecordScheduler.js: fetchRecordConfigs()
const response = await fetch(`${this.workersApiUrl}/api/record/configs`, {
  headers: {
    'X-API-Key': apiKey
  }
});
```

可能的问题：
- `VPS_API_KEY` 环境变量未设置或错误
- Workers API网络连接失败
- Cloudflare限流或错误

如果这个步骤失败，`fetchRecordConfigs()` 会返回空数组 `[]`，导致没有任何频道被调度。

### 3. **时间判断边界问题**

```javascript
isInTimeRange(current, start, end) {
  const currentMins = ch * 60 + cm;
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  
  // 正常情况
  return currentMins >= startMins && currentMins < endMins;  // ⚠️ 注意是 <，不是 <=
}
```

如果VPS重启时间正好在 `17:25`，由于使用 `<` 而非 `<=`，会判断为不在范围内。

### 4. **RecordScheduler初始化异常被捕获**

```javascript
// app.js
try {
  await recordScheduler.start();
} catch (error) {
  logger.error('❌ Failed to start RecordScheduler', { error, stack });
  // ⚠️ 错误被捕获但服务继续运行，录制功能失效
}
```

如果 `start()` 抛出异常，服务器会继续运行，但录制调度器实际未启动。

---

## 诊断步骤

### 使用诊断脚本

```powershell
# 设置API Key（从.env文件获取）
$env:VPS_API_KEY = "your-api-key-here"

# 运行诊断
.\scripts\test\check-recording.ps1
```

### 手动检查VPS日志

```bash
ssh root@yoyo-vps

# 查看PM2日志
pm2 logs vps-api --lines 100 --nostream

# 搜索关键日志
pm2 logs vps-api --lines 500 --nostream | grep -i "recordscheduler\|workday"
```

关键日志标记：
- `✅ RecordScheduler started successfully` - 启动成功
- `❌ Failed to start RecordScheduler` - 启动失败
- `Fetched record configs, count: X` - 获取到X个配置
- `Not in time range` - 时间不在范围内
- `Not a workday, skipping` - 不是工作日
- `⚠️ Workday API failed, falling back to basic mode` - **关键：API失败**

### 手动测试Workers API

```bash
curl -X GET https://yoyoapi.your-domain.com/api/record/configs \
  -H "X-API-Key: YOUR_API_KEY"
```

预期响应：
```json
{
  "status": "success",
  "data": [
    {
      "channelId": "...",
      "channelName": "二楼教室1",
      "enabled": true,
      "startTime": "07:40",
      "endTime": "17:25",
      "workdaysOnly": true,
      "rtmpUrl": "..."
    }
  ]
}
```

### 手动测试Timor API

```bash
curl -X GET "https://timor.tech/api/holiday/info/$(date +%Y-%m-%d)" \
  -H "User-Agent: Mozilla/5.0"
```

---

## 解决方案

### 方案 1：手动触发录制调度重载（立即生效）

```bash
curl -X POST https://yoyo-vps.your-domain.com/api/simple-stream/record/reload-schedule \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

### 方案 2：重启VPS服务（推荐）

```bash
ssh root@yoyo-vps 'pm2 restart vps-api'
```

### 方案 3：增加WorkdayChecker容错和重试机制

```javascript
// 修改 WorkdayChecker.js
async isWorkday(date = new Date()) {
  // ... existing code ...
  
  try {
    // 🆕 添加重试逻辑
    let retries = 3;
    let lastError;
    
    while (retries > 0) {
      try {
        const response = await fetch(`${this.apiUrl}/${dateStr}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 ...'
          },
          timeout: 5000  // 5秒超时
        });
        
        if (response.ok) {
          const data = await response.json();
          const isWorkday = (data.type.type === 0 || data.type.type === 3);
          this.cache.set(dateStr, { isWorkday, cachedAt: Date.now() });
          return isWorkday;
        }
      } catch (error) {
        lastError = error;
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));  // 等待1秒重试
        }
      }
    }
    
    throw lastError;
    
  } catch (error) {
    // 降级处理
    // ...
  }
}
```

### 方案 4：预缓存工作日数据（最佳长期方案）

修改 `RecordScheduler.start()` 确保工作日数据已初始化：

```javascript
async start() {
  try {
    // 1. 确保WorkdayChecker初始化完成
    logger.info('Initializing WorkdayChecker...');
    await this.workdayChecker.initialize();
    
    // 🆕 2. 验证工作日数据是否可用
    const today = new Date();
    try {
      const isWorkday = await this.workdayChecker.isWorkday(today);
      logger.info('WorkdayChecker ready', { 
        today: today.toISOString().split('T')[0],
        isWorkday 
      });
    } catch (error) {
      logger.warn('WorkdayChecker validation failed', { error: error.message });
    }
    
    // 3. 继续后续流程...
    const configs = await this.fetchRecordConfigs();
    // ...
  }
}
```

### 方案 5：添加启动后的健康检查

在 `app.js` 中添加：

```javascript
// 🆕 启动RecordScheduler后进行健康检查
if (recordScheduler) {
  try {
    await recordScheduler.start();
    logger.info('✅ RecordScheduler started successfully');
    
    // 🆕 健康检查：延迟5秒后检查状态
    setTimeout(async () => {
      const status = recordScheduler.getStatus();
      if (status.scheduledChannels.length === 0) {
        logger.error('⚠️ RecordScheduler has no scheduled channels after startup!');
        // 🆕 尝试重新加载
        try {
          await recordScheduler.reloadSchedule();
          logger.info('✅ RecordScheduler reloaded successfully');
        } catch (reloadError) {
          logger.error('Failed to reload scheduler', { error: reloadError.message });
        }
      }
    }, 5000);
  } catch (error) {
    logger.error('❌ Failed to start RecordScheduler', { error, stack });
  }
}
```

---

## 最可能的根本原因

根据代码分析和架构设计，**最可能的原因**是：

**VPS重启后，`WorkdayChecker` 调用 Timor API 失败，降级到基础模式（周一至周五），但如果：**
1. 今天是周末
2. 或者今天是法定节假日
3. 或者网络连接不稳定导致API超时

**则会错误地判断为"不是工作日"，即使配置中设置了 `workdaysOnly: true`。**

---

## 立即行动建议

1. **检查VPS日志**：
   ```bash
   ssh root@yoyo-vps 'pm2 logs vps-api --lines 100 --nostream | grep -i "workday\|record"'
   ```

2. **如果今天应该录制，立即触发重载**：
   ```bash
   curl -X POST https://yoyo-vps.your-domain.com/api/simple-stream/record/reload-schedule \
     -H "X-API-Key: YOUR_API_KEY" \
     -H "Content-Type: application/json"
   ```

3. **验证是否是工作日API问题**：
   ```bash
   curl "https://timor.tech/api/holiday/info/$(date +%Y-%m-%d)"
   ```

4. **长期修复**：实施方案3（重试机制）或方案4（预缓存）

---

## 相关代码文件

- `vps-server/src/app.js`: Line 386-397 (RecordScheduler启动)
- `vps-server/src/services/RecordScheduler.js`: Line 34-78 (start方法), Line 147-170 (shouldRecordNow)
- `vps-server/src/services/WorkdayChecker.js`: Line 96-163 (isWorkday方法)
- `cloudflare-worker/src/handlers/recordHandler.js`: Line 51-106 (getAllRecordConfigs)
