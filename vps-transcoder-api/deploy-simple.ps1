# VPS代理服务部署脚本
Write-Host "开始VPS代理服务部署..." -ForegroundColor Green

# 1. 检查VPS连接
Write-Host "1. 检查VPS连接..." -ForegroundColor Yellow
$result = ssh -o ConnectTimeout=10 root@142.171.75.220 "echo 'VPS连接正常'"
Write-Host "VPS连接结果: $result" -ForegroundColor Cyan

# 2. 拉取最新代码
Write-Host "2. 拉取最新代码..." -ForegroundColor Yellow
$gitPull = ssh -o ConnectTimeout=30 root@142.171.75.220 "cd /opt/yoyo-transcoder && git pull origin master"
Write-Host "Git拉取结果: $gitPull" -ForegroundColor Cyan

# 3. 重启服务
Write-Host "3. 重启VPS服务..." -ForegroundColor Yellow
$restart = ssh -o ConnectTimeout=20 root@142.171.75.220 "pm2 reload vps-transcoder-api"
Write-Host "服务重启结果: $restart" -ForegroundColor Cyan

# 4. 验证服务状态
Write-Host "4. 验证服务状态..." -ForegroundColor Yellow
$status = ssh -o ConnectTimeout=10 root@142.171.75.220 "pm2 list | grep vps-transcoder-api"
Write-Host "服务状态: $status" -ForegroundColor Cyan

# 5. 测试API端点
Write-Host "5. 测试代理API端点..." -ForegroundColor Yellow
try {
    $apiTest = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "代理API测试成功" -ForegroundColor Green
    Write-Host "API响应: $($apiTest | ConvertTo-Json -Compress)" -ForegroundColor Cyan
} catch {
    Write-Host "代理API测试失败: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "VPS部署完成!" -ForegroundColor Green
