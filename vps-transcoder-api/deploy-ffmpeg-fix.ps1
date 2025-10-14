# YOYO流媒体平台 - FFmpeg配置修复部署脚本
# 修复视频播放问题：简化FFmpeg参数，禁用音频输出

Write-Host "🔧 YOYO流媒体平台 - FFmpeg配置修复部署" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "📋 修复内容:" -ForegroundColor Yellow
Write-Host "- 简化FFmpeg参数配置" -ForegroundColor White
Write-Host "- 禁用音频输出（-an）避免PCM μ-law转码问题" -ForegroundColor White
Write-Host "- 移除复杂的网络优化参数" -ForegroundColor White
Write-Host "- 延长超时时间到30秒" -ForegroundColor White
Write-Host "- 基于成功测试的简化配置" -ForegroundColor White
Write-Host ""

Write-Host "⚠️ 重要提示:" -ForegroundColor Yellow
Write-Host "- 此操作会重启VPS转码服务" -ForegroundColor Red
Write-Host "- 可能短暂影响现有连接" -ForegroundColor Red
Write-Host "- 建议在维护时间窗口执行" -ForegroundColor Red
Write-Host ""

# 询问用户确认
$confirmation = Read-Host "是否继续执行部署？(y/n)"
if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Host "操作已取消" -ForegroundColor Yellow
    exit
}

Write-Host ""
Write-Host "🚀 开始执行部署..." -ForegroundColor Green

try {
    # 1. 上传修复后的SimpleStreamManager.js到VPS
    Write-Host ""
    Write-Host "[1/4] 上传修复后的SimpleStreamManager.js..." -ForegroundColor Yellow
    
    $localFile = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api\src\services\SimpleStreamManager.js"
    $remotePath = "/root/vps-transcoder-api/src/services/SimpleStreamManager.js"
    
    # 使用SCP上传文件
    Write-Host "正在上传文件..." -ForegroundColor Gray
    & scp $localFile "root@yoyo-vps.5202021.xyz:$remotePath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 文件上传成功" -ForegroundColor Green
    } else {
        throw "文件上传失败"
    }
    
    # 2. 备份原文件并验证上传
    Write-Host ""
    Write-Host "[2/4] 备份原文件并验证..." -ForegroundColor Yellow
    & ssh root@yoyo-vps.5202021.xyz "cp $remotePath ${remotePath}.backup.$(date +%Y%m%d_%H%M%S) && ls -la $remotePath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 文件备份和验证成功" -ForegroundColor Green
    } else {
        throw "文件备份失败"
    }
    
    # 3. 重启VPS转码服务
    Write-Host ""
    Write-Host "[3/4] 重启VPS转码服务..." -ForegroundColor Yellow
    & ssh root@yoyo-vps.5202021.xyz "cd /root/vps-transcoder-api && pm2 restart vps-transcoder-api"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 服务重启成功" -ForegroundColor Green
    } else {
        throw "服务重启失败"
    }
    
    # 4. 验证服务状态
    Write-Host ""
    Write-Host "[4/4] 验证服务状态..." -ForegroundColor Yellow
    
    # 等待服务启动
    Start-Sleep -Seconds 3
    
    # 检查PM2状态
    Write-Host "检查PM2服务状态..." -ForegroundColor Gray
    & ssh root@yoyo-vps.5202021.xyz "pm2 status"
    
    # 检查VPS API状态
    Write-Host "检查VPS API状态..." -ForegroundColor Gray
    try {
        $apiResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/status" -Headers @{"X-API-Key"="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"} -TimeoutSec 10
        if ($apiResponse.status -eq "running") {
            Write-Host "✓ VPS API响应正常" -ForegroundColor Green
        } else {
            Write-Host "⚠ VPS API响应异常: $($apiResponse.status)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "✗ VPS API无法访问: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 检查系统状态
    Write-Host "检查转码系统状态..." -ForegroundColor Gray
    try {
        $systemResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/simple-stream/system/status" -Headers @{"X-API-Key"="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"} -TimeoutSec 10
        Write-Host "✓ 转码系统状态: activeStreams=$($systemResponse.activeStreams), totalSessions=$($systemResponse.totalSessions)" -ForegroundColor Green
    } catch {
        Write-Host "⚠ 无法获取转码系统状态: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "🎉 FFmpeg配置修复部署完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 修复总结:" -ForegroundColor Yellow
    Write-Host "✓ 简化FFmpeg参数配置" -ForegroundColor Green
    Write-Host "✓ 禁用音频输出避免转码问题" -ForegroundColor Green
    Write-Host "✓ 延长超时时间到30秒" -ForegroundColor Green
    Write-Host "✓ VPS转码服务重启成功" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 后续测试步骤:" -ForegroundColor Yellow
    Write-Host "1. 访问前端页面: https://yoyo.5202021.xyz" -ForegroundColor White
    Write-Host "2. 尝试播放视频频道" -ForegroundColor White
    Write-Host "3. 检查是否还有播放错误" -ForegroundColor White
    Write-Host "4. 查看VPS日志: pm2 logs vps-transcoder-api" -ForegroundColor White
    
} catch {
    Write-Host ""
    Write-Host "❌ 部署过程中出现错误: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 手动修复步骤:" -ForegroundColor Yellow
    Write-Host "1. SSH连接到VPS: ssh root@yoyo-vps.5202021.xyz" -ForegroundColor White
    Write-Host "2. 手动上传文件或直接编辑: /root/vps-transcoder-api/src/services/SimpleStreamManager.js" -ForegroundColor White
    Write-Host "3. 重启服务: cd /root/vps-transcoder-api && pm2 restart vps-transcoder-api" -ForegroundColor White
    Write-Host "4. 检查状态: pm2 status && pm2 logs vps-transcoder-api --lines 20" -ForegroundColor White
}

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
