# 部署代理修复到VPS
# 解决代理连接错误和视频流代理传输问题

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署代理修复到VPS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 配置
$VPS_HOST = "142.171.75.220"
$VPS_USER = "root"
$VPS_DIR = "/opt/yoyo-transcoder"
$LOCAL_DIR = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api"

# 1. 上传修复脚本
Write-Host "[1] 上传修复脚本到VPS..." -ForegroundColor Yellow
$scpCommand = "scp -o StrictHostKeyChecking=no $LOCAL_DIR\enable-proxy-streaming.sh ${VPS_USER}@${VPS_HOST}:$VPS_DIR/"
Write-Host "执行: $scpCommand" -ForegroundColor Gray
cmd /c $scpCommand 2>&1

# 2. 上传ProxyManager.js
Write-Host ""
Write-Host "[2] 上传ProxyManager.js到VPS..." -ForegroundColor Yellow
$scpCommand = "scp -o StrictHostKeyChecking=no $LOCAL_DIR\src\services\ProxyManager.js ${VPS_USER}@${VPS_HOST}:$VPS_DIR/src/services/"
Write-Host "执行: $scpCommand" -ForegroundColor Gray
cmd /c $scpCommand 2>&1

# 3. 上传proxy.js路由
Write-Host ""
Write-Host "[3] 上传proxy.js路由到VPS..." -ForegroundColor Yellow
$scpCommand = "scp -o StrictHostKeyChecking=no $LOCAL_DIR\src\routes\proxy.js ${VPS_USER}@${VPS_HOST}:$VPS_DIR/src/routes/"
Write-Host "执行: $scpCommand" -ForegroundColor Gray
cmd /c $scpCommand 2>&1

# 4. 执行修复脚本
Write-Host ""
Write-Host "[4] 在VPS上执行修复脚本..." -ForegroundColor Yellow
$sshCommand = "ssh -o ConnectTimeout=30 -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST 'cd $VPS_DIR && chmod +x enable-proxy-streaming.sh && ./enable-proxy-streaming.sh'"
Write-Host "执行修复..." -ForegroundColor Gray
cmd /c $sshCommand 2>&1

# 5. 验证部署结果
Write-Host ""
Write-Host "[5] 验证部署结果..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 检查代理服务状态
try {
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "✓ 代理服务API响应正常" -ForegroundColor Green
    Write-Host "  连接状态: $($response.data.connectionStatus)" -ForegroundColor White
    Write-Host "  当前代理: $($response.data.currentProxy)" -ForegroundColor White
} catch {
    Write-Host "✗ 代理服务API检查失败: $_" -ForegroundColor Red
}

# 检查健康状态
try {
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/health" -Method GET -TimeoutSec 10
    Write-Host "✓ 代理健康检查正常" -ForegroundColor Green
    Write-Host "  状态: $($response.status)" -ForegroundColor White
} catch {
    Write-Host "✗ 健康检查失败: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步操作：" -ForegroundColor Yellow
Write-Host "1. 在管理后台重新激活代理" -ForegroundColor White
Write-Host "2. 测试代理连接功能" -ForegroundColor White
Write-Host "3. 播放视频验证代理传输" -ForegroundColor White
Write-Host ""
Write-Host "如果问题仍然存在，请运行:" -ForegroundColor Yellow
Write-Host "  .\fix-proxy-connection.ps1" -ForegroundColor Cyan
Write-Host "进行详细诊断" -ForegroundColor White
Write-Host ""
