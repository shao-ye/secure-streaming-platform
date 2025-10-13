# 简化版完整流程测试
Write-Host "Complete Flow Test - Proxy Testing and R2 Storage" -ForegroundColor Green

# 需要手动设置token
$authToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzI4ODA0MzUyLCJleHAiOjE3Mjg4OTA3NTJ9.mYSMJvVfKJCNJhJhUdOJGHdKJGHdKJGHdKJGHdKJGHd"

if (-not $authToken) {
    Write-Host "Need auth token" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $authToken"
    "Content-Type" = "application/json"
}

Write-Host "`nStep 1: Get proxy config" -ForegroundColor Yellow
try {
    $proxyConfig = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/config" -Method GET -Headers $headers -TimeoutSec 10
    $proxies = $proxyConfig.data.proxies
    Write-Host "Found $($proxies.Count) proxies" -ForegroundColor Green
    
    if ($proxies.Count -eq 0) {
        Write-Host "No proxies found" -ForegroundColor Red
        exit 1
    }
    
    $testProxy = $proxies[0]
    Write-Host "Testing proxy: $($testProxy.name)" -ForegroundColor Gray
    
    Write-Host "`nStep 2: Execute proxy test" -ForegroundColor Yellow
    $testData = @{
        id = $testProxy.id
        name = $testProxy.name
        type = $testProxy.type
        config = $testProxy.config
        testUrlId = "baidu"
    } | ConvertTo-Json -Depth 10
    
    $testResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test" -Method POST -Headers $headers -Body $testData -TimeoutSec 20
    
    Write-Host "Test completed: success=$($testResult.data.success), latency=$($testResult.data.latency)ms" -ForegroundColor Green
    
    Write-Host "`nStep 3: Wait for R2 storage" -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    Write-Host "`nStep 4: Read history" -ForegroundColor Yellow
    $historyResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/$($testProxy.id)" -Method GET -Headers $headers -TimeoutSec 10
    
    $history = $historyResult.data
    if ($history -and $history.Count -gt 0) {
        $latest = $history[0]
        Write-Host "Found history: latency=$($latest.latency)ms, time=$($latest.timestamp)" -ForegroundColor Green
        
        if ($latest.latency -eq $testResult.data.latency) {
            Write-Host "R2 data matches test result!" -ForegroundColor Green
        } else {
            Write-Host "R2 data mismatch: test=$($testResult.data.latency), stored=$($latest.latency)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "No history found in R2!" -ForegroundColor Red
    }
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nTest completed" -ForegroundColor Cyan
