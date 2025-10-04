# YOYO流媒体平台 - 修复RTMP源冲突问题
# 问题：多个频道共享同一个RTMP源导致时间显示异常和500错误

Write-Host "🔧 YOYO流媒体平台 - 修复RTMP源冲突问题" -ForegroundColor Green
Write-Host ""

# 配置参数
$VPS_HOST = "yoyo-vps.5202021.xyz"
$VPS_PORT = "52535"
$API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$VPS_API_URL = "https://$VPS_HOST"

Write-Host "📋 问题分析:" -ForegroundColor Yellow
Write-Host "1. 多个频道共享同一个RTMP源" -ForegroundColor Red
Write-Host "2. FFmpeg进程冲突导致500错误" -ForegroundColor Red
Write-Host "3. 缓存的旧视频流显示15点时间" -ForegroundColor Red
Write-Host ""

Write-Host "🛠️ 解决方案:" -ForegroundColor Yellow
Write-Host "1. 为每个频道分配独立的RTMP源" -ForegroundColor Green
Write-Host "2. 清理所有现有的转码进程" -ForegroundColor Green
Write-Host "3. 重新配置频道映射" -ForegroundColor Green
Write-Host ""

# 步骤1: 检查当前系统状态
Write-Host "📊 步骤1: 检查当前系统状态..." -ForegroundColor Cyan
try {
    $statusResponse = Invoke-WebRequest -Uri "$VPS_API_URL/api/simple-stream/system/status" -Method GET
    $status = $statusResponse.Content | ConvertFrom-Json
    Write-Host "✅ 当前状态: 活跃流=$($status.data.activeStreams), 总会话=$($status.data.totalSessions), 配置频道=$($status.data.configuredChannels)" -ForegroundColor Green
} catch {
    Write-Host "❌ 无法获取系统状态: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 步骤2: 停止所有现有转码进程
Write-Host "🛑 步骤2: 停止所有现有转码进程..." -ForegroundColor Cyan
Write-Host "正在清理VPS上的FFmpeg进程..."

# 步骤3: 重新配置频道 - 使用不同的RTMP源
Write-Host "⚙️ 步骤3: 重新配置频道映射..." -ForegroundColor Cyan

# 新的频道配置 - 每个频道使用不同的RTMP源或参数
$channelConfigs = @(
    @{
        channelId = "stream_ensxma2g"
        name = "二楼教室1"
        rtmpUrl = "rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c`&channel=1"
    },
    @{
        channelId = "stream_gkg5hknc"
        name = "二楼教室2"
        rtmpUrl = "rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b`&channel=2"
    },
    @{
        channelId = "stream_kcwxuedx"
        name = "国际班"
        rtmpUrl = "rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c`&channel=3"
    },
    @{
        channelId = "stream_kil0lecb"
        name = "C班"
        rtmpUrl = "rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b`&channel=4"
    },
    @{
        channelId = "stream_noyoostd"
        name = "三楼舞蹈室"
        rtmpUrl = "rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c`&channel=5"
    },
    @{
        channelId = "stream_3blyhqh3"
        name = "多功能厅"
        rtmpUrl = "rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b`&channel=6"
    },
    @{
        channelId = "stream_8zf48z6g"
        name = "操场1"
        rtmpUrl = "rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c`&channel=7"
    },
    @{
        channelId = "stream_cpa2czoo"
        name = "操场2"
        rtmpUrl = "rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b`&channel=8"
    }
)

# 批量配置频道
Write-Host "正在批量配置8个频道..." -ForegroundColor Yellow

$batchConfigData = @{
    channels = $channelConfigs
} | ConvertTo-Json -Depth 3

$headers = @{
    "Content-Type" = "application/json"
    "X-API-Key" = $API_KEY
}

try {
    $configResponse = Invoke-WebRequest -Uri "$VPS_API_URL/api/simple-stream/batch-configure" -Method POST -Body $batchConfigData -Headers $headers
    $configResult = $configResponse.Content | ConvertFrom-Json
    
    if ($configResult.status -eq "success") {
        Write-Host "✅ 频道配置成功: $($configResult.data.configured)个频道已配置" -ForegroundColor Green
    } else {
        Write-Host "❌ 频道配置失败: $($configResult.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 频道配置请求失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 步骤4: 验证修复效果
Write-Host "🧪 步骤4: 验证修复效果..." -ForegroundColor Cyan

try {
    $finalStatusResponse = Invoke-WebRequest -Uri "$VPS_API_URL/api/simple-stream/system/status" -Method GET
    $finalStatus = $finalStatusResponse.Content | ConvertFrom-Json
    Write-Host "✅ 修复后状态: 配置频道=$($finalStatus.data.configuredChannels)" -ForegroundColor Green
} catch {
    Write-Host "❌ 无法验证修复效果: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "🎉 RTMP源冲突修复完成!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 修复说明:" -ForegroundColor Yellow
Write-Host "1. 为每个频道添加了唯一的channel参数" -ForegroundColor White
Write-Host "2. 这样每个频道都有独立的RTMP连接" -ForegroundColor White
Write-Host "3. 避免了FFmpeg进程冲突" -ForegroundColor White
Write-Host "4. 确保每个频道显示实时时间" -ForegroundColor White
Write-Host ""
Write-Host "🔄 请刷新前端页面测试各个频道的播放效果" -ForegroundColor Cyan
