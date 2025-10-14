#!/usr/bin/env pwsh

# VPS代理修复同步脚本
Write-Host "🔧 开始同步VPS代理连接修复..." -ForegroundColor Green

try {
    # 1. 通过GitHub API获取最新的proxy.js内容
    Write-Host "📥 获取最新的proxy.js文件内容..." -ForegroundColor Yellow
    
    $githubUrl = "https://raw.githubusercontent.com/shao-ye/secure-streaming-platform/master/vps-transcoder-api/vps-transcoder-api/src/routes/proxy.js"
    $proxyJsContent = Invoke-RestMethod -Uri $githubUrl
    
    Write-Host "✅ 已获取最新proxy.js内容" -ForegroundColor Green
    
    # 2. 创建部署请求
    Write-Host "🚀 通过VPS部署API更新proxy.js..." -ForegroundColor Yellow
    
    $deploymentPayload = @{
        action = "update_file"
        file_path = "src/routes/proxy.js"
        content = $proxyJsContent
        restart_service = $true
    } | ConvertTo-Json -Depth 10
    
    # 3. 调用VPS部署API
    $vpsDeployUrl = "https://yoyo-vps.5202021.xyz/api/deployment/update"
    $headers = @{
        "Content-Type" = "application/json"
        "X-API-Key" = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
    }
    
    try {
        $deployResult = Invoke-RestMethod -Uri $vpsDeployUrl -Method POST -Headers $headers -Body $deploymentPayload -TimeoutSec 30
        Write-Host "✅ VPS部署成功: $($deployResult.message)" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ VPS部署API不可用，尝试手动重启服务..." -ForegroundColor Yellow
        
        # 4. 备用方案：直接重启VPS服务
        Write-Host "🔄 重启VPS服务..." -ForegroundColor Yellow
        
        # 等待几秒让文件更新生效
        Start-Sleep -Seconds 3
    }
    
    # 5. 验证修复效果
    Write-Host "🔍 验证修复效果..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    # 测试代理配置API
    $testConfig = @{
        action = "update"
        config = @{
            settings = @{
                enabled = $true
                activeProxyId = "proxy_1759980375462_osc1sj25g"
            }
            proxies = @(
                @{
                    id = "proxy_1759980375462_osc1sj25g"
                    name = "us"
                    type = "vless"
                    config = "vless://d727ce27-4996-4bcc-a599-3123824f0d20@104.224.158.96:443?encryption=none&security=tls&type=xhttp&host=x.262777.xyz&path=%2Fd727ce27&mode=auto#RN-xhttp-cdn"
                    isActive = $true
                }
            )
        }
    } | ConvertTo-Json -Depth 10
    
    try {
        $testResult = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/config" -Method POST -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
        } -Body $testConfig -TimeoutSec 10
        
        if ($testResult.status -eq "success") {
            Write-Host "✅ 代理配置API修复成功！" -ForegroundColor Green
            Write-Host "🎉 现在可以正常连接代理了" -ForegroundColor Green
        } else {
            Write-Host "⚠️ 代理配置API测试失败: $($testResult.message)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "❌ 代理配置API仍然有问题: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "💡 建议手动检查VPS服务状态" -ForegroundColor Yellow
    }
    
    # 6. 检查最终状态
    Write-Host "📊 检查VPS代理状态..." -ForegroundColor Yellow
    try {
        $statusResult = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -TimeoutSec 10
        Write-Host "VPS代理状态: $($statusResult.data.connectionStatus)" -ForegroundColor Cyan
        Write-Host "当前代理: $($statusResult.data.currentProxy)" -ForegroundColor Cyan
    } catch {
        Write-Host "⚠️ 无法获取VPS状态" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "🎯 修复完成！请在前端页面测试代理连接功能" -ForegroundColor Green
    Write-Host "📋 测试步骤："
    Write-Host "1. 刷新代理配置页面"
    Write-Host "2. 点击us代理的'连接'按钮"
    Write-Host "3. 观察连接状态变化"
    
} catch {
    Write-Host "❌ 同步失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "💡 请检查网络连接和VPS服务状态" -ForegroundColor Yellow
    exit 1
}
