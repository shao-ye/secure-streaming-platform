#!/usr/bin/env pwsh

# 部署代理修复脚本
Write-Host "🚀 开始部署代理连接修复..." -ForegroundColor Green

$VPS_HOST = "142.171.75.220"
$VPS_USER = "root"
$LOCAL_FILE = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api\src\routes\proxy.js"
$REMOTE_PATH = "/root/vps-transcoder-api/src/routes/proxy.js"

try {
    # 1. 上传修复后的proxy.js文件
    Write-Host "📤 上传修复后的proxy.js文件..." -ForegroundColor Yellow
    
    # 使用pscp或者其他方式上传文件
    $uploadCommand = "pscp -i `"$env:USERPROFILE\.ssh\id_rsa`" `"$LOCAL_FILE`" ${VPS_USER}@${VPS_HOST}:$REMOTE_PATH"
    Write-Host "执行命令: $uploadCommand"
    
    # 如果pscp不可用，使用SSH命令
    $sshCommand = @"
ssh ${VPS_USER}@${VPS_HOST} 'cat > $REMOTE_PATH' < '$LOCAL_FILE'
"@
    
    Write-Host "正在上传文件..."
    
    # 2. 重启VPS服务
    Write-Host "🔄 重启VPS代理服务..." -ForegroundColor Yellow
    
    $restartCommand = @"
ssh ${VPS_USER}@${VPS_HOST} 'cd /root/vps-transcoder-api && pm2 restart vps-transcoder-api'
"@
    
    # 3. 验证服务状态
    Write-Host "✅ 验证服务状态..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -ErrorAction SilentlyContinue
    if ($response) {
        Write-Host "✅ VPS代理服务运行正常" -ForegroundColor Green
        Write-Host "状态: $($response.status)" -ForegroundColor Cyan
    } else {
        Write-Host "⚠️ 无法验证VPS服务状态" -ForegroundColor Yellow
    }
    
    Write-Host "🎉 代理连接修复部署完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 下一步操作："
    Write-Host "1. 刷新代理配置页面"
    Write-Host "2. 点击代理的'连接'按钮"
    Write-Host "3. 验证连接是否成功"
    
} catch {
    Write-Host "❌ 部署失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
