# 调试历史记录加载问题 - 完整流程测试
Write-Host "🔍 调试代理延迟历史记录加载问题" -ForegroundColor Green

Write-Host "`n📋 测试流程:" -ForegroundColor Yellow
Write-Host "1. 获取认证token" -ForegroundColor Gray
Write-Host "2. 获取代理配置列表" -ForegroundColor Gray
Write-Host "3. 执行代理测试并观察R2存储" -ForegroundColor Gray
Write-Host "4. 检查历史记录API" -ForegroundColor Gray
Write-Host "5. 验证前端加载逻辑" -ForegroundColor Gray

# 需要手动输入token
$token = Read-Host "`n请输入管理员认证token (从浏览器开发者工具获取)"

if (-not $token) {
    Write-Host "❌ 需要token才能继续测试" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
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
    
    Write-Host "`n📊 步骤2: 检查R2存储当前状态" -ForegroundColor Yellow
    try {
        $r2Status = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/debug/r2-storage" -Method GET -Headers $headers -TimeoutSec 10
        Write-Host "✅ R2存储状态:" -ForegroundColor Green
        Write-Host "   对象数量: $($r2Status.data.objectCount)" -ForegroundColor Gray
        if ($r2Status.data.objects.Count -gt 0) {
            Write-Host "   现有对象:" -ForegroundColor Gray
            foreach ($obj in $r2Status.data.objects) {
                Write-Host "     - $($obj.key) (大小: $($obj.size) 字节)" -ForegroundColor Gray
            }
        }
    } catch {
        Write-Host "⚠️ 无法获取R2存储状态: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    Write-Host "`n📊 步骤3: 检查代理历史记录 (测试前)" -ForegroundColor Yellow
    try {
        $historyBefore = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
        if ($historyBefore.data -and $historyBefore.data.Count -gt 0) {
            Write-Host "✅ 找到现有历史记录: $($historyBefore.data.Count) 条" -ForegroundColor Green
            $latest = $historyBefore.data[0]
            Write-Host "   最新记录: 延迟=$($latest.latency)ms, 时间=$($latest.timestamp)" -ForegroundColor Gray
        } else {
            Write-Host "⚪ 暂无历史记录" -ForegroundColor Gray
        }
    } catch {
        Write-Host "❌ 获取历史记录失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host "`n📊 步骤4: 执行代理测试" -ForegroundColor Yellow
    $testData = @{
        id = $testProxy.id
        name = $testProxy.name
        type = $testProxy.type
        config = $testProxy.config
        testUrlId = "baidu"
    } | ConvertTo-Json -Depth 10
    
    Write-Host "   🚀 发送测试请求..." -ForegroundColor Cyan
    $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 25
    
    Write-Host "✅ 代理测试完成" -ForegroundColor Green
    Write-Host "   测试结果: success=$($testResult.data.success)" -ForegroundColor Gray
    Write-Host "   延迟: $($testResult.data.latency)ms" -ForegroundColor Gray
    Write-Host "   方法: $($testResult.data.method)" -ForegroundColor Gray
    
    Write-Host "`n📊 步骤5: 等待R2存储写入" -ForegroundColor Yellow
    Write-Host "   ⏳ 等待8秒确保R2存储完成..." -ForegroundColor Gray
    Start-Sleep -Seconds 8
    
    Write-Host "`n📊 步骤6: 检查R2存储更新状态" -ForegroundColor Yellow
    try {
        $r2StatusAfter = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/debug/r2-storage" -Method GET -Headers $headers -TimeoutSec 10
        Write-Host "✅ R2存储更新后状态:" -ForegroundColor Green
        Write-Host "   对象数量: $($r2StatusAfter.data.objectCount)" -ForegroundColor Gray
        
        if ($r2StatusAfter.data.objectCount -gt $r2Status.data.objectCount) {
            Write-Host "   ✅ R2存储对象数量增加了!" -ForegroundColor Green
        } elseif ($r2StatusAfter.data.objectCount -eq $r2Status.data.objectCount) {
            Write-Host "   ⚠️ R2存储对象数量没有变化" -ForegroundColor Yellow
        }
        
        # 查找我们测试的代理对应的文件
        $targetKey = "$($testProxy.id).json"
        $foundObject = $r2StatusAfter.data.objects | Where-Object { $_.key -eq $targetKey }
        if ($foundObject) {
            Write-Host "   ✅ 找到测试代理的R2存储文件: $($foundObject.key)" -ForegroundColor Green
        } else {
            Write-Host "   ❌ 没有找到测试代理的R2存储文件: $targetKey" -ForegroundColor Red
        }
    } catch {
        Write-Host "⚠️ 无法获取R2存储更新状态: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    Write-Host "`n📊 步骤7: 检查代理历史记录 (测试后)" -ForegroundColor Yellow
    try {
        $historyAfter = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
        
        if ($historyAfter.data -and $historyAfter.data.Count -gt 0) {
            Write-Host "✅ 测试后找到历史记录: $($historyAfter.data.Count) 条" -ForegroundColor Green
            $latest = $historyAfter.data[0]
            Write-Host "   最新记录: 延迟=$($latest.latency)ms, 时间=$($latest.timestamp)" -ForegroundColor Gray
            Write-Host "   测试网站: $($latest.testUrlId)" -ForegroundColor Gray
            Write-Host "   测试方法: $($latest.method)" -ForegroundColor Gray
            
            # 验证数据一致性
            if ($latest.latency -eq $testResult.data.latency) {
                Write-Host "   ✅ 历史记录与测试结果一致!" -ForegroundColor Green
            } else {
                Write-Host "   ⚠️ 历史记录与测试结果不一致" -ForegroundColor Yellow
                Write-Host "     测试结果: $($testResult.data.latency)ms" -ForegroundColor Gray
                Write-Host "     历史记录: $($latest.latency)ms" -ForegroundColor Gray
            }
        } else {
            Write-Host "❌ 测试后仍然没有历史记录!" -ForegroundColor Red
            Write-Host "   🔍 这表明R2存储写入或读取存在问题" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ 获取测试后历史记录失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host "`n📊 步骤8: 测试其他代理的历史记录" -ForegroundColor Yellow
    foreach ($proxy in $proxies) {
        try {
            $history = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($proxy.id)" -Method GET -Headers $headers -TimeoutSec 5
            if ($history.data -and $history.data.Count -gt 0) {
                $latest = $history.data[0]
                Write-Host "   ✅ $($proxy.name): 延迟=$($latest.latency)ms, 时间=$($latest.timestamp)" -ForegroundColor Green
            } else {
                Write-Host "   ⚪ $($proxy.name): 无历史记录" -ForegroundColor Gray
            }
        } catch {
            Write-Host "   ❌ $($proxy.name): 获取失败" -ForegroundColor Red
        }
    }
    
} catch {
    Write-Host "❌ 测试流程失败: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   详细错误: $($_.ErrorDetails.Message)" -ForegroundColor Gray
    }
}

Write-Host "`n📋 问题诊断总结" -ForegroundColor Cyan
Write-Host "=" * 60
Write-Host "🎯 根据测试结果分析问题:" -ForegroundColor Green
Write-Host ""
Write-Host "如果看到 '✅ 历史记录与测试结果一致!':" -ForegroundColor Yellow
Write-Host "   → R2存储功能正常，问题在前端页面加载逻辑" -ForegroundColor Gray
Write-Host "   → 需要检查ProxyConfig.vue的loadProxyTestHistory函数" -ForegroundColor Gray
Write-Host ""
Write-Host "如果看到 '❌ 测试后仍然没有历史记录!':" -ForegroundColor Yellow
Write-Host "   → R2存储写入失败，需要检查Workers日志" -ForegroundColor Gray
Write-Host "   → 可能是saveTestHistory函数或R2配置问题" -ForegroundColor Gray
Write-Host ""
Write-Host "如果看到 '❌ 没有找到测试代理的R2存储文件':" -ForegroundColor Yellow
Write-Host "   → R2存储写入失败，但API返回成功" -ForegroundColor Gray
Write-Host "   → 需要检查R2存储桶权限和配置" -ForegroundColor Gray
Write-Host "=" * 60
