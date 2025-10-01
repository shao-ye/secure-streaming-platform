# VPS API路由自动部署脚本
# 用于将新的api.js路由文件部署到VPS服务器

param(
    [string]$VpsHost = "yoyo-vps.5202021.xyz",
    [int]$SshPort = 52535,
    [string]$ApiKey = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
)

Write-Host "🚀 开始部署VPS API路由..." -ForegroundColor Green
Write-Host "目标服务器: $VpsHost" -ForegroundColor Cyan

# 定义本地api.js文件路径
$LocalApiFile = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api\src\routes\api.js"

# 检查本地文件是否存在
if (-not (Test-Path $LocalApiFile)) {
    Write-Host "❌ 错误: 本地api.js文件不存在: $LocalApiFile" -ForegroundColor Red
    exit 1
}

Write-Host "✅ 本地api.js文件存在" -ForegroundColor Green

# 方法1: 尝试通过SCP上传文件
Write-Host "`n📤 方法1: 尝试通过SCP上传文件..." -ForegroundColor Yellow

try {
    $scpCommand = "scp -P $SshPort `"$LocalApiFile`" root@${VpsHost}:/opt/yoyo-transcoder/src/routes/"
    Write-Host "执行命令: $scpCommand" -ForegroundColor Gray
    
    $scpResult = Invoke-Expression $scpCommand 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ SCP上传成功" -ForegroundColor Green
        $uploadSuccess = $true
    } else {
        Write-Host "❌ SCP上传失败: $scpResult" -ForegroundColor Red
        $uploadSuccess = $false
    }
} catch {
    Write-Host "❌ SCP上传异常: $($_.Exception.Message)" -ForegroundColor Red
    $uploadSuccess = $false
}

# 方法2: 如果SCP失败，尝试通过SSH直接创建文件
if (-not $uploadSuccess) {
    Write-Host "`n📝 方法2: 尝试通过SSH直接创建文件..." -ForegroundColor Yellow
    
    # 读取本地api.js文件内容
    $apiContent = Get-Content $LocalApiFile -Raw
    
    # 转义特殊字符
    $escapedContent = $apiContent -replace "'", "'\"'\"'" -replace "`n", "\n" -replace "`r", ""
    
    $sshCommand = @"
ssh -p $SshPort root@$VpsHost "
cd /opt/yoyo-transcoder/src/routes && 
cp api.js api.js.backup 2>/dev/null || echo 'api.js不存在，将创建新文件' && 
cat > api.js << 'APIEOF'
$apiContent
APIEOF
"
"@
    
    try {
        Write-Host "执行SSH命令创建文件..." -ForegroundColor Gray
        $sshResult = Invoke-Expression $sshCommand 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ SSH文件创建成功" -ForegroundColor Green
            $uploadSuccess = $true
        } else {
            Write-Host "❌ SSH文件创建失败: $sshResult" -ForegroundColor Red
        }
    } catch {
        Write-Host "❌ SSH文件创建异常: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 如果文件上传成功，尝试重启PM2服务
if ($uploadSuccess) {
    Write-Host "`n🔄 重启PM2服务..." -ForegroundColor Yellow
    
    try {
        $restartCommand = "ssh -p $SshPort root@$VpsHost 'pm2 restart vps-transcoder-api'"
        Write-Host "执行命令: $restartCommand" -ForegroundColor Gray
        
        $restartResult = Invoke-Expression $restartCommand 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ PM2服务重启成功" -ForegroundColor Green
            Write-Host "$restartResult" -ForegroundColor Gray
        } else {
            Write-Host "❌ PM2服务重启失败: $restartResult" -ForegroundColor Red
        }
    } catch {
        Write-Host "❌ PM2服务重启异常: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 等待服务启动
    Write-Host "`n⏳ 等待服务启动..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    # 验证部署结果
    Write-Host "`n🧪 验证部署结果..." -ForegroundColor Yellow
    
    try {
        # 测试start-stream端点
        $testData = @{
            streamId = "test_deployment"
            rtmpUrl = "rtmp://test.example.com/live/test"
        } | ConvertTo-Json
        
        $headers = @{
            "Content-Type" = "application/json"
            "X-API-Key" = $ApiKey
        }
        
        Write-Host "测试 /api/start-stream 端点..." -ForegroundColor Gray
        
        $response = Invoke-WebRequest -Uri "https://$VpsHost/api/start-stream" -Method POST -Body $testData -Headers $headers -UseBasicParsing 2>&1
        
        if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 400) {
            Write-Host "✅ API端点部署成功！状态码: $($response.StatusCode)" -ForegroundColor Green
            Write-Host "响应内容: $($response.Content)" -ForegroundColor Gray
        } else {
            Write-Host "⚠️  API端点响应异常，状态码: $($response.StatusCode)" -ForegroundColor Yellow
        }
    } catch {
        if ($_.Exception.Message -like "*404*") {
            Write-Host "❌ API端点仍然返回404，部署可能失败" -ForegroundColor Red
        } else {
            Write-Host "🔍 测试过程中出现异常: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "`n❌ 文件上传失败，无法继续部署" -ForegroundColor Red
    Write-Host "`n📋 手动部署建议:" -ForegroundColor Cyan
    Write-Host "1. 查看部署指南: VPS_API_ROUTES_DEPLOYMENT_GUIDE.md" -ForegroundColor White
    Write-Host "2. 手动SSH连接到VPS服务器" -ForegroundColor White
    Write-Host "3. 创建或更新 /opt/yoyo-transcoder/src/routes/api.js 文件" -ForegroundColor White
    Write-Host "4. 重启PM2服务: pm2 restart vps-transcoder-api" -ForegroundColor White
}

Write-Host "`n🏁 部署脚本执行完成" -ForegroundColor Green
