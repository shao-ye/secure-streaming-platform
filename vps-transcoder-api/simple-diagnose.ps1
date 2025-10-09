# 简化的代理连接问题诊断脚本
Write-Host "🔍 代理连接问题诊断工具" -ForegroundColor Cyan

# 1. 检查VPS代理状态
Write-Host "`n1. 检查VPS代理状态..." -ForegroundColor Yellow
$apiKey = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

try {
    $response = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Headers @{"X-API-Key"=$apiKey} -UseBasicParsing
    $data = $response.Content | ConvertFrom-Json
    Write-Host "✅ VPS代理服务正常" -ForegroundColor Green
    Write-Host "   连接状态: $($data.data.connectionStatus)" -ForegroundColor Gray
    Write-Host "   当前代理: $($data.data.currentProxy)" -ForegroundColor Gray
} catch {
    Write-Host "❌ VPS代理服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. 检查代理配置
Write-Host "`n2. 检查代理配置..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Headers @{"Authorization"="Bearer simple-token-1759980516042"} -UseBasicParsing
    $data = $response.Content | ConvertFrom-Json
    Write-Host "✅ 代理配置正常" -ForegroundColor Green
    Write-Host "   功能启用: $($data.data.settings.enabled)" -ForegroundColor Gray
    Write-Host "   活跃代理: $($data.data.settings.activeProxyId)" -ForegroundColor Gray
    Write-Host "   代理数量: $($data.data.proxies.Count)" -ForegroundColor Gray
} catch {
    Write-Host "❌ 代理配置异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🔍 诊断完成！" -ForegroundColor Cyan
