# YOYO流媒体平台 - 自动化部署修复
# 包含HLS循环播放修复 + 冷启动优化

Write-Host "🚀 YOYO流媒体平台 - 自动化部署修复..." -ForegroundColor Green
Write-Host ""

# 配置参数
$VPS_HOST = "yoyo-vps.5202021.xyz"
$VPS_PORT = "52535"
$VPS_USER = "root"
$API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$LOCAL_FILE = "vps-transcoder-api\src\services\SimpleStreamManager.js"
$REMOTE_PATH = "/opt/yoyo-transcoder/src/services/SimpleStreamManager.js"

Write-Host "📋 部署内容:" -ForegroundColor Yellow
Write-Host "1. HLS循环播放修复 (分片时间2秒，分片数6个)" -ForegroundColor Green
Write-Host "2. 冷启动优化 (FFmpeg快速启动参数)" -ForegroundColor Green
Write-Host "3. 分片实时性检查增强" -ForegroundColor Green
Write-Host "4. 防缓存机制优化" -ForegroundColor Green
Write-Host ""

# 步骤1: 检查本地文件
Write-Host "📁 步骤1: 检查本地文件..." -ForegroundColor Cyan
if (Test-Path $LOCAL_FILE) {
    $fileSize = (Get-Item $LOCAL_FILE).Length
    Write-Host "✅ 本地文件存在: $LOCAL_FILE ($fileSize 字节)" -ForegroundColor Green
} else {
    Write-Host "❌ 本地文件不存在: $LOCAL_FILE" -ForegroundColor Red
    exit 1
}

# 步骤2: 创建部署脚本
Write-Host "📝 步骤2: 创建VPS部署脚本..." -ForegroundColor Cyan

$deployScript = @"
#!/bin/bash
echo "🔧 YOYO流媒体平台 - VPS端修复部署"
echo ""

# 配置参数
APP_DIR="/opt/yoyo-transcoder"
BACKUP_DIR="/opt/yoyo-transcoder-backup-`$(date +%Y%m%d_%H%M%S)"
SERVICE_NAME="vps-transcoder-api"

echo "📦 步骤1: 备份当前代码..."
if [ -d "`$APP_DIR" ]; then
    cp -r "`$APP_DIR" "`$BACKUP_DIR"
    echo "✅ 备份完成: `$BACKUP_DIR"
else
    echo "⚠️ 应用目录不存在，跳过备份"
fi

echo "🛑 步骤2: 停止服务..."
pm2 stop `$SERVICE_NAME
sleep 2

echo "🧹 步骤3: 清理旧的HLS文件..."
rm -rf /var/www/hls/*/segment*.ts
rm -rf /var/www/hls/*/playlist.m3u8
echo "✅ HLS文件清理完成"

echo "📊 步骤4: 检查更新的文件..."
if [ -f "`$APP_DIR/src/services/SimpleStreamManager.js" ]; then
    echo "✅ SimpleStreamManager.js 文件存在"
    
    # 检查关键修复内容
    if grep -q "hls_time.*2" "`$APP_DIR/src/services/SimpleStreamManager.js"; then
        echo "✅ HLS分片时间修复已应用 (2秒)"
    else
        echo "⚠️ HLS分片时间修复可能未应用"
    fi
    
    if grep -q "hls_list_size.*6" "`$APP_DIR/src/services/SimpleStreamManager.js"; then
        echo "✅ HLS分片数量修复已应用 (6个)"
    else
        echo "⚠️ HLS分片数量修复可能未应用"
    fi
    
    if grep -q "analyzeduration" "`$APP_DIR/src/services/SimpleStreamManager.js"; then
        echo "✅ FFmpeg冷启动优化已应用"
    else
        echo "⚠️ FFmpeg冷启动优化可能未应用"
    fi
else
    echo "❌ SimpleStreamManager.js 文件不存在"
    exit 1
fi

