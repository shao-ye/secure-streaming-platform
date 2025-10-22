# 查询代理配置
$loginBody = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/login" -Method Post -Body $loginBody -ContentType "application/json"

$headers = @{
    "Authorization" = "Bearer $($loginResponse.data.token)"
}

Write-Host "Fetching proxy config..."
$proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Headers $headers

Write-Host "`n=== Proxy Configuration ===" -ForegroundColor Cyan
Write-Host "Enabled: $($proxyConfig.data.enabled)"
Write-Host "Active Proxy ID: $($proxyConfig.data.activeProxyId)"
Write-Host "Proxies Count: $($proxyConfig.data.proxies.Count)"
Write-Host "`n=== Settings ===" -ForegroundColor Cyan
$proxyConfig.data.settings | Format-List
