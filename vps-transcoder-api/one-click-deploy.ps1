# 一键部署代理流媒体功能
# 使用VPS部署API，无需SSH连接

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  一键部署代理流媒体功能" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 配置
$VPS_API_URL = "https://yoyo-vps.5202021.xyz"
$DEPLOYMENT_API = "$VPS_API_URL/api/deployment"

Write-Host "🎯 部署方案说明:" -ForegroundColor Yellow
Write-Host "1. ✅ 通过HTTP API自动部署，无需SSH连接" -ForegroundColor Green
Write-Host "2. ✅ 自动拉取Git最新代码" -ForegroundColor Green
Write-Host "3. ✅ 自动同步代码到VPS运行目录" -ForegroundColor Green
Write-Host "4. ✅ 自动执行代理流媒体集成脚本" -ForegroundColor Green
Write-Host "5. ✅ 自动重启服务并验证结果" -ForegroundColor Green
Write-Host ""

Write-Host "📋 功能特性:" -ForegroundColor Yellow
Write-Host "- 透明代理规则自动管理 (iptables)" -ForegroundColor White
Write-Host "- FFmpeg进程代理环境变量配置" -ForegroundColor White
Write-Host "- 代理状态实时监控服务" -ForegroundColor White
Write-Host "- 视频流通过代理传输" -ForegroundColor White
Write-Host ""

Write-Host "⚠️ 重要说明:" -ForegroundColor Yellow
Write-Host "- 此操作将修改VPS网络配置 (iptables规则)" -ForegroundColor Red
Write-Host "- 将重启PM2服务，可能短暂影响现有连接" -ForegroundColor Red
Write-Host "- 建议在维护时间窗口执行" -ForegroundColor Red
Write-Host ""

