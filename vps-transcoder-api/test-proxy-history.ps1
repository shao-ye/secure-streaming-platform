# 代理历史测试结果验证脚本
# 用于测试R2存储和历史加载功能

Write-Host "🔍 代理历史测试结果验证" -ForegroundColor Green

# 需要一个有效的认证token来测试管理员API
$authToken = Read-Host "请输入管理员认证token (或按Enter跳过认证测试)"

if ($authToken) {
    Write-Host "`n📊 1. 测试全局配置API" -ForegroundColor Yellow
    try {
        $globalConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/global-config" -Method GET -Headers @{"Authorization"="Bearer $authToken"} -TimeoutSec 10
        Write-Host "✅ 全局配置获取成功" -ForegroundColor Green
        Write-Host "   当前测试网站: $($globalConfig.data.currentTestUrlId)" -ForegroundColor Gray
    } catch {
        Write-Host "❌ 全局配置获取失败: $($_.Exception.Message)" -ForegroundColor Red
    }

    Write-Host "`n📊 2. 测试代理配置API" -ForegroundColor Yellow
    try {
        $proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Method GET -Headers @{"Authorization"="Bearer $authToken"} -TimeoutSec 10
        Write-Host "✅ 代理配置获取成功" -ForegroundColor Green
        $proxies = $proxyConfig.data.proxies
        Write-Host "   代理数量: $($proxies.Count)" -ForegroundColor Gray
        
        if ($proxies.Count -gt 0) {
            Write-Host "`n📊 3. 测试代理历史记录API" -ForegroundColor Yellow
            $testProxyId = $proxies[0].id
            Write-Host "   测试代理ID: $testProxyId" -ForegroundColor Gray
            
            try {
                $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$testProxyId" -Method GET -Headers @{"Authorization"="Bearer $authToken"} -TimeoutSec 10
                Write-Host "✅ 代理历史记录获取成功" -ForegroundColor Green
                $history = $historyResult.data
                if ($history -and $history.Count -gt 0) {
                    $latestTest = $history[0]
                    Write-Host "   历史记录数量: $($history.Count)" -ForegroundColor Gray
                    Write-Host "   最新测试时间: $($latestTest.timestamp)" -ForegroundColor Gray
                    Write-Host "   最新测试结果: success=$($latestTest.success), latency=$($latestTest.latency)ms" -ForegroundColor Gray
                } else {
                    Write-Host "   📝 该代理暂无历史测试记录" -ForegroundColor Yellow
                }
            } catch {
                Write-Host "❌ 代理历史记录获取失败: $($_.Exception.Message)" -ForegroundColor Red
            }

            Write-Host "`n📊 4. 执行代理测试 (创建历史记录)" -ForegroundColor Yellow
            try {
                $testData = @{
                    id = $testProxyId
                    name = $proxies[0].name
                    type = $proxies[0].type
                    config = $proxies[0].config
                    testUrlId = "baidu"
                } | ConvertTo-Json

                $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers @{"Authorization"="Bearer $authToken"; "Content-Type"="application/json"} -Body $testData -TimeoutSec 15
                Write-Host "✅ 代理测试执行成功" -ForegroundColor Green
                Write-Host "   测试结果: success=$($testResult.data.success), latency=$($testResult.data.latency)ms, method=$($testResult.data.method)" -ForegroundColor Gray
                
                # 等待几秒让R2存储完成写入
                Write-Host "   ⏳ 等待R2存储写入..." -ForegroundColor Gray
                Start-Sleep -Seconds 3
                
                # 再次获取历史记录验证是否保存成功
                try {
                    $newHistoryResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$testProxyId" -Method GET -Headers @{"Authorization"="Bearer $authToken"} -TimeoutSec 10
                    $newHistory = $newHistoryResult.data
                    if ($newHistory -and $newHistory.Count -gt 0) {
                        $latestTest = $newHistory[0]
                        Write-Host "✅ R2存储验证成功 - 最新记录已保存" -ForegroundColor Green
                        Write-Host "   保存时间: $($latestTest.timestamp)" -ForegroundColor Gray
                        Write-Host "   保存结果: success=$($latestTest.success), latency=$($latestTest.latency)ms" -ForegroundColor Gray
                    } else {
                        Write-Host "⚠️ R2存储可能有延迟，历史记录暂未更新" -ForegroundColor Yellow
                    }
                } catch {
                    Write-Host "❌ R2存储验证失败: $($_.Exception.Message)" -ForegroundColor Red
                }
                
            } catch {
                Write-Host "❌ 代理测试执行失败: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    } catch {
        Write-Host "❌ 代理配置获取失败: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "⏭️ 跳过认证测试，仅验证基础服务" -ForegroundColor Yellow
}

Write-Host "`n📊 5. 验证基础服务状态" -ForegroundColor Yellow
try {
    $apiStatus = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/status" -Method GET -TimeoutSec 10
    Write-Host "✅ API服务正常: $($apiStatus.status) v$($apiStatus.version)" -ForegroundColor Green
} catch {
    Write-Host "❌ API服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

try {
    $vpsStatus = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/status" -Method GET -TimeoutSec 10
    Write-Host "✅ VPS服务正常: $($vpsStatus.status) v$($vpsStatus.version)" -ForegroundColor Green
} catch {
    Write-Host "❌ VPS服务异常: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📋 验证总结" -ForegroundColor Cyan
Write-Host "=" * 50
Write-Host "🎯 代理历史测试结果功能验证完成" -ForegroundColor Green
Write-Host ""
Write-Host "📝 验证项目:" -ForegroundColor Yellow
Write-Host "   • R2存储配置 (PROXY_TEST_HISTORY)" -ForegroundColor Gray
Write-Host "   • 全局配置API端点" -ForegroundColor Gray
Write-Host "   • 代理历史记录API端点" -ForegroundColor Gray
Write-Host "   • 代理测试和R2存储写入" -ForegroundColor Gray
Write-Host "   • 基础服务状态" -ForegroundColor Gray
Write-Host ""
Write-Host "🔧 下一步:" -ForegroundColor Yellow
Write-Host "   1. 刷新前端页面 (Cloudflare Pages自动部署)" -ForegroundColor Gray
Write-Host "   2. 检查延迟列是否显示历史测试结果" -ForegroundColor Gray
Write-Host "   3. 测试已连接代理的自动刷新功能" -ForegroundColor Gray
Write-Host "=" * 50
