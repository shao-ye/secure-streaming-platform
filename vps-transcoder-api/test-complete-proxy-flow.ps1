# 完整代理测试流程验证脚本
# 测试从前端到VPS的完整代理测试功能

Write-Host "🎯 完整代理测试流程验证" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 测试数据
$testData = @{
    id = "jp"
    name = "JP-Evoxt" 
    type = "vless"
    config = "vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=XSIEcTZ1NnjyY-BhYuiW74fAwFfve-8YJ-T855r0f1c&type=tcp&headerType=none#JP-Evoxt"
    testUrlId = "baidu"
} | ConvertTo-Json -Depth 3

Write-Host "📋 测试配置:" -ForegroundColor Yellow
Write-Host "- 代理: JP-Evoxt (VLESS)" -ForegroundColor White
Write-Host "- 测试网站: 百度" -ForegroundColor White
Write-Host "- 期望结果: method = 'real_test', latency > 0" -ForegroundColor White
Write-Host ""

# 1. 直接测试VPS API
Write-Host "🔍 步骤1: 直接测试VPS API" -ForegroundColor Green
try {
    $vpsResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/test" -Method POST -Body $testData -ContentType "application/json" -TimeoutSec 30
    Write-Host "✅ VPS API响应成功:" -ForegroundColor Green
    Write-Host "   - 成功: $($vpsResponse.data.success)" -ForegroundColor White
    Write-Host "   - 延迟: $($vpsResponse.data.latency)ms" -ForegroundColor White  
    Write-Host "   - 方法: $($vpsResponse.data.method)" -ForegroundColor White
    
    if ($vpsResponse.data.method -eq "real_test" -and $vpsResponse.data.latency -gt 0) {
        Write-Host "🎉 VPS真实代理测试功能正常!" -ForegroundColor Green
    } else {
        Write-Host "⚠️ VPS测试结果异常" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ VPS API测试失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# 2. 测试通过Cloudflare Workers的API (需要认证)
Write-Host "🔍 步骤2: 测试Cloudflare Workers API" -ForegroundColor Green
Write-Host "⚠️ 需要认证token，请通过前端页面测试" -ForegroundColor Yellow

Write-Host ""

# 3. 前端测试指南
Write-Host "🌐 步骤3: 前端页面测试指南" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Cyan

Write-Host "📱 访问地址: https://yoyo-streaming.5202021.xyz/admin" -ForegroundColor Blue
Write-Host ""
Write-Host "🔧 测试步骤:" -ForegroundColor Yellow
Write-Host "1. 登录管理后台" -ForegroundColor White
Write-Host "2. 进入代理配置页面" -ForegroundColor White  
Write-Host "3. 点击JP代理的'测试'按钮" -ForegroundColor White
Write-Host "4. 观察延迟显示:" -ForegroundColor White
Write-Host "   - 应显示真实延迟(如881ms)" -ForegroundColor Green
Write-Host "   - 不应显示-1或'连接错误'" -ForegroundColor Red
Write-Host "5. 打开浏览器控制台(F12)" -ForegroundColor White
Write-Host "6. 检查日志中是否包含:" -ForegroundColor White
Write-Host "   - 'method: real_test'" -ForegroundColor Green
Write-Host "   - '代理测试成功'" -ForegroundColor Green

Write-Host ""
Write-Host "✅ 成功标志:" -ForegroundColor Green
Write-Host "- 延迟显示为具体数值(如881ms)" -ForegroundColor White
Write-Host "- 控制台显示'method: real_test'" -ForegroundColor White
Write-Host "- 测试按钮状态正常切换" -ForegroundColor White

Write-Host ""
Write-Host "❌ 失败标志:" -ForegroundColor Red  
Write-Host "- 延迟显示为-1" -ForegroundColor White
Write-Host "- 显示连接错误或测试失败" -ForegroundColor White
Write-Host "- 控制台出现错误信息" -ForegroundColor White

Write-Host ""
Write-Host "测试完成后，真实代理延迟测试功能应该完全正常工作!" -ForegroundColor Cyan
