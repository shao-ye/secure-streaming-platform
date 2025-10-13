# 直接API测试脚本 - 测试代理延迟和R2存储功能
# 用于快速验证R2存储保存和历史记录加载

Write-Host "🔍 直接API测试 - 代理延迟和R2存储功能" -ForegroundColor Green

# 需要一个有效的认证token
$authToken = Read-Host "请输入管理员认证token"

if (-not $authToken) {
    Write-Host "❌ 需要认证token才能测试管理员API" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $authToken"
    "Content-Type" = "application/json"
}

# 1. 获取代理配置列表
Write-Host "`n📊 1. 获取代理配置列表" -ForegroundColor Yellow
try {
    $proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Method GET -Headers $headers -TimeoutSec 10
    Write-Host "✅ 代理配置获取成功" -ForegroundColor Green
    $proxies = $proxyConfig.data.proxies
    Write-Host "   代理数量: $($proxies.Count)" -ForegroundColor Gray
    
    if ($proxies.Count -gt 0) {
        $testProxy = $proxies[0]
        Write-Host "   测试代理: $($testProxy.name) (ID: $($testProxy.id))" -ForegroundColor Gray
        
        # 2. 执行代理测试
        Write-Host "`n📊 2. 执行代理测试" -ForegroundColor Yellow
        $testData = @{
            id = $testProxy.id
            name = $testProxy.name
            type = $testProxy.type
            config = $testProxy.config
            testUrlId = "baidu"
        } | ConvertTo-Json -Depth 10

        try {
            Write-Host "   🚀 开始测试代理: $($testProxy.name)" -ForegroundColor Cyan
            $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 15
            
            Write-Host "✅ 代理测试执行成功" -ForegroundColor Green
            Write-Host "   测试结果: success=$($testResult.data.success), latency=$($testResult.data.latency)ms, method=$($testResult.data.method)" -ForegroundColor Gray
            
            if ($testResult.data.success) {
                Write-Host "   ✅ 代理测试成功，延迟: $($testResult.data.latency)ms" -ForegroundColor Green
            } else {
                Write-Host "   ❌ 代理测试失败" -ForegroundColor Red
            }
            
            # 等待R2存储写入
            Write-Host "   ⏳ 等待R2存储写入 (5秒)..." -ForegroundColor Gray
            Start-Sleep -Seconds 5
            
            # 3. 获取测试历史记录
            Write-Host "`n📊 3. 获取测试历史记录" -ForegroundColor Yellow
            try {
                $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
                
                Write-Host "✅ 历史记录获取成功" -ForegroundColor Green
                $history = $historyResult.data
                
                if ($history -and $history.Count -gt 0) {
                    $latestTest = $history[0]
                    Write-Host "   📝 历史记录数量: $($history.Count)" -ForegroundColor Gray
                    Write-Host "   📅 最新测试时间: $($latestTest.timestamp)" -ForegroundColor Gray
                    Write-Host "   📊 最新测试结果: success=$($latestTest.success), latency=$($latestTest.latency)ms, method=$($latestTest.method)" -ForegroundColor Gray
                    Write-Host "   🌐 测试网站: $($latestTest.testUrlId)" -ForegroundColor Gray
                    
                    # 验证数据一致性
                    if ($latestTest.success -eq $testResult.data.success -and $latestTest.latency -eq $testResult.data.latency) {
                        Write-Host "   ✅ R2存储数据与测试结果一致" -ForegroundColor Green
                    } else {
                        Write-Host "   ⚠️ R2存储数据与测试结果不一致" -ForegroundColor Yellow
                        Write-Host "     测试结果: success=$($testResult.data.success), latency=$($testResult.data.latency)" -ForegroundColor Gray
                        Write-Host "     存储数据: success=$($latestTest.success), latency=$($latestTest.latency)" -ForegroundColor Gray
                    }
                } else {
                    Write-Host "   ❌ 没有找到历史测试记录" -ForegroundColor Red
                    Write-Host "   🔍 可能原因: R2存储写入失败或延迟" -ForegroundColor Yellow
                }
                
            } catch {
                Write-Host "   ❌ 历史记录获取失败: $($_.Exception.Message)" -ForegroundColor Red
            }
            
        } catch {
            Write-Host "❌ 代理测试执行失败: $($_.Exception.Message)" -ForegroundColor Red
        }
        
        # 4. 测试其他代理的历史记录
        Write-Host "`n📊 4. 检查所有代理的历史记录" -ForegroundColor Yellow
        foreach ($proxy in $proxies) {
            try {
                $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($proxy.id)" -Method GET -Headers $headers -TimeoutSec 10
                $history = $historyResult.data
                
                if ($history -and $history.Count -gt 0) {
                    $latestTest = $history[0]
                    Write-Host "   ✅ $($proxy.name): 有历史记录 (延迟: $($latestTest.latency)ms, 时间: $($latestTest.timestamp))" -ForegroundColor Green
                } else {
                    Write-Host "   ⚪ $($proxy.name): 无历史记录" -ForegroundColor Gray
                }
            } catch {
                Write-Host "   ❌ $($proxy.name): 获取历史记录失败" -ForegroundColor Red
            }
        }
        
    } else {
        Write-Host "   ❌ 没有找到代理配置" -ForegroundColor Red
    }
    
} catch {
    Write-Host "❌ 代理配置获取失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 5. 测试全局配置
Write-Host "`n📊 5. 测试全局配置" -ForegroundColor Yellow
try {
    $globalConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/global-config" -Method GET -Headers $headers -TimeoutSec 10
    Write-Host "✅ 全局配置获取成功" -ForegroundColor Green
    Write-Host "   当前测试网站: $($globalConfig.data.currentTestUrlId)" -ForegroundColor Gray
    Write-Host "   启用历史记录: $($globalConfig.data.enableTestHistory)" -ForegroundColor Gray
} catch {
    Write-Host "❌ 全局配置获取失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📋 API测试总结" -ForegroundColor Cyan
Write-Host "=" * 50
Write-Host "🎯 直接API测试完成" -ForegroundColor Green
Write-Host ""
Write-Host "📝 测试项目:" -ForegroundColor Yellow
Write-Host "   • 代理配置列表获取" -ForegroundColor Gray
Write-Host "   • 代理测试API调用" -ForegroundColor Gray
Write-Host "   • R2存储写入验证" -ForegroundColor Gray
Write-Host "   • 历史记录读取验证" -ForegroundColor Gray
Write-Host "   • 数据一致性检查" -ForegroundColor Gray
Write-Host ""
Write-Host "🔧 如果历史记录为空，可能原因:" -ForegroundColor Yellow
Write-Host "   1. R2存储桶配置问题" -ForegroundColor Gray
Write-Host "   2. saveTestHistory函数执行失败" -ForegroundColor Gray
Write-Host "   3. Workers环境变量缺失" -ForegroundColor Gray
Write-Host "   4. R2存储权限问题" -ForegroundColor Gray
Write-Host "=" * 50
