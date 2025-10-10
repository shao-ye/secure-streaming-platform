# 修复VPS代理服务部署脚本
Write-Host "🔧 修复VPS代理服务部署" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan

# 1. 创建临时部署包
$tempDir = "temp_proxy_fix"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

# 2. 复制关键代理文件
Write-Host "复制代理服务文件..." -ForegroundColor Yellow
Copy-Item "src/routes/proxy.js" -Destination "$tempDir/proxy.js"
Copy-Item "src/services/ProxyManager.js" -Destination "$tempDir/ProxyManager.js"

# 3. 创建修复脚本
$fixScript = @'
#!/bin/bash
echo "🔧 修复VPS代理服务"

# 停止服务
echo "停止现有服务..."
pkill -f "node.*app.js" || true
sleep 2

# 备份并更新文件
echo "更新代理服务文件..."
cd /opt/yoyo-transcoder

# 创建备份
cp src/routes/proxy.js src/routes/proxy.js.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
cp src/services/ProxyManager.js src/services/ProxyManager.js.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true

# 更新文件
mkdir -p src/routes src/services
cp /root/proxy.js src/routes/proxy.js
cp /root/ProxyManager.js src/services/ProxyManager.js

# 检查app.js中的代理路由集成
echo "检查代理路由集成..."
if ! grep -q "proxy.*require.*routes/proxy" src/app.js; then
    echo "添加代理路由到app.js..."
    # 在simple-stream路由后添加代理路由
    sed -i '/simple-stream/a app.use("/api/proxy", require("./routes/proxy"));' src/app.js
fi

# 重启服务
echo "重启服务..."
nohup node src/app.js > logs/app.log 2>&1 &
sleep 3

# 验证服务
echo "验证代理API..."
if curl -s -f "http://localhost:3000/api/proxy/status" >/dev/null 2>&1; then
    echo "✅ 代理API修复成功"
    curl -s "http://localhost:3000/api/proxy/status"
else
    echo "❌ 代理API仍然异常"
    echo "最新日志:"
    tail -10 logs/app.log
fi

# 清理临时文件
rm -f /root/proxy.js /root/ProxyManager.js
'@

$fixScript | Out-File -FilePath "$tempDir/fix.sh" -Encoding UTF8

# 4. 打包
Write-Host "创建修复包..." -ForegroundColor Yellow
$packageName = "proxy-fix-$(Get-Date -Format 'yyyyMMdd_HHmmss').tar.gz"
tar -czf $packageName -C $tempDir .

# 5. 上传并执行修复
Write-Host "上传到VPS..." -ForegroundColor Yellow
scp $packageName root@142.171.75.220:/root/

Write-Host "执行修复..." -ForegroundColor Yellow
ssh root@142.171.75.220 "cd /root && tar -xzf $packageName && chmod +x fix.sh && ./fix.sh && rm -f $packageName"

# 6. 清理
Remove-Item $tempDir -Recurse -Force
Remove-Item $packageName -Force

Write-Host "修复完成！" -ForegroundColor Green
