# 简化的VPS部署脚本
$VpsHost = "142.171.75.220"
$VpsUser = "root"
$VpsAppDir = "/opt/yoyo-transcoder"

Write-Host "🚀 部署SimpleStreamManager更新到VPS" -ForegroundColor Green

# 上传文件
Write-Host "📤 上传SimpleStreamManager.js..." -ForegroundColor Yellow
scp "vps-transcoder-api\src\services\SimpleStreamManager.js" "${VpsUser}@${VpsHost}:${VpsAppDir}/src/services/"

Write-Host "📤 上传simple-stream.js..." -ForegroundColor Yellow  
scp "vps-transcoder-api\src\routes\simple-stream.js" "${VpsUser}@${VpsHost}:${VpsAppDir}/src/routes/"

# 重启服务
Write-Host "🔄 重启VPS服务..." -ForegroundColor Yellow
ssh "${VpsUser}@${VpsHost}" "cd $VpsAppDir && pm2 restart vps-transcoder-api"

Write-Host "✅ 部署完成！" -ForegroundColor Green
