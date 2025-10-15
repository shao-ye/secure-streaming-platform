# VPS代理连接调试脚本
Write-Host "🔍 VPS代理连接调试开始" -ForegroundColor Cyan

# 1. 检查初始状态
Write-Host "`n1️⃣ 检查初始代理状态..." -ForegroundColor Yellow
try {
    $initialStatus = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "初始状态: $($initialStatus | ConvertTo-Json -Depth 3)" -ForegroundColor Green
} catch {
    Write-Host "❌ 获取初始状态失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 2. 断开现有连接（如果有）
Write-Host "`n2️⃣ 断开现有连接..." -ForegroundColor Yellow
try {
    $disconnectResult = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/disconnect" -Method POST -ContentType "application/json" -TimeoutSec 10
    Write-Host "断开结果: $($disconnectResult.message)" -ForegroundColor Green
} catch {
    Write-Host "⚠️ 断开操作: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 3. 测试代理连接
Write-Host "`n3️⃣ 测试代理连接..." -ForegroundColor Yellow
$testProxyConfig = @{
    proxyConfig = @{
        id = "debug_test_proxy"
        name = "调试测试代理"
        type = "vless"
        config = "vless://d727ce27-4996-4bcc-a599-3123824f0d20@104.224.158.96:443?encryption=none`&security=tls`&type=xhttp`&host=x.262777.xyz`&path=%2Fd727ce27`&mode=auto#RN-xhttp-cdn"
    }
} | ConvertTo-Json -Depth 3

try {
    Write-Host "发送连接请求..." -ForegroundColor Cyan
    $connectResult = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/connect" -Method POST -Body $testProxyConfig -ContentType "application/json" -TimeoutSec 30
    Write-Host "✅ 连接结果: $($connectResult | ConvertTo-Json -Depth 3)" -ForegroundColor Green
} catch {
    Write-Host "❌ 连接失败: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        Write-Host "错误详情: $errorBody" -ForegroundColor Red
    }
    exit 1
}

# 4. 等待并检查连接后状态
Write-Host "`n4️⃣ 检查连接后状态..." -ForegroundColor Yellow
for ($i = 1; $i -le 5; $i++) {
    Write-Host "第 $i 次状态检查..." -ForegroundColor Cyan
    Start-Sleep -Seconds 2
    
    try {
        $postStatus = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
        Write-Host "状态检查 $i : $($postStatus | ConvertTo-Json -Depth 4)" -ForegroundColor Green
        
        if ($postStatus.data.connectionStatus -eq "connected") {
            Write-Host "✅ 代理连接状态确认!" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "❌ 状态检查失败: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 5. 测试代理功能
Write-Host "`n5️⃣ 测试代理功能..." -ForegroundColor Yellow
try {
    $healthCheck = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/health" -Method GET -TimeoutSec 10
    Write-Host "VPS健康状态: 版本 $($healthCheck.version), 运行时间 $([math]::Round($healthCheck.uptime/60, 1))分钟" -ForegroundColor Green
} catch {
    Write-Host "❌ VPS健康检查失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎯 调试完成!" -ForegroundColor Cyan
