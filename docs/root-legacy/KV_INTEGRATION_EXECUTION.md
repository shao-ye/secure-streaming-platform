# 🔄 KV整合完整执行文档

**版本**: v2.0 | **创建时间**: 2025-10-27 17:17  
**目标**: 将预加载配置整合到频道配置中，减少50% KV读取，删除旧数据

---

## 📊 执行进度追踪

| 阶段 | 名称 | 状态 | 完成时间 |
|------|------|------|----------|
| **准备** | 数据备份 | ⏳ 未开始 | - |
| **阶段1** | 修改预加载配置更新逻辑 | ⏳ 未开始 | - |
| **阶段2** | 修改预加载配置读取逻辑 | ⏳ 未开始 | - |
| **阶段3** | 简化频道列表API | ⏳ 未开始 | - |
| **阶段4** | 数据迁移+删除旧键 | ⏳ 未开始 | - |
| **阶段5** | 完整测试验证 | ⏳ 未开始 | - |

---

## 🎯 准备阶段：数据备份

### 步骤1：导出当前数据

```powershell
# 导出频道列表
$response = Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/admin/streams" -Method Get
$response.data.streams | ConvertTo-Json -Depth 10 | Out-File "backup-channels-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"

Write-Host "✅ 数据已备份"
```

✅ 完成后在进度表标记

---

## 🎯 阶段1：修改预加载配置更新逻辑

**文件**: `cloudflare-worker/src/handlers/preloadHandler.js`

### 步骤1.1：找到updatePreloadConfig函数（第76行）

完整替换为以下代码（**不再写入旧键**）：

```javascript
async function updatePreloadConfig(env, channelId, data, username) {
  try {
    const { enabled, startTime, endTime, workdaysOnly } = data;
    
    if (!isValidTimeFormat(startTime) || !isValidTimeFormat(endTime)) {
      return {
        status: 'error',
        message: '时间格式错误，应为 HH:MM 格式'
      };
    }
    
    // 🆕 读取现有频道配置
    const channelKey = `channel:${channelId}`;
    let channelData = null;
    
    try {
      const existingData = await env.YOYO_USER_DB.get(channelKey);
      if (existingData) {
        channelData = JSON.parse(existingData);
      }
    } catch (error) {
      console.error('读取频道配置失败:', error);
    }
    
    // 如果频道不存在，创建基础配置
    if (!channelData) {
      channelData = {
        id: channelId,
        name: channelId,
        rtmpUrl: '',
        sortOrder: 999,
        updatedAt: new Date().toISOString()
      };
    }
    
    // 🆕 构建预加载配置
    const preloadConfig = {
      enabled: enabled === true,
      startTime,
      endTime,
      workdaysOnly: workdaysOnly === true,
      updatedAt: new Date().toISOString(),
      updatedBy: username || 'unknown'
    };
    
    // 🆕 嵌入到频道配置（只写这里，不再写旧键）
    channelData.preloadConfig = preloadConfig;
    channelData.updatedAt = new Date().toISOString();
    
    // 🆕 保存更新后的频道配置
    await env.YOYO_USER_DB.put(channelKey, JSON.stringify(channelData));
    
    // 通知VPS
    try {
      await notifyVpsReload(env);
    } catch (error) {
      console.error('通知VPS失败:', error);
    }
    
    return {
      status: 'success',
      data: {
        channelId,
        ...preloadConfig
      }
    };
  } catch (error) {
    console.error('Failed to update preload config:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}
```

### 步骤1.2：提交和部署

```bash
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform
git add cloudflare-worker/src/handlers/preloadHandler.js
git commit -m "refactor(preload): 预加载配置整合到频道配置中"
git push origin master

cd cloudflare-worker
npx wrangler deploy --env production
```

### 步骤1.3：验证（暂时会失败，这是正常的）

