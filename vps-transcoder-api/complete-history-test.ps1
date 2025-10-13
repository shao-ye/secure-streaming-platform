# 完整的代理历史记录测试流程
Write-Host "🎯 执行完整的代理历史记录测试流程" -ForegroundColor Green

# 需要用户提供有效的认证token
$token = Read-Host "`n请输入有效的管理员认证token"

if (-not $token) {
    Write-Host "❌ 需要有效的token才能继续测试" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

Write-Host "`n📊 步骤1: 获取代理配置列表" -ForegroundColor Yellow
try {
    $proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Method GET -Headers $headers -TimeoutSec 10
    $proxies = $proxyConfig.data.proxies
    
    if ($proxies.Count -eq 0) {
        Write-Host "❌ 没有代理配置，无法测试" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✅ 获取到 $($proxies.Count) 个代理配置" -ForegroundColor Green
    $testProxy = $proxies[0]
    Write-Host "   选择测试代理: $($testProxy.name) (ID: $($testProxy.id))" -ForegroundColor Gray
    
} catch {
    Write-Host "❌ 获取代理配置失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n📊 步骤2: 检查测试前的历史记录" -ForegroundColor Yellow
try {
    $historyBefore = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
    
    if ($historyBefore.data -and $historyBefore.data.Count -gt 0) {
        $latest = $historyBefore.data[0]
        Write-Host "✅ 测试前已有历史记录:" -ForegroundColor Green
        Write-Host "   延迟: $($latest.latency)ms" -ForegroundColor Gray
        Write-Host "   时间: $($latest.timestamp)" -ForegroundColor Gray
        Write-Host "   方法: $($latest.method)" -ForegroundColor Gray
    } else {
        Write-Host "⚪ 测试前无历史记录" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ 获取测试前历史记录失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📊 步骤3: 执行代理测试" -ForegroundColor Yellow
$testData = @{
    id = $testProxy.id
    name = $testProxy.name
    type = $testProxy.type
    config = $testProxy.config
    testUrlId = "baidu"
} | ConvertTo-Json -Depth 10

try {
    Write-Host "   🚀 发送测试请求..." -ForegroundColor Cyan
    $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 25
    
    Write-Host "✅ 代理测试完成" -ForegroundColor Green
    Write-Host "   成功: $($testResult.data.success)" -ForegroundColor Gray
    Write-Host "   延迟: $($testResult.data.latency)ms" -ForegroundColor Gray
    Write-Host "   方法: $($testResult.data.method)" -ForegroundColor Gray
    
    if ($testResult.data.error) {
        Write-Host "   错误: $($testResult.data.error)" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ 代理测试失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n📊 步骤4: 等待R2存储写入完成" -ForegroundColor Yellow
Write-Host "   ⏳ 等待5秒确保R2存储完成..." -ForegroundColor Gray
Start-Sleep -Seconds 5

Write-Host "`n📊 步骤5: 检查测试后的历史记录" -ForegroundColor Yellow
try {
    $historyAfter = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
    
    if ($historyAfter.data -and $historyAfter.data.Count -gt 0) {
        $latest = $historyAfter.data[0]
        Write-Host "✅ 测试后找到历史记录:" -ForegroundColor Green
        Write-Host "   延迟: $($latest.latency)ms" -ForegroundColor Gray
        Write-Host "   时间: $($latest.timestamp)" -ForegroundColor Gray
        Write-Host "   方法: $($latest.method)" -ForegroundColor Gray
        Write-Host "   成功: $($latest.success)" -ForegroundColor Gray
        
        # 验证数据一致性
        if ($latest.latency -eq $testResult.data.latency) {
            Write-Host "   ✅ 历史记录与测试结果完全一致!" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️ 历史记录与测试结果不一致:" -ForegroundColor Yellow
            Write-Host "     测试结果延迟: $($testResult.data.latency)ms" -ForegroundColor Gray
            Write-Host "     历史记录延迟: $($latest.latency)ms" -ForegroundColor Gray
        }
        
        # 检查时间戳是否是最新的
        $testTime = [DateTime]::Parse($latest.timestamp)
        $now = Get-Date
        $timeDiff = ($now - $testTime).TotalMinutes
        
        if ($timeDiff -lt 2) {
            Write-Host "   ✅ 时间戳是最新的 (差异: $([math]::Round($timeDiff, 1))分钟)" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️ 时间戳较旧 (差异: $([math]::Round($timeDiff, 1))分钟)" -ForegroundColor Yellow
        }
        
    } else {
        Write-Host "❌ 测试后仍然没有历史记录!" -ForegroundColor Red
        Write-Host "   🔍 这表明R2存储写入失败" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ 获取测试后历史记录失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📊 步骤6: 验证前端数据格式兼容性" -ForegroundColor Yellow
if ($historyAfter.data -and $historyAfter.data.Count -gt 0) {
    $latest = $historyAfter.data[0]
    
    # 模拟前端的处理逻辑
    Write-Host "   🔍 模拟前端处理逻辑:" -ForegroundColor Cyan
    
    if ($latest.success -and $latest.latency -gt 0) {
        Write-Host "   ✅ 前端应该显示: $($latest.latency)ms (历史延迟)" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️ 前端可能不会显示历史延迟" -ForegroundColor Yellow
        Write-Host "     success: $($latest.success)" -ForegroundColor Gray
        Write-Host "     latency: $($latest.latency)" -ForegroundColor Gray
    }
}

Write-Host "`n📋 测试结果总结" -ForegroundColor Cyan
Write-Host "=" * 60
Write-Host "🎯 完整流程测试结果分析:" -ForegroundColor Green
Write-Host ""
Write-Host "如果历史记录与测试结果一致且时间戳最新:" -ForegroundColor Yellow
Write-Host "   → R2存储功能完全正常" -ForegroundColor Gray
Write-Host "   → 问题可能在前端页面加载时机或显示逻辑" -ForegroundColor Gray
Write-Host ""
Write-Host "如果没有历史记录或数据不一致:" -ForegroundColor Yellow
Write-Host "   → R2存储写入存在问题" -ForegroundColor Gray
Write-Host "   → 需要检查Workers环境变量和R2存储桶配置" -ForegroundColor Gray
Write-Host ""
Write-Host "下一步建议:" -ForegroundColor Yellow
Write-Host "   1. 如果R2存储正常，检查前端页面刷新后是否显示历史延迟" -ForegroundColor Gray
Write-Host "   2. 如果R2存储异常，检查Cloudflare Workers的R2存储桶配置" -ForegroundColor Gray
Write-Host "   3. 检查浏览器控制台是否有相关错误日志" -ForegroundColor Gray
Write-Host "=" * 60
