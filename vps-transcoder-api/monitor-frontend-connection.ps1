# 监控前端建立的代理连接稳定性
param(
    [int]$IntervalSeconds = 30,  # 监控间隔
    [int]$MaxChecks = 200        # 最大检查次数
)

Write-Host "=== 前端代理连接稳定性监控 ===" -ForegroundColor Green
Write-Host "监控间隔: $IntervalSeconds 秒" -ForegroundColor Yellow
Write-Host "最大检查: $MaxChecks 次" -ForegroundColor Yellow
Write-Host "请先通过前端页面建立代理连接，然后按任意键开始监控..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

$count = 1
$connectionStartTime = $null
$lastConnectionStatus = $null
$disconnectionEvents = @()

while ($count -le $MaxChecks) {
    try {
        $currentTime = Get-Date
        Write-Host "`n=== 第 $count 次检查 $($currentTime.ToString('HH:mm:ss')) ===" -ForegroundColor Cyan
        
        # 查询VPS代理状态
        $response = Invoke-RestMethod -Uri "http://142.171.75.220:3000/api/proxy/status" -Method GET -ContentType "application/json"
        
        if ($response.status -eq "success") {
            $data = $response.data
            $currentStatus = $data.connectionStatus
            $currentProxy = $data.currentProxy
            
            # 记录连接开始时间
            if ($currentStatus -eq "connected" -and $connectionStartTime -eq $null) {
                $connectionStartTime = $currentTime
                Write-Host "🟢 检测到连接建立: $currentProxy" -ForegroundColor Green
            }
            
            # 检测状态变化
            if ($lastConnectionStatus -ne $null -and $lastConnectionStatus -ne $currentStatus) {
                $statusChange = @{
                    Time = $currentTime
                    From = $lastConnectionStatus
                    To = $currentStatus
                    Proxy = $currentProxy
                    Check = $count
                }
                
                if ($currentStatus -eq "disconnected") {
                    $disconnectionEvents += $statusChange
                    Write-Host "🔴 连接断开事件!" -ForegroundColor Red
                    Write-Host "   时间: $($currentTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Red
                    Write-Host "   代理: $currentProxy" -ForegroundColor Red
                    if ($connectionStartTime) {
                        $duration = $currentTime - $connectionStartTime
                        Write-Host "   持续时间: $($duration.ToString('hh\:mm\:ss'))" -ForegroundColor Red
                    }
                } else {
                    Write-Host "🟡 状态变化: $lastConnectionStatus -> $currentStatus" -ForegroundColor Yellow
                }
            }
            
            # 显示当前状态
            $statusColor = if($currentStatus -eq "connected") {"Green"} else {"Red"}
            Write-Host "状态: $currentStatus" -ForegroundColor $statusColor
            Write-Host "代理: $currentProxy" -ForegroundColor White
            
            if ($connectionStartTime -and $currentStatus -eq "connected") {
                $uptime = $currentTime - $connectionStartTime
                Write-Host "运行时间: $($uptime.ToString('hh\:mm\:ss'))" -ForegroundColor Green
            }
            
            if ($data.statistics) {
                Write-Host "延迟: $($data.statistics.avgLatency)ms | 成功率: $($data.statistics.successRate)%" -ForegroundColor Gray
            }
            
            $lastConnectionStatus = $currentStatus
            
        } else {
            Write-Host "❌ API调用失败: $($response.status)" -ForegroundColor Red
        }
        
        $count++
        Start-Sleep -Seconds $IntervalSeconds
        
    } catch {
        Write-Host "❌ 网络错误: $($_.Exception.Message)" -ForegroundColor Red
        Start-Sleep -Seconds $IntervalSeconds
    }
}

# 输出监控总结
Write-Host "`n=== 监控总结 ===" -ForegroundColor Green
Write-Host "总检查次数: $($count - 1)" -ForegroundColor White
Write-Host "断开事件数: $($disconnectionEvents.Count)" -ForegroundColor White

if ($disconnectionEvents.Count -gt 0) {
    Write-Host "`n断开事件详情:" -ForegroundColor Red
    foreach ($event in $disconnectionEvents) {
        Write-Host "  - 第$($event.Check)次检查: $($event.Time.ToString('HH:mm:ss')) $($event.From) -> $($event.To)" -ForegroundColor Red
    }
}

if ($connectionStartTime) {
    $totalUptime = (Get-Date) - $connectionStartTime
    Write-Host "总运行时间: $($totalUptime.ToString('hh\:mm\:ss'))" -ForegroundColor Green
}
