# YOYO流媒体平台 - 登录日志R2存储桶迁移方案

## 📋 项目背景

### 当前登录日志存储方案
- **存储位置**: Cloudflare KV
- **存储格式**: `login_log:timestamp:username` 键值对
- **数据结构**: JSON格式的单条日志记录
- **TTL设置**: 7天自动过期
- **问题**: KV不支持前缀查询，无法高效获取历史日志列表

### 目标R2存储方案
- **存储位置**: Cloudflare R2对象存储
- **存储格式**: 按日期分组的JSON文件
- **查询能力**: 支持日期范围查询和分页
- **成本优化**: R2存储成本更低，适合大量日志数据

---

## 🏗️ 技术架构设计

### R2存储结构设计
```
yoyo-login-logs/                    # R2存储桶名称
├── 2025/                          # 年份目录
│   ├── 10/                        # 月份目录
│   │   ├── 05/                    # 日期目录
│   │   │   ├── login-logs.json    # 当日登录日志汇总
│   │   │   └── metadata.json      # 元数据（统计信息）
│   │   └── 06/
│   │       ├── login-logs.json
│   │       └── metadata.json
│   └── 11/
└── index/                         # 索引目录
    ├── latest.json                # 最新日志索引
    └── monthly-stats.json         # 月度统计
```

### 数据格式设计

#### 统计分析能力说明
R2存储设计完全支持未来的用户登录数据统计分析：

**1. 登录趋势分析**
- 按日/周/月统计登录次数和成功率
- 识别登录高峰时段和低谷期
- 分析用户活跃度变化趋势

**2. 用户行为分析**
- 用户登录频率统计（日活、周活、月活）
- 用户会话时长分析
- 频繁登录用户识别

**3. 安全监控分析**
- 失败登录统计和异常检测
- 可疑IP地址识别
- 暴力破解攻击检测

**4. 地理分布分析**
- 用户登录地理位置统计
- 国家/城市分布热力图
- 异地登录检测

**5. 设备和技术分析**
- 用户设备类型统计（桌面/移动）
- 浏览器使用情况分析
- 操作系统分布统计

**6. 性能监控分析**
- 登录响应时间统计
- 系统性能瓶颈识别
- 用户体验优化建议

#### 日志文件格式 (login-logs.json)
```json
{
  "date": "2025-10-05",
  "logs": [
    {
      "id": "log_20251005_143022_001",
      "username": "admin",
      "ip": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "timestamp": "2025-10-05T14:30:22.123Z",
      "status": "success",
      "location": "中国 北京",
      "details": {
        "sessionId": "sess_xxx",
        "role": "admin",
        "responseTime": 245
      }
    }
  ],
  "stats": {
    "total": 15,
    "success": 12,
    "failed": 3,
    "uniqueUsers": 3,
    "uniqueIPs": 5
  }
}
```

#### 元数据格式 (metadata.json)
```json
{
  "date": "2025-10-05",
  "totalLogs": 15,
  "successCount": 12,
  "failedCount": 3,
  "uniqueUsers": ["admin", "user1", "user2"],
  "uniqueIPs": ["192.168.1.100", "192.168.1.101"],
  "firstLogTime": "2025-10-05T08:30:22.123Z",
  "lastLogTime": "2025-10-05T18:45:33.456Z",
  "fileSize": 2048,
  "lastUpdated": "2025-10-05T18:45:35.000Z"
}
```

---

## 🔧 代码修改方案

### 1. Cloudflare Workers修改

#### 1.1 环境变量配置
```javascript
// wrangler.toml 新增R2绑定
[[r2_buckets]]
binding = "LOGIN_LOGS_BUCKET"
bucket_name = "yoyo-login-logs"
```

#### 1.2 新增R2日志服务 (src/utils/r2-logger.js)
```javascript
export class R2LoginLogger {
  constructor(bucket) {
    this.bucket = bucket;
  }

  async recordLogin(logEntry) {
    const date = new Date(logEntry.timestamp);
    const dateStr = date.toISOString().split('T')[0];
    const filePath = this.getLogFilePath(date);
    
    // 获取当日日志文件
    let dailyLogs = await this.getDailyLogs(filePath);
    
    // 添加新日志
    dailyLogs.logs.push(logEntry);
    dailyLogs.stats = this.calculateStats(dailyLogs.logs);
    
    // 保存到R2
    await this.saveDailyLogs(filePath, dailyLogs);
    await this.updateMetadata(date, dailyLogs);
  }

  async getLoginLogs(startDate, endDate, limit = 100, offset = 0) {
    const logs = [];
    const dateRange = this.getDateRange(startDate, endDate);
    
    for (const date of dateRange) {
      const filePath = this.getLogFilePath(date);
      const dailyLogs = await this.getDailyLogs(filePath);
      logs.push(...dailyLogs.logs);
    }
    
    // 按时间倒序排列并分页
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return {
      logs: logs.slice(offset, offset + limit),
      total: logs.length,
      hasMore: logs.length > offset + limit
    };
  }

  getLogFilePath(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}/login-logs.json`;
  }
}
```

#### 1.3 修改认证处理器 (src/handlers/auth.js)
```javascript
import { R2LoginLogger } from '../utils/r2-logger.js';

