# 测试路由模式
$loginBody = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/login" -Method Post -Body $loginBody -ContentType "application/json"

Write-Host "Login Success! Token: $($loginResponse.data.token.substring(0,20))..."

$headers = @{
    "Authorization" = "Bearer $($loginResponse.data.token)"
    "Content-Type" = "application/json"
}

$watchBody = @{
    channelId = "stream_cpa2czoo"
} | ConvertTo-Json

Write-Host "`nTesting start-watching API..."
$watchResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/simple-stream/start-watching" -Method Post -Headers $headers -Body $watchBody

Write-Host "`n=== Routing Information ==="
Write-Host "Routing Mode: $($watchResponse.data.routingMode)" -ForegroundColor Cyan
Write-Host "Routing Reason: $($watchResponse.data.routingReason)" -ForegroundColor Cyan
Write-Host "HLS URL: $($watchResponse.data.hlsUrl)" -ForegroundColor Yellow
Write-Host "`n=== Debug Info ==="
Write-Host "Proxy Config Enabled: $($watchResponse.data.debug.proxyConfig.enabled)"
Write-Host "Active Proxy ID: $($watchResponse.data.debug.proxyConfig.activeProxyId)"
Write-Host "Tunnel Enabled: $($watchResponse.data.debug.tunnelEnabled)"
Write-Host "Country: $($watchResponse.data.debug.country)"