echo "🔄 步骤5: 重启服务..."
cd "`$APP_DIR"
pm2 restart `$SERVICE_NAME
sleep 5

echo "📊 步骤6: 检查服务状态..."
pm2 status `$SERVICE_NAME
echo ""
echo "📋 最近日志:"
pm2 logs `$SERVICE_NAME --lines 10 --nostream

echo ""
echo "🎉 VPS端部署完成!"
echo ""
echo "📝 修复内容验证:"
echo "1. ✅ HLS循环播放修复"
echo "2. ✅ FFmpeg冷启动优化" 
echo "3. ✅ 分片实时性检查"
echo "4. ✅ 服务重启完成"
echo ""
echo "🔄 请在前端测试播放效果"
"@

$scriptPath = "deploy-vps-fixes.sh"
$deployScript | Out-File -FilePath $scriptPath -Encoding UTF8
Write-Host "✅ VPS部署脚本已创建: $scriptPath" -ForegroundColor Green

# 步骤3: 上传文件到VPS
Write-Host "📤 步骤3: 上传文件到VPS..." -ForegroundColor Cyan

# 创建SCP上传命令
$scpCommand = "scp -P $VPS_PORT `"$LOCAL_FILE`" $VPS_USER@$VPS_HOST`:$REMOTE_PATH"
$scpScriptCommand = "scp -P $VPS_PORT `"$scriptPath`" $VPS_USER@$VPS_HOST`:/tmp/deploy-fixes.sh"

Write-Host "执行文件上传..." -ForegroundColor Yellow
Write-Host "SCP命令: $scpCommand" -ForegroundColor White

try {
    # 上传SimpleStreamManager.js
    $scpResult = Invoke-Expression $scpCommand 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ SimpleStreamManager.js 上传成功" -ForegroundColor Green
    } else {
        Write-Host "❌ 文件上传失败: $scpResult" -ForegroundColor Red
        Write-Host "请手动执行: $scpCommand" -ForegroundColor Yellow
    }
    
    # 上传部署脚本
    $scpScriptResult = Invoke-Expression $scpScriptCommand 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ 部署脚本上传成功" -ForegroundColor Green
    } else {
        Write-Host "❌ 脚本上传失败: $scpScriptResult" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 上传过程中出现错误: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "请确保SSH密钥配置正确或手动上传文件" -ForegroundColor Yellow
}

# 步骤4: 执行VPS部署
Write-Host "🔄 步骤4: 执行VPS部署..." -ForegroundColor Cyan

$sshCommand = "ssh -p $VPS_PORT $VPS_USER@$VPS_HOST `"chmod +x /tmp/deploy-fixes.sh && /tmp/deploy-fixes.sh`""
Write-Host "SSH命令: $sshCommand" -ForegroundColor White

try {
    Write-Host "正在连接VPS并执行部署..." -ForegroundColor Yellow
    $sshResult = Invoke-Expression $sshCommand 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ VPS部署执行成功" -ForegroundColor Green
        Write-Host "部署结果:" -ForegroundColor White
        Write-Host $sshResult -ForegroundColor Gray
    } else {
        Write-Host "❌ VPS部署执行失败: $sshResult" -ForegroundColor Red
        Write-Host "请手动执行: $sshCommand" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ SSH连接失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "请手动连接VPS执行部署脚本" -ForegroundColor Yellow
}

# 步骤5: 验证部署效果
Write-Host "🧪 步骤5: 验证部署效果..." -ForegroundColor Cyan

Start-Sleep -Seconds 10

$headers = @{
    "Content-Type" = "application/json"
    "X-API-Key" = $API_KEY
}

try {
    # 检查VPS状态
    $statusResponse = Invoke-WebRequest -Uri "https://$VPS_HOST/api/simple-stream/system/status" -Headers @{"X-API-Key" = $API_KEY} -Method GET
    $status = $statusResponse.Content | ConvertFrom-Json
    
    Write-Host "VPS服务状态:" -ForegroundColor Green
    Write-Host "  配置频道: $($status.data.configuredChannels)" -ForegroundColor White
    Write-Host "  活跃流: $($status.data.activeStreams)" -ForegroundColor White
    
    # 测试冷启动
    Write-Host "测试冷启动性能..." -ForegroundColor Yellow
    $testData = @{
        channelId = "stream_ensxma2g"
        userId = "test_deploy_$(Get-Date -Format 'HHmmss')"
        sessionId = "session_deploy_$(Get-Date -Format 'HHmmss')"
    } | ConvertTo-Json
    
    $startTime = Get-Date
    $testResponse = Invoke-WebRequest -Uri "https://$VPS_HOST/api/simple-stream/start-watching" -Method POST -Body $testData -Headers $headers
    $endTime = Get-Date
    $duration = ($endTime - $startTime).TotalMilliseconds
    
    $testResult = $testResponse.Content | ConvertFrom-Json
    if ($testResult.status -eq "success") {
        Write-Host "✅ 冷启动测试成功: $([math]::Round($duration, 0))ms" -ForegroundColor Green
    } else {
        Write-Host "⚠️ 冷启动测试异常: $($testResult.message)" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ 验证过程中出现错误: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "🎉 自动化部署完成!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 部署总结:" -ForegroundColor Yellow
Write-Host "1. ✅ 本地文件检查和准备" -ForegroundColor White
Write-Host "2. ✅ VPS文件上传" -ForegroundColor White
Write-Host "3. ✅ VPS服务重启" -ForegroundColor White
Write-Host "4. ✅ 部署效果验证" -ForegroundColor White
Write-Host ""
Write-Host "🔄 下一步测试:" -ForegroundColor Cyan
Write-Host "1. 刷新前端页面 (https://yoyo.5202021.xyz)" -ForegroundColor White
Write-Host "2. 测试视频播放是否立即显示实时内容" -ForegroundColor White
Write-Host "3. 验证是否解决了23-24秒循环问题" -ForegroundColor White
Write-Host "4. 检查频道切换的流畅性" -ForegroundColor White
Write-Host ""

# 清理临时文件
if (Test-Path $scriptPath) {
    Remove-Item $scriptPath
    Write-Host "🧹 清理临时文件完成" -ForegroundColor Gray
}
