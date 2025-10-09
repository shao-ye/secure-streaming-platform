# VPS代码同步脚本
# 将最新的代码同步到VPS服务器

Write-Host "开始同步代码到VPS..." -ForegroundColor Green

# 检查Git状态
Write-Host "1. 检查Git状态..."
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "发现未提交的更改，先提交代码..." -ForegroundColor Yellow
    git add .
    git commit -m "VPS部署前代码同步 - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

# 推送到远程仓库
Write-Host "2. 推送到远程仓库..."
git push origin master

Write-Host "3. 代码已推送到GitHub，VPS需要手动拉取最新代码" -ForegroundColor Yellow
Write-Host "VPS服务器需要执行以下命令:" -ForegroundColor Cyan
Write-Host "cd /path/to/vps-transcoder-api" -ForegroundColor White
Write-Host "git pull origin master" -ForegroundColor White
Write-Host "npm install" -ForegroundColor White
Write-Host "pm2 restart vps-transcoder-api" -ForegroundColor White

Write-Host "代码同步准备完成！" -ForegroundColor Green
