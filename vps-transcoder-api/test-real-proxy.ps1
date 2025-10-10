# 测试真实代理配置脚本
Write-Host "开始测试真实代理配置..." -ForegroundColor Green

# 模拟jp代理配置（从界面截图看到的）
$jpProxyConfig = @{
    proxyId = "proxy_1759944903623_j46t5kl7i"
    proxyConfig = @{
        name = "jp"
        type = "vless"
        config = "vless://xxxxx@example.com:443?type=tcp"  # 简化的测试配置
    }
    testUrl = "https://www.baidu.com"
}

# 模拟us代理配置
$usProxyConfig = @{
    proxyId = "proxy_1759944903624_us8k2ml9n"
    proxyConfig = @{
        name = "us"
        type = "vless"
        config = "vless://xxxxx@example.com:443?type=tcp"  # 简化的测试配置
    }
    testUrl = "https://www.baidu.com"
}

Write-Host "1. 测试jp代理..." -ForegroundColor Yellow
try {
    $jpResult = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/test" -Method POST -Body ($jpProxyConfig | ConvertTo-Json -Depth 3) -ContentType "application/json" -TimeoutSec 15
    Write-Host "jp代理测试结果: $($jpResult | ConvertTo-Json -Compress)" -ForegroundColor Cyan
    
    if ($jpResult.data.success) {
        Write-Host "jp代理测试成功! 延迟: $($jpResult.data.latency)ms, 方法: $($jpResult.data.method)" -ForegroundColor Green
    } else {
        Write-Host "jp代理测试失败: $($jpResult.data.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "jp代理测试异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n2. 测试us代理..." -ForegroundColor Yellow
try {
    $usResult = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/test" -Method POST -Body ($usProxyConfig | ConvertTo-Json -Depth 3) -ContentType "application/json" -TimeoutSec 15
    Write-Host "us代理测试结果: $($usResult | ConvertTo-Json -Compress)" -ForegroundColor Cyan
    
    if ($usResult.data.success) {
        Write-Host "us代理测试成功! 延迟: $($usResult.data.latency)ms, 方法: $($usResult.data.method)" -ForegroundColor Green
    } else {
        Write-Host "us代理测试失败: $($usResult.data.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "us代理测试异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n3. 测试Cloudflare Workers代理API..." -ForegroundColor Yellow
try {
    $workersResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/proxy/test" -Method POST -Body ($jpProxyConfig | ConvertTo-Json -Depth 3) -ContentType "application/json" -TimeoutSec 15
    Write-Host "Cloudflare Workers测试结果: $($workersResult | ConvertTo-Json -Compress)" -ForegroundColor Cyan
} catch {
    Write-Host "Cloudflare Workers测试异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n测试完成!" -ForegroundColor Green
