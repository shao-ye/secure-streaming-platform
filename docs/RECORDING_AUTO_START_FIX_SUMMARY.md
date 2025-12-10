# VPS重启后录制未自动启动 - 问题总结与解决方案

**问题**: 频道"二楼教室1"配置了定时录制（07:40-17:25，仅工作日），VPS重启后当前时间在范围内但录制未自动开始

---

## 根本原因

根据代码分析，VPS重启后录制未自动启动最可能的原因是：

### **WorkdayChecker API失败 → 降级到基础模式 → 工作日判断错误**

1. **启动流程**：
   ```
   VPS重启 
   → RecordScheduler.start() 
   → WorkdayChecker.initialize() 
   → 调用 Timor API (https://timor.tech/api/holiday/info)
   → fetchRecordConfigs() 获取录制配置
   → shouldRecordNow() 判断是否应该录制
   ```

2. **失败点**：
   - `WorkdayChecker` 需要调用 Timor API 获取中国法定节假日数据
   - **VPS重启时网络未稳定** → API调用超时
   - **Timor API限流或故障** → API返回错误
   - **Cloudflare Bot防护拦截** → 403/429错误

3. **降级行为**：
   ```javascript
   // 当API失败时，降级为"基础模式"
   const dayOfWeek = date.getDay();
   const isWorkday = dayOfWeek >= 1 && dayOfWeek <= 5;  // 周一至周五
   ```
   
   **问题**：基础模式无法识别：
   - ❌ 法定节假日（如周三是节假日但基础模式认为是工作日）
   - ❌ 调休工作日（如周六上班但基础模式认为不是工作日）
   - ❌ 周末（当天是周六/周日）

4. **结果**：
   - `shouldRecordNow()` 返回 `false`
   - VPS启动时跳过了立即开始录制
   - 只设置了定时任务（等到下个开始时间触发）

---

## 快速解决方案（立即生效）

### 方法 1：使用PowerShell脚本触发重载

```powershell
# 设置API密钥
$env:VPS_API_KEY = "your-api-key-here"

# 运行脚本
.\scripts\fix\trigger-recording-reload.ps1
```

### 方法 2：使用curl命令

