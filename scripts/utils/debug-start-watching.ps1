# 调试start-watching API问题

Write-Host "🔍 调试start-watching API问题" -ForegroundColor Yellow

# 1. 测试获取频道列表
Write-Host "`n1. 测试频道列表API..." -ForegroundColor Cyan
try {
    $headers = @{"Authorization"="Bearer 0daf4e23-221f-4b07-8dd6-03fec8679800"}
    $streams = Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/streams" -Method GET -Headers $headers -TimeoutSec 10
    Write-Host "✅ 频道列表获取成功，共 $($streams.data.count) 个频道" -ForegroundColor Green
    
    # 显示第一个频道的详细信息
    $firstStream = $streams.data.streams[0]
    Write-Host "第一个频道信息:" -ForegroundColor White
    Write-Host "  ID: $($firstStream.id)" -ForegroundColor Gray
    Write-Host "  名称: $($firstStream.name)" -ForegroundColor Gray
    Write-Host "  RTMP: $($firstStream.rtmpUrl)" -ForegroundColor Gray
    
} catch {
    Write-Host "❌ 频道列表获取失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 2. 测试直接调用VPS API
Write-Host "`n2. 测试VPS直接API..." -ForegroundColor Cyan
try {
    $vpsHeaders = @{"Content-Type"="application/json"}
    $vpsBody = @{
        channelId = $firstStream.id
        rtmpUrl = $firstStream.rtmpUrl
    } | ConvertTo-Json
    
    Write-Host "请求体: $vpsBody" -ForegroundColor Gray
    
    $vpsResult = Invoke-RestMethod -Uri "https://yoyo-vps.your-domain.com/api/simple-stream/start-watching" -Method POST -Headers $vpsHeaders -Body $vpsBody -TimeoutSec 15
    Write-Host "✅ VPS API调用成功" -ForegroundColor Green
    Write-Host "响应: $($vpsResult | ConvertTo-Json -Depth 3)" -ForegroundColor Gray
    
} catch {
    Write-Host "❌ VPS API调用失败: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $errorBody = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($errorBody)
        $errorText = $reader.ReadToEnd()
        Write-Host "错误详情: $errorText" -ForegroundColor Red
    }
}

# 3. 测试Cloudflare Workers API
Write-Host "`n3. 测试Cloudflare Workers API..." -ForegroundColor Cyan
try {
    $workersHeaders = @{
        "Authorization"="Bearer 0daf4e23-221f-4b07-8dd6-03fec8679800"
        "Content-Type"="application/json"
    }
    $workersBody = @{
        channelId = $firstStream.id
    } | ConvertTo-Json
    
    Write-Host "请求体: $workersBody" -ForegroundColor Gray
    
    $workersResult = Invoke-RestMethod -Uri "https://yoyoapi.your-domain.com/api/simple-stream/start-watching" -Method POST -Headers $workersHeaders -Body $workersBody -TimeoutSec 15
    Write-Host "✅ Workers API调用成功" -ForegroundColor Green
    Write-Host "响应: $($workersResult | ConvertTo-Json -Depth 3)" -ForegroundColor Gray
    
} catch {
    Write-Host "❌ Workers API调用失败: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        try {
            $errorStream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($errorStream)
            $errorText = $reader.ReadToEnd()
            Write-Host "错误详情: $errorText" -ForegroundColor Red
        } catch {
            Write-Host "无法读取错误详情" -ForegroundColor Red
        }
    }
}

Write-Host "`n🔍 调试完成" -ForegroundColor Yellow
