# R2存储流程测试 - 使用curl命令
Write-Host "🔍 R2存储完整流程测试" -ForegroundColor Green

# 请手动设置有效的token
$token = Read-Host "请输入Bearer token (从浏览器开发者工具获取)"

if (-not $token) {
    Write-Host "❌ 需要token才能继续测试" -ForegroundColor Red
    exit 1
}

# 已知的代理ID (从之前的测试中获得)
$proxyId = "proxy_1760329814328_lyeyuemkh"  # JP测试代理1
$proxyName = "JP测试代理1"

Write-Host "`n📊 步骤1: 直接调用代理测试API" -ForegroundColor Yellow

# 构造测试数据
$testData = @{
    id = $proxyId
    name = $proxyName
    type = "vless"
    config = "vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=XSIEcTZ1NnjyY-BhYuiW74fAwFfve-8YJ-T855r0f1c&type=tcp&headerType=none#JP-Evoxt"
    testUrlId = "baidu"
} | ConvertTo-Json -Compress

Write-Host "   🚀 发送测试请求到: https://yoyoapi.5202021.xyz/api/admin/proxy/test" -ForegroundColor Cyan
Write-Host "   📝 测试数据: $($testData.Substring(0, [Math]::Min(100, $testData.Length)))..." -ForegroundColor Gray

try {
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type" = "application/json"
    }
    
    $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 30
    
    Write-Host "✅ 代理测试API调用成功" -ForegroundColor Green
    Write-Host "   📊 测试结果: success=$($testResult.data.success)" -ForegroundColor Gray
    Write-Host "   ⏱️ 延迟: $($testResult.data.latency)ms" -ForegroundColor Gray
    Write-Host "   🔧 方法: $($testResult.data.method)" -ForegroundColor Gray
    Write-Host "   💬 消息: $($testResult.data.message)" -ForegroundColor Gray
    
    if ($testResult.data.success) {
        Write-Host "   ✅ 代理测试成功!" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️ 代理测试失败，但继续验证R2存储" -ForegroundColor Yellow
    }
    
    Write-Host "`n📊 步骤2: 等待R2存储写入" -ForegroundColor Yellow
    Write-Host "   ⏳ 等待10秒确保R2存储完成..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
    
    Write-Host "`n📊 步骤3: 读取R2存储的历史记录" -ForegroundColor Yellow
    Write-Host "   🔍 查询URL: https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$proxyId" -ForegroundColor Cyan
    
    $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$proxyId" -Method GET -Headers $headers -TimeoutSec 15
    
    Write-Host "✅ 历史记录API调用成功" -ForegroundColor Green
    $history = $historyResult.data
    
    if ($history -and $history.Count -gt 0) {
        Write-Host "🎉 在R2存储中找到历史记录!" -ForegroundColor Green
        $latest = $history[0]
        Write-Host "   📝 记录数量: $($history.Count)" -ForegroundColor Gray
        Write-Host "   📅 测试时间: $($latest.timestamp)" -ForegroundColor Gray
        Write-Host "   📊 测试结果: success=$($latest.success)" -ForegroundColor Gray
        Write-Host "   ⏱️ 延迟: $($latest.latency)ms" -ForegroundColor Gray
        Write-Host "   🌐 测试网站: $($latest.testUrlId)" -ForegroundColor Gray
        Write-Host "   🔧 测试方法: $($latest.method)" -ForegroundColor Gray
        
        # 验证数据一致性
        if ($latest.success -eq $testResult.data.success -and $latest.latency -eq $testResult.data.latency) {
            Write-Host "   🎯 R2存储数据与测试结果完全一致!" -ForegroundColor Green
            Write-Host "   ✅ R2存储写入和读取功能正常" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️ R2存储数据与测试结果不一致:" -ForegroundColor Yellow
            Write-Host "     刚才测试: success=$($testResult.data.success), latency=$($testResult.data.latency)" -ForegroundColor Gray
            Write-Host "     R2存储: success=$($latest.success), latency=$($latest.latency)" -ForegroundColor Gray
        }
    } else {
        Write-Host "❌ R2存储中没有找到历史记录!" -ForegroundColor Red
        Write-Host "   🔍 可能的原因:" -ForegroundColor Yellow
        Write-Host "     1. saveTestHistory函数没有被调用" -ForegroundColor Gray
        Write-Host "     2. R2存储写入失败" -ForegroundColor Gray
        Write-Host "     3. R2存储桶权限问题" -ForegroundColor Gray
        Write-Host "     4. Workers环境变量PROXY_TEST_HISTORY未配置" -ForegroundColor Gray
    }
    
} catch {
    Write-Host "❌ API调用失败: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   详细错误: $($_.ErrorDetails.Message)" -ForegroundColor Gray
    }
}

Write-Host "`n📋 测试总结" -ForegroundColor Cyan
Write-Host "=" * 50
if ($history -and $history.Count -gt 0) {
    Write-Host "🎯 结论: R2存储功能正常工作" -ForegroundColor Green
    Write-Host "   问题可能在前端页面加载逻辑" -ForegroundColor Yellow
} else {
    Write-Host "🎯 结论: R2存储可能存在问题" -ForegroundColor Red
    Write-Host "   需要检查Workers日志和配置" -ForegroundColor Yellow
}
Write-Host "=" * 50
