# 测试VPS本地API
Write-Host "测试VPS本地代理API..." -ForegroundColor Cyan

# 测试连接API - 修复JSON格式
$connectCommand = @"
curl -X POST http://localhost:3000/api/proxy/connect -H 'Content-Type: application/json' -d '{\"proxyConfig\":{\"id\":\"test\",\"name\":\"test\",\"type\":\"vless\",\"config\":\"vless://test@test.com:443\"}}' -w '\nHTTP Status: %{http_code}\n' -s
"@

Write-Host "测试连接API:" -ForegroundColor Yellow
Write-Host $connectCommand

try {
    $result = ssh root@142.171.75.220 $connectCommand
    Write-Host "连接API测试结果:" -ForegroundColor Green
    Write-Host $result
} catch {
    Write-Host "SSH执行失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n" -NoNewline

# 测试状态API
$statusCommand = @"
curl -X GET http://localhost:3000/api/proxy/status -H 'Content-Type: application/json' -w '\nHTTP Status: %{http_code}\n' -s
"@

Write-Host "测试状态API:" -ForegroundColor Yellow
Write-Host $statusCommand

try {
    $result = ssh root@142.171.75.220 $statusCommand
    Write-Host "状态API测试结果:" -ForegroundColor Green
    Write-Host $result
} catch {
    Write-Host "SSH执行失败: $($_.Exception.Message)" -ForegroundColor Red
}
