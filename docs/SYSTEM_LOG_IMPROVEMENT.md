# 系统日志改进说明

**日期**: 2025-11-17  
**改进内容**: 管理后台系统日志显示优化

---

## 问题描述

管理后台的"系统状态"页签中，系统日志只显示无意义的"Configuration validated successfully"消息，无法帮助用户了解系统实际运行状态。

## 改进方案

### 1. 数据源切换

**之前**：读取 PM2 的 stdout 日志（`/var/log/transcoder/pm2-out.log`）
- 只包含进程的标准输出
- 大部分是配置验证信息
- 缺少应用级别的业务日志

**现在**：读取 Winston 应用日志（`/opt/yoyo-transcoder/logs/combined.log`）
- 包含完整的应用级别日志
- 记录了所有业务操作（频道、录制、转码等）
- 结构化的JSON格式，易于解析

### 2. 智能过滤

添加了 `isMeaningfulLog()` 函数，自动过滤无意义的日志：

**过滤掉的日志**（噪音）：
- `configuration validated` - 配置验证
- `ffmpeg stderr` - FFmpeg错误流
- `frame=`, `bitrate=`, `speed=` - FFmpeg进度信息
- `time=`, `size=`, `dup=`, `drop=` - FFmpeg统计信息

**保留的日志**（有意义）：
- 包含关键词：`starting`, `started`, `stopped`, `recording`, `channel`, `stream`
- 包含关键词：`error`, `failed`, `success`, `warning`, `scheduler`, `initialized`
- 包含关键词：`fetched`, `proxy`, `cleanup`, `deleted`
- **所有** `error` 和 `warn` 级别的日志

### 3. 日志格式化

增强了日志的可读性：

**添加上下文信息**：
```javascript
// 之前
"Channel started successfully"

// 现在
"[stream_ensxma2g] Channel started successfully"
```

**添加关键参数**：
```javascript
// 之前
"RecordScheduler initialized"

// 现在
"RecordScheduler initialized (API: https://yoyoapi.your-domain.com)"
```

**添加统计信息**：
```javascript
// 之前
"Fetched record configs"

// 现在
"Fetched record configs (count: 1, API: https://yoyoapi.your-domain.com)"
```

---

## 代码变更

### 修改文件

`vps-server/src/routes/logs.js`

### 关键函数

#### 1. `parseWinstonLogLine(line)`
解析 Winston JSON 格式的日志：
```javascript
{
  "level": "info",
  "message": "Recording started",
  "timestamp": "2025-11-17T10:00:00.000Z",
  "service": "vps-transcoder-api",
  "channelId": "stream_ensxma2g",
  "rtmpUrl": "rtmp://..."
}
```

#### 2. `isMeaningfulLog(log)`
判断日志是否应该显示：
- 过滤噪音模式
- 匹配有意义模式
- 保留所有错误和警告

#### 3. `GET /api/logs/recent` (重写)
- 读取 `combined.log` 而非 `pm2-out.log`
- 读取 `lines * 5` 行以确保过滤后有足够日志
- 应用智能过滤
- 格式化日志消息
- 添加 channelId 和上下文信息

---

## API 响应示例

### 之前（PM2日志）

```json
{
  "status": "success",
  "data": {
    "logs": [
      {
        "timestamp": "2025-11-17T10:00:00.000Z",
        "level": "info",
        "message": "✅ Configuration validated successfully"
      },
      {
        "timestamp": "2025-11-17T10:00:01.000Z",
        "level": "info",
        "message": "✅ Configuration validated successfully"
      }
    ],
    "total": 2
  }
}
```

### 现在（Winston日志 + 智能过滤）

```json
{
  "status": "success",
  "data": {
    "logs": [
      {
        "timestamp": "2025-11-17T11:02:12.000Z",
        "level": "info",
        "message": "[stream_ensxma2g] Recording started (RTMP: <RTMP_URL>)"
      },
      {
        "timestamp": "2025-11-17T11:02:10.000Z",
        "level": "info",
        "message": "RecordScheduler initialized (API: https://yoyoapi.your-domain.com)"
      },
      {
        "timestamp": "2025-11-17T11:02:09.000Z",
        "level": "info",
        "message": "Fetched record configs (count: 1)"
      },
      {
        "timestamp": "2025-11-17T11:02:05.000Z",
        "level": "info",
        "message": "SimpleStreamManager initialized and cleaned up"
      },
      {
        "timestamp": "2025-11-17T11:00:00.000Z",
        "level": "warn",
        "message": "[stream_cpa2czoo] Channel stopped - stream ended"
      }
    ],
    "total": 5,
    "source": "winston-combined"
  }
}
```

