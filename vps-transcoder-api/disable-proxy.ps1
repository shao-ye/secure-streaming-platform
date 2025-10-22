# 禁用代理，切换到Direct模式
$loginBody = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

Write-Host "Logging in..."
$loginResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/login" -Method Post -Body $loginBody -ContentType "application/json"

$headers = @{
    "Authorization" = "Bearer $($loginResponse.data.token)"
    "Content-Type" = "application/json"
}

Write-Host "Disabling proxy..."
$updateBody = @{
    enabled = $false
    activeProxyId = $null
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/settings" -Method Put -Headers $headers -Body $updateBody

Write-Host "`nProxy disabled! System will now use Direct mode." -ForegroundColor Green
Write-Host "Testing routing mode..."

Start-Sleep -Seconds 2

# 测试路由模式
$watchBody = @{
    channelId = "stream_cpa2czoo"
} | ConvertTo-Json

$watchResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/simple-stream/start-watching" -Method Post -Headers $headers -Body $watchBody

Write-Host "`n=== New Routing Mode ===" -ForegroundColor Cyan
Write-Host "Mode: $($watchResponse.data.routingMode)"
Write-Host "Reason: $($watchResponse.data.routingReason)"
Write-Host "HLS URL: $($watchResponse.data.hlsUrl)"
