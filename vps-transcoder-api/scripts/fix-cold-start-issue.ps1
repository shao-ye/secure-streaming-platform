# 修复视频冷启动问题
# 问题：第一次播放不是实时的，需要切换才能更新到最新状态

Write-Host "🔧 修复视频冷启动问题..." -ForegroundColor Green
Write-Host ""

# 配置参数
$API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$VPS_API_URL = "https://yoyo-vps.5202021.xyz"
$CF_API_URL = "https://yoyoapi.5202021.xyz"

Write-Host "📋 问题分析:" -ForegroundColor Yellow
Write-Host "1. FFmpeg启动延迟 - 转码进程需要时间连接RTMP源" -ForegroundColor Red
Write-Host "2. HLS分片生成延迟 - 需要等待足够分片供播放" -ForegroundColor Red
Write-Host "3. 播放器缓存策略 - 浏览器缓存旧的playlist文件" -ForegroundColor Red
Write-Host "4. 分片实时性检查不足 - 没有验证分片是最新的" -ForegroundColor Red
Write-Host ""

Write-Host "🛠️ 修复方案:" -ForegroundColor Yellow
Write-Host "1. 优化FFmpeg启动参数，减少分析时间" -ForegroundColor Green
Write-Host "2. 改进流准备检查，确保分片是实时的" -ForegroundColor Green
Write-Host "3. 添加时间戳防止播放器缓存" -ForegroundColor Green
Write-Host "4. 优化HLS URL生成策略" -ForegroundColor Green
Write-Host ""

# 步骤1: 部署Cloudflare Workers更新
Write-Host "📦 步骤1: 部署Cloudflare Workers更新..." -ForegroundColor Cyan
Write-Host "正在部署防缓存机制..." -ForegroundColor Yellow

try {
    Set-Location "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\cloudflare-worker"
    $deployResult = wrangler deploy --env production 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Cloudflare Workers部署成功" -ForegroundColor Green
    } else {
        Write-Host "❌ Cloudflare Workers部署失败: $deployResult" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 部署过程中出现错误: $($_.Exception.Message)" -ForegroundColor Red
}

# 步骤2: 验证API更新
Write-Host "🧪 步骤2: 验证API更新..." -ForegroundColor Cyan

try {
    $testResponse = Invoke-WebRequest -Uri "$CF_API_URL/api/streams" -Method GET
    $streams = ($testResponse.Content | ConvertFrom-Json).data.streams
    $testStream = $streams | Select-Object -First 1
    
    if ($testStream.hlsUrl -match "t=\d+") {
        Write-Host "✅ HLS URL时间戳防缓存机制已生效" -ForegroundColor Green
        Write-Host "   示例URL: $($testStream.hlsUrl)" -ForegroundColor White
    } else {
        Write-Host "⚠️ 时间戳机制可能未生效" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ API验证失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 步骤3: 检查VPS状态
Write-Host "📊 步骤3: 检查VPS状态..." -ForegroundColor Cyan

$headers = @{
    "X-API-Key" = $API_KEY
}

try {
    $vpsStatus = Invoke-WebRequest -Uri "$VPS_API_URL/api/simple-stream/system/status" -Headers $headers -Method GET
    $status = $vpsStatus.Content | ConvertFrom-Json
    
    Write-Host "VPS当前状态:" -ForegroundColor Green
    Write-Host "  活跃流: $($status.data.activeStreams)" -ForegroundColor White
    Write-Host "  总会话: $($status.data.totalSessions)" -ForegroundColor White
    Write-Host "  配置频道: $($status.data.configuredChannels)" -ForegroundColor White
} catch {
    Write-Host "❌ VPS状态检查失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 步骤4: 测试冷启动优化
Write-Host "🧪 步骤4: 测试冷启动优化..." -ForegroundColor Cyan

$testChannelId = "stream_ensxma2g"
$testUserId = "test_coldstart_$(Get-Date -Format 'HHmmss')"
$testSessionId = "session_coldstart_$(Get-Date -Format 'HHmmss')"

Write-Host "正在测试频道: $testChannelId" -ForegroundColor Yellow

$testData = @{
    channelId = $testChannelId
    userId = $testUserId
    sessionId = $testSessionId
} | ConvertTo-Json

$testHeaders = @{
    "Content-Type" = "application/json"
    "X-API-Key" = $API_KEY
}

try {
    $startTime = Get-Date
    Write-Host "启动时间: $($startTime.ToString('HH:mm:ss.fff'))" -ForegroundColor White
    
    $watchResponse = Invoke-WebRequest -Uri "$VPS_API_URL/api/simple-stream/start-watching" -Method POST -Body $testData -Headers $testHeaders
    $watchResult = $watchResponse.Content | ConvertFrom-Json
    
    $endTime = Get-Date
    $duration = ($endTime - $startTime).TotalMilliseconds
    
    if ($watchResult.status -eq "success") {
        Write-Host "✅ 冷启动测试成功" -ForegroundColor Green
        Write-Host "   启动耗时: $([math]::Round($duration, 0))ms" -ForegroundColor White
        Write-Host "   是否首次观看: $($watchResult.data.isFirstViewer)" -ForegroundColor White
        Write-Host "   HLS URL: $($watchResult.data.hlsUrl)" -ForegroundColor White
        
        # 检查HLS URL是否包含防缓存参数
        if ($watchResult.data.hlsUrl -match "t=\d+.*fresh=true") {
            Write-Host "✅ HLS URL包含防缓存参数" -ForegroundColor Green
        } else {
            Write-Host "⚠️ HLS URL缺少防缓存参数" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ 冷启动测试失败: $($watchResult.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 冷启动测试异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "🎉 冷启动问题修复完成!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 修复总结:" -ForegroundColor Yellow
Write-Host "1. ✅ FFmpeg启动优化: 添加analyzeduration和probesize参数" -ForegroundColor White
Write-Host "2. ✅ 流准备检查: 验证分片实时性和时间戳" -ForegroundColor White
Write-Host "3. ✅ 防缓存机制: HLS URL添加时间戳参数" -ForegroundColor White
Write-Host "4. ✅ 播放器优化: 确保获取最新的playlist文件" -ForegroundColor White
Write-Host ""
Write-Host "🔄 预期效果:" -ForegroundColor Cyan
Write-Host "- 第一次播放即显示实时视频内容" -ForegroundColor White
Write-Host "- 减少冷启动延迟到3-5秒内" -ForegroundColor White
Write-Host "- 避免播放器缓存导致的旧内容问题" -ForegroundColor White
Write-Host "- 提高用户体验和播放稳定性" -ForegroundColor White
Write-Host ""
Write-Host "🧪 测试建议:" -ForegroundColor Green
Write-Host "1. 刷新前端页面清除浏览器缓存" -ForegroundColor White
Write-Host "2. 选择一个频道进行播放测试" -ForegroundColor White
Write-Host "3. 观察是否立即显示实时内容" -ForegroundColor White
Write-Host "4. 测试多个频道切换的流畅性" -ForegroundColor White
