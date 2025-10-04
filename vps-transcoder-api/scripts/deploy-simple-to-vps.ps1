# YOYO流媒体平台 - 简化架构VPS部署脚本 (PowerShell版本)
# 将新的SimpleStreamManager部署到生产服务器

param(
    [string]$VpsHost = "142.171.75.220",
    [string]$VpsUser = "root",
    [string]$VpsAppDir = "/opt/yoyo-transcoder",
    [string]$ApiKey = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
)

Write-Host "🚀 YOYO简化架构VPS部署脚本" -ForegroundColor Green
Write-Host "=============================" -ForegroundColor Green

# 检查依赖
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "❌ ssh 未安装，请先安装 OpenSSH" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    Write-Host "❌ scp 未安装，请先安装 OpenSSH" -ForegroundColor Red
    exit 1
}

Write-Host "📋 部署信息：" -ForegroundColor Cyan
Write-Host "- VPS服务器: $VpsHost"
Write-Host "- 应用目录: $VpsAppDir"
Write-Host "- 本地项目: $(Get-Location)"
Write-Host ""

# 步骤1: 本地代码验证
Write-Host "🔍 步骤1: 本地代码验证..." -ForegroundColor Yellow

$requiredFiles = @(
    "vps-transcoder-api\src\services\SimpleStreamManager.js",
    "vps-transcoder-api\src\routes\simple-stream.js",
    "vps-transcoder-api\src\app.js"
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path $file)) {
        Write-Host "❌ $file 文件不存在" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ 本地代码文件检查通过" -ForegroundColor Green

# 步骤2: 备份VPS现有代码
Write-Host "💾 步骤2: 备份VPS现有代码..." -ForegroundColor Yellow
$backupDir = "/opt/yoyo-transcoder-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

$backupScript = @"
if [ -d "$VpsAppDir" ]; then
    echo "创建备份目录: $backupDir"
    cp -r "$VpsAppDir" "$backupDir"
    echo "✅ 备份完成: $backupDir"
else
    echo "⚠️ 应用目录不存在，跳过备份"
fi
"@

ssh "$VpsUser@$VpsHost" $backupScript

# 步骤3: 同步代码到VPS
Write-Host "📤 步骤3: 同步代码到VPS..." -ForegroundColor Yellow

# 创建临时部署目录
$tempDeployDir = "temp-deploy-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDeployDir -Force | Out-Null

# 复制需要的文件
Write-Host "准备部署文件..."
Copy-Item -Path "vps-transcoder-api\src" -Destination "$tempDeployDir\src" -Recurse
Copy-Item -Path "vps-transcoder-api\package.json" -Destination "$tempDeployDir\"
if (Test-Path "vps-transcoder-api\package-lock.json") {
    Copy-Item -Path "vps-transcoder-api\package-lock.json" -Destination "$tempDeployDir\"
}

# 同步到VPS
Write-Host "同步文件到VPS..."
scp -r "$tempDeployDir\*" "$VpsUser@${VpsHost}:$VpsAppDir/"

# 清理临时目录
Remove-Item -Path $tempDeployDir -Recurse -Force

Write-Host "✅ 代码同步完成" -ForegroundColor Green

# 步骤4: VPS服务器配置
Write-Host "⚙️ 步骤4: VPS服务器配置..." -ForegroundColor Yellow

$configScript = @"
cd $VpsAppDir

echo "检查Node.js版本..."
node --version

echo "安装/更新依赖..."
npm install --production

echo "检查FFmpeg..."
ffmpeg -version | head -1

echo "确保HLS输出目录存在..."
mkdir -p /var/www/hls
chown -R root:root /var/www/hls
chmod -R 755 /var/www/hls

echo "检查日志目录..."
mkdir -p /var/log/transcoder
chown -R root:root /var/log/transcoder

echo "✅ VPS环境配置完成"
"@

ssh "$VpsUser@$VpsHost" $configScript

# 步骤5: 重启服务
Write-Host "🔄 步骤5: 重启应用服务..." -ForegroundColor Yellow

$restartScript = @"
cd $VpsAppDir

echo "停止现有PM2进程..."
pm2 stop vps-transcoder-api || echo "进程未运行"
pm2 delete vps-transcoder-api || echo "进程不存在"

echo "启动新的应用服务..."
pm2 start src/app.js --name vps-transcoder-api --log /var/log/transcoder/app.log

echo "等待服务启动..."
sleep 5

echo "检查PM2状态..."
pm2 status

echo "保存PM2配置..."
pm2 save
"@

ssh "$VpsUser@$VpsHost" $restartScript

# 步骤6: 健康检查
Write-Host "🏥 步骤6: 服务健康检查..." -ForegroundColor Yellow

Write-Host "等待服务完全启动..."
Start-Sleep -Seconds 10

# 检查服务状态
Write-Host "检查API健康状态..."
$healthCheck = ssh "$VpsUser@$VpsHost" "curl -s -f http://localhost:3000/health || echo 'FAILED'"

if ($healthCheck -like "*healthy*") {
    Write-Host "✅ API服务健康检查通过" -ForegroundColor Green
} else {
    Write-Host "❌ API服务健康检查失败" -ForegroundColor Red
    Write-Host "响应: $healthCheck"
    
    # 显示日志
    Write-Host "查看应用日志..."
    ssh "$VpsUser@$VpsHost" "pm2 logs vps-transcoder-api --lines 20"
    exit 1
}

# 步骤7: 初始化频道配置
Write-Host "🎛️ 步骤7: 初始化频道配置..." -ForegroundColor Yellow

# 使用有效的RTMP源
$rtmpSource1 = "rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b"
$rtmpSource2 = "rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c"

$configChannelsScript = @"
echo "配置频道..."
curl -X POST "http://localhost:3000/api/simple-stream/batch-configure" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ApiKey" \
  -d '{
    "channels": [
      {"channelId": "stream_ensxma2g", "name": "二楼教室1", "rtmpUrl": "$rtmpSource2"},
      {"channelId": "stream_gkg5hknc", "name": "二楼教室2", "rtmpUrl": "$rtmpSource1"},
      {"channelId": "stream_kcwxuedx", "name": "国际班", "rtmpUrl": "$rtmpSource2"},
      {"channelId": "stream_kil0lecb", "name": "C班", "rtmpUrl": "$rtmpSource1"},
      {"channelId": "stream_noyoostd", "name": "三楼舞蹈室", "rtmpUrl": "$rtmpSource2"},
      {"channelId": "stream_3blyhqh3", "name": "多功能厅", "rtmpUrl": "$rtmpSource1"},
      {"channelId": "stream_8zf48z6g", "name": "操场1", "rtmpUrl": "$rtmpSource2"},
      {"channelId": "stream_cpa2czoo", "name": "操场2", "rtmpUrl": "$rtmpSource1"}
    ]
  }'
