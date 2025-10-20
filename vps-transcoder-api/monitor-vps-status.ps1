# 持续监控VPS代理状态
Write-Host "开始监控VPS代理状态..." -ForegroundColor Green
Write-Host "每10秒查询一次，按Ctrl+C停止" -ForegroundColor Yellow

$count = 1
while ($true) {
    try {
        Write-Host "`n=== 第 $count 次检查 $(Get-Date -Format 'HH:mm:ss') ===" -ForegroundColor Cyan
        
        # 查询VPS代理状态
        $response = Invoke-RestMethod -Uri "http://142.171.75.220:3000/api/proxy/status" -Method GET -ContentType "application/json"
        
        if ($response.status -eq "success") {
            $data = $response.data
            Write-Host "连接状态: $($data.connectionStatus)" -ForegroundColor $(if($data.connectionStatus -eq "connected") {"Green"} else {"Red"})
            Write-Host "当前代理: $($data.currentProxy)" -ForegroundColor White
            
            if ($data.statistics) {
                Write-Host "平均延迟: $($data.statistics.avgLatency)ms" -ForegroundColor Gray
                Write-Host "成功率: $($data.statistics.successRate)%" -ForegroundColor Gray
            }
        } else {
            Write-Host "API调用失败: $($response.status)" -ForegroundColor Red
        }
        
        $count++
        Start-Sleep -Seconds 10
        
    } catch {
        Write-Host "网络错误: $($_.Exception.Message)" -ForegroundColor Red
        Start-Sleep -Seconds 10
    }
}
