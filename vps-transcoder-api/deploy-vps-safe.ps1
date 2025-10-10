# VPS安全部署脚本 - 避免SSH会话卡死
# 使用短连接和明确的超时设置

Write-Host "开始VPS代理服务部署..." -ForegroundColor Green

# 1. 检查VPS连接
Write-Host "1. 检查VPS连接状态..." -ForegroundColor Yellow
try {
    $result = ssh -o ConnectTimeout=10 -o ServerAliveInterval=5 root@142.171.75.220 "echo 'VPS连接正常'"
    Write-Host "VPS连接成功: $result" -ForegroundColor Green
} catch {
    Write-Host "VPS连接失败" -ForegroundColor Red
    exit 1
}

# 2. 检查项目目录
Write-Host "2. 检查项目目录..." -ForegroundColor Yellow
$dirCheck = ssh -o ConnectTimeout=10 root@142.171.75.220 "test -d /opt/yoyo-transcoder && echo 'EXISTS' || echo 'NOT_EXISTS'"
if ($dirCheck -eq "EXISTS") {
    Write-Host "项目目录存在" -ForegroundColor Green
} else {
    Write-Host "项目目录不存在" -ForegroundColor Red
    exit 1
}

# 3. 拉取最新代码
Write-Host "3. 拉取最新代码..." -ForegroundColor Yellow
$gitPull = ssh -o ConnectTimeout=30 root@142.171.75.220 "cd /opt/yoyo-transcoder; git pull origin master"
Write-Host "Git拉取结果: $gitPull" -ForegroundColor Cyan

# 4. 检查关键文件是否更新
Write-Host "4. 验证文件更新..." -ForegroundColor Yellow
$fileCheck = ssh -o ConnectTimeout=10 root@142.171.75.220 "ls -la /opt/yoyo-transcoder/src/services/ProxyManager.js"
Write-Host "ProxyManager.js文件信息: $fileCheck" -ForegroundColor Cyan

# 5. 重启服务（使用reload而不是restart避免长时间等待）
Write-Host "5. 重启VPS服务..." -ForegroundColor Yellow
$restart = ssh -o ConnectTimeout=20 root@142.171.75.220 "pm2 reload vps-transcoder-api"
Write-Host "服务重启结果: $restart" -ForegroundColor Cyan

# 6. 验证服务状态
Write-Host "6. 验证服务状态..." -ForegroundColor Yellow
$status = ssh -o ConnectTimeout=10 root@142.171.75.220 "pm2 list | grep vps-transcoder-api"
Write-Host "服务状态: $status" -ForegroundColor Cyan

# 7. 测试API端点
Write-Host "7. 测试代理API端点..." -ForegroundColor Yellow
try {
    $apiTest = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "代理API测试成功" -ForegroundColor Green
    Write-Host "API响应: $($apiTest | ConvertTo-Json -Compress)" -ForegroundColor Cyan
} catch {
    Write-Host "代理API测试失败: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "VPS部署完成!" -ForegroundColor Green
Write-Host "现在可以测试代理功能了" -ForegroundColor Cyan
