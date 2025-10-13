# 完整流程测试：代理测试 → R2存储 → 历史记录读取
Write-Host "🔍 完整流程测试 - 代理延迟测试和R2存储验证" -ForegroundColor Green

# 从浏览器开发者工具中获取的认证token (需要手动替换)
Write-Host "⚠️ 需要从浏览器开发者工具获取认证token" -ForegroundColor Yellow
Write-Host "1. 打开 https://yoyo.5202021.xyz/admin" -ForegroundColor Gray
Write-Host "2. 按F12打开开发者工具" -ForegroundColor Gray
Write-Host "3. 在Network标签页中找到任意API请求" -ForegroundColor Gray
Write-Host "4. 复制Authorization header中的Bearer token" -ForegroundColor Gray
Write-Host ""

$authToken = Read-Host "请输入Bearer token (不包含'Bearer '前缀)"

if (-not $authToken) {
    Write-Host "❌ 需要认证token才能测试" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $authToken"
    "Content-Type" = "application/json"
}

Write-Host "`n📊 步骤1: 获取代理配置" -ForegroundColor Yellow
try {
    $proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Method GET -Headers $headers -TimeoutSec 10
    $proxies = $proxyConfig.data.proxies
    Write-Host "✅ 获取到 $($proxies.Count) 个代理" -ForegroundColor Green
    
    if ($proxies.Count -eq 0) {
        Write-Host "❌ 没有代理配置，无法测试" -ForegroundColor Red
        exit 1
    }
    
    # 选择第一个代理进行测试
    $testProxy = $proxies[0]
    Write-Host "   选择测试代理: $($testProxy.name) (ID: $($testProxy.id))" -ForegroundColor Gray
    
    Write-Host "`n📊 步骤2: 执行代理测试" -ForegroundColor Yellow
    $testData = @{
        id = $testProxy.id
        name = $testProxy.name
        type = $testProxy.type
        config = $testProxy.config
        testUrlId = "baidu"
    } | ConvertTo-Json -Depth 10
    
    Write-Host "   🚀 发送测试请求..." -ForegroundColor Cyan
    $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 20
    
    Write-Host "✅ 代理测试完成" -ForegroundColor Green
    Write-Host "   测试结果: success=$($testResult.data.success)" -ForegroundColor Gray
    Write-Host "   延迟: $($testResult.data.latency)ms" -ForegroundColor Gray
    Write-Host "   方法: $($testResult.data.method)" -ForegroundColor Gray
    Write-Host "   消息: $($testResult.data.message)" -ForegroundColor Gray
    
    if (-not $testResult.data.success) {
        Write-Host "⚠️ 代理测试失败，但继续验证R2存储流程" -ForegroundColor Yellow
    }
    
    Write-Host "`n📊 步骤3: 等待R2存储写入" -ForegroundColor Yellow
    Write-Host "   ⏳ 等待5秒让R2存储完成写入..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
    
    Write-Host "`n📊 步骤4: 读取历史记录" -ForegroundColor Yellow
    try {
        $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
        
        Write-Host "✅ 历史记录API调用成功" -ForegroundColor Green
        $history = $historyResult.data
        
        if ($history -and $history.Count -gt 0) {
            Write-Host "✅ 找到历史记录!" -ForegroundColor Green
            $latest = $history[0]
            Write-Host "   📝 记录数量: $($history.Count)" -ForegroundColor Gray
            Write-Host "   📅 测试时间: $($latest.timestamp)" -ForegroundColor Gray
            Write-Host "   📊 测试结果: success=$($latest.success), latency=$($latest.latency)ms" -ForegroundColor Gray
            Write-Host "   🌐 测试网站: $($latest.testUrlId)" -ForegroundColor Gray
            Write-Host "   🔧 测试方法: $($latest.method)" -ForegroundColor Gray
            
            # 验证数据一致性
            if ($latest.success -eq $testResult.data.success -and $latest.latency -eq $testResult.data.latency) {
                Write-Host "   ✅ R2存储数据与测试结果完全一致!" -ForegroundColor Green
            } else {
                Write-Host "   ⚠️ R2存储数据与测试结果不一致:" -ForegroundColor Yellow
                Write-Host "     刚才测试: success=$($testResult.data.success), latency=$($testResult.data.latency)" -ForegroundColor Gray
                Write-Host "     R2存储: success=$($latest.success), latency=$($latest.latency)" -ForegroundColor Gray
            }
        } else {
            Write-Host "❌ 没有找到历史记录!" -ForegroundColor Red
            Write-Host "   🔍 可能原因:" -ForegroundColor Yellow
            Write-Host "     1. R2存储写入失败" -ForegroundColor Gray
            Write-Host "     2. saveTestHistory函数未被调用" -ForegroundColor Gray
            Write-Host "     3. R2存储桶权限问题" -ForegroundColor Gray
            Write-Host "     4. Workers环境变量配置问题" -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "❌ 历史记录读取失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host "`n📊 步骤5: 测试其他代理的历史记录" -ForegroundColor Yellow
    foreach ($proxy in $proxies) {
        try {
            $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($proxy.id)" -Method GET -Headers $headers -TimeoutSec 5
            $history = $historyResult.data
            
            if ($history -and $history.Count -gt 0) {
                $latest = $history[0]
                Write-Host "   ✅ $($proxy.name): 延迟=$($latest.latency)ms, 时间=$($latest.timestamp)" -ForegroundColor Green
            } else {
                Write-Host "   ⚪ $($proxy.name): 无历史记录" -ForegroundColor Gray
            }
        } catch {
            Write-Host "   ❌ $($proxy.name): 读取失败" -ForegroundColor Red
        }
    }
    
} catch {
    Write-Host "❌ 流程测试失败: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   详细错误: $($_.ErrorDetails.Message)" -ForegroundColor Gray
    }
}

Write-Host "`n📋 测试总结" -ForegroundColor Cyan
Write-Host "=" * 60
Write-Host "🎯 完整流程测试结果:" -ForegroundColor Green
Write-Host ""
Write-Host "如果看到 '✅ R2存储数据与测试结果完全一致!'，说明:" -ForegroundColor Yellow
Write-Host "   • 代理测试API正常工作" -ForegroundColor Gray
Write-Host "   • R2存储写入成功" -ForegroundColor Gray
Write-Host "   • 历史记录读取正常" -ForegroundColor Gray
Write-Host "   • 问题可能在前端页面加载逻辑" -ForegroundColor Gray
Write-Host ""
Write-Host "如果看到 '❌ 没有找到历史记录!'，说明:" -ForegroundColor Yellow
Write-Host "   • R2存储写入可能失败" -ForegroundColor Gray
Write-Host "   • 需要检查Workers日志" -ForegroundColor Gray
Write-Host "   • 可能是权限或配置问题" -ForegroundColor Gray
Write-Host "=" * 60
