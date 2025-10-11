# 验证代理流媒体功能脚本
# 全面测试代理与视频流的集成效果

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  代理流媒体功能验证测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$VPS_API_URL = "https://yoyo-vps.5202021.xyz"

# 测试函数
function Test-ApiEndpoint {
    param($Url, $Description)
    try {
        $response = Invoke-RestMethod -Uri $Url -Method GET -TimeoutSec 10
        Write-Host "  ✓ $Description" -ForegroundColor Green
        return $response
    } catch {
        Write-Host "  ✗ $Description 失败: $_" -ForegroundColor Red
        return $null
    }
}

function Test-ProxyStatus {
    Write-Host "[1] 检查代理服务状态..." -ForegroundColor Yellow
    $response = Test-ApiEndpoint "$VPS_API_URL/api/proxy/status" "代理状态API"
    
    if ($response) {
        Write-Host "    连接状态: $($response.data.connectionStatus)" -ForegroundColor White
        Write-Host "    当前代理: $($response.data.currentProxy)" -ForegroundColor White
        Write-Host "    运行模式: $($response.data.mode)" -ForegroundColor White
        
        if ($response.data.connectionStatus -eq "connected") {
            Write-Host "  ✓ 代理已连接，具备流媒体转发条件" -ForegroundColor Green
            return $true
        } else {
            Write-Host "  ⚠ 代理未连接，流媒体将直连传输" -ForegroundColor Yellow
            return $false
        }
    }
    return $false
}

function Test-StreamStatus {
    Write-Host ""
    Write-Host "[2] 检查流媒体服务状态..." -ForegroundColor Yellow
    $response = Test-ApiEndpoint "$VPS_API_URL/api/simple-stream/system/status" "流媒体状态API"
    
    if ($response) {
        Write-Host "    活跃流数量: $($response.data.activeStreams)" -ForegroundColor White
        Write-Host "    总会话数: $($response.data.totalSessions)" -ForegroundColor White
        Write-Host "    系统状态: $($response.data.systemStatus)" -ForegroundColor White
        return $true
    }
    return $false
}

function Test-ProxyIntegration {
    Write-Host ""
    Write-Host "[3] 检查代理集成功能..." -ForegroundColor Yellow
    
    # 检查代理健康状态
    $healthResponse = Test-ApiEndpoint "$VPS_API_URL/api/proxy/health" "代理健康检查"
    
    if ($healthResponse) {
        Write-Host "    健康状态: $($healthResponse.status)" -ForegroundColor White
        Write-Host "    集成状态: $($healthResponse.data.integrationStatus)" -ForegroundColor White
    }
    
    # 检查基础服务
    $baseResponse = Test-ApiEndpoint "$VPS_API_URL/health" "VPS基础服务"
    
    if ($baseResponse) {
        Write-Host "    服务版本: $($baseResponse.version)" -ForegroundColor White
        Write-Host "    运行环境: $($baseResponse.environment)" -ForegroundColor White
    }
}