# 用户确认
$response = Read-Host "确认开始一键部署？(y/n)"
if ($response -ne 'y' -and $response -ne 'Y') {
    Write-Host "用户取消部署" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "🚀 开始一键部署..." -ForegroundColor Green
Write-Host ""

# 调用一键部署API
try {
    Write-Host "正在执行一键部署流程，请稍候..." -ForegroundColor Yellow
    Write-Host "预计需要2-5分钟完成..." -ForegroundColor Gray
    Write-Host ""
    
    $deployBody = @{
        scriptName = "integrate-proxy-streaming.sh"
    }
    
    $response = Invoke-RestMethod -Uri "$DEPLOYMENT_API/deploy/complete" -Method POST -Body ($deployBody | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 400
    
    if ($response.success) {
        Write-Host "🎉 一键部署成功！" -ForegroundColor Green
        Write-Host ""
        
        # 显示部署步骤结果
        Write-Host "📊 部署步骤详情:" -ForegroundColor Cyan
        $stepIndex = 1
        foreach ($step in $response.data.deploymentSteps) {
            $status = if ($step.success) { "✅" } else { "❌" }
            $stepName = switch ($step.step) {
                "git_pull" { "拉取最新代码" }
                "sync_code" { "同步代码文件" }
                "execute_script" { "执行集成脚本" }
                "pm2_restart" { "重启PM2服务" }
                "verification" { "验证部署结果" }
                default { $step.step }
            }
            Write-Host "  $stepIndex. $status $stepName" -ForegroundColor $(if ($step.success) { "Green" } else { "Red" })
            $stepIndex++
        }
        
        Write-Host ""
        Write-Host "📈 部署统计:" -ForegroundColor Cyan
        Write-Host "  总步骤: $($response.data.totalSteps)" -ForegroundColor White
        Write-Host "  成功步骤: $($response.data.successSteps)" -ForegroundColor Green
        Write-Host "  完成时间: $($response.data.timestamp)" -ForegroundColor Gray
        
    } else {
        Write-Host "❌ 一键部署失败" -ForegroundColor Red
        Write-Host ""
        Write-Host "失败步骤详情:" -ForegroundColor Yellow
        foreach ($step in $response.data.deploymentSteps) {
            if (-not $step.success) {
                Write-Host "  ❌ $($step.step): $($step.error)" -ForegroundColor Red
            }
        }
    }
    
} catch {
    Write-Host "❌ 部署API调用失败: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "可能的原因:" -ForegroundColor Yellow
    Write-Host "1. VPS服务未启动或不可访问" -ForegroundColor White
    Write-Host "2. 部署API未正确配置" -ForegroundColor White
    Write-Host "3. 网络连接问题" -ForegroundColor White
    Write-Host ""
    Write-Host "建议操作:" -ForegroundColor Yellow
    Write-Host "1. 检查VPS服务状态: $VPS_API_URL/health" -ForegroundColor White
    Write-Host "2. 使用详细部署脚本: .\deploy-via-api.ps1" -ForegroundColor White
    Write-Host "3. 手动SSH到VPS进行排查" -ForegroundColor White
    exit 1
}

# 等待服务完全启动
Write-Host ""
Write-Host "⏳ 等待服务完全启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# 验证部署结果
Write-Host ""
Write-Host "🔍 验证部署结果..." -ForegroundColor Yellow

$allServicesOk = $true

# 检查基础服务
try {
    $healthCheck = Invoke-RestMethod -Uri "$VPS_API_URL/health" -Method GET -TimeoutSec 10
    Write-Host "  ✅ VPS基础服务正常 (版本: $($healthCheck.version))" -ForegroundColor Green
} catch {
    Write-Host "  ❌ VPS基础服务异常" -ForegroundColor Red
    $allServicesOk = $false
}

# 检查代理服务
try {
    $proxyStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "  ✅ 代理服务正常 (状态: $($proxyStatus.data.connectionStatus))" -ForegroundColor Green
    
    if ($proxyStatus.data.connectionStatus -eq "connected") {
        Write-Host "    🎯 代理已连接，视频流将通过代理传输" -ForegroundColor Green
    } else {
        Write-Host "    ⚠️ 代理未连接，请在管理后台激活代理" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ 代理服务异常" -ForegroundColor Red
    $allServicesOk = $false
}

# 检查流媒体服务
try {
    $streamStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/simple-stream/system/status" -Method GET -TimeoutSec 10
    Write-Host "  ✅ 流媒体服务正常 (活跃流: $($streamStatus.data.activeStreams))" -ForegroundColor Green
} catch {
    Write-Host "  ❌ 流媒体服务异常" -ForegroundColor Red
    $allServicesOk = $false
}

# 最终结果
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($allServicesOk) {
    Write-Host "🎉 代理流媒体功能部署成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "✨ 新增功能:" -ForegroundColor Green
    Write-Host "  ✅ 视频流通过代理传输" -ForegroundColor White
    Write-Host "  ✅ 透明代理规则自动管理" -ForegroundColor White
    Write-Host "  ✅ FFmpeg代理环境变量配置" -ForegroundColor White
    Write-Host "  ✅ 代理状态实时监控" -ForegroundColor White
    Write-Host ""
    Write-Host "📋 使用说明:" -ForegroundColor Yellow
    Write-Host "1. 访问管理后台: https://yoyo.5202021.xyz" -ForegroundColor Cyan
    Write-Host "2. 进入代理配置页面" -ForegroundColor White
    Write-Host "3. 开启代理功能总开关" -ForegroundColor White
    Write-Host "4. 选择并激活jp或us代理" -ForegroundColor White
    Write-Host "5. 播放视频测试代理效果" -ForegroundColor White
    Write-Host ""
    Write-Host "🔍 监控地址:" -ForegroundColor Yellow
    Write-Host "- 代理状态: $VPS_API_URL/api/proxy/status" -ForegroundColor Cyan
    Write-Host "- 流媒体状态: $VPS_API_URL/api/simple-stream/system/status" -ForegroundColor Cyan
    Write-Host "- 系统健康: $VPS_API_URL/health" -ForegroundColor Cyan
    
} else {
    Write-Host "⚠️ 部署完成但部分服务异常" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "建议操作:" -ForegroundColor Yellow
    Write-Host "1. 等待1-2分钟让服务完全启动" -ForegroundColor White
    Write-Host "2. 重新运行验证: .\verify-proxy-streaming.ps1" -ForegroundColor White
    Write-Host "3. 查看VPS服务日志排查问题" -ForegroundColor White
    Write-Host "4. 如问题持续，请联系技术支持" -ForegroundColor White
}

Write-Host ""
Write-Host "部署流程结束！" -ForegroundColor Green