// 替换原有的 recordLoginLog 函数
async function recordLoginLog(env, username, request, success, details = {}) {
  try {
    const logger = new R2LoginLogger(env.LOGIN_LOGS_BUCKET);
    
    const logEntry = {
      id: `log_${Date.now()}_${generateRandomString(8)}`,
      username: username || '未知',
      ip: request.headers.get('CF-Connecting-IP') || '未知',
      userAgent: request.headers.get('User-Agent') || '未知',
      timestamp: new Date().toISOString(),
      status: success ? 'success' : 'failed',
      location: `${request.cf?.country || '未知'} ${request.cf?.city || '未知'}`,
      details: details
    };

    await logger.recordLogin(logEntry);
    console.log('Login log recorded to R2:', { username, success });
  } catch (error) {
    console.error('Failed to record login log to R2:', error);
    // 降级到KV存储
    await recordLoginLogToKV(env, username, request, success, details);
  }
}
```

#### 1.4 修改管理员处理器 (src/handlers/admin.js)
```javascript
import { R2LoginLogger } from '../utils/r2-logger.js';

async getLoginLogs(request, env, ctx) {
  try {
    const authResult = await requireAdmin(request, env);
    if (authResult.error) return authResult.error;

    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate') || 
                     new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = url.searchParams.get('endDate') || 
                   new Date().toISOString().split('T')[0];
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const logger = new R2LoginLogger(env.LOGIN_LOGS_BUCKET);
    const result = await logger.getLoginLogs(
      new Date(startDate), 
      new Date(endDate), 
      limit, 
      offset
    );

    return successResponse({
      logs: result.logs,
      total: result.total,
      hasMore: result.hasMore,
      pagination: { limit, offset },
      dateRange: { startDate, endDate },
      timestamp: new Date().toISOString()
    }, 'Login logs retrieved successfully', request);

  } catch (error) {
    console.error('Admin get login logs error:', error);
    return errorResponse('Failed to retrieve login logs', 'ADMIN_LOGIN_LOGS_ERROR', 500, request);
  }
}
```

### 2. 前端修改

#### 2.1 修改系统诊断组件 (src/components/SystemDiagnostics.vue)
```javascript
// 添加日期范围选择和分页功能
const dateRange = ref([
  new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  new Date()
]);
const pagination = reactive({
  current: 1,
  pageSize: 20,
  total: 0
});

const refreshLoginLogs = async () => {
  loading.loginLogs = true;
  try {
    const [startDate, endDate] = dateRange.value;
    const params = new URLSearchParams({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      limit: pagination.pageSize.toString(),
      offset: ((pagination.current - 1) * pagination.pageSize).toString()
    });

    const response = await axios.get(`/api/admin/login/logs?${params}`);
    if (response.data.status === 'success') {
      loginLogs.value = response.data.data.logs;
      pagination.total = response.data.data.total;
      infoLog('登录日志刷新成功');
    }
  } catch (error) {
    errorLog('获取登录日志失败:', error);
    ElMessage.error('获取登录日志失败');
  } finally {
    loading.loginLogs = false;
  }
};
```

#### 2.2 增强日志显示界面
```vue
<template>
  <el-card class="login-logs-card">
    <template #header>
      <div class="card-header">
        <span>登录日志</span>
        <div class="header-controls">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            size="small"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="refreshLoginLogs"
          />
          <el-button size="small" :icon="Refresh" @click="refreshLoginLogs" :loading="loading.loginLogs" />
        </div>
      </div>
    </template>

    <div class="logs-container">
      <div v-if="loginLogs.length > 0">
        <div v-for="log in loginLogs" :key="log.id" class="login-log-item">
          <!-- 日志显示内容 -->
        </div>
        
        <el-pagination
          v-model:current-page="pagination.current"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="refreshLoginLogs"
          @current-change="refreshLoginLogs"
        />
      </div>
    </div>
  </el-card>
