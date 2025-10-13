# 简化版API测试脚本
Write-Host "🔍 API直接测试 - R2存储功能验证" -ForegroundColor Green

# 使用一个测试token (需要替换为实际的token)
$authToken = "your-admin-token-here"
Write-Host "⚠️ 请在脚本中设置正确的authToken" -ForegroundColor Yellow

$headers = @{
    "Authorization" = "Bearer $authToken"
    "Content-Type" = "application/json"
}

# 1. 获取代理列表
Write-Host "`n📊 1. 获取代理配置" -ForegroundColor Yellow
try {
    $proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Method GET -Headers $headers -TimeoutSec 10
    $proxies = $proxyConfig.data.proxies
    Write-Host "✅ 获取到 $($proxies.Count) 个代理" -ForegroundColor Green
    
    if ($proxies.Count -gt 0) {
        $testProxy = $proxies[0]
        Write-Host "   测试代理: $($testProxy.name)" -ForegroundColor Gray
        
        # 2. 执行代理测试
        Write-Host "`n📊 2. 执行代理测试" -ForegroundColor Yellow
        $testData = @{
            id = $testProxy.id
            name = $testProxy.name
            type = $testProxy.type
            config = $testProxy.config
            testUrlId = "baidu"
        } | ConvertTo-Json
        
        $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 15
        Write-Host "✅ 测试完成: success=$($testResult.data.success), latency=$($testResult.data.latency)ms" -ForegroundColor Green
        
        # 等待R2写入
        Write-Host "   ⏳ 等待R2存储..." -ForegroundColor Gray
        Start-Sleep -Seconds 3
        
        # 3. 检查历史记录
        Write-Host "`n📊 3. 检查历史记录" -ForegroundColor Yellow
        $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
        $history = $historyResult.data
        
        if ($history -and $history.Count -gt 0) {
            $latest = $history[0]
            Write-Host "✅ 找到历史记录: latency=$($latest.latency)ms, time=$($latest.timestamp)" -ForegroundColor Green
        } else {
            Write-Host "❌ 没有历史记录" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "❌ API调用失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n✅ 测试完成" -ForegroundColor Green
