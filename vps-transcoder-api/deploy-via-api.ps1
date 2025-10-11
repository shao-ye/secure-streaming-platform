# 通过API接口自动部署代理流媒体功能
# 无需SSH连接，通过HTTP API完成所有操作

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  API自动部署代理流媒体功能" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 配置
$VPS_API_URL = "https://yoyo-vps.5202021.xyz"
$DEPLOYMENT_API = "$VPS_API_URL/api/deployment"

# 通用API调用函数
function Invoke-VpsApi {
    param(
        [string]$Endpoint,
        [string]$Method = "GET",
        [object]$Body = $null,
        [int]$TimeoutSec = 30
    )
    
    try {
        $params = @{
            Uri = "$DEPLOYMENT_API$Endpoint"
            Method = $Method
            TimeoutSec = $TimeoutSec
            Headers = @{
                'Content-Type' = 'application/json'
                'User-Agent' = 'YOYO-Deployment-Client/1.0'
            }
        }
        
        if ($Body -and $Method -ne "GET") {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-RestMethod @params
        return @{
            Success = $true
            Data = $response
        }
    } catch {
        return @{
            Success = $false
            Error = $_.Exception.Message
            StatusCode = $_.Exception.Response.StatusCode.value__
        }
    }
}

# 显示步骤状态
function Show-StepResult {
    param(
        [string]$StepName,
        [object]$Result,
        [bool]$ShowDetails = $false
    )
    
    if ($Result.Success) {
        Write-Host "  ✓ $StepName" -ForegroundColor Green
        if ($ShowDetails -and $Result.Data.message) {
            Write-Host "    $($Result.Data.message)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ✗ $StepName" -ForegroundColor Red
        Write-Host "    错误: $($Result.Error)" -ForegroundColor Red
    }
    
    return $Result.Success
}

# 等待用户确认
function Wait-UserConfirmation {
    param([string]$Message)
    
    Write-Host ""
    Write-Host $Message -ForegroundColor Yellow
    $response = Read-Host "是否继续？(y/n)"
    return ($response -eq 'y' -or $response -eq 'Y')
}

Write-Host "🚀 开始API自动部署流程..." -ForegroundColor Green
Write-Host ""

# 步骤1: 检查VPS基础服务
Write-Host "[1] 检查VPS基础服务状态..." -ForegroundColor Yellow
try {
    $healthCheck = Invoke-RestMethod -Uri "$VPS_API_URL/health" -Method GET -TimeoutSec 10
    Write-Host "  ✓ VPS基础服务正常" -ForegroundColor Green
    Write-Host "    版本: $($healthCheck.version)" -ForegroundColor Gray
    Write-Host "    环境: $($healthCheck.environment)" -ForegroundColor Gray
    Write-Host "    运行时间: $([math]::Round($healthCheck.uptime / 3600, 2))小时" -ForegroundColor Gray
} catch {
    Write-Host "  ✗ VPS基础服务检查失败: $_" -ForegroundColor Red
    Write-Host "请检查VPS服务是否正常运行" -ForegroundColor Yellow
    exit 1
}

# 步骤2: 检查部署API可用性
Write-Host ""
Write-Host "[2] 检查部署API可用性..." -ForegroundColor Yellow
$statusResult = Invoke-VpsApi -Endpoint "/status" -TimeoutSec 15
if (-not (Show-StepResult "部署API连接" $statusResult)) {
    Write-Host "部署API不可用，请确认VPS上已部署最新代码" -ForegroundColor Red
    exit 1
}

# 步骤3: 检查Git仓库状态
Write-Host ""
Write-Host "[3] 检查Git仓库状态..." -ForegroundColor Yellow
$gitStatusResult = Invoke-VpsApi -Endpoint "/git/status"
$gitOk = Show-StepResult "Git仓库状态" $gitStatusResult $true

if ($gitOk -and $gitStatusResult.Data.data.exists) {
    Write-Host "    Git目录: $($gitStatusResult.Data.data.gitDir)" -ForegroundColor Gray
    Write-Host "    当前分支: $($gitStatusResult.Data.data.branch)" -ForegroundColor Gray
    Write-Host "    当前提交: $($gitStatusResult.Data.data.commit)" -ForegroundColor Gray
}

# 步骤4: 拉取最新代码
Write-Host ""
Write-Host "[4] 拉取最新代码..." -ForegroundColor Yellow
$pullResult = Invoke-VpsApi -Endpoint "/git/pull" -Method "POST" -TimeoutSec 60
$pullOk = Show-StepResult "代码拉取" $pullResult $true

if ($pullOk -and $pullResult.Data.data.hasUpdates) {
    Write-Host "    代码已更新: $($pullResult.Data.data.beforeCommit) → $($pullResult.Data.data.afterCommit)" -ForegroundColor Green
} elseif ($pullOk) {
    Write-Host "    代码已是最新版本" -ForegroundColor Gray
}

# 步骤5: 同步代码到运行目录
Write-Host ""
Write-Host "[5] 同步代码到运行目录..." -ForegroundColor Yellow
$syncResult = Invoke-VpsApi -Endpoint "/sync/code" -Method "POST" -TimeoutSec 30
$syncOk = Show-StepResult "代码同步" $syncResult $true

# 步骤6: 执行代理流媒体集成脚本
Write-Host ""
Write-Host "[6] 执行代理流媒体集成脚本..." -ForegroundColor Yellow

if (-not (Wait-UserConfirmation "即将执行代理流媒体集成脚本，这将配置透明代理规则和FFmpeg环境变量")) {
    Write-Host "用户取消操作" -ForegroundColor Yellow
    exit 0
}

$scriptBody = @{
    scriptName = "integrate-proxy-streaming.sh"
    timeout = 300000  # 5分钟超时
}

$scriptResult = Invoke-VpsApi -Endpoint "/execute/script" -Method "POST" -Body $scriptBody -TimeoutSec 320
$scriptOk = Show-StepResult "脚本执行" $scriptResult

if ($scriptOk) {
    Write-Host "    脚本输出:" -ForegroundColor Gray
    if ($scriptResult.Data.data.stdout) {
        $scriptResult.Data.data.stdout -split "`n" | ForEach-Object {
            if ($_.Trim()) {
                Write-Host "      $_" -ForegroundColor White
            }
        }
    }
    if ($scriptResult.Data.data.stderr) {
        Write-Host "    错误输出:" -ForegroundColor Yellow
        $scriptResult.Data.data.stderr -split "`n" | ForEach-Object {
            if ($_.Trim()) {
                Write-Host "      $_" -ForegroundColor Yellow
            }
        }
    }
} else {
    Write-Host "脚本执行失败，查看详细错误信息:" -ForegroundColor Red
    if ($scriptResult.Data.data.error) {
        Write-Host "  错误: $($scriptResult.Data.data.error)" -ForegroundColor Red
    }
}

# 步骤7: 重启PM2服务
Write-Host ""
Write-Host "[7] 重启PM2服务..." -ForegroundColor Yellow
$restartBody = @{
    serviceName = "vps-transcoder-api"
}

$restartResult = Invoke-VpsApi -Endpoint "/pm2/restart" -Method "POST" -Body $restartBody -TimeoutSec 30
$restartOk = Show-StepResult "PM2服务重启" $restartResult $true

# 步骤8: 等待服务启动并验证
Write-Host ""
Write-Host "[8] 等待服务启动并验证..." -ForegroundColor Yellow
Write-Host "等待10秒让服务完全启动..." -ForegroundColor Gray
Start-Sleep -Seconds 10

# 验证基础服务
try {
    $healthCheck = Invoke-RestMethod -Uri "$VPS_API_URL/health" -Method GET -TimeoutSec 10
    Write-Host "  ✓ VPS基础服务正常" -ForegroundColor Green
} catch {
    Write-Host "  ✗ VPS基础服务检查失败" -ForegroundColor Red
}

# 验证代理服务
try {
    $proxyStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "  ✓ 代理服务API正常" -ForegroundColor Green
    Write-Host "    连接状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor Gray
    Write-Host "    当前代理: $($proxyStatus.data.currentProxy)" -ForegroundColor Gray
} catch {
    Write-Host "  ✗ 代理服务API检查失败" -ForegroundColor Red
}

# 验证流媒体服务
try {
    $streamStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/simple-stream/system/status" -Method GET -TimeoutSec 10
    Write-Host "  ✓ 流媒体服务正常" -ForegroundColor Green
    Write-Host "    活跃流: $($streamStatus.data.activeStreams)" -ForegroundColor Gray
} catch {
    Write-Host "  ✗ 流媒体服务检查失败" -ForegroundColor Red
}

# 部署结果总结
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署结果总结" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allStepsOk = $gitOk -and $pullOk -and $syncOk -and $scriptOk -and $restartOk

if ($allStepsOk) {
    Write-Host "🎉 代理流媒体集成部署成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "✅ 已完成的功能:" -ForegroundColor Green
    Write-Host "  - 代理流媒体集成已部署" -ForegroundColor White
    Write-Host "  - 透明代理规则自动管理" -ForegroundColor White
    Write-Host "  - FFmpeg进程代理环境变量" -ForegroundColor White
    Write-Host "  - 代理状态实时监控" -ForegroundColor White
    Write-Host ""
    Write-Host "📋 下一步操作:" -ForegroundColor Yellow
    Write-Host "1. 访问管理后台开启代理功能" -ForegroundColor White
    Write-Host "2. 选择并激活jp或us代理" -ForegroundColor White
    Write-Host "3. 播放视频测试代理传输效果" -ForegroundColor White
    Write-Host "4. 观察网络流量是否通过代理" -ForegroundColor White
    
} else {
    Write-Host "❌ 部署过程中出现错误" -ForegroundColor Red
    Write-Host ""
    Write-Host "请检查以下问题:" -ForegroundColor Yellow
    if (-not $gitOk) { Write-Host "  - Git仓库访问问题" -ForegroundColor Red }
    if (-not $pullOk) { Write-Host "  - 代码拉取失败" -ForegroundColor Red }
    if (-not $syncOk) { Write-Host "  - 代码同步失败" -ForegroundColor Red }
    if (-not $scriptOk) { Write-Host "  - 脚本执行失败" -ForegroundColor Red }
    if (-not $restartOk) { Write-Host "  - 服务重启失败" -ForegroundColor Red }
    Write-Host ""
    Write-Host "建议操作:" -ForegroundColor Yellow
    Write-Host "1. 检查VPS服务日志" -ForegroundColor White
    Write-Host "2. 手动SSH到VPS排查问题" -ForegroundColor White
    Write-Host "3. 重新运行此部署脚本" -ForegroundColor White
}

Write-Host ""
Write-Host "🔍 监控地址:" -ForegroundColor Cyan
Write-Host "- VPS健康状态: $VPS_API_URL/health" -ForegroundColor White
Write-Host "- 代理服务状态: $VPS_API_URL/api/proxy/status" -ForegroundColor White
Write-Host "- 流媒体状态: $VPS_API_URL/api/simple-stream/system/status" -ForegroundColor White
Write-Host "- 部署API状态: $VPS_API_URL/api/deployment/status" -ForegroundColor White
Write-Host ""

Write-Host "部署完成！" -ForegroundColor Green
