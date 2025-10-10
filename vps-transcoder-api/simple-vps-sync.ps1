# 简化的VPS代码同步脚本
Write-Host "VPS代码同步开始..." -ForegroundColor Cyan

# 1. 创建临时目录
$tempDir = "temp_vps_sync"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# 2. 复制代码
Write-Host "复制代码文件..." -ForegroundColor Yellow
Copy-Item "vps-transcoder-api" -Destination "$tempDir/vps-transcoder-api" -Recurse

# 3. 创建部署脚本
$deployScript = @'
#!/bin/bash
echo "停止服务..."
pkill -f "node.*app.js" || true
sleep 2

echo "备份现有代码..."
if [ -d "/opt/yoyo-transcoder" ]; then
    mv /opt/yoyo-transcoder /opt/yoyo-transcoder.backup.$(date +%Y%m%d_%H%M%S)
fi

echo "部署新代码..."
mkdir -p /opt/yoyo-transcoder
cp -r vps-transcoder-api/* /opt/yoyo-transcoder/
cd /opt/yoyo-transcoder

echo "安装依赖..."
npm install

echo "创建目录..."
mkdir -p config logs
chmod 755 config logs

echo "检查V2Ray..."
if command -v xray >/dev/null && ! command -v v2ray >/dev/null; then
    ln -sf /usr/local/bin/xray /usr/local/bin/v2ray
fi

echo "启动服务..."
nohup node src/app.js > logs/app.log 2>&1 &
sleep 3

echo "检查服务..."
if pgrep -f "node.*app.js" >/dev/null; then
    echo "服务启动成功"
    curl -s http://localhost:3000/api/proxy/status || echo "API测试"
else
    echo "服务启动失败"
    tail -5 logs/app.log
fi
'@

$deployScript | Out-File -FilePath "$tempDir/deploy.sh" -Encoding UTF8

# 4. 打包
Write-Host "创建代码包..." -ForegroundColor Yellow
$packageName = "vps-code-$(Get-Date -Format 'yyyyMMdd_HHmmss').tar.gz"
tar -czf $packageName -C $tempDir .

# 5. 上传并部署
Write-Host "上传到VPS..." -ForegroundColor Yellow
scp $packageName root@142.171.75.220:/root/

Write-Host "在VPS上部署..." -ForegroundColor Yellow
ssh root@142.171.75.220 "cd /root && tar -xzf $packageName && chmod +x deploy.sh && ./deploy.sh && rm -f $packageName"

# 6. 清理
Remove-Item $tempDir -Recurse -Force
Remove-Item $packageName -Force

Write-Host "同步完成！" -ForegroundColor Green
