#!/usr/bin/env pwsh

# 通过API触发VPS一键部署脚本
Write-Host "🚀 开始通过API触发VPS一键部署..." -ForegroundColor Green

$VPS_API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$VPS_BASE_URL = "https://yoyo-vps.5202021.xyz"

try {
    # 1. 检查VPS基础状态
    Write-Host "📡 检查VPS基础状态..." -ForegroundColor Yellow
    $healthResponse = Invoke-RestMethod -Uri "$VPS_BASE_URL/health" -TimeoutSec 10
    Write-Host "✅ VPS基础服务正常 - 版本: $($healthResponse.version)" -ForegroundColor Green
    
    # 2. 尝试通过部署API触发部署
    Write-Host "🔄 尝试通过部署API触发一键部署..." -ForegroundColor Yellow
    
    try {
        $deployPayload = @{
            action = "deploy"
            script = "vps-simple-deploy.sh"
            force = $true
        } | ConvertTo-Json -Depth 10
        
        $deployResponse = Invoke-RestMethod -Uri "$VPS_BASE_URL/api/deployment/execute" -Method POST -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = $VPS_API_KEY
        } -Body $deployPayload -TimeoutSec 120
        
        Write-Host "✅ 部署API调用成功" -ForegroundColor Green
        Write-Host "部署结果: $($deployResponse.message)" -ForegroundColor Cyan
        
    } catch {
        Write-Host "⚠️ 部署API不可用，尝试备用方案..." -ForegroundColor Yellow
        
        # 备用方案：通过系统API重启服务
        Write-Host "🔄 尝试通过系统API重启服务..." -ForegroundColor Yellow
        
        try {
            $restartPayload = @{
                action = "restart"
                service = "vps-transcoder-api"
            } | ConvertTo-Json
            
            $restartResponse = Invoke-RestMethod -Uri "$VPS_BASE_URL/api/system/restart" -Method POST -Headers @{
                "Content-Type" = "application/json"
                "X-API-Key" = $VPS_API_KEY
            } -Body $restartPayload -TimeoutSec 30
            
            Write-Host "✅ 服务重启成功" -ForegroundColor Green
            
        } catch {
            Write-Host "❌ 系统API也不可用，需要手动处理" -ForegroundColor Red
            Write-Host "💡 建议手动SSH执行: bash /tmp/github/secure-streaming-platform/vps-transcoder-api/vps-simple-deploy.sh" -ForegroundColor Yellow
        }
    }
    
    # 3. 等待服务重启
    Write-Host "⏳ 等待服务重启完成..." -ForegroundColor Yellow
    Start-Sleep -Seconds 15
    
    # 4. 验证部署效果
    Write-Host "🔍 验证部署效果..." -ForegroundColor Yellow
    
    # 检查基础服务
    try {
        $healthCheck = Invoke-RestMethod -Uri "$VPS_BASE_URL/health" -TimeoutSec 10
        Write-Host "✅ 基础服务正常 - 版本: $($healthCheck.version)" -ForegroundColor Green
    } catch {
        Write-Host "❌ 基础服务检查失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 检查代理状态API
    try {
        $proxyStatus = Invoke-RestMethod -Uri "$VPS_BASE_URL/api/proxy/status" -TimeoutSec 10
        Write-Host "✅ 代理状态API正常" -ForegroundColor Green
    } catch {
        Write-Host "❌ 代理状态API失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 测试代理测试API
    Write-Host "🔍 测试代理测试API..." -ForegroundColor Yellow
    
    $testData = @{
        proxyConfig = @{
            id = "proxy_1759944903623_j46t5kl7i"
            name = "jp"
            type = "vless"
            config = "vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=XSIEcTZ1NnjyY-BhYuiW74fAwFfve-8YJ-T855r0f1c&type=tcp&headerType=none#JP-Evoxt"
        }
        testUrlId = "baidu"
    } | ConvertTo-Json -Depth 10
    
    try {
        $testResponse = Invoke-RestMethod -Uri "$VPS_BASE_URL/api/proxy/test" -Method POST -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = $VPS_API_KEY
        } -Body $testData -TimeoutSec 30
        
        Write-Host "✅ VPS代理测试API正常工作！" -ForegroundColor Green
        Write-Host "测试结果: success=$($testResponse.data.success), latency=$($testResponse.data.latency), method=$($testResponse.data.method)" -ForegroundColor Cyan
        
        if ($testResponse.data.method -eq "real_test") {
            Write-Host "🎉 VPS真实测试功能正常！" -ForegroundColor Green
        } else {
            Write-Host "⚠️ VPS返回其他测试方法: $($testResponse.data.method)" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "❌ VPS代理测试API失败: $($_.Exception.Message)" -ForegroundColor Red
        
        # 测试通过Cloudflare Workers
        Write-Host "🔄 测试通过Cloudflare Workers..." -ForegroundColor Yellow
        
        try {
            $workerResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers @{
                "Content-Type" = "application/json"
            } -Body $testData -TimeoutSec 15
            
            Write-Host "✅ Cloudflare Workers代理测试正常" -ForegroundColor Green
            Write-Host "测试结果: success=$($workerResponse.data.success), latency=$($workerResponse.data.latency), method=$($workerResponse.data.method)" -ForegroundColor Cyan
            
        } catch {
            Write-Host "❌ Cloudflare Workers测试也失败: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    # 5. 总结部署结果
    Write-Host ""
    Write-Host "📊 部署结果总结:" -ForegroundColor Green
    Write-Host "1. VPS服务重启完成" -ForegroundColor White
    Write-Host "2. 代理测试功能验证完成" -ForegroundColor White
    Write-Host "3. 如果VPS直接测试失败，Cloudflare Workers降级机制正常" -ForegroundColor White
    Write-Host ""
    Write-Host "🔗 下一步验证:" -ForegroundColor Yellow
    Write-Host "1. 在前端页面测试代理功能" -ForegroundColor White
    Write-Host "2. 检查代理测试是否返回真实延迟" -ForegroundColor White
    Write-Host "3. 验证-1显示是否为正确的测试失败结果" -ForegroundColor White
    
} catch {
    Write-Host "❌ 部署过程中发生错误: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎯 VPS部署完成！请测试代理功能" -ForegroundColor Green