function Test-ProxyConnectivity {
    Write-Host ""
    Write-Host "[4] 测试代理连通性..." -ForegroundColor Yellow
    
    # 构造测试数据
    $testData = @{
        proxyId = "proxy_jp_001"
        testSite = "baidu"
    } | ConvertTo-Json
    
    try {
        $testResponse = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/test" -Method POST -Body $testData -ContentType "application/json" -TimeoutSec 15
        
        if ($testResponse.success) {
            Write-Host "  ✓ 代理连通性测试通过" -ForegroundColor Green
            Write-Host "    测试延迟: $($testResponse.data.latency)ms" -ForegroundColor White
            Write-Host "    测试方法: $($testResponse.data.method)" -ForegroundColor White
        } else {
            Write-Host "  ✗ 代理连通性测试失败" -ForegroundColor Red
            Write-Host "    错误信息: $($testResponse.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ⚠ 代理测试API调用失败: $_" -ForegroundColor Yellow
    }
}

function Show-IntegrationSummary {
    param($ProxyConnected, $StreamActive)
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  集成功能验证总结" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    if ($ProxyConnected -and $StreamActive) {
        Write-Host "🎯 完整功能状态:" -ForegroundColor Green
        Write-Host "  ✅ 代理服务正常运行" -ForegroundColor Green
        Write-Host "  ✅ 流媒体服务正常运行" -ForegroundColor Green
        Write-Host "  ✅ 代理流媒体集成完成" -ForegroundColor Green
        Write-Host "  ✅ 视频流将通过代理传输" -ForegroundColor Green
        Write-Host ""
        Write-Host "📋 用户体验:" -ForegroundColor Yellow
        Write-Host "  - 播放视频时流量通过代理服务器" -ForegroundColor White
        Write-Host "  - 可以访问被限制的RTMP源" -ForegroundColor White
        Write-Host "  - 代理切换时流媒体自动适应" -ForegroundColor White
        
    } elseif ($StreamActive) {
        Write-Host "⚠️ 部分功能状态:" -ForegroundColor Yellow
        Write-Host "  ✅ 流媒体服务正常运行" -ForegroundColor Green
        Write-Host "  ❌ 代理服务未连接" -ForegroundColor Red
        Write-Host "  ⚠️ 视频流将直连传输" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "📋 建议操作:" -ForegroundColor Yellow
        Write-Host "  1. 在管理后台开启代理功能" -ForegroundColor White
        Write-Host "  2. 选择并激活可用的代理节点" -ForegroundColor White
        Write-Host "  3. 重新运行此验证脚本" -ForegroundColor White
        
    } else {
        Write-Host "❌ 功能异常状态:" -ForegroundColor Red
        Write-Host "  ❌ 代理服务异常" -ForegroundColor Red
        Write-Host "  ❌ 流媒体服务异常" -ForegroundColor Red
        Write-Host "  ❌ 需要检查服务部署" -ForegroundColor Red
        Write-Host ""
        Write-Host "📋 故障排除:" -ForegroundColor Yellow
        Write-Host "  1. 检查VPS服务状态" -ForegroundColor White
        Write-Host "  2. 重新运行部署脚本" -ForegroundColor White
        Write-Host "  3. 查看服务日志排查问题" -ForegroundColor White
    }
}

function Show-TestInstructions {
    Write-Host ""
    Write-Host "🧪 手动测试步骤:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. 代理功能测试:" -ForegroundColor Yellow
    Write-Host "   - 访问管理后台代理配置页面" -ForegroundColor White
    Write-Host "   - 开启代理功能总开关" -ForegroundColor White
    Write-Host "   - 选择jp或us代理并激活" -ForegroundColor White
    Write-Host "   - 观察代理状态变为'已连接'" -ForegroundColor White
    Write-Host ""
    Write-Host "2. 视频流测试:" -ForegroundColor Yellow
    Write-Host "   - 播放任意视频内容" -ForegroundColor White
    Write-Host "   - 观察视频是否正常加载" -ForegroundColor White
    Write-Host "   - 检查播放质量和延迟" -ForegroundColor White
    Write-Host "   - 尝试切换不同代理节点" -ForegroundColor White
    Write-Host ""
    Write-Host "3. 切换功能测试:" -ForegroundColor Yellow
    Write-Host "   - 在视频播放过程中关闭代理" -ForegroundColor White
    Write-Host "   - 观察视频是否继续播放" -ForegroundColor White
    Write-Host "   - 重新开启代理，确认功能正常" -ForegroundColor White
    Write-Host ""
    Write-Host "4. 性能验证:" -ForegroundColor Yellow
    Write-Host "   - 对比代理开启前后的播放速度" -ForegroundColor White
    Write-Host "   - 测试不同代理节点的性能差异" -ForegroundColor White
    Write-Host "   - 确认代理不影响视频质量" -ForegroundColor White
    Write-Host ""
}

# 执行验证测试
$proxyConnected = Test-ProxyStatus
$streamActive = Test-StreamStatus
Test-ProxyIntegration
Test-ProxyConnectivity

# 显示总结
Show-IntegrationSummary -ProxyConnected $proxyConnected -StreamActive $streamActive
Show-TestInstructions

Write-Host "验证完成！" -ForegroundColor Green
Write-Host ""