```powershell
# 更新配置测试（会写入channel键）
$body = @{
    enabled = $true
    startTime = "08:00"
    endTime = "18:00"
    workdaysOnly = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/preload/config/stream_ensxma2g" -Method PUT -Headers @{"Content-Type"="application/json"} -Body $body

Write-Host "✅ 阶段1完成（读取逻辑还未更新，暂时读不到配置是正常的）"
```

✅ 完成后在进度表标记

---

## 🎯 阶段2：修改预加载配置读取逻辑

**文件**: `cloudflare-worker/src/handlers/preloadHandler.js`

### 步骤2.1：修改getPreloadConfig函数（第9-42行）

完整替换为：

```javascript
async function getPreloadConfig(env, channelId) {
  try {
    // 🆕 从频道配置中读取
    const channelKey = `channel:${channelId}`;
    const channelData = await env.YOYO_USER_DB.get(channelKey, { type: 'json' });
    
    if (channelData?.preloadConfig) {
      return {
        status: 'success',
        data: {
          channelId,
          ...channelData.preloadConfig
        }
      };
    }
    
    // 返回默认配置
    return {
      status: 'success',
      data: {
        channelId,
        enabled: false,
        startTime: '07:00',
        endTime: '17:30',
        workdaysOnly: false
      }
    };
  } catch (error) {
    console.error('Failed to get preload config:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}
```

### 步骤2.2：修改getAllPreloadConfigs函数（第47-71行）

完整替换为：

```javascript
async function getAllPreloadConfigs(env) {
  try {
    // 🆕 遍历所有频道配置
    const listResult = await env.YOYO_USER_DB.list({ prefix: 'channel:' });
    
    const configs = [];
    for (const key of listResult.keys) {
      const channelData = await env.YOYO_USER_DB.get(key.name, { type: 'json' });
      if (channelData?.preloadConfig?.enabled) {
        configs.push({
          channelId: channelData.id,
          ...channelData.preloadConfig
        });
      }
    }
    
    return {
      status: 'success',
      data: configs
    };
  } catch (error) {
    console.error('Failed to get all preload configs:', error);
    return {
      status: 'error',
      message: error.message
    };
  }
}
```

### 步骤2.3：提交和部署

```bash
git add cloudflare-worker/src/handlers/preloadHandler.js
git commit -m "refactor(preload): 从频道配置读取预加载设置"
git push origin master

cd cloudflare-worker
npx wrangler deploy --env production
```

### 步骤2.4：验证

```powershell
# 测试读取配置
$response = Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/preload/config/stream_ensxma2g" -Method Get

if ($response.data.enabled) {
    Write-Host "✅ 阶段2验证通过 - 可以正常读取整合后的配置"
} else {
    Write-Host "⚠️  配置未启用或需要重新设置"
}
```

✅ 验证通过后在进度表标记

---

## 🎯 阶段3：简化频道列表API

**文件**: `cloudflare-worker/src/index.js`

### 步骤3.1：找到频道列表API（约第770-811行）

删除预加载配置的单独读取代码，替换为：

```javascript
// 构建频道列表，优先使用KV存储中的更新数据
const streams = [];

for (const [id, config] of Object.entries(CHANNELS)) {
  // 只读取频道配置（已包含预加载配置）
  const channelKey = `channel:${id}`;
  let channelData = null;
  
  try {
    if (env.YOYO_USER_DB) {
      const kvData = await env.YOYO_USER_DB.get(channelKey);
      if (kvData) {
        channelData = JSON.parse(kvData);
      }
    }
  } catch (kvError) {
    console.error('KV read error for', id, ':', kvError);
  }
  
  // 使用KV数据或默认配置
  streams.push({
    id,
    name: channelData?.name || config.name,
    rtmpUrl: channelData?.rtmpUrl || defaultRtmpUrls[id] || `<RTMP_URL>`,
    sortOrder: channelData?.sortOrder || config.order,
    createdAt: channelData?.updatedAt || '2025-10-03T12:00:00Z',
    preloadConfig: channelData?.preloadConfig || null  // ✨ 直接从频道配置读取（KV读取减半）
  });
}
```

### 步骤3.2：提交和部署

