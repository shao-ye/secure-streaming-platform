# 检查KV中proxy-config的完整结构
$loginBody = @{
    username = "admin"
    password = "admin123"
}
$loginBodyJson = $loginBody | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/login" -Method Post -Body $loginBodyJson -ContentType "application/json"

$headers = @{
    "Authorization" = "Bearer $($loginResponse.data.token)"
}

Write-Host "=== 查询代理配置完整结构 ===" -ForegroundColor Cyan
$proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Headers $headers

Write-Host "`n=== KV存储结构分析 ===" -ForegroundColor Yellow
Write-Host "1. 代理功能启用状态: $($proxyConfig.data.enabled)" -ForegroundColor Green
Write-Host "2. 当前选中的代理ID: $($proxyConfig.data.activeProxyId)" -ForegroundColor Green
Write-Host "3. 代理列表数量: $($proxyConfig.data.proxies.Count)" -ForegroundColor Green

Write-Host "`n=== 代理列表 ===" -ForegroundColor Yellow
foreach ($proxy in $proxyConfig.data.proxies) {
    Write-Host "  - ID: $($proxy.id)"
    Write-Host "    名称: $($proxy.name)"
    Write-Host "    类型: $($proxy.type)"
    Write-Host "    是否活跃: $($proxy.isActive)"
    Write-Host "    延迟: $($proxy.latency)"
    Write-Host ""
}

Write-Host "`n=== 现在查询VPS实时代理状态 ===" -ForegroundColor Cyan
try {
    $vpsStatus = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/status" -Headers $headers
    Write-Host "VPS代理连接状态: $($vpsStatus.data.connectionStatus)" -ForegroundColor $(if($vpsStatus.data.connectionStatus -eq 'connected'){'Green'}else{'Red'})
    Write-Host "VPS当前代理: $($vpsStatus.data.currentProxy)" -ForegroundColor Yellow
} catch {
    Write-Host "查询VPS状态失败: $_" -ForegroundColor Red
}
