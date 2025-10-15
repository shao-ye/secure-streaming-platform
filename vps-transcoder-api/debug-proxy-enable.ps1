# 测试代理连接API
Write-Host "测试VPS代理连接API..." -ForegroundColor Cyan

# 构建请求体JSON - 使用现有的connect端点
$requestBody = '{"proxyConfig":{"id":"proxy_test_connect_001","name":"测试代理JP","type":"vless","config":"vless://d727ce27-4996-4bcc-a599-3123824f0d20@104.224.158.96:443?encryption=none&security=tls&type=xhttp&host=x.262777.xyz&path=/d727ce27&mode=auto#RN-xhttp-cdn"}}'

Write-Host "发送代理配置:" -ForegroundColor Yellow
Write-Host $requestBody

try {
    # 测试VPS的/api/proxy/connect端点（现有端点）
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/connect" -Method POST -Body $requestBody -ContentType "application/json" -TimeoutSec 30
    
    Write-Host "API调用成功:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 3)
    
    # 检查代理状态
    Start-Sleep -Seconds 3
    $status = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "代理状态:" -ForegroundColor Magenta
    Write-Host ($status | ConvertTo-Json -Depth 3)
    
} catch {
    Write-Host "API调用失败:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}
