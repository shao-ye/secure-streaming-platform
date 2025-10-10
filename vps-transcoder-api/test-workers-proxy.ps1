# 测试Cloudflare Workers代理API脚本
Write-Host "开始测试Cloudflare Workers代理API..." -ForegroundColor Green

# 模拟jp代理配置
$jpProxyConfig = @{
    id = "proxy_1759944903623_j46t5kl7i"
    name = "jp"
    type = "vless"
    config = "vless://xxxxx@example.com:443?type=tcp"
    testUrl = "https://www.baidu.com"
}

Write-Host "1. 测试Cloudflare Workers代理测试API..." -ForegroundColor Yellow
try {
    $workersResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Body ($jpProxyConfig | ConvertTo-Json -Depth 3) -ContentType "application/json" -TimeoutSec 20
    Write-Host "Cloudflare Workers测试结果: $($workersResult | ConvertTo-Json -Compress)" -ForegroundColor Cyan
    
    if ($workersResult.data.success) {
        Write-Host "Workers代理测试成功! 延迟: $($workersResult.data.latency)ms, 方法: $($workersResult.data.method)" -ForegroundColor Green
    } else {
        Write-Host "Workers代理测试失败: $($workersResult.data.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "Workers代理测试异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n2. 测试按ID测试代理..." -ForegroundColor Yellow
try {
    $proxyId = "proxy_1759944903623_j46t5kl7i"
    $byIdResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test/$proxyId" -Method POST -ContentType "application/json" -TimeoutSec 20
    Write-Host "按ID测试结果: $($byIdResult | ConvertTo-Json -Compress)" -ForegroundColor Cyan
} catch {
    Write-Host "按ID测试异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n3. 检查代理配置..." -ForegroundColor Yellow
try {
    $configResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Method GET -TimeoutSec 10
    Write-Host "代理配置: $($configResult | ConvertTo-Json -Compress)" -ForegroundColor Cyan
} catch {
    Write-Host "获取代理配置异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n测试完成!" -ForegroundColor Green
