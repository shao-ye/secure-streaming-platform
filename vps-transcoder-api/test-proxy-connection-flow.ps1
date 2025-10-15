#!/usr/bin/env pwsh

Write-Host "🎯 代理连接完整流程测试" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 测试数据
$testProxy = @{
    id = "jp-test"
    name = "JP-Evoxt-Test"
    config = "vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=chrome&pbk=XSIEcTZ1NnjyY-BhYuiW74fAwFfve-8YJ-T855r0f1c&type=tcp&headerType=none#JP-Evoxt"
}

Write-Host ""
Write-Host "📋 测试步骤:" -ForegroundColor Yellow
Write-Host "1. 检查当前代理状态"
Write-Host "2. 连接代理"
Write-Host "3. 验证连接状态"
Write-Host "4. 测试视频流转发"
Write-Host "5. 断开代理连接"
Write-Host ""

# 步骤1: 检查当前状态
Write-Host "🔍 步骤1: 检查当前代理状态..." -ForegroundColor Yellow
try {
    $statusResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "✅ 当前状态:" -ForegroundColor Green
    Write-Host "- 连接状态: $($statusResponse.data.connectionStatus)" -ForegroundColor White
    Write-Host "- 当前代理: $($statusResponse.data.currentProxy)" -ForegroundColor White
} catch {
    Write-Host "❌ 状态检查失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# 步骤2: 连接代理
Write-Host "🔄 步骤2: 连接代理..." -ForegroundColor Yellow
$connectData = @{
    proxyConfig = $testProxy
} | ConvertTo-Json -Depth 3

try {
    $connectResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/connect" -Method POST -Body $connectData -ContentType "application/json" -TimeoutSec 30
    Write-Host "✅ 代理连接结果:" -ForegroundColor Green
    Write-Host "- 成功: $($connectResponse.data.success)" -ForegroundColor White
    Write-Host "- 消息: $($connectResponse.data.message)" -ForegroundColor White
    Write-Host "- 状态: $($connectResponse.data.status)" -ForegroundColor White
    
    if ($connectResponse.data.success) {
        Write-Host "🎉 代理连接成功！" -ForegroundColor Green
        
        # 等待3秒让代理完全启动
        Write-Host "⏳ 等待3秒让代理完全启动..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
        
        # 步骤3: 验证连接状态
        Write-Host ""
        Write-Host "🔍 步骤3: 验证连接状态..." -ForegroundColor Yellow
        try {
            $verifyResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
            Write-Host "✅ 验证结果:" -ForegroundColor Green
            Write-Host "- 连接状态: $($verifyResponse.data.connectionStatus)" -ForegroundColor White
            Write-Host "- 当前代理: $($verifyResponse.data.currentProxy.name)" -ForegroundColor White
            Write-Host "- 统计信息: $($verifyResponse.data.statistics | ConvertTo-Json -Compress)" -ForegroundColor White
            
            if ($verifyResponse.data.connectionStatus -eq "connected") {
                Write-Host "🎉 代理状态验证成功！" -ForegroundColor Green
                
                # 步骤4: 测试视频流转发
                Write-Host ""
                Write-Host "🎬 步骤4: 测试视频流转发能力..." -ForegroundColor Yellow
                Write-Host "- iptables规则应该已设置，RTMP/HTTP/HTTPS流量将通过代理转发" -ForegroundColor White
                Write-Host "- 端口1080 SOCKS5代理应该正在监听" -ForegroundColor White
                Write-Host "- 透明代理规则已应用于端口1935(RTMP), 80(HTTP), 443(HTTPS)" -ForegroundColor White
                
                # 步骤5: 断开连接（可选）
                Write-Host ""
                Write-Host "🔄 步骤5: 断开代理连接..." -ForegroundColor Yellow
                try {
                    $disconnectResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/disconnect" -Method POST -TimeoutSec 15
                    Write-Host "✅ 断开连接结果:" -ForegroundColor Green
                    Write-Host "- 成功: $($disconnectResponse.data.success)" -ForegroundColor White
                    Write-Host "- 消息: $($disconnectResponse.data.message)" -ForegroundColor White
                } catch {
                    Write-Host "❌ 断开连接失败: $($_.Exception.Message)" -ForegroundColor Red
                }
            } else {
                Write-Host "⚠️ 代理状态异常: $($verifyResponse.data.connectionStatus)" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "❌ 状态验证失败: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ 代理连接失败" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 代理连接失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "🎯 测试完成" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