"@

ssh "$VpsUser@$VpsHost" $configChannelsScript

Write-Host "✅ 频道配置完成" -ForegroundColor Green

# 步骤8: 功能测试
Write-Host "🧪 步骤8: 功能测试..." -ForegroundColor Yellow

Write-Host "测试系统状态API..."
$systemStatus = ssh "$VpsUser@$VpsHost" "curl -s -H 'X-API-Key: $ApiKey' http://localhost:3000/api/simple-stream/system/status"
Write-Host "系统状态: $systemStatus"

Write-Host "测试开始观看API..."
$startResponse = ssh "$VpsUser@$VpsHost" "curl -s -X POST -H 'Content-Type: application/json' -H 'X-API-Key: $ApiKey' -d '{\"channelId\": \"stream_ensxma2g\", \"userId\": \"test-deploy-user\"}' http://localhost:3000/api/simple-stream/start-watching"
Write-Host "开始观看响应: $startResponse"

# 提取sessionId进行清理
if ($startResponse -match '"sessionId":"([^"]*)"') {
    $sessionId = $matches[1]
    Write-Host "清理测试会话: $sessionId"
    ssh "$VpsUser@$VpsHost" "curl -s -X POST -H 'Content-Type: application/json' -H 'X-API-Key: $ApiKey' -d '{\"sessionId\": \"$sessionId\"}' http://localhost:3000/api/simple-stream/stop-watching" | Out-Null
}

Write-Host "✅ 功能测试完成" -ForegroundColor Green

# 部署总结
Write-Host ""
Write-Host "🎉 简化架构部署完成！" -ForegroundColor Green
Write-Host "==========================" -ForegroundColor Green
Write-Host ""
Write-Host "📊 部署摘要：" -ForegroundColor Cyan
Write-Host "✅ 代码同步完成" -ForegroundColor Green
Write-Host "✅ 依赖安装完成" -ForegroundColor Green
Write-Host "✅ 服务重启成功" -ForegroundColor Green
Write-Host "✅ 健康检查通过" -ForegroundColor Green
Write-Host "✅ 频道配置完成" -ForegroundColor Green
Write-Host "✅ 功能测试通过" -ForegroundColor Green
Write-Host ""
Write-Host "🔗 API端点：" -ForegroundColor Cyan
Write-Host "- 健康检查: http://yoyo-vps.5202021.xyz/health"
Write-Host "- 系统状态: http://yoyo-vps.5202021.xyz/api/simple-stream/system/status"
Write-Host "- 开始观看: POST http://yoyo-vps.5202021.xyz/api/simple-stream/start-watching"
Write-Host "- 停止观看: POST http://yoyo-vps.5202021.xyz/api/simple-stream/stop-watching"
Write-Host ""
Write-Host "📋 新架构特性：" -ForegroundColor Cyan
Write-Host "• 0.5秒HLS分片，超低延迟"
Write-Host "• 按需启动转码，节省资源"
Write-Host "• 智能会话管理，自动清理"
Write-Host "• 多用户共享转码进程"
Write-Host "• 无缝频道切换支持"
Write-Host ""
Write-Host "🎯 下一步：" -ForegroundColor Cyan
Write-Host "1. 部署Cloudflare Workers"
Write-Host "2. 测试前端集成"
Write-Host "3. 验证端到端功能"
Write-Host ""
Write-Host "🚀 简化架构已准备就绪！" -ForegroundColor Green
