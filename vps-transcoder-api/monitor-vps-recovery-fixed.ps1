# VPS服务恢复监控脚本
# 用于监控VPS服务状态，等待代理服务部署完成

Write-Host "🔍 开始监控VPS服务恢复状态..." -ForegroundColor Yellow
Write-Host "目标: https://yoyo-vps.5202021.xyz" -ForegroundColor Cyan
Write-Host "按 Ctrl+C 停止监控" -ForegroundColor Gray
Write-Host ""

$maxAttempts = 20  # 最多尝试20次
$attempt = 0
$interval = 30     # 每30秒检查一次

while ($attempt -lt $maxAttempts) {
    $attempt++
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    
    try {
        Write-Host "[$timestamp] 尝试 $attempt/$maxAttempts - 检查VPS健康状态..." -ForegroundColor White
        
        # 检查基础健康状态
        $health = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/health" -Method GET -TimeoutSec 10
        
        Write-Host "✅ VPS基础服务已恢复!" -ForegroundColor Green
        Write-Host "   消息: $($health.message)" -ForegroundColor Green
        Write-Host "   版本: $($health.version)" -ForegroundColor Green
        
        # 检查代理服务状态
        try {
            Write-Host "🔍 检查代理服务状态..." -ForegroundColor Yellow
            $proxyStatus = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
            
            Write-Host "✅ 代理服务正常!" -ForegroundColor Green
            Write-Host "   连接状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor Green
            Write-Host "   最后更新: $($proxyStatus.data.lastUpdate)" -ForegroundColor Green
            
            # 检查新的连接端点
            Write-Host "🔍 检查代理连接端点..." -ForegroundColor Yellow
            
            $testProxy = @{
                id = "test_proxy_001"
                name = "测试代理"
                type = "vless"
                config = "vless://test@test.com:443"
            }
            $body = @{ proxyConfig = $testProxy } | ConvertTo-Json -Depth 3
            
            try {
                $connectTest = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/connect" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
                
                Write-Host "🎉 代理连接端点正常工作!" -ForegroundColor Green
                Write-Host "   测试结果: $($connectTest.message)" -ForegroundColor Green
                
                # 立即断开测试连接
                try {
                    $disconnectTest = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/disconnect" -Method POST -TimeoutSec 10
                    Write-Host "✅ 代理断开端点也正常工作!" -ForegroundColor Green
                }
                catch {
                    Write-Host "⚠️ 代理断开端点测试失败，但连接端点正常" -ForegroundColor Yellow
                }
                
                break  # 所有测试通过，退出循环
            }
            catch {
                $errorMsg = $_.Exception.Message
                if ($errorMsg -like "*not a valid endpoint*") {
                    Write-Host "❌ 代理连接端点尚未部署" -ForegroundColor Red
                    Write-Host "   错误: $errorMsg" -ForegroundColor Red
                }
                else {
                    Write-Host "⚠️ 代理连接端点测试异常: $errorMsg" -ForegroundColor Yellow
                }
            }
        }
        catch {
            Write-Host "❌ 代理服务检查失败: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    catch {
        $errorMsg = $_.Exception.Message
        Write-Host "❌ VPS服务尚未恢复" -ForegroundColor Red
        Write-Host "   错误: $errorMsg" -ForegroundColor Red
    }
    
    if ($attempt -lt $maxAttempts) {
        Write-Host "⏳ 等待 $interval 秒后重试..." -ForegroundColor Gray
        Write-Host ""
        Start-Sleep -Seconds $interval
    }
}

if ($attempt -ge $maxAttempts) {
    Write-Host "❌ 监控超时，VPS服务可能需要手动干预" -ForegroundColor Red
    Write-Host "建议检查:" -ForegroundColor Yellow
    Write-Host "1. VPS服务器是否正常运行" -ForegroundColor Yellow
    Write-Host "2. PM2进程是否正常启动" -ForegroundColor Yellow
    Write-Host "3. 部署脚本是否执行成功" -ForegroundColor Yellow
}
else {
    Write-Host ""
    Write-Host "🎉 VPS服务完全恢复，代理流媒体转发功能已就绪!" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步操作:" -ForegroundColor Cyan
    Write-Host "1. 部署Cloudflare Workers更新" -ForegroundColor White
    Write-Host "2. 测试前端代理连接功能" -ForegroundColor White
    Write-Host "3. 验证流媒体转发效果" -ForegroundColor White
}

Write-Host ""
Write-Host "监控完成。" -ForegroundColor Gray
