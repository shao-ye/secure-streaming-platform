$body = '{"username":"admin","password":"admin123"}'
$loginResp = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/login" -Method Post -Body $body -ContentType "application/json"
$token = $loginResp.data.token

Write-Host "=== KV Proxy Config Structure ===" -ForegroundColor Cyan

$proxyResp = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Headers @{Authorization="Bearer $token"}

Write-Host "`nEnabled: $($proxyResp.data.enabled)"
Write-Host "ActiveProxyId: $($proxyResp.data.activeProxyId)"
Write-Host "Proxies Count: $($proxyResp.data.proxies.Count)"

Write-Host "`n=== VPS Status ===" -ForegroundColor Yellow
$statusResp = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/status" -Headers @{Authorization="Bearer $token"}
Write-Host "Connection Status: $($statusResp.data.connectionStatus)"
if ($statusResp.data.currentProxy) {
    Write-Host "Current Proxy Name: $($statusResp.data.currentProxy.name)"
} else {
    Write-Host "Current Proxy: None"
}
