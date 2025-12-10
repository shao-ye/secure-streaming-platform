# 手动触发录制调度重载脚本
# 用于VPS重启后录制未自动启动的情况

param(
    [string]$VpsUrl = "https://yoyo-vps.your-domain.com",
    [string]$ApiKey = $env:VPS_API_KEY
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Trigger Recording Scheduler Reload" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

if (-not $ApiKey) {
    Write-Host "[ERROR] VPS_API_KEY environment variable not set" -ForegroundColor Red
    Write-Host "Please set it manually:" -ForegroundColor Yellow
    Write-Host '  $env:VPS_API_KEY = "your-api-key-here"' -ForegroundColor Gray
    exit 1
}

$headers = @{
    "X-API-Key" = $ApiKey
    "Content-Type" = "application/json"
}

# Trigger reload
Write-Host "Triggering RecordScheduler reload..." -ForegroundColor Yellow
Write-Host "URL: $VpsUrl/api/simple-stream/record/reload-schedule" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/record/reload-schedule" `
        -Method Post `
        -Headers $headers `
        -Body (ConvertTo-Json @{}) `
        -TimeoutSec 30
    
    if ($response.status -eq "success") {
        Write-Host "[SUCCESS] RecordScheduler reloaded successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Response:" -ForegroundColor Cyan
        $response | ConvertTo-Json -Depth 5 | Write-Host
        Write-Host ""
        
        # Wait a moment and check status
        Write-Host "Waiting 3 seconds before checking status..." -ForegroundColor Gray
        Start-Sleep -Seconds 3
        
        # Check scheduler status
        Write-Host "Checking scheduler status..." -ForegroundColor Yellow
        $statusResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/record/status" `
            -Method Get `
            -Headers $headers `
            -TimeoutSec 10
        
        Write-Host ""
        Write-Host "Scheduler Status:" -ForegroundColor Cyan
        Write-Host "  Running: $($statusResponse.data.isRunning)" -ForegroundColor Gray
        Write-Host "  Scheduled channels: $($statusResponse.data.totalScheduled)" -ForegroundColor Gray
        
        if ($statusResponse.data.scheduledChannels) {
            Write-Host "  Channels:" -ForegroundColor Gray
            foreach ($channelId in $statusResponse.data.scheduledChannels) {
                Write-Host "    - $channelId" -ForegroundColor Gray
            }
        }
        
        # Check recording status
        Write-Host ""
        Write-Host "Checking recording status..." -ForegroundColor Yellow
        $recordingResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/recording/status" `
            -Method Get `
            -Headers $headers `
            -TimeoutSec 10
        
        Write-Host ""
        Write-Host "Recording Status:" -ForegroundColor Cyan
        Write-Host "  Total channels: $($recordingResponse.data.totalChannels)" -ForegroundColor Gray
        Write-Host "  Recording now: $($recordingResponse.data.recordingCount)" -ForegroundColor Gray
        
        if ($recordingResponse.data.channels) {
            Write-Host ""
            Write-Host "Channels:" -ForegroundColor Cyan
            foreach ($channel in $recordingResponse.data.channels) {
                $status = if ($channel.isRecording) { "[RECORDING]" } else { "[NOT RECORDING]" }
                $color = if ($channel.isRecording) { "Green" } else { "Gray" }
                Write-Host "  $status $($channel.channelName)" -ForegroundColor $color
                if ($channel.isRecording) {
                    Write-Host "    File: $($channel.outputFile)" -ForegroundColor Gray
                }
            }
        }
        
    } else {
        Write-Host "[ERROR] Reload failed: $($response.message)" -ForegroundColor Red
    }
    
} catch {
    Write-Host "[ERROR] Request failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Possible causes:" -ForegroundColor Yellow
    Write-Host "  1. VPS service is not running" -ForegroundColor Gray
    Write-Host "  2. API key is incorrect" -ForegroundColor Gray
    Write-Host "  3. Network connection issue" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Try checking VPS status:" -ForegroundColor Yellow
    Write-Host "  ssh root@yoyo-vps 'pm2 status'" -ForegroundColor Cyan
    exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
