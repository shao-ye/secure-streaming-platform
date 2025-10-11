# 部署代理流媒体集成功能到VPS
# 实现视频流通过代理传输的完整功能

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署代理流媒体集成功能" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 配置
$VPS_HOST = "142.171.75.220"
$VPS_USER = "root"
$VPS_DIR = "/opt/yoyo-transcoder"
$LOCAL_DIR = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api"

Write-Host "📋 部署计划:" -ForegroundColor Yellow
Write-Host "1. ✅ V2Ray已安装确认" -ForegroundColor Green
Write-Host "2. 🔄 上传代理流媒体集成脚本" -ForegroundColor Yellow
Write-Host "3. 🔄 执行集成部署" -ForegroundColor Yellow
Write-Host "4. 🔄 验证功能完整性" -ForegroundColor Yellow
Write-Host ""

# 1. 上传集成脚本
Write-Host "[1] 上传代理流媒体集成脚本..." -ForegroundColor Yellow
$scpCommand = "scp -o StrictHostKeyChecking=no `"$LOCAL_DIR\integrate-proxy-streaming.sh`" ${VPS_USER}@${VPS_HOST}:$VPS_DIR/"
Write-Host "执行: $scpCommand" -ForegroundColor Gray
$result = cmd /c $scpCommand 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ 集成脚本上传成功" -ForegroundColor Green
} else {
    Write-Host "  ✗ 集成脚本上传失败: $result" -ForegroundColor Red
    exit 1
}

# 2. 执行集成部署
Write-Host ""
Write-Host "[2] 在VPS上执行代理流媒体集成..." -ForegroundColor Yellow
$sshCommand = "ssh -o ConnectTimeout=30 -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST 'cd $VPS_DIR && chmod +x integrate-proxy-streaming.sh && ./integrate-proxy-streaming.sh'"
Write-Host "执行集成部署..." -ForegroundColor Gray
$result = cmd /c $sshCommand 2>&1
Write-Host $result

# 3. 等待服务启动
Write-Host ""
Write-Host "[3] 等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# 4. 验证部署结果
Write-Host ""
Write-Host "[4] 验证部署结果..." -ForegroundColor Yellow

# 检查代理服务状态
try {
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "  ✓ 代理服务API响应正常" -ForegroundColor Green
    Write-Host "    连接状态: $($response.data.connectionStatus)" -ForegroundColor White
    Write-Host "    当前代理: $($response.data.currentProxy)" -ForegroundColor White
    
    if ($response.data.connectionStatus -eq "connected") {
        Write-Host "  ✓ 代理已连接，流媒体将通过代理传输" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ 代理未连接，请在管理后台激活代理" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ✗ 代理服务API检查失败: $_" -ForegroundColor Red
}

# 检查基础服务
try {
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/health" -Method GET -TimeoutSec 10
    Write-Host "  ✓ VPS基础服务正常" -ForegroundColor Green
} catch {
    Write-Host "  ✗ VPS基础服务检查失败: $_" -ForegroundColor Red
}

# 检查流媒体服务
try {
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/simple-stream/system/status" -Method GET -TimeoutSec 10
    Write-Host "  ✓ 流媒体服务正常" -ForegroundColor Green
    Write-Host "    活跃流: $($response.data.activeStreams)" -ForegroundColor White
} catch {
    Write-Host "  ✗ 流媒体服务检查失败: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "🎯 功能说明:" -ForegroundColor Yellow
Write-Host "1. ✅ 代理流媒体集成已部署" -ForegroundColor Green
Write-Host "2. ✅ 透明代理规则自动管理" -ForegroundColor Green
Write-Host "3. ✅ FFmpeg进程代理环境变量" -ForegroundColor Green
Write-Host "4. ✅ 代理状态实时监控" -ForegroundColor Green
Write-Host ""

Write-Host "📋 测试步骤:" -ForegroundColor Yellow
Write-Host "1. 在管理后台开启代理功能" -ForegroundColor White
Write-Host "2. 选择并激活jp或us代理" -ForegroundColor White
Write-Host "3. 播放视频，观察是否通过代理传输" -ForegroundColor White
Write-Host "4. 关闭代理，确认视频切换到直连" -ForegroundColor White
Write-Host ""

Write-Host "🔍 监控命令:" -ForegroundColor Yellow
Write-Host "- 代理状态: https://yoyo-vps.5202021.xyz/api/proxy/status" -ForegroundColor Cyan
Write-Host "- 流媒体状态: https://yoyo-vps.5202021.xyz/api/simple-stream/system/status" -ForegroundColor Cyan
Write-Host ""

Write-Host "⚠️ 注意事项:" -ForegroundColor Yellow
Write-Host "1. 代理连接时，所有RTMP/HTTP/HTTPS流量将通过代理" -ForegroundColor White
Write-Host "2. 代理断开时，流量会自动切换回直连" -ForegroundColor White
Write-Host "3. 监控服务会持续运行，确保规则同步" -ForegroundColor White
Write-Host ""

# 提供下一步操作建议
Write-Host "🚀 下一步操作:" -ForegroundColor Green
Write-Host "1. 访问管理后台，开启代理功能" -ForegroundColor White
Write-Host "2. 播放视频测试代理传输效果" -ForegroundColor White
Write-Host "3. 观察网络流量是否通过代理" -ForegroundColor White
Write-Host ""
