# 部署完整按需转码系统到VPS
# 包含完整的观看者管理和自动清理功能

Write-Host "开始部署完整按需转码系统..." -ForegroundColor Green

# VPS连接信息
$VPS_HOST = "142.171.75.220"
$VPS_PORT = "22"
$VPS_USER = "root"
$REMOTE_PATH = "/opt/yoyo-transcoder"

# 要上传的关键文件
$FILES_TO_UPLOAD = @(
    "vps-transcoder-api\src\routes\api.js",
    "vps-transcoder-api\src\routes\ondemand-complete.js"
)

Write-Host "上传更新的文件到VPS..." -ForegroundColor Yellow

foreach ($file in $FILES_TO_UPLOAD) {
    $localFile = Join-Path $PSScriptRoot "..\$file"
    $remoteFile = "$VPS_USER@${VPS_HOST}:$REMOTE_PATH/src/routes/$(Split-Path $file -Leaf)"
    
    Write-Host "上传 $file..." -ForegroundColor Cyan
    scp -P $VPS_PORT $localFile $remoteFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ $file 上传成功" -ForegroundColor Green
    } else {
        Write-Host "❌ $file 上传失败" -ForegroundColor Red
        exit 1
    }
}

Write-Host "重启VPS转码服务..." -ForegroundColor Yellow

# 重启PM2服务
$restartCommand = @"
cd $REMOTE_PATH && pm2 restart vps-transcoder-api && pm2 status
"@

ssh -p $VPS_PORT $VPS_USER@$VPS_HOST $restartCommand

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ VPS服务重启成功" -ForegroundColor Green
} else {
    Write-Host "❌ VPS服务重启失败" -ForegroundColor Red
    exit 1
}

Write-Host "验证按需转码API端点..." -ForegroundColor Yellow

# 测试API端点
$testCommands = @(
    "curl -X GET 'http://localhost:3000/api/ondemand/channels' -H 'x-api-key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938'",
    "curl -X GET 'http://localhost:3000/api/ondemand/system/status' -H 'x-api-key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938'"
)

foreach ($cmd in $testCommands) {
    Write-Host "执行: $cmd" -ForegroundColor Cyan
    ssh -p $VPS_PORT $VPS_USER@$VPS_HOST $cmd
    Write-Host ""
}

Write-Host "✅ 完整按需转码系统部署完成！" -ForegroundColor Green
Write-Host "系统现在支持以下功能：" -ForegroundColor Yellow
Write-Host "- 频道配置管理" -ForegroundColor White
Write-Host "- 观看者会话管理" -ForegroundColor White
Write-Host "- 按需启动转码进程" -ForegroundColor White
Write-Host "- 自动停止无观看者的转码" -ForegroundColor White
Write-Host "- 心跳保持机制" -ForegroundColor White
Write-Host "- 系统状态监控" -ForegroundColor White
