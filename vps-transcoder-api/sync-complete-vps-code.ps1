# VPS完整代码同步脚本
Write-Host "🚀 VPS完整代码同步脚本" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. 检查本地代码状态
Write-Host "`n1. 检查本地代码状态..." -ForegroundColor Yellow
$currentDir = Get-Location
Write-Host "当前目录: $currentDir" -ForegroundColor Gray

# 确保在正确的目录
if (-not (Test-Path "vps-transcoder-api")) {
    Write-Host "❌ 请在项目根目录运行此脚本" -ForegroundColor Red
    exit 1
}

# 2. 创建代码包
Write-Host "`n2. 创建VPS代码包..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$packageName = "vps-code-$timestamp.tar.gz"

# 创建临时目录
$tempDir = "temp_vps_package"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# 复制VPS相关代码
Write-Host "复制VPS应用代码..." -ForegroundColor Gray
Copy-Item "vps-transcoder-api/vps-transcoder-api" -Destination "$tempDir/vps-transcoder-api" -Recurse

# 创建部署脚本
Write-Host "创建VPS部署脚本..." -ForegroundColor Gray
$deployScript = @"
#!/bin/bash

# VPS代码更新部署脚本
echo "🔄 VPS代码更新部署"
echo "===================="

# 1. 停止现有服务
echo "停止现有服务..."
pkill -f "node.*app.js" || echo "没有运行中的服务"
sleep 2

# 2. 备份现有代码
if [ -d "/opt/yoyo-transcoder" ]; then
    echo "备份现有代码..."
    mv /opt/yoyo-transcoder /opt/yoyo-transcoder.backup.`date +%Y%m%d_%H%M%S`
fi

# 3. 部署新代码
echo "部署新代码..."
mkdir -p /opt/yoyo-transcoder
cp -r vps-transcoder-api/* /opt/yoyo-transcoder/
cd /opt/yoyo-transcoder

# 4. 安装依赖
echo "安装依赖..."
npm install

# 5. 创建必要目录
echo "创建必要目录..."
mkdir -p config logs
chmod 755 config logs

# 6. 检查V2Ray软链接
echo "检查V2Ray软链接..."
if command -v xray &> /dev/null && ! command -v v2ray &> /dev/null; then
    ln -sf /usr/local/bin/xray /usr/local/bin/v2ray
    echo "✅ 已创建v2ray软链接"
fi

# 7. 启动服务
echo "启动服务..."
nohup node src/app.js > logs/app.log 2>&1 &
sleep 3

# 8. 验证服务
echo "验证服务..."
if pgrep -f "node.*app.js" > /dev/null; then
    echo "✅ 服务启动成功"
    
    # 测试API
    if curl -s -f "http://localhost:3000/health" > /dev/null; then
        echo "✅ 基础API正常"
    fi
    
    if curl -s -f "http://localhost:3000/api/proxy/status" > /dev/null; then
        echo "✅ 代理API正常"
        curl -s "http://localhost:3000/api/proxy/status" | head -1
    fi
else
    echo "❌ 服务启动失败"
    tail -10 logs/app.log
fi

echo "===================="
echo "✅ VPS代码更新完成"
"@

$deployScript | Out-File -FilePath "$tempDir/deploy.sh" -Encoding UTF8
(Get-Content "$tempDir/deploy.sh") -replace "`r`n", "`n" | Set-Content "$tempDir/deploy.sh" -NoNewline

# 3. 打包代码
Write-Host "`n3. 打包代码..." -ForegroundColor Yellow
if (Get-Command tar -ErrorAction SilentlyContinue) {
    tar -czf $packageName -C $tempDir .
    Write-Host "✅ 代码包创建成功: $packageName" -ForegroundColor Green
} else {
    Write-Host "❌ 系统中没有tar命令，请手动打包" -ForegroundColor Red
    Write-Host "临时目录: $tempDir" -ForegroundColor Gray
}

# 4. 上传到VPS
Write-Host "`n4. 上传到VPS..." -ForegroundColor Yellow
try {
    # 使用scp上传
    scp $packageName root@142.171.75.220:/root/
    Write-Host "✅ 代码包上传成功" -ForegroundColor Green
    
    # 在VPS上解压并部署
    Write-Host "`n5. 在VPS上部署..." -ForegroundColor Yellow
    ssh root@142.171.75.220 "
        cd /root
        tar -xzf $packageName
        chmod +x deploy.sh
        ./deploy.sh
        rm -f $packageName
    "
    
    Write-Host "VPS部署完成" -ForegroundColor Green
    
} catch {
    Write-Host "VPS部署失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 5. 清理临时文件
Write-Host "`n6. 清理临时文件..." -ForegroundColor Yellow
Remove-Item $tempDir -Recurse -Force
if (Test-Path $packageName) {
    Remove-Item $packageName -Force
}
Write-Host "✅ 清理完成" -ForegroundColor Green

# 6. 测试VPS服务
Write-Host "`n7. 测试VPS服务..." -ForegroundColor Yellow
try {
    Start-Sleep -Seconds 5
    $response = Invoke-WebRequest -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Headers @{"X-API-Key"="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"} -UseBasicParsing
    $data = $response.Content | ConvertFrom-Json
    Write-Host "✅ VPS代理服务正常" -ForegroundColor Green
    Write-Host "   连接状态: $($data.data.connectionStatus)" -ForegroundColor Gray
    Write-Host "   当前代理: $($data.data.currentProxy)" -ForegroundColor Gray
    Write-Host "   模式: $($data.data.mode)" -ForegroundColor Gray
} catch {
    Write-Host "❌ VPS服务测试失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nVPS代码同步完成！" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
