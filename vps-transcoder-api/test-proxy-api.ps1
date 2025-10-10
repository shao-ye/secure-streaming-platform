# 测试代理API功能脚本 - 避免SSH连接问题
Write-Host "开始测试代理API功能..." -ForegroundColor Green

# 1. 测试VPS基础服务
Write-Host "1. 测试VPS基础服务..." -ForegroundColor Yellow
try {
    $healthCheck = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/health" -Method GET -TimeoutSec 5
    Write-Host "VPS基础服务正常: $($healthCheck | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "VPS基础服务异常: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 2. 测试代理状态API
Write-Host "2. 测试代理状态API..." -ForegroundColor Yellow
try {
    $proxyStatus = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "代理状态API正常: $($proxyStatus | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "代理状态API异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. 测试代理测试API（使用模拟数据）
Write-Host "3. 测试代理测试API..." -ForegroundColor Yellow
$testProxyConfig = @{
    proxyId = "test-proxy"
    proxyConfig = @{
        name = "测试代理"
        type = "vless"
        config = "vless://test@example.com:443?type=tcp"
    }
    testUrl = "https://www.baidu.com"
}

try {
    $testResult = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/test" -Method POST -Body ($testProxyConfig | ConvertTo-Json -Depth 3) -ContentType "application/json" -TimeoutSec 15
    Write-Host "代理测试API正常: $($testResult | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "代理测试API异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 4. 测试Cloudflare Workers API
Write-Host "4. 测试Cloudflare Workers API..." -ForegroundColor Yellow
try {
    $workersHealth = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/health" -Method GET -TimeoutSec 5
    Write-Host "Cloudflare Workers正常: $($workersHealth | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
    Write-Host "Cloudflare Workers异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "API测试完成!" -ForegroundColor Green
Write-Host "如果所有API都正常，说明代码已经成功部署到VPS" -ForegroundColor Cyan
