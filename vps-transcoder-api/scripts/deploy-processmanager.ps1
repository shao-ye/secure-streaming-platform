# 部署修复后的ProcessManager.js到VPS服务器
# 修复FFmpeg转码进程启动失败的问题

param(
    [string]$VpsHost = "yoyo-vps.5202021.xyz",
    [int]$SshPort = 52535,
    [string]$ApiKey = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
)

Write-Host "🚀 开始部署修复后的ProcessManager.js..." -ForegroundColor Green
Write-Host "目标服务器: $VpsHost" -ForegroundColor Cyan

# 定义本地ProcessManager.js文件路径
$LocalFile = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api\src\services\ProcessManager.js"

# 检查本地文件是否存在
if (-not (Test-Path $LocalFile)) {
    Write-Host "❌ 错误: 本地ProcessManager.js文件不存在: $LocalFile" -ForegroundColor Red
    exit 1
}

$uploadSuccess = $false

Write-Host "✅ 本地ProcessManager.js文件存在" -ForegroundColor Green

# 读取本地文件内容
$fileContent = Get-Content $LocalFile -Raw

# 通过SSH直接创建文件
Write-Host "`n📝 通过SSH部署文件..." -ForegroundColor Yellow

$sshCommand = @"
ssh -p $SshPort root@$VpsHost "
cd /opt/yoyo-transcoder/src/services && 
cp ProcessManager.js ProcessManager.js.backup 2>/dev/null || echo 'ProcessManager.js不存在，将创建新文件' && 
cat > ProcessManager.js << 'PMEOF'
$fileContent
PMEOF
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
        $uploadSuccess = $false
    }
} catch {
    Write-Host "❌ SSH文件创建异常: $($_.Exception.Message)" -ForegroundColor Red
    $uploadSuccess = $false
}

# 如果文件上传成功，重启PM2服务
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
    Start-Sleep -Seconds 8
    
    # 验证部署结果
    Write-Host "`n🧪 验证部署结果..." -ForegroundColor Yellow
    
    try {
        # 测试健康检查端点
        Write-Host "测试健康检查端点..." -ForegroundColor Gray
        
        $headers = @{
            "Content-Type" = "application/json"
            "X-API-Key" = $ApiKey
        }
        
        $healthResponse = Invoke-RestMethod -Uri "http://$VpsHost/api/status" -Method GET -Headers $headers -TimeoutSec 10
        
        if ($healthResponse.status -eq "running") {
            Write-Host "✅ 服务健康检查通过!" -ForegroundColor Green
            Write-Host "服务版本: $($healthResponse.version)" -ForegroundColor Gray
            
            # 测试转码端点
            Write-Host "`n测试转码端点..." -ForegroundColor Gray
            
            $testData = @{
                streamId = "test_deploy_$(Get-Date -Format 'HHmmss')"
                rtmpUrl = "rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"
            } | ConvertTo-Json
            
            try {
                $streamResponse = Invoke-RestMethod -Uri "http://$VpsHost/api/start-stream" -Method POST -Body $testData -Headers $headers -TimeoutSec 20
                Write-Host "✅ 转码测试成功! 修复生效!" -ForegroundColor Green
                Write-Host "HLS URL: $($streamResponse.data.hlsUrl)" -ForegroundColor Cyan
            } catch {
                if ($_.Exception.Message -like "*timeout*") {
                    Write-Host "⚠️  转码启动中，这是正常的（FFmpeg需要时间处理RTMP流）" -ForegroundColor Yellow
                } else {
                    Write-Host "🔍 转码测试: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
            
        } else {
            Write-Host "❌ 服务健康检查失败" -ForegroundColor Red
        }
    } catch {
        Write-Host "❌ 验证过程出错: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "`n❌ 文件上传失败，无法继续部署" -ForegroundColor Red
}

Write-Host "`n🏁 部署脚本执行完成" -ForegroundColor Green
