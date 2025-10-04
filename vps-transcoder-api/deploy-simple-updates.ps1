# 简化的VPS部署脚本 - 仅部署更新的SimpleStreamManager文件

$VpsHost = "142.171.75.220"
$VpsUser = "root"
$VpsAppDir = "/opt/yoyo-transcoder"

Write-Host "🚀 部署SimpleStreamManager更新到VPS" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

# 检查文件是否存在
$files = @(
    "vps-transcoder-api\src\services\SimpleStreamManager.js",
    "vps-transcoder-api\src\routes\simple-stream.js"
)

foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        Write-Host "❌ 文件不存在: $file" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ 本地文件检查通过" -ForegroundColor Green

# 上传文件
Write-Host "📤 上传SimpleStreamManager.js..." -ForegroundColor Yellow
scp "vps-transcoder-api\src\services\SimpleStreamManager.js" "${VpsUser}@${VpsHost}:${VpsAppDir}/src/services/"

Write-Host "📤 上传simple-stream.js..." -ForegroundColor Yellow  
scp "vps-transcoder-api\src\routes\simple-stream.js" "${VpsUser}@${VpsHost}:${VpsAppDir}/src/routes/"

# 重启服务
Write-Host "🔄 重启VPS服务..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsHost}" "cd $VpsAppDir && pm2 restart vps-transcoder-api"

Write-Host "✅ 部署完成！" -ForegroundColor Green

# 健康检查
Write-Host "🔍 健康检查..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsHost}" "curl -s http://localhost:3000/health | head -1"

Write-Host "🎉 SimpleStreamManager更新部署完成！" -ForegroundColor Green
