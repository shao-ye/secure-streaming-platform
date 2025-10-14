# YOYO流媒体平台 - 视频播放iptables修复脚本
# 解决因代理规则导致的视频播放问题

Write-Host "🔧 YOYO流媒体平台 - 视频播放iptables修复" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "📋 问题描述:" -ForegroundColor Yellow
Write-Host "- 视频无法播放，显示连接失败" -ForegroundColor White
Write-Host "- 可能原因：iptables代理规则重定向了端口流量" -ForegroundColor White
Write-Host "- 当代理服务未运行时，流量被重定向到无效端口" -ForegroundColor White
Write-Host ""

Write-Host "🔍 将要执行的操作:" -ForegroundColor Yellow
Write-Host "1. 检查VPS上的iptables规则" -ForegroundColor White
Write-Host "2. 检查代理服务状态" -ForegroundColor White
Write-Host "3. 清理无效的代理规则（如果需要）" -ForegroundColor White
Write-Host "4. 重启相关服务" -ForegroundColor White
Write-Host "5. 验证修复结果" -ForegroundColor White
Write-Host ""

Write-Host "⚠️ 重要提示:" -ForegroundColor Yellow
Write-Host "- 此操作会修改VPS的iptables规则" -ForegroundColor Red
Write-Host "- 会重启Nginx和PM2服务" -ForegroundColor Red
Write-Host "- 建议在维护时间窗口执行" -ForegroundColor Red
Write-Host ""

# 询问用户确认
$confirmation = Read-Host "是否继续执行修复？(y/n)"
if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Host "操作已取消" -ForegroundColor Yellow
    exit
}

Write-Host ""
Write-Host "🚀 开始执行修复..." -ForegroundColor Green

try {
    # 1. 上传修复脚本到VPS
    Write-Host ""
    Write-Host "[1/4] 上传修复脚本到VPS..." -ForegroundColor Yellow
    
    $scriptPath = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\fix-iptables-rules.sh"
    $remotePath = "/root/fix-iptables-rules.sh"
    
    # 使用SCP上传脚本
    Write-Host "正在上传脚本..." -ForegroundColor Gray
    & scp $scriptPath "root@yoyo-vps.5202021.xyz:$remotePath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 脚本上传成功" -ForegroundColor Green
    } else {
        throw "脚本上传失败"
    }
    
    # 2. 设置脚本执行权限
    Write-Host ""
    Write-Host "[2/4] 设置脚本执行权限..." -ForegroundColor Yellow
    & ssh root@yoyo-vps.5202021.xyz "chmod +x $remotePath"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 权限设置成功" -ForegroundColor Green
    } else {
        throw "权限设置失败"
    }
    
    # 3. 执行修复脚本
    Write-Host ""
    Write-Host "[3/4] 执行iptables诊断和修复..." -ForegroundColor Yellow
    Write-Host "注意：脚本可能会询问是否自动修复，请根据提示操作" -ForegroundColor Cyan
    Write-Host ""
    
    # 交互式执行修复脚本
    & ssh -t root@yoyo-vps.5202021.xyz $remotePath
    
    # 4. 验证修复结果
    Write-Host ""
    Write-Host "[4/4] 验证修复结果..." -ForegroundColor Yellow
    
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
    
    # 检查Workers代理状态
    Write-Host "检查代理配置状态..." -ForegroundColor Gray
    try {
        $proxyResponse = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/status" -Headers @{"Authorization"="Bearer 0daf4e23-221f-4b07-8dd6-03fec8679800"} -TimeoutSec 10
        $connectionStatus = $proxyResponse.data.connectionStatus
        Write-Host "✓ 代理状态: $connectionStatus" -ForegroundColor $(if ($connectionStatus -eq "connected") { "Green" } else { "Yellow" })
    } catch {
        Write-Host "⚠ 无法获取代理状态: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "🎉 修复流程完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 后续测试步骤:" -ForegroundColor Yellow
    Write-Host "1. 访问前端页面: https://yoyo.5202021.xyz" -ForegroundColor White
    Write-Host "2. 尝试播放视频频道" -ForegroundColor White
    Write-Host "3. 检查是否还有播放错误" -ForegroundColor White
    Write-Host ""
    Write-Host "💡 如果问题仍然存在:" -ForegroundColor Yellow
    Write-Host "- 检查RTMP推流源是否正常" -ForegroundColor White
    Write-Host "- 查看VPS日志: pm2 logs vps-transcoder-api" -ForegroundColor White
    Write-Host "- 检查FFmpeg进程: ps aux | grep ffmpeg" -ForegroundColor White
    
} catch {
    Write-Host ""
    Write-Host "❌ 修复过程中出现错误: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 手动修复步骤:" -ForegroundColor Yellow
    Write-Host "1. SSH连接到VPS: ssh root@yoyo-vps.5202021.xyz" -ForegroundColor White
    Write-Host "2. 检查iptables规则: iptables -t nat -L OUTPUT -n" -ForegroundColor White
    Write-Host "3. 清理代理规则: iptables -t nat -D OUTPUT -p tcp --dport 80 -j REDIRECT --to-port 1080" -ForegroundColor White
    Write-Host "4. 重启服务: systemctl restart nginx && pm2 restart vps-transcoder-api" -ForegroundColor White
}

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