</template>
```

### 3. VPS转码服务修改

#### 3.1 VPS端不需要修改
- VPS转码服务不涉及登录日志功能
- 所有登录相关逻辑都在Cloudflare Workers中处理
- VPS只负责视频转码和HLS文件服务

---

## 🔄 迁移实施步骤

### 阶段一：R2存储桶创建和配置 (30分钟)
1. **创建R2存储桶**
   ```bash
   wrangler r2 bucket create yoyo-login-logs
   ```

2. **配置CORS策略**
   ```json
   {
     "AllowedOrigins": ["https://yoyo.5202021.xyz"],
     "AllowedMethods": ["GET", "PUT", "POST"],
     "AllowedHeaders": ["*"],
     "MaxAgeSeconds": 3600
   }
   ```

3. **更新wrangler.toml配置**
   ```toml
   [[r2_buckets]]
   binding = "LOGIN_LOGS_BUCKET"
   bucket_name = "yoyo-login-logs"
   ```

### 阶段二：后端代码实现 (2小时)
1. **实现R2LoginLogger类** (45分钟)
   - 创建 `src/utils/r2-logger.js`
   - 实现日志记录和查询功能
   - 添加错误处理和降级机制

2. **修改认证处理器** (30分钟)
   - 更新 `recordLoginLog` 函数
   - 集成R2Logger
   - 保留KV降级方案

3. **修改管理员API** (45分钟)
   - 更新 `getLoginLogs` 方法
   - 添加分页和日期范围支持
   - 优化查询性能

### 阶段三：前端功能增强 (1.5小时)
1. **增强日志查询界面** (60分钟)
   - 添加日期范围选择器
   - 实现分页功能
   - 优化移动端显示

2. **测试和调试** (30分钟)
   - 验证日志查询功能
   - 测试分页和筛选
   - 检查移动端兼容性

### 阶段四：测试和验证 (30分钟)
1. **功能测试** (20分钟)
   - 测试登录日志记录到R2
   - 验证管理后台查询功能
   - 测试分页和日期筛选

2. **性能验证** (10分钟)
   - 验证日志记录性能
   - 测试查询响应时间
   - 确认R2存储成本优化

---

## 📊 成本和性能分析

### 存储成本对比
| 存储方案 | 月存储成本 | 请求成本 | 总成本预估 |
|---------|-----------|----------|-----------|
| KV存储 | $0.50/GB | $0.50/百万次 | $2-5/月 |
| R2存储 | $0.015/GB | $0.36/百万次 | $0.5-1/月 |
| **节省** | **97%** | **28%** | **75-80%** |

### 性能优势
- **查询性能**: R2支持范围查询，比KV单键查询更高效
- **存储容量**: R2无存储限制，KV有单键64KB限制
- **数据持久性**: R2提供更高的数据持久性保证
- **分析能力**: R2支持复杂查询和数据分析

---

## 🛡️ 风险评估和应对

### 潜在风险
1. **R2服务可用性**: R2服务中断影响日志查询
2. **数据迁移风险**: 历史数据迁移过程中可能丢失
3. **API兼容性**: 前端API调用需要适配新的分页参数

### 应对措施
1. **降级机制**: R2不可用时自动降级到KV存储
2. **数据清理**: 清理KV中的旧日志键，避免存储浪费
3. **渐进式部署**: 先部署新功能，从新登录开始使用R2存储
4. **监控告警**: 添加R2操作的监控和告警机制

---

## ✅ 验收标准

### 功能验收
- [ ] 登录日志正确记录到R2存储桶
- [ ] 管理后台可以查询指定日期范围的日志
- [ ] 支持分页查询，每页最多100条记录
- [ ] 日志显示包含所有必要信息（用户名、IP、时间、状态等）
- [ ] 移动端界面正常显示和操作

### 性能验收
- [ ] 日志记录响应时间 < 200ms
- [ ] 日志查询响应时间 < 1s
- [ ] 支持并发登录时的日志记录
- [ ] R2存储成本比KV降低70%以上

### 稳定性验收
- [ ] R2不可用时自动降级到KV
- [ ] 新登录日志正确存储到R2
- [ ] 7天内无相关错误报告
- [ ] 监控指标正常

---

## 📅 实施时间表

| 阶段 | 预计时间 | 负责人 | 交付物 |
|------|---------|--------|--------|
| 方案评审 | 0.5小时 | 开发团队 | 确认技术方案 |
| R2配置 | 0.5小时 | DevOps | R2存储桶和配置 |
| 后端开发 | 2小时 | 后端开发 | R2Logger和API |
| 前端开发 | 1.5小时 | 前端开发 | 增强查询界面 |
| 测试部署 | 0.5小时 | 全栈开发 | 功能验证 |
| **总计** | **5小时** | | **完整迁移方案** |

---

**文档创建时间**: 2025年10月5日 21:35  
**方案版本**: v1.0  
**预计完成时间**: 2025年10月6日  
**维护人员**: YOYO开发团队
