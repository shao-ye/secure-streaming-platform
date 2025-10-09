# VPS状态检查脚本
Write-Host "检查VPS服务状态..." -ForegroundColor Green

# VPS配置
$VPS_HOST = "yoyo-vps.5202021.xyz"
$API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

Write-Host "1. 检查基础健康状态..."
try {
    $healthResponse = Invoke-RestMethod -Uri "https://$VPS_HOST/health" -Method GET -TimeoutSec 10
    Write-Host "VPS基础服务正常运行" -ForegroundColor Green
    Write-Host "版本: $($healthResponse.version)" -ForegroundColor Cyan
    Write-Host "运行时间: $($healthResponse.uptime)秒" -ForegroundColor Cyan
} catch {
    Write-Host "VPS基础服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "2. 检查SimpleStream服务状态..."
try {
    $headers = @{ "X-API-Key" = $API_KEY }
    $statusResponse = Invoke-RestMethod -Uri "https://$VPS_HOST/api/status" -Method GET -Headers $headers -TimeoutSec 10
    Write-Host "SimpleStream服务正常" -ForegroundColor Green
    Write-Host "状态: $($statusResponse.status)" -ForegroundColor Cyan
} catch {
    Write-Host "SimpleStream服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "3. 检查代理服务状态..."
try {
    $headers = @{ "X-API-Key" = $API_KEY }
    $proxyResponse = Invoke-RestMethod -Uri "https://$VPS_HOST/api/proxy/status" -Method GET -Headers $headers -TimeoutSec 10
    Write-Host "代理服务正常运行" -ForegroundColor Green
    Write-Host "代理状态: $($proxyResponse.status)" -ForegroundColor Cyan
} catch {
    Write-Host "代理服务异常: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "可能原因: 代理服务未部署或未启动" -ForegroundColor Yellow
}

Write-Host "4. 检查代理健康检查端点..."
try {
    $headers = @{ "X-API-Key" = $API_KEY }
    $healthResponse = Invoke-RestMethod -Uri "https://$VPS_HOST/api/proxy/health" -Method GET -Headers $headers -TimeoutSec 10
    Write-Host "代理健康检查正常" -ForegroundColor Green
    Write-Host "健康状态: $($healthResponse.status)" -ForegroundColor Cyan
} catch {
    Write-Host "代理健康检查异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "5. 测试代理测试端点..."
try {
    $headers = @{ 
        "X-API-Key" = $API_KEY
        "Content-Type" = "application/json"
    }
    $testData = @{
        proxyId = "test"
        proxyConfig = @{
            name = "测试代理"
            type = "vless"
            config = "vless://test@example.com:443?encryption=none"
        }
    } | ConvertTo-Json -Depth 3

    $testResponse = Invoke-RestMethod -Uri "https://$VPS_HOST/api/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 10
    Write-Host "代理测试端点正常" -ForegroundColor Green
    Write-Host "测试结果: $($testResponse.status)" -ForegroundColor Cyan
} catch {
    Write-Host "代理测试端点异常: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "这是关键问题！需要部署代理服务" -ForegroundColor Yellow
}

Write-Host "VPS状态检查完成！" -ForegroundColor Green