```bash
curl -X POST https://yoyo-vps.your-domain.com/api/simple-stream/record/reload-schedule \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 方法 3：重启VPS服务

```bash
ssh root@yoyo-vps 'pm2 restart vps-api'
```

---

## 诊断工具

使用诊断脚本检查当前状态：

```powershell
$env:VPS_API_KEY = "your-api-key-here"
.\scripts\test\check-recording.ps1
```

诊断脚本会检查：
1. Workers API连接和配置获取
2. 目标频道配置详情
3. 当前时间是否在录制范围内
4. 工作日状态（调用Timor API）
5. VPS当前录制状态
6. RecordScheduler调度器状态
7. 综合判断和建议操作

---

## 长期修复方案

### 方案 A：增加WorkdayChecker重试机制（推荐）

修改 `vps-server/src/services/WorkdayChecker.js`，在API调用失败时增加重试：

```javascript
async isWorkday(date = new Date()) {
  // 尝试从API获取，带重试机制
  let retries = 3;
  let lastError;
  
  while (retries > 0) {
    try {
      const response = await fetch(`${this.apiUrl}/${dateStr}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 ...' },
        signal: AbortSignal.timeout(5000)  // 5秒超时
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
        logger.warn(`WorkdayChecker API failed, retrying (${retries} left)...`, { error: error.message });
        await new Promise(resolve => setTimeout(resolve, 2000));  // 等待2秒重试
      }
    }
  }
  
  // 所有重试失败后降级
  logger.warn('WorkdayChecker API failed after retries, falling back to basic mode', { lastError });
  // ... 降级逻辑
}
```

### 方案 B：预加载月度工作日数据

修改 `WorkdayChecker.initialize()`，在启动时预取整月数据：

```javascript
async initialize() {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    
    // 🆕 预取整月数据
    await this.prefetchMonthData(year, month);
    
    // 验证今天的数据已缓存
    const dateStr = this.formatDate(now);
    if (!this.cache.has(dateStr)) {
      throw new Error('Failed to cache today\'s workday data');
    }
    
    logger.info('✅ WorkdayChecker initialized with today\'s data cached');
  }
}
```

### 方案 C：添加启动健康检查

修改 `vps-server/src/app.js`：

```javascript
// 启动RecordScheduler
if (recordScheduler) {
  try {
    await recordScheduler.start();
    logger.info('✅ RecordScheduler started successfully');
    
    // 🆕 延迟5秒后检查调度器状态
    setTimeout(async () => {
      const status = recordScheduler.getStatus();
      
      if (!status.isRunning || status.totalScheduled === 0) {
        logger.error('⚠️ RecordScheduler appears unhealthy, attempting reload...');
        
        try {
          await recordScheduler.reloadSchedule();
          logger.info('✅ RecordScheduler reloaded successfully');
        } catch (reloadError) {
          logger.error('❌ Failed to reload RecordScheduler', { error: reloadError.message });
        }
      } else {
        logger.info('✅ RecordScheduler health check passed', {
          scheduledChannels: status.totalScheduled
        });
      }
    }, 5000);
    
  } catch (error) {
    logger.error('❌ Failed to start RecordScheduler', { error: error.message });
  }
}
```

---

## 验证步骤

### 1. 检查VPS日志

```bash
ssh root@yoyo-vps 'pm2 logs vps-api --lines 100 --nostream | grep -E "RecordScheduler|Workday|shouldRecordNow"'
```

关键日志：
- ✅ `RecordScheduler started successfully` - 启动成功
- ✅ `Fetched record configs, count: N` - 获取N个配置
- ⚠️ `Workday API failed, falling back to basic mode` - **API失败**
- ⚠️ `Not in time range` - 时间判断
- ⚠️ `Not a workday, skipping` - 工作日判断

### 2. 测试Timor API

```bash
# 测试今天
curl "https://timor.tech/api/holiday/info/$(date +%Y-%m-%d)" -H "User-Agent: Mozilla/5.0"

# 预期响应
{
  "code": 0,
  "type": {
    "type": 0,      // 0=工作日, 1=周末, 2=节假日, 3=调休工作日
    "name": "工作日",
    "week": 5
  }
}
```

### 3. 验证Workers API

```bash
curl https://yoyoapi.your-domain.com/api/record/configs \
  -H "X-API-Key: YOUR_API_KEY"
```

### 4. 检查RecordScheduler状态

```bash
curl https://yoyo-vps.your-domain.com/api/simple-stream/record/status \
  -H "X-API-Key: YOUR_API_KEY"
```

---

## 预防措施

1. **监控WorkdayChecker**：在日志中添加 WorkdayChecker 状态报告
2. **启动健康检查**：实施方案C，自动检测和修复
3. **备用工作日API**：考虑添加备用API（如百度日历API）
4. **改进降级策略**：降级时记录警告，并在下次cron运行时重试

---

## 相关文件

- **诊断脚本**: `scripts/test/check-recording.ps1`
- **修复脚本**: `scripts/fix/trigger-recording-reload.ps1`
- **详细分析**: `docs/RECORDING_AUTO_START_ISSUE_ANALYSIS.md`
- **核心代码**:
  - `vps-server/src/services/RecordScheduler.js`
  - `vps-server/src/services/WorkdayChecker.js`
  - `vps-server/src/app.js` (Line 386-397)

---

## 总结

**问题**: VPS重启时 WorkdayChecker API调用失败 → 降级到基础模式 → 工作日判断错误 → 录制未启动

**立即解决**: 运行 `.\scripts\fix\trigger-recording-reload.ps1` 手动触发重载

**长期修复**: 实施重试机制（方案A）+ 启动健康检查（方案C）
