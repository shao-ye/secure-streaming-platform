# 代理连接问题诊断脚本
Write-Host "🔍 代理连接问题诊断工具" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. 检查VPS基础服务状态
Write-Host "`n1. 检查VPS基础服务..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/health" -UseBasicParsing
    Write-Host "✅ VPS基础服务正常 (状态码: $($healthResponse.StatusCode))" -ForegroundColor Green
    $healthData = $healthResponse.Content | ConvertFrom-Json
    Write-Host "   版本: $($healthData.version)" -ForegroundColor Gray
    Write-Host "   运行时间: $($healthData.uptime)秒" -ForegroundColor Gray
} catch {
    Write-Host "❌ VPS基础服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. 检查代理服务API端点
Write-Host "`n2. 检查代理服务API端点..." -ForegroundColor Yellow
$apiKey = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

try {
    $proxyStatusResponse = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Headers @{"X-API-Key"=$apiKey} -UseBasicParsing
    Write-Host "✅ 代理状态API正常 (状态码: $($proxyStatusResponse.StatusCode))" -ForegroundColor Green
    $proxyStatusData = $proxyStatusResponse.Content | ConvertFrom-Json
    Write-Host "   连接状态: $($proxyStatusData.data.connectionStatus)" -ForegroundColor Gray
    Write-Host "   当前代理: $($proxyStatusData.data.currentProxy)" -ForegroundColor Gray
    Write-Host "   最后更新: $($proxyStatusData.data.lastUpdate)" -ForegroundColor Gray
} catch {
    Write-Host "❌ 代理状态API异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. 检查代理配置
Write-Host "`n3. 检查代理配置..." -ForegroundColor Yellow
try {
    $configResponse = Invoke-WebRequest -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Headers @{"Authorization"="Bearer simple-token-1759980516042"} -UseBasicParsing
    Write-Host "✅ 代理配置API正常 (状态码: $($configResponse.StatusCode))" -ForegroundColor Green
    $configData = $configResponse.Content | ConvertFrom-Json
    Write-Host "   代理功能启用: $($configData.data.settings.enabled)" -ForegroundColor Gray
    Write-Host "   活跃代理ID: $($configData.data.settings.activeProxyId)" -ForegroundColor Gray
    Write-Host "   代理数量: $($configData.data.proxies.Count)" -ForegroundColor Gray
    
    foreach ($proxy in $configData.data.proxies) {
        Write-Host "   - $($proxy.name) ($($proxy.type)): $($proxy.status)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ 代理配置API异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 4. 测试代理启用流程
Write-Host "`n4. 测试代理启用流程..." -ForegroundColor Yellow
try {
    # 获取第一个代理的ID
    $configResponse = Invoke-WebRequest -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Headers @{"Authorization"="Bearer simple-token-1759980516042"} -UseBasicParsing
    $configData = $configResponse.Content | ConvertFrom-Json
    
    if ($configData.data.proxies.Count -gt 0) {
        $firstProxy = $configData.data.proxies[0]
        Write-Host "   测试启用代理: $($firstProxy.name)" -ForegroundColor Gray
        
        # 尝试启用代理
        $enableBody = @{
            action = "enable"
            proxyId = $firstProxy.id
        } | ConvertTo-Json
        
        $enableResponse = Invoke-WebRequest -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/control" -Method POST -Headers @{"Authorization"="Bearer simple-token-1759980516042"; "Content-Type"="application/json"} -Body $enableBody -UseBasicParsing
        Write-Host "✅ 代理启用请求成功 (状态码: $($enableResponse.StatusCode))" -ForegroundColor Green
        
        $enableData = $enableResponse.Content | ConvertFrom-Json
        Write-Host "   响应消息: $($enableData.message)" -ForegroundColor Gray
        
        # 等待5秒后检查状态
        Write-Host "   等待5秒后检查代理状态..." -ForegroundColor Gray
        Start-Sleep -Seconds 5
        
        $statusResponse = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Headers @{"X-API-Key"=$apiKey} -UseBasicParsing
        $statusData = $statusResponse.Content | ConvertFrom-Json
        Write-Host "   代理连接状态: $($statusData.data.connectionStatus)" -ForegroundColor $(if ($statusData.data.connectionStatus -eq "connected") { "Green" } else { "Red" })
        
        if ($statusData.data.connectionStatus -ne "connected") {
            Write-Host "⚠️  代理未能成功连接，可能的原因:" -ForegroundColor Yellow
            Write-Host "   - V2Ray/Xray客户端未安装" -ForegroundColor Gray
            Write-Host "   - 代理服务器不可达" -ForegroundColor Gray
            Write-Host "   - 配置文件生成错误" -ForegroundColor Gray
            Write-Host "   - 端口冲突或权限问题" -ForegroundColor Gray
        }
        
    } else {
        Write-Host "❌ 没有找到可测试的代理配置" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 代理启用测试失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 5. 检查VPS系统资源
Write-Host "`n5. 检查VPS系统资源..." -ForegroundColor Yellow
try {
    $statusResponse = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/api/status" -Headers @{"X-API-Key"=$apiKey} -UseBasicParsing
    Write-Host "✅ VPS系统状态正常" -ForegroundColor Green
} catch {
    Write-Host "❌ VPS系统状态检查失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🔍 诊断完成！" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 6. 提供解决建议
Write-Host "`n💡 解决建议:" -ForegroundColor Cyan
Write-Host "1. 如果VPS代理服务未正确响应，需要在VPS上部署完整的代理服务" -ForegroundColor White
Write-Host "2. 确保V2Ray/Xray客户端已正确安装" -ForegroundColor White
Write-Host "3. 检查代理配置是否正确（URL格式、服务器地址等）" -ForegroundColor White
Write-Host "4. 验证网络连接和防火墙设置" -ForegroundColor White
Write-Host "5. 查看VPS日志文件获取详细错误信息" -ForegroundColor White
