# 本地转码功能测试脚本
Write-Host "🧪 本地转码功能测试" -ForegroundColor Green

$LocalServerUrl = "http://localhost:3001"
$ApiKey = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

# 检查Node.js是否安装
Write-Host "`n🔍 检查Node.js环境..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js版本: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js未安装或不在PATH中" -ForegroundColor Red
    exit 1
}

# 检查FFmpeg是否安装
Write-Host "`n🔍 检查FFmpeg环境..." -ForegroundColor Yellow
try {
    $ffmpegVersion = ffmpeg -version 2>$null | Select-Object -First 1
    if ($ffmpegVersion) {
        Write-Host "✅ FFmpeg已安装: $($ffmpegVersion.Split(' ')[2])" -ForegroundColor Green
    } else {
        Write-Host "⚠️  FFmpeg未找到，转码功能可能无法工作" -ForegroundColor Yellow
        Write-Host "请从 https://ffmpeg.org/download.html 下载并安装FFmpeg" -ForegroundColor Cyan
    }
} catch {
    Write-Host "⚠️  FFmpeg未找到，转码功能可能无法工作" -ForegroundColor Yellow
}

# 启动本地调试服务器
Write-Host "`n🚀 启动本地调试服务器..." -ForegroundColor Yellow
$serverProcess = Start-Process -FilePath "node" -ArgumentList "scripts/local-debug-server.js" -WorkingDirectory "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api" -PassThru

# 等待服务器启动
Write-Host "⏳ 等待服务器启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# 测试健康检查
Write-Host "`n🏥 测试健康检查端点..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-RestMethod -Uri "$LocalServerUrl/health" -Method GET -TimeoutSec 5
    Write-Host "✅ 健康检查通过" -ForegroundColor Green
    Write-Host "服务状态: $($healthResponse.status)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ 健康检查失败: $($_.Exception.Message)" -ForegroundColor Red
    $serverProcess.Kill()
    exit 1
}

# 测试API状态端点
Write-Host "`n📊 测试API状态端点..." -ForegroundColor Yellow
try {
    $headers = @{"X-API-Key" = $ApiKey}
    $statusResponse = Invoke-RestMethod -Uri "$LocalServerUrl/api/status" -Method GET -Headers $headers -TimeoutSec 5
    Write-Host "✅ API状态端点正常" -ForegroundColor Green
    Write-Host "API状态: $($statusResponse.status)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ API状态端点失败: $($_.Exception.Message)" -ForegroundColor Red
}

# 测试转码端点
Write-Host "`n🎬 测试转码端点..." -ForegroundColor Yellow
$testData = @{
    streamId = "test_local_$(Get-Date -Format 'HHmmss')"
    rtmpUrl = "rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"
} | ConvertTo-Json

try {
    $headers = @{
        "Content-Type" = "application/json"
        "X-API-Key" = $ApiKey
    }
    
    Write-Host "发送转码请求..." -ForegroundColor Gray
    $transcodeResponse = Invoke-RestMethod -Uri "$LocalServerUrl/api/start-stream" -Method POST -Body $testData -Headers $headers -TimeoutSec 15
    
    Write-Host "✅ 转码端点响应成功!" -ForegroundColor Green
    Write-Host "响应内容:" -ForegroundColor Cyan
    $transcodeResponse | ConvertTo-Json -Depth 3 | Write-Host -ForegroundColor Gray
    
} catch {
    Write-Host "🔍 转码端点测试结果: $($_.Exception.Message)" -ForegroundColor Yellow
    if ($_.Exception.Response) {
        $errorResponse = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($errorResponse)
        $errorContent = $reader.ReadToEnd()
        Write-Host "错误详情: $errorContent" -ForegroundColor Red
    }
}

# 检查生成的HLS文件
Write-Host "`n📁 检查HLS输出文件..." -ForegroundColor Yellow
$hlsDir = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\debug-hls"
if (Test-Path $hlsDir) {
    $hlsFiles = Get-ChildItem $hlsDir -Recurse
    if ($hlsFiles.Count -gt 0) {
        Write-Host "✅ 找到HLS文件:" -ForegroundColor Green
        $hlsFiles | ForEach-Object { Write-Host "  - $($_.FullName)" -ForegroundColor Cyan }
    } else {
        Write-Host "⚠️  HLS目录为空" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  HLS输出目录不存在" -ForegroundColor Yellow
}

# 停止服务器
Write-Host "`n🛑 停止本地服务器..." -ForegroundColor Yellow
$serverProcess.Kill()

Write-Host "`n🏁 本地测试完成!" -ForegroundColor Green
Write-Host "如果转码功能正常，可以将修复应用到VPS服务器" -ForegroundColor Cyan
