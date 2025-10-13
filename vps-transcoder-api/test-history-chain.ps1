# 测试历史记录完整链路
Write-Host "🔍 测试代理历史记录完整链路" -ForegroundColor Green

# 测试无认证的API调用，观察响应
Write-Host "`n📊 步骤1: 测试R2存储调试端点" -ForegroundColor Yellow
try {
    $r2Debug = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/debug/r2-storage" -Method GET -Headers @{"Authorization"="Bearer test"} -TimeoutSec 10
    Write-Host "意外成功: $($r2Debug | ConvertTo-Json)" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✅ R2调试端点存在，需要认证" -ForegroundColor Green
    } else {
        Write-Host "❌ R2调试端点异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n📊 步骤2: 测试历史记录API端点" -ForegroundColor Yellow
$testProxyId = "proxy_1760329814328_lyeyuemkh"  # JP测试代理1的ID
try {
    $history = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$testProxyId" -Method GET -Headers @{"Authorization"="Bearer test"} -TimeoutSec 10
    Write-Host "意外成功: $($history | ConvertTo-Json)" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✅ 历史记录端点存在，需要认证" -ForegroundColor Green
    } else {
        Write-Host "❌ 历史记录端点异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n📊 步骤3: 测试代理测试API端点" -ForegroundColor Yellow
$testData = '{"id":"test","name":"测试","type":"vless","config":"test","testUrlId":"baidu"}'
try {
    $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers @{"Authorization"="Bearer test"; "Content-Type"="application/json"} -Body $testData -TimeoutSec 10
    Write-Host "意外成功: $($testResult | ConvertTo-Json)" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✅ 代理测试端点存在，需要认证" -ForegroundColor Green
    } else {
        Write-Host "❌ 代理测试端点异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n📊 步骤4: 测试R2写入端点" -ForegroundColor Yellow
try {
    $r2Write = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/debug/r2-write-test" -Method POST -Headers @{"Authorization"="Bearer test"} -TimeoutSec 10
    Write-Host "意外成功: $($r2Write | ConvertTo-Json)" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "✅ R2写入测试端点存在，需要认证" -ForegroundColor Green
    } else {
        Write-Host "❌ R2写入测试端点异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n📋 API端点验证总结" -ForegroundColor Cyan
Write-Host "=" * 50
Write-Host "🎯 所有API端点状态:" -ForegroundColor Green
Write-Host ""
Write-Host "如果所有端点都返回401认证错误，说明:" -ForegroundColor Yellow
Write-Host "   ✅ API端点配置正确" -ForegroundColor Gray
Write-Host "   ✅ 路由配置正常" -ForegroundColor Gray
Write-Host "   ✅ Workers部署成功" -ForegroundColor Gray
Write-Host "   🔍 问题可能在认证或R2存储逻辑" -ForegroundColor Gray
Write-Host ""
Write-Host "下一步调试建议:" -ForegroundColor Yellow
Write-Host "   1. 获取有效的认证token" -ForegroundColor Gray
Write-Host "   2. 执行完整的代理测试流程" -ForegroundColor Gray
Write-Host "   3. 检查R2存储写入和读取" -ForegroundColor Gray
Write-Host "   4. 验证前端历史记录加载逻辑" -ForegroundColor Gray
Write-Host "=" * 50