---

## 用户体验改进

### 管理后台 - 系统状态页签

**之前**：
```
2025-11-17 11:00:00 [info] ✅ Configuration validated successfully
2025-11-17 11:00:01 [info] ✅ Configuration validated successfully
2025-11-17 11:00:02 [info] ✅ Configuration validated successfully
...（重复的无用信息）
```

**现在**：
```
2025-11-17 11:02:12 [info] [stream_ensxma2g] Recording started (RTMP: <RTMP_URL>)
2025-11-17 11:02:10 [info] RecordScheduler initialized (API: https://yoyoapi.your-domain.com)
2025-11-17 11:02:09 [info] Fetched record configs (count: 1)
2025-11-17 11:00:05 [warn] [stream_cpa2czoo] Channel stopped - stream ended
2025-11-17 10:55:00 [info] VideoCleanupScheduler: Deleted 3 old files (2.3GB freed)
```

---

## 性能优化

### 1. 日志读取优化

使用 `tail` 命令而非 Node.js `fs.readFile`：
```javascript
// 高效读取大文件的最后N行
const { stdout } = await execAsync(`tail -n ${lines} "${filePath}"`);
```

**优点**：
- 不需要加载整个日志文件到内存
- 速度快，即使日志文件有几GB
- 系统调用级别的优化

### 2. 预读取策略

读取 `lines * 5` 行，过滤后再截取：
```javascript
const rawLines = await readLastLines(logFile, lines * 5);
let logs = rawLines.map(parseWinstonLogLine).filter(log => log !== null);
logs = logs.filter(isMeaningfulLog);
logs = logs.reverse().slice(0, lines);
```

**原因**：
- 过滤会减少日志数量
- 确保返回足够的有意义日志
- 避免前端请求次数

---

## 后续优化建议

### 1. 实时日志推送

使用 WebSocket 或 Server-Sent Events (SSE) 推送实时日志：
```javascript
// 伪代码
const logStream = tail('/opt/yoyo-transcoder/logs/combined.log', { follow: true });
logStream.on('line', (line) => {
  const log = parseWinstonLogLine(line);
  if (isMeaningfulLog(log)) {
    ws.send(JSON.stringify(log));
  }
});
```

### 2. 日志分类标签

添加日志类别标签，方便前端过滤：
```javascript
{
  timestamp: "...",
  level: "info",
  message: "...",
  category: "recording" // 或 "channel", "proxy", "cleanup", "system"
}
```

### 3. 日志搜索

支持关键词搜索和时间范围过滤：
```
GET /api/logs/search?keyword=stream_ensxma2g&startTime=2025-11-17T10:00:00Z
```

### 4. 日志统计

提供日志统计信息：
```javascript
{
  total: 1000,
  byLevel: {
    error: 5,
    warn: 20,
    info: 975
  },
  byCategory: {
    recording: 300,
    channel: 400,
    system: 300
  }
}
```

---

## 部署说明

### 1. 代码更新

```bash
git pull origin master
cd /opt/yoyo-transcoder
cp /tmp/github/secure-streaming-platform/vps-server/src/routes/logs.js src/routes/
```

### 2. 重启服务

```bash
pm2 reload vps-transcoder-api
```

### 3. 验证

```bash
curl http://localhost:3000/api/logs/recent?lines=10 | jq
```

---

## 常见问题

### Q1: 为什么日志还是很旧？

**A**: Winston 日志只在服务启动或有实际操作时才会写入。如果系统空闲，日志文件可能不会更新。

### Q2: 如何查看更多历史日志？

**A**: 增加 `lines` 参数：
```
GET /api/logs/recent?lines=200
```

### Q3: 如何查看实时日志？

**A**: 目前需要手动刷新。后续版本会支持实时推送。

### Q4: 过滤太严格，看不到某些日志？

**A**: 修改 `isMeaningfulLog()` 函数中的 `meaningfulPatterns` 数组，添加更多关键词。

---

## 总结

✅ **问题已解决**：系统日志现在显示有意义的业务信息
✅ **用户体验提升**：管理员可以实时了解系统运行状态
✅ **性能优化**：高效读取大日志文件
✅ **可扩展性**：易于添加新的过滤规则和格式化逻辑

**影响范围**：
- 前端：无需修改，API响应格式保持兼容
- 后端：仅修改日志读取逻辑
- 性能：改进，使用tail命令优化读取
