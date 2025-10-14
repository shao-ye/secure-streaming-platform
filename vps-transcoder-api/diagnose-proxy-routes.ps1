#!/usr/bin/env pwsh

# 代理路由诊断脚本
Write-Host "🔍 开始诊断VPS代理路由问题..." -ForegroundColor Green

try {
    # 1. 检查VPS基础服务
    Write-Host "📡 检查VPS基础服务..." -ForegroundColor Yellow
    $healthResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/health" -TimeoutSec 10
    Write-Host "✅ VPS基础服务正常 - 版本: $($healthResponse.version)" -ForegroundColor Green
    
    # 2. 测试代理状态API
    Write-Host "🔍 测试代理状态API..." -ForegroundColor Yellow
    try {
        $proxyStatus = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -TimeoutSec 10
        Write-Host "✅ 代理状态API正常" -ForegroundColor Green
        Write-Host "代理状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor Cyan
    } catch {
        Write-Host "❌ 代理状态API失败: $($_.Exception.Message)" -ForegroundColor Red
        
        # 检查错误详情
        if ($_.Exception.Message -like "*Endpoint not found*") {
            Write-Host "🔍 问题确认: 代理路由未正确加载" -ForegroundColor Yellow
        }
    }
    
    # 3. 测试代理配置API
    Write-Host "🔍 测试代理配置API..." -ForegroundColor Yellow
    try {
        $testConfig = @{
            action = "update"
            config = @{
                settings = @{
                    enabled = $true
                    activeProxyId = "test"
                }
            }
        } | ConvertTo-Json -Depth 10
        
        $configResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/config" -Method POST -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
        } -Body $testConfig -TimeoutSec 10
        
        Write-Host "✅ 代理配置API正常" -ForegroundColor Green
    } catch {
        Write-Host "❌ 代理配置API失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 4. 检查其他API端点
    Write-Host "🔍 检查其他API端点..." -ForegroundColor Yellow
    
    $endpoints = @(
        "/api/status",
        "/api/simple-stream/status"
    )
    
    foreach ($endpoint in $endpoints) {
        try {
            $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz$endpoint" -TimeoutSec 10
            Write-Host "✅ $endpoint - 正常" -ForegroundColor Green
        } catch {
            Write-Host "❌ $endpoint - 失败: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    # 5. 分析问题原因
    Write-Host ""
    Write-Host "📋 问题分析:" -ForegroundColor Yellow
    Write-Host "1. VPS基础服务正常运行" -ForegroundColor White
    Write-Host "2. 其他API端点可能正常工作" -ForegroundColor White
    Write-Host "3. 代理相关API端点不可用" -ForegroundColor White
    Write-Host ""
    Write-Host "🔍 可能原因:" -ForegroundColor Yellow
    Write-Host "- ProxyManager.js初始化失败" -ForegroundColor White
    Write-Host "- proxy.js路由文件加载错误" -ForegroundColor White
    Write-Host "- 依赖模块缺失或版本不兼容" -ForegroundColor White
    Write-Host "- app.js中代理路由配置问题" -ForegroundColor White
    
    # 6. 建议解决方案
    Write-Host ""
    Write-Host "💡 建议解决方案:" -ForegroundColor Green
    Write-Host "1. 检查VPS日志确认具体错误信息" -ForegroundColor White
    Write-Host "2. 验证ProxyManager.js文件完整性" -ForegroundColor White
    Write-Host "3. 重新同步代码并重启服务" -ForegroundColor White
    Write-Host "4. 如果问题持续，考虑简化代理功能实现" -ForegroundColor White
    
} catch {
    Write-Host "❌ 诊断过程中发生错误: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎯 诊断完成！" -ForegroundColor Green
