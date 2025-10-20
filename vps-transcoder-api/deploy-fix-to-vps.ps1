# VPS转码服务修复部署脚本
# 解决频道播放问题：同步最新的SimpleStreamManager代码

Write-Host "=== VPS转码服务修复部署脚本 ===" -ForegroundColor Green
Write-Host "时间: $(Get-Date)" -ForegroundColor Gray
Write-Host ""

# 设置变量
$VPS_IP = "142.171.75.220"
$VPS_USER = "root"
$VPS_SERVICE_DIR = "/opt/yoyo-transcoder"
$LOCAL_SOURCE_DIR = "./temp_vps_sync_new/src"

Write-Host "🎯 目标VPS: $VPS_IP" -ForegroundColor Cyan
Write-Host "📁 服务目录: $VPS_SERVICE_DIR" -ForegroundColor Cyan
Write-Host "📦 本地源码: $LOCAL_SOURCE_DIR" -ForegroundColor Cyan
Write-Host ""

# 1. 检查本地源码目录
if (-not (Test-Path $LOCAL_SOURCE_DIR)) {
    Write-Host "❌ 本地源码目录不存在: $LOCAL_SOURCE_DIR" -ForegroundColor Red
    exit 1
}

Write-Host "✅ 本地源码目录存在" -ForegroundColor Green

# 2. 停止服务
Write-Host ""
Write-Host "🛑 停止转码服务..." -ForegroundColor Yellow
try {
    ssh -o ConnectTimeout=10 "$VPS_USER@$VPS_IP" "pm2 stop vps-transcoder-api || echo '服务未运行'"
    Start-Sleep -Seconds 2
    Write-Host "✅ 服务已停止" -ForegroundColor Green
} catch {
    Write-Host "⚠️ 停止服务时出现问题: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 3. 同步最新代码
Write-Host ""
Write-Host "📤 同步最新代码到VPS..." -ForegroundColor Yellow
try {
    scp -r "$LOCAL_SOURCE_DIR" "${VPS_USER}@${VPS_IP}:${VPS_SERVICE_DIR}/"
    Write-Host "✅ 代码同步完成" -ForegroundColor Green
} catch {
    Write-Host "❌ 代码同步失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 4. 安装依赖
Write-Host ""
Write-Host "📦 安装/更新依赖..." -ForegroundColor Yellow
try {
    ssh -o ConnectTimeout=10 "$VPS_USER@$VPS_IP" "cd $VPS_SERVICE_DIR && npm install --production"
    Write-Host "✅ 依赖安装完成" -ForegroundColor Green
} catch {
    Write-Host "⚠️ 依赖安装时出现问题: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 5. 清理旧的HLS文件
Write-Host ""
Write-Host "🧹 清理旧的HLS文件..." -ForegroundColor Yellow
try {
    ssh -o ConnectTimeout=10 "$VPS_USER@$VPS_IP" @"
        rm -rf /var/www/hls/stream_*
        mkdir -p /var/www/hls
        chmod -R 755 /var/www/hls
        chown -R www-data:www-data /var/www/hls
        echo '✅ HLS目录已清理'
"@
    Write-Host "✅ HLS目录清理完成" -ForegroundColor Green
} catch {
    Write-Host "⚠️ HLS目录清理时出现问题: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 6. 重启服务
Write-Host ""
Write-Host "🔄 重启转码服务..." -ForegroundColor Yellow
try {
    ssh -o ConnectTimeout=10 "$VPS_USER@$VPS_IP" "cd $VPS_SERVICE_DIR && pm2 restart vps-transcoder-api"
    Start-Sleep -Seconds 3
    Write-Host "✅ 服务已重启" -ForegroundColor Green
} catch {
    Write-Host "⚠️ 服务重启时出现问题: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 7. 验证服务状态
Write-Host ""
Write-Host "🧪 验证服务状态..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 测试基础API
Write-Host "测试基础API..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "http://${VPS_IP}:3000/api/status" -TimeoutSec 10
    Write-Host "✅ 基础API正常: $($response.message)" -ForegroundColor Green
} catch {
    Write-Host "❌ 基础API测试失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 测试SimpleStreamManager API
Write-Host ""
Write-Host "测试SimpleStreamManager API..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "http://${VPS_IP}:3000/api/simple-stream/health" -TimeoutSec 10
    Write-Host "✅ SimpleStreamManager API正常: $($response.message)" -ForegroundColor Green
} catch {
    Write-Host "❌ SimpleStreamManager API测试失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "🎉 部署完成！" -ForegroundColor Green
Write-Host ""
Write-Host "📋 后续测试步骤：" -ForegroundColor Cyan
Write-Host "1. 在浏览器中测试频道播放"
Write-Host "2. 检查HLS文件是否正常生成"
Write-Host "3. 验证频道切换功能"
Write-Host ""
Write-Host "🔍 如果还有问题，请检查：" -ForegroundColor Yellow
Write-Host "- pm2 logs vps-transcoder-api"
Write-Host "- /var/www/hls/ 目录权限"
Write-Host "- FFmpeg是否正确安装"
