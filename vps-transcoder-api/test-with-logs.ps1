# 带日志监控的API测试
Write-Host "🔍 开始API测试并监控Workers日志" -ForegroundColor Green

# 测试无认证的API调用，观察日志输出
Write-Host "`n📊 步骤1: 测试调试API端点" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/debug/r2-storage" -Method GET -Headers @{"Authorization"="Bearer invalid"} -TimeoutSec 10
    Write-Host "意外成功: $response" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✅ 调试端点正常响应401 (需要认证)" -ForegroundColor Green
    } else {
        Write-Host "❌ 调试端点异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n📊 步骤2: 测试代理测试API端点" -ForegroundColor Yellow
try {
    $testData = '{"id":"test-proxy","name":"测试代理","type":"vless","config":"test-config","testUrlId":"baidu"}'
    $response = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers @{"Authorization"="Bearer invalid"; "Content-Type"="application/json"} -Body $testData -TimeoutSec 10
    Write-Host "意外成功: $response" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✅ 代理测试端点正常响应401 (需要认证)" -ForegroundColor Green
    } else {
        Write-Host "❌ 代理测试端点异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n📊 步骤3: 测试历史记录API端点" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/test-proxy-id" -Method GET -Headers @{"Authorization"="Bearer invalid"} -TimeoutSec 10
    Write-Host "意外成功: $response" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✅ 历史记录端点正常响应401 (需要认证)" -ForegroundColor Green
    } else {
        Write-Host "❌ 历史记录端点异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n✅ API端点测试完成" -ForegroundColor Cyan
Write-Host "现在请检查Workers日志输出，看是否有相关的调试信息" -ForegroundColor Gray
