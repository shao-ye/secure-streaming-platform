# VPS代理服务诊断脚本
Write-Host "🔍 VPS代理服务诊断" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan

# 1. 检查基础服务
Write-Host "`n1. 检查基础服务..." -ForegroundColor Yellow
try {
    $health = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/health" -UseBasicParsing
    $healthData = $health.Content | ConvertFrom-Json
    Write-Host "✅ 基础服务正常" -ForegroundColor Green
    Write-Host "   版本: $($healthData.version)" -ForegroundColor Gray
    Write-Host "   运行时间: $([math]::Round($healthData.uptime/60, 2))分钟" -ForegroundColor Gray
} catch {
    Write-Host "❌ 基础服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. 检查API状态
Write-Host "`n2. 检查API状态..." -ForegroundColor Yellow
try {
    $status = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/api/status" -UseBasicParsing
    $statusData = $status.Content | ConvertFrom-Json
    Write-Host "✅ API服务正常" -ForegroundColor Green
    Write-Host "   状态: $($statusData.status)" -ForegroundColor Gray
    Write-Host "   版本: $($statusData.version)" -ForegroundColor Gray
} catch {
    Write-Host "❌ API服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. 检查代理API端点
Write-Host "`n3. 检查代理API端点..." -ForegroundColor Yellow
$proxyEndpoints = @(
    "/api/proxy/status",
    "/api/proxy/config", 
    "/api/proxy/test",
    "/api/proxy/health"
)

foreach ($endpoint in $proxyEndpoints) {
    try {
        $response = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz$endpoint" -Method GET -Headers @{"X-API-Key"="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"} -UseBasicParsing
        Write-Host "✅ $endpoint - 正常 (状态码: $($response.StatusCode))" -ForegroundColor Green
    } catch {
        $errorMsg = $_.Exception.Message
        if ($errorMsg -like "*Endpoint not found*") {
            Write-Host "❌ $endpoint - 端点不存在" -ForegroundColor Red
        } elseif ($errorMsg -like "*404*") {
            Write-Host "❌ $endpoint - 404未找到" -ForegroundColor Red
        } else {
            Write-Host "❌ $endpoint - 错误: $errorMsg" -ForegroundColor Red
        }
    }
}

# 4. 诊断结论
Write-Host "`n📋 诊断结论:" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan

$proxyApiExists = $false
try {
    Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Headers @{"X-API-Key"="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"} -UseBasicParsing | Out-Null
    $proxyApiExists = $true
} catch {}

if ($proxyApiExists) {
    Write-Host "✅ 代理API服务正常运行" -ForegroundColor Green
    Write-Host "   建议: 可以继续测试代理功能" -ForegroundColor Gray
} else {
    Write-Host "❌ 代理API服务不可用" -ForegroundColor Red
    Write-Host "   可能原因:" -ForegroundColor Yellow
    Write-Host "   1. VPS上的代码不是最新版本" -ForegroundColor Gray
    Write-Host "   2. 代理路由文件缺失或损坏" -ForegroundColor Gray
    Write-Host "   3. 应用启动时出现错误" -ForegroundColor Gray
    Write-Host "   4. 代理路由没有正确加载" -ForegroundColor Gray
    Write-Host "" -ForegroundColor Gray
    Write-Host "   建议解决方案:" -ForegroundColor Yellow
    Write-Host "   1. 重新同步最新代码到VPS" -ForegroundColor Gray
    Write-Host "   2. 检查VPS应用启动日志" -ForegroundColor Gray
    Write-Host "   3. 确认代理路由文件完整性" -ForegroundColor Gray
}

Write-Host "`n🔧 下一步操作建议:" -ForegroundColor Cyan
if (-not $proxyApiExists) {
    Write-Host "1. 运行代码同步脚本重新部署VPS代码" -ForegroundColor Yellow
    Write-Host "2. 检查VPS应用是否正确重启" -ForegroundColor Yellow
    Write-Host "3. 验证代理路由是否正确加载" -ForegroundColor Yellow
}

Write-Host "`n诊断完成！" -ForegroundColor Cyan
