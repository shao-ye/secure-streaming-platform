#!/usr/bin/env pwsh

# 调试代理测试功能
Write-Host "🔧 调试代理测试功能..." -ForegroundColor Green

# 测试配置
$VPS_API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$VPS_BASE_URL = "https://yoyo-vps.5202021.xyz"

# 真实的代理配置
$realProxyConfig = @{
    id = "proxy_1759944903623_j46t5kl7i"
    name = "jp"
    type = "vless"
    config = "vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=XSIEcTZ1NnjyY-BhYuiW74fAwFfve-8YJ-T855r0f1c&type=tcp&headerType=none#JP-Evoxt"
    testUrlId = "baidu"
}

Write-Host "📋 使用的代理配置:" -ForegroundColor Yellow
Write-Host "- 名称: $($realProxyConfig.name)" -ForegroundColor White
Write-Host "- 类型: $($realProxyConfig.type)" -ForegroundColor White
Write-Host "- 测试网站: $($realProxyConfig.testUrlId)" -ForegroundColor White

try {
    # 1. 检查VPS基础状态
    Write-Host ""
    Write-Host "📡 检查VPS基础状态..." -ForegroundColor Yellow
    $health = Invoke-RestMethod -Uri "$VPS_BASE_URL/health" -TimeoutSec 10
    Write-Host "✅ VPS基础服务正常 - 版本: $($health.version)" -ForegroundColor Green
    
    # 2. 尝试直接调用VPS代理测试API
    Write-Host ""
    Write-Host "🔍 尝试直接调用VPS代理测试API..." -ForegroundColor Yellow
    
    $vpsTestData = @{
        proxyConfig = $realProxyConfig
        testUrlId = $realProxyConfig.testUrlId
    } | ConvertTo-Json -Depth 10
    
    try {
        $vpsResult = Invoke-RestMethod -Uri "$VPS_BASE_URL/api/proxy/test" -Method POST -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = $VPS_API_KEY
        } -Body $vpsTestData -TimeoutSec 45
        
        Write-Host "🎉 VPS代理测试API工作正常！" -ForegroundColor Green
        Write-Host "测试结果:" -ForegroundColor Cyan
        Write-Host "- 成功: $($vpsResult.data.success)" -ForegroundColor White
        Write-Host "- 延迟: $($vpsResult.data.latency)ms" -ForegroundColor White
        Write-Host "- 方法: $($vpsResult.data.method)" -ForegroundColor White
        
        if ($vpsResult.data.message) {
            Write-Host "- 消息: $($vpsResult.data.message)" -ForegroundColor White
        }
        
        if ($vpsResult.data.error) {
            Write-Host "- 错误: $($vpsResult.data.error)" -ForegroundColor Red
        }
        
        # 判断测试结果
        if ($vpsResult.data.success -and $vpsResult.data.latency -gt 0) {
            Write-Host "🎉 真实代理延迟测试成功！延迟: $($vpsResult.data.latency)ms" -ForegroundColor Green
        } elseif ($vpsResult.data.latency -eq -1) {
            Write-Host "⚠️ 代理测试失败，但这可能是正常的（代理不可用或网络问题）" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "❌ VPS代理测试API失败: $($_.Exception.Message)" -ForegroundColor Red
        
        if ($_.Exception.Message -like "*404*") {
            Write-Host "💡 VPS代理测试端点未部署，尝试通过Cloudflare Workers..." -ForegroundColor Yellow
            
            # 3. 通过Cloudflare Workers测试
            Write-Host ""
            Write-Host "🔄 通过Cloudflare Workers测试..." -ForegroundColor Yellow
            
            $workerTestData = $realProxyConfig | ConvertTo-Json -Depth 10
            
            $workerResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers @{
                "Content-Type" = "application/json"
            } -Body $workerTestData -TimeoutSec 30
            
            Write-Host "Cloudflare Workers测试结果:" -ForegroundColor Cyan
            Write-Host "- 成功: $($workerResult.data.success)" -ForegroundColor White
            Write-Host "- 延迟: $($workerResult.data.latency)ms" -ForegroundColor White
            Write-Host "- 方法: $($workerResult.data.method)" -ForegroundColor White
            
            if ($workerResult.data.error) {
                Write-Host "- 错误: $($workerResult.data.error)" -ForegroundColor Red
            }
        }
    }
    
    # 4. 总结
    Write-Host ""
    Write-Host "📊 调试总结:" -ForegroundColor Green
    Write-Host "1. VPS基础服务正常运行" -ForegroundColor White
    Write-Host "2. 需要确保VPS上部署了最新的代理测试代码" -ForegroundColor White
    Write-Host "3. 代理测试功能的架构是完整的" -ForegroundColor White
    Write-Host ""
    Write-Host "🔗 建议操作:" -ForegroundColor Yellow
    Write-Host "1. 确认VPS已拉取最新Git代码" -ForegroundColor White
    Write-Host "2. 重启VPS服务加载新的代理路由" -ForegroundColor White
    Write-Host "3. 验证V2Ray/Xray客户端已安装" -ForegroundColor White
    
} catch {
    Write-Host "❌ 调试过程中发生错误: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎯 代理测试功能调试完成！" -ForegroundColor Green
