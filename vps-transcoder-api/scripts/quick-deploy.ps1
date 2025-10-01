# 快速部署修复后的ProcessManager.js
Write-Host "🚀 快速部署修复后的ProcessManager.js..." -ForegroundColor Green

$VpsHost = "yoyo-vps.5202021.xyz"
$SshPort = 52535
$ApiKey = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

# 直接通过SSH执行修复命令
Write-Host "📝 应用FFmpeg修复..." -ForegroundColor Yellow

$fixCommand = @'
ssh -p 52535 root@yoyo-vps.5202021.xyz '
cd /opt/yoyo-transcoder/src/services
cp ProcessManager.js ProcessManager.js.backup
sed -i "s/-method.*PUT.*,//g" ProcessManager.js
sed -i "s/preset.*veryfast/preset\", \"ultrafast/g" ProcessManager.js
sed -i "s/maxrate.*2500k/maxrate\", \"1500k/g" ProcessManager.js
pm2 restart vps-transcoder-api
'
'@

Write-Host "执行修复命令..." -ForegroundColor Gray
Invoke-Expression $fixCommand

Write-Host "`n⏳ 等待服务重启..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# 测试修复结果
Write-Host "`n🧪 测试修复结果..." -ForegroundColor Yellow

$testData = @{
    streamId = "test_fix_$(Get-Date -Format 'HHmmss')"
    rtmpUrl = "rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
    "X-API-Key" = $ApiKey
}

try {
    Write-Host "测试转码功能..." -ForegroundColor Gray
    $response = Invoke-RestMethod -Uri "http://$VpsHost/api/start-stream" -Method POST -Body $testData -Headers $headers -TimeoutSec 20
    Write-Host "✅ 转码修复成功!" -ForegroundColor Green
    Write-Host "HLS URL: $($response.data.hlsUrl)" -ForegroundColor Cyan
} catch {
    Write-Host "转码测试结果: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n🏁 快速修复完成" -ForegroundColor Green