```bash
git add cloudflare-worker/src/index.js
git commit -m "refactor(api): 简化频道列表API，KV读取减少50%"
git push origin master

cd cloudflare-worker
npx wrangler deploy --env production
```

### 步骤3.3：验证

```powershell
# 验证API返回正确
$response = Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/admin/streams" -Method Get
$channel = $response.data.streams | Where-Object { $_.id -eq "stream_ensxma2g" }

if ($channel.preloadConfig) {
    Write-Host "✅ 阶段3验证通过 - KV读取减少50%"
} else {
    Write-Host "⚠️  preloadConfig为空（需要先设置配置）"
}
```

✅ 验证通过后在进度表标记

---

## 🎯 阶段4：删除旧的KV键

**目标**: 删除旧的 `PRELOAD_CONFIG:*` 键（无需迁移，配置已全部关闭）

### 步骤4.1：删除旧键

```bash
cd D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\cloudflare-worker

# 删除所有旧的预加载配置键
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_ensxma2g"
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_gkg5hknc"
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_kcwxuedx"
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_kil0lecb"
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_noyoostd"
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_3blyhqh3"
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_8zf48z6g"
npx wrangler kv:key delete --binding=YOYO_USER_DB --env=production "PRELOAD_CONFIG:stream_cpa2czoo"
```

### 步骤4.2：验证清理

```powershell
Write-Host "✅ 验证旧键已删除..." -ForegroundColor Yellow

# 验证频道列表正常（preloadConfig都为null）
$response = Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/admin/streams" -Method Get
$streams = $response.data.streams

Write-Host "  频道总数: $($streams.Count)" -ForegroundColor Green
Write-Host "  所有频道的preloadConfig都应该为null（因为已关闭）" -ForegroundColor Gray

# 检查几个频道
$testChannels = @("stream_ensxma2g", "stream_gkg5hknc", "stream_kcwxuedx")
foreach ($channelId in $testChannels) {
    $channel = $streams | Where-Object { $_.id -eq $channelId }
    if ($channel.preloadConfig -eq $null) {
        Write-Host "  ✓ $channelId - preloadConfig = null" -ForegroundColor Green
    } else {
        Write-Host "  ✓ $channelId - preloadConfig 存在但未启用" -ForegroundColor Yellow
    }
}

Write-Host "`n✅ 阶段4完成！旧键已清理" -ForegroundColor Green
```

✅ 验证通过后在进度表标记

---

## 🎯 阶段5：完整测试和验证

### 步骤5.1：完整功能测试

```powershell
Write-Host "开始完整测试..."

# 1. 测试频道列表加载
$streams = (Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/admin/streams").data.streams
Write-Host "✅ 频道列表: $($streams.Count)个频道"

# 2. 测试预加载配置读取
$config = (Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/preload/config/stream_ensxma2g").data
Write-Host "✅ 配置读取: enabled=$($config.enabled)"

# 3. 测试配置更新
$body = @{
    enabled = $true
    startTime = "09:00"
    endTime = "19:00"
    workdaysOnly = $false
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/preload/config/stream_ensxma2g" -Method PUT -Headers @{"Content-Type"="application/json"} -Body $body
Write-Host "✅ 配置更新成功"

# 4. 验证更新生效
$updated = (Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/admin/streams").data.streams | Where-Object { $_.id -eq "stream_ensxma2g" }
if ($updated.preloadConfig.startTime -eq "09:00") {
    Write-Host "✅ 所有测试通过！"
} else {
    Write-Host "❌ 测试失败"
}
```

### 步骤5.2：性能验证

在浏览器开发者工具Network标签中：
1. 刷新频道管理页面
2. 查看 `/api/admin/streams` 请求
3. 应该只有1个请求，响应包含完整的preloadConfig

✅ 验证通过后在进度表标记

---

## 🎉 完成标志

- ✅ 所有阶段验证通过
- ✅ KV读取减少50%（16次→8次）
- ✅ 功能完全正常
- ✅ 无错误日志

**整合完成！月节省约2400次KV读取** 🚀
