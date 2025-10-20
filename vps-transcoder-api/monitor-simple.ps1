# 简单的VPS状态监控脚本
Write-Host "开始监控VPS代理状态..." -ForegroundColor Green
Write-Host "每5秒查询一次，按Ctrl+C停止" -ForegroundColor Yellow

$count = 1
while ($true) {
    try {
        $currentTime = Get-Date -Format 'HH:mm:ss'
        Write-Host "`n=== 第 $count 次检查 $currentTime ===" -ForegroundColor Cyan
        
        # 查询VPS代理状态
        $response = Invoke-RestMethod -Uri "http://142.171.75.220:3000/api/proxy/status" -Method GET
        
        if ($response.status -eq "success") {
            $data = $response.data
            $status = $data.connectionStatus
            $proxy = $data.currentProxy
            
            if ($status -eq "connected") {
                Write-Host "🟢 状态: $status" -ForegroundColor Green
                Write-Host "🔗 代理: $proxy" -ForegroundColor Green
                if ($data.statistics) {
                    Write-Host "📊 延迟: $($data.statistics.avgLatency)ms | 成功率: $($data.statistics.successRate)%" -ForegroundColor Gray
                }
            } else {
                Write-Host "🔴 状态: $status" -ForegroundColor Red
            }
        } else {
            Write-Host "❌ API调用失败" -ForegroundColor Red
        }
        
        $count++
        Start-Sleep -Seconds 5
        
    } catch {
        Write-Host "❌ 错误: $($_.Exception.Message)" -ForegroundColor Red
        Start-Sleep -Seconds 5
    }
}
