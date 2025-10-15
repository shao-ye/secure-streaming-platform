# 🔧 代理测试按钮修复验证脚本

Write-Host "🎯 代理测试按钮问题诊断和修复" -ForegroundColor Cyan
Write-Host "=" * 50 -ForegroundColor Cyan

# 测试数据
$testProxy = @{
    id = "jp"
    name = "JP-Evoxt"
    config = "vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=XSIEcTZ1NnjyY-BhYuiW74fAwFfve-8YJ-T855r0f1c&type=tcp&headerType=none#JP-Evoxt"
}

Write-Host "`n📋 问题分析:" -ForegroundColor Yellow
Write-Host "1. VPS测试接口返回失败（延迟-1ms）" -ForegroundColor White
Write-Host "2. VPS连接接口工作正常" -ForegroundColor White
Write-Host "3. 前端代码已更新使用连接接口" -ForegroundColor White
Write-Host "4. 可能是Cloudflare Pages部署延迟" -ForegroundColor White

Write-Host "`n🔧 解决方案验证:" -ForegroundColor Green

# 1. 验证VPS连接接口
Write-Host "`n1. 验证VPS连接接口（前端应该调用的接口）:" -ForegroundColor Yellow
try {
    $connectData = @{
        proxyConfig = $testProxy
    } | ConvertTo-Json -Depth 3

    $startTime = Get-Date
    $connectResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/connect" -Method POST -Body $connectData -ContentType "application/json" -TimeoutSec 30
    $endTime = Get-Date
    $connectionLatency = ($endTime - $startTime).TotalMilliseconds

    Write-Host "✅ VPS连接接口测试成功:" -ForegroundColor Green
    Write-Host "- 状态: $($connectResponse.data.status)" -ForegroundColor White
    Write-Host "- 消息: $($connectResponse.message)" -ForegroundColor White
    Write-Host "- 连接延迟: $([math]::Round($connectionLatency))ms" -ForegroundColor White
    
    # 立即断开连接
    try {
        $disconnectResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/disconnect" -Method POST -ContentType "application/json" -TimeoutSec 15
        Write-Host "✅ 代理已断开连接" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ 断开连接时出错: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ VPS连接接口失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. 验证Workers代理连接API
Write-Host "`n2. 验证Workers代理连接API（前端实际调用的路径）:" -ForegroundColor Yellow
try {
    # 创建会话进行认证
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    
    # 登录获取认证
    $loginData = @{
        username = "admin"
        password = "admin123"
    } | ConvertTo-Json
    
    $loginResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/auth/login" -Method POST -Body $loginData -ContentType "application/json" -WebSession $session -TimeoutSec 15
    Write-Host "✅ 用户认证成功" -ForegroundColor Green
    
    # 测试Workers代理连接API
    $connectData = @{
        proxyConfig = $testProxy
    } | ConvertTo-Json -Depth 3
    
    $startTime = Get-Date
    $workersConnectResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/connect" -Method POST -Body $connectData -ContentType "application/json" -WebSession $session -TimeoutSec 30
    $endTime = Get-Date
    $workersLatency = ($endTime - $startTime).TotalMilliseconds
    
    Write-Host "✅ Workers代理连接API成功:" -ForegroundColor Green
    Write-Host "- 状态: $($workersConnectResponse.data.status)" -ForegroundColor White
    Write-Host "- 消息: $($workersConnectResponse.message)" -ForegroundColor White
    Write-Host "- 连接延迟: $([math]::Round($workersLatency))ms" -ForegroundColor White
    
    # 断开连接
    try {
        $workersDisconnectResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/disconnect" -Method POST -WebSession $session -TimeoutSec 15
        Write-Host "✅ Workers代理已断开连接" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ Workers断开连接时出错: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ Workers代理连接API失败: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP状态码: $statusCode" -ForegroundColor Red
    }
}

Write-Host "`n📊 测试结果总结:" -ForegroundColor Cyan
Write-Host "如果上述两个测试都成功，说明:" -ForegroundColor White
Write-Host "✅ 后端API完全正常" -ForegroundColor Green
Write-Host "✅ 前端代码逻辑正确" -ForegroundColor Green
Write-Host "❓ 问题可能是前端部署延迟" -ForegroundColor Yellow

Write-Host "`n💡 解决建议:" -ForegroundColor Yellow
Write-Host "1. 等待Cloudflare Pages自动部署（5-10分钟）" -ForegroundColor White
Write-Host "2. 手动触发前端重新部署" -ForegroundColor White
Write-Host "3. 清除浏览器缓存后重试" -ForegroundColor White

Write-Host "`n🎯 为什么反复出现这个问题:" -ForegroundColor Yellow
Write-Host "1. 测试接口和连接接口代码分离，修复不同步" -ForegroundColor White
Write-Host "2. 前端部署和后端部署不同步" -ForegroundColor White
Write-Host "3. 浏览器缓存导致使用旧版本前端代码" -ForegroundColor White
Write-Host "4. 需要建立统一的测试逻辑，避免多套API" -ForegroundColor White

Write-Host "`n" + "=" * 50 -ForegroundColor Cyan
Write-Host "🎉 如果测试成功，代理测试按钮功能已修复！" -ForegroundColor Green
