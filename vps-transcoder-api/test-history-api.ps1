# 测试历史记录API
Write-Host "🔍 测试代理历史记录API" -ForegroundColor Green

# 已知的代理ID
$proxyIds = @(
    "proxy_1760329814328_lyeyuemkh",  # JP测试代理1
    "proxy_1760191959322_7k06t6hk2",  # 2334jp
    "proxy_1760173685593_u3fve3hzw",  # test
    "proxy_1760173684780_rdvm8bd8h"   # jp-test
)

Write-Host "📊 测试所有代理的历史记录API" -ForegroundColor Yellow

foreach ($proxyId in $proxyIds) {
    Write-Host "`n🔍 测试代理: $proxyId" -ForegroundColor Cyan
    
    try {
        # 不使用认证，看看是否返回AUTH_REQUIRED错误
        $response = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$proxyId" -Method GET -TimeoutSec 10
        Write-Host "✅ API调用成功 (无需认证?)" -ForegroundColor Green
        Write-Host "   响应: $($response | ConvertTo-Json -Depth 2)" -ForegroundColor Gray
    } catch {
        $errorMessage = $_.Exception.Message
        $errorDetails = $_.ErrorDetails.Message
        
        if ($errorDetails -like "*AUTH_REQUIRED*") {
            Write-Host "✅ API端点正常，需要认证" -ForegroundColor Green
        } elseif ($errorDetails -like "*404*" -or $errorMessage -like "*404*") {
            Write-Host "❌ API端点不存在 (404)" -ForegroundColor Red
        } else {
            Write-Host "❌ API异常: $errorMessage" -ForegroundColor Red
            if ($errorDetails) {
                Write-Host "   详细错误: $errorDetails" -ForegroundColor Gray
            }
        }
    }
}

Write-Host "`n📋 测试总结" -ForegroundColor Cyan
Write-Host "如果所有API都返回AUTH_REQUIRED，说明端点配置正确" -ForegroundColor Gray
Write-Host "如果返回404，说明路由配置有问题" -ForegroundColor Gray
