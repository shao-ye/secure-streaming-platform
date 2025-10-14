#!/usr/bin/env pwsh

# 通过HTTP API修复VPS代理路由问题
Write-Host "🔧 开始通过HTTP API修复VPS代理路由问题..." -ForegroundColor Green

$VPS_API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$VPS_BASE_URL = "https://yoyo-vps.5202021.xyz"

try {
    # 1. 检查VPS基础状态
    Write-Host "📡 检查VPS基础状态..." -ForegroundColor Yellow
    $healthResponse = Invoke-RestMethod -Uri "$VPS_BASE_URL/health" -TimeoutSec 10
    Write-Host "✅ VPS基础服务正常 - 版本: $($healthResponse.version)" -ForegroundColor Green
    
    # 2. 尝试通过部署API重新部署
    Write-Host "🚀 尝试通过部署API重新部署..." -ForegroundColor Yellow
    
    try {
        $deploymentPayload = @{
            action = "redeploy_routes"
            components = @("proxy", "simple-stream")
            restart_pm2 = $true
        } | ConvertTo-Json -Depth 10
        
        $deployResponse = Invoke-RestMethod -Uri "$VPS_BASE_URL/api/deployment/redeploy" -Method POST -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = $VPS_API_KEY
        } -Body $deploymentPayload -TimeoutSec 60
        
        Write-Host "✅ 部署API调用成功: $($deployResponse.message)" -ForegroundColor Green
        
    } catch {
        Write-Host "⚠️ 部署API不可用，使用备用方案..." -ForegroundColor Yellow
        
        # 备用方案：直接重启PM2服务
        Write-Host "🔄 尝试通过系统API重启服务..." -ForegroundColor Yellow
        
        try {
            $restartPayload = @{
                action = "restart_pm2"
                service = "vps-transcoder-api"
            } | ConvertTo-Json
            
            $restartResponse = Invoke-RestMethod -Uri "$VPS_BASE_URL/api/system/restart" -Method POST -Headers @{
                "Content-Type" = "application/json"
                "X-API-Key" = $VPS_API_KEY
            } -Body $restartPayload -TimeoutSec 30
            
            Write-Host "✅ 服务重启成功" -ForegroundColor Green
            
        } catch {
            Write-Host "❌ 系统API也不可用，需要手动处理" -ForegroundColor Red
        }
    }
    
    # 3. 等待服务重启
    Write-Host "⏳ 等待服务重启完成..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    # 4. 验证修复效果
    Write-Host "🔍 验证修复效果..." -ForegroundColor Yellow
    
    $testEndpoints = @(
        "/api/proxy/status",
        "/api/proxy/config",
        "/api/simple-stream/status"
    )
    
    $successCount = 0
    foreach ($endpoint in $testEndpoints) {
        try {
            if ($endpoint -eq "/api/proxy/config") {
                # POST请求需要特殊处理
                $testPayload = @{
                    action = "get"
                } | ConvertTo-Json
                
                $response = Invoke-RestMethod -Uri "$VPS_BASE_URL$endpoint" -Method POST -Headers @{
                    "Content-Type" = "application/json"
                    "X-API-Key" = $VPS_API_KEY
                } -Body $testPayload -TimeoutSec 10
            } else {
                $response = Invoke-RestMethod -Uri "$VPS_BASE_URL$endpoint" -TimeoutSec 10
            }
            
            Write-Host "✅ $endpoint - 修复成功" -ForegroundColor Green
            $successCount++
            
        } catch {
            Write-Host "❌ $endpoint - 仍然失败: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    # 5. 测试代理连接功能
    if ($successCount -gt 0) {
        Write-Host "🔍 测试代理连接功能..." -ForegroundColor Yellow
        
        try {
            # 测试前端代理连接API
            $proxyTestResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/control" -Method POST -Headers @{
                "Content-Type" = "application/json"
                "Authorization" = "Bearer test-token"
            } -Body '{"action":"enable","proxyId":"proxy_1759980375462_osc1sj25g"}' -TimeoutSec 15
            
            Write-Host "✅ 前端代理连接API正常工作" -ForegroundColor Green
            Write-Host "响应: $($proxyTestResponse.message)" -ForegroundColor Cyan
            
        } catch {
            Write-Host "⚠️ 前端代理连接API测试失败: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    
    # 6. 总结修复结果
    Write-Host ""
    Write-Host "📊 修复结果总结:" -ForegroundColor Green
    Write-Host "- 成功修复的端点: $successCount / $($testEndpoints.Count)" -ForegroundColor White
    
    if ($successCount -eq $testEndpoints.Count) {
        Write-Host "🎉 所有代理路由已成功修复！" -ForegroundColor Green
        Write-Host "✅ 现在可以正常使用代理连接功能" -ForegroundColor Green
    } elseif ($successCount -gt 0) {
        Write-Host "⚠️ 部分路由已修复，但仍有问题需要进一步处理" -ForegroundColor Yellow
    } else {
        Write-Host "❌ 路由修复失败，需要手动处理" -ForegroundColor Red
        Write-Host ""
        Write-Host "💡 建议手动操作:" -ForegroundColor Yellow
        Write-Host "1. 再次运行vps-simple-deploy.sh脚本" -ForegroundColor White
        Write-Host "2. 检查VPS上的代码同步状态" -ForegroundColor White
        Write-Host "3. 验证ProxyManager.js和proxy.js文件" -ForegroundColor White
    }
    
} catch {
    Write-Host "❌ 修复过程中发生错误: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎯 修复完成！请测试代理连接功能" -ForegroundColor Green
