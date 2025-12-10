# Recording Scheduler Diagnostic Tool
param(
    [string]$VpsUrl = "https://yoyo-vps.your-domain.com",
    [string]$WorkersUrl = "https://yoyoapi.your-domain.com",
    [string]$ApiKey = $env:VPS_API_KEY,
    [string]$ChannelName = "二楼教室1"
)

Write-Host "========================================"  -ForegroundColor Cyan
Write-Host "Recording Scheduler Diagnostic Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not $ApiKey) {
    Write-Host "[ERROR] VPS_API_KEY environment variable not set" -ForegroundColor Red
    exit 1
}

$headers = @{
    "X-API-Key" = $ApiKey
    "Content-Type" = "application/json"
}

# Get Shanghai timezone current time
$shanghaiTime = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "China Standard Time")
$currentTime = $shanghaiTime.ToString("HH:mm")
$currentDate = $shanghaiTime.ToString("yyyy-MM-dd")
$dayOfWeek = $shanghaiTime.DayOfWeek

Write-Host "Current Time (Shanghai): $currentTime" -ForegroundColor Gray
Write-Host "Current Date: $currentDate ($dayOfWeek)" -ForegroundColor Gray
Write-Host ""

# Step 1: Fetch recording configs from Workers API
Write-Host "Step 1: Fetching recording configs from Workers API..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$WorkersUrl/api/record/configs" -Headers $headers -Method Get -TimeoutSec 10
    Write-Host "[OK] Connection successful" -ForegroundColor Green
    Write-Host "Found $($response.data.Count) channels with recording enabled" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "[ERROR] Connection failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Find target channel
Write-Host "Step 2: Finding target channel '$ChannelName'..." -ForegroundColor Yellow
$targetChannel = $response.data | Where-Object { $_.channelName -eq $ChannelName }

if (-not $targetChannel) {
    Write-Host "[ERROR] Channel '$ChannelName' not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Available channels with recording enabled:" -ForegroundColor Yellow
    foreach ($config in $response.data) {
        Write-Host "  - $($config.channelName) [$($config.channelId)]" -ForegroundColor Gray
    }
    exit 1
}

Write-Host "[OK] Target channel found" -ForegroundColor Green
Write-Host "Channel Details:" -ForegroundColor Cyan
Write-Host "  ID: $($targetChannel.channelId)" -ForegroundColor Gray
Write-Host "  Name: $($targetChannel.channelName)" -ForegroundColor Gray
Write-Host "  Recording Time: $($targetChannel.startTime) - $($targetChannel.endTime)" -ForegroundColor Gray
Write-Host "  Workdays Only: $($targetChannel.workdaysOnly)" -ForegroundColor Gray
Write-Host "  Enabled: $($targetChannel.enabled)" -ForegroundColor Gray
Write-Host "  RTMP URL: $($targetChannel.rtmpUrl)" -ForegroundColor Gray
Write-Host ""

# Step 3: Check time range
Write-Host "Step 3: Checking if current time is in recording range..." -ForegroundColor Yellow

$startTime = [DateTime]::ParseExact($targetChannel.startTime, "HH:mm", $null)
$endTime = [DateTime]::ParseExact($targetChannel.endTime, "HH:mm", $null)
$current = [DateTime]::ParseExact($currentTime, "HH:mm", $null)

$currentMins = $current.Hour * 60 + $current.Minute
$startMins = $startTime.Hour * 60 + $startTime.Minute
$endMins = $endTime.Hour * 60 + $endTime.Minute

$inRange = $false
if ($endMins -lt $startMins) {
    # Cross-day case
    $inRange = ($currentMins -ge $startMins) -or ($currentMins -lt $endMins)
} else {
    # Normal case
    $inRange = ($currentMins -ge $startMins) -and ($currentMins -lt $endMins)
}

if ($inRange) {
    Write-Host "[OK] Current time is IN recording range" -ForegroundColor Green
} else {
    Write-Host "[NOT IN RANGE] Current time is NOT in recording range" -ForegroundColor Red
}
Write-Host ""

# Step 4: Check workday status
Write-Host "Step 4: Checking workday status..." -ForegroundColor Yellow
$isWorkday = $true

if ($targetChannel.workdaysOnly) {
    Write-Host "Configuration requires: Workdays only" -ForegroundColor Gray
    
    try {
        $holidayResponse = Invoke-RestMethod -Uri "https://timor.tech/api/holiday/info/$currentDate" -Method Get -TimeoutSec 5
        $isWorkday = ($holidayResponse.type.type -eq 0) -or ($holidayResponse.type.type -eq 3)
        
        if ($isWorkday) {
            Write-Host "[OK] Today is a WORKDAY ($($holidayResponse.type.name))" -ForegroundColor Green
        } else {
            Write-Host "[NOT WORKDAY] Today is NOT a workday ($($holidayResponse.type.name))" -ForegroundColor Red
        }
    } catch {
        Write-Host "[WARN] Cannot query holiday API, using basic check" -ForegroundColor Yellow
        $isWorkday = ($dayOfWeek -ge [DayOfWeek]::Monday) -and ($dayOfWeek -le [DayOfWeek]::Friday)
        
        if ($isWorkday) {
            Write-Host "[OK] Today is a WORKDAY (basic mode)" -ForegroundColor Green
        } else {
            Write-Host "[NOT WORKDAY] Today is NOT a workday (basic mode)" -ForegroundColor Red
        }
    }
} else {
    Write-Host "[INFO] Recording every day, no workday check needed" -ForegroundColor Cyan
}
Write-Host ""

# Step 5: Overall decision
$shouldRecord = $inRange -and ((-not $targetChannel.workdaysOnly) -or $isWorkday)

Write-Host "Step 5: Overall decision..." -ForegroundColor Yellow
if ($shouldRecord) {
    Write-Host "[SHOULD RECORD] All conditions met, recording should start automatically" -ForegroundColor Green
} else {
    Write-Host "[SHOULD NOT RECORD] Conditions not met for recording" -ForegroundColor Red
    if (-not $inRange) {
        Write-Host "  Reason: Current time is not in recording range" -ForegroundColor Red
    }
    if ($targetChannel.workdaysOnly -and -not $isWorkday) {
        Write-Host "  Reason: Today is not a workday" -ForegroundColor Red
    }
}
Write-Host ""

# Step 6: Check VPS current recording status
Write-Host "Step 6: Checking VPS current recording status..." -ForegroundColor Yellow
$recording = $null
try {
    $statusResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/recording/status" -Headers $headers -Method Get -TimeoutSec 10
    
    $recording = $statusResponse.data.channels | Where-Object { $_.channelName -eq $ChannelName }
    
    if ($recording) {
        if ($recording.isRecording) {
            Write-Host "[OK] Channel is currently RECORDING" -ForegroundColor Green
            Write-Host "  Output file: $($recording.outputFile)" -ForegroundColor Gray
            if ($recording.duration) {
                Write-Host "  Duration: $($recording.duration)" -ForegroundColor Gray
            }
        } else {
            Write-Host "[WARN] Channel configured but NOT recording" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[NOT RECORDING] Channel not in recording status" -ForegroundColor Red
    }
} catch {
    Write-Host "[ERROR] Cannot get recording status: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

# Step 7: Check RecordScheduler status
Write-Host "Step 7: Checking RecordScheduler status..." -ForegroundColor Yellow
try {
    $schedulerResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/record/status" -Headers $headers -Method Get -TimeoutSec 10
    
    Write-Host "  Scheduler running: $($schedulerResponse.data.isRunning)" -ForegroundColor Gray
    Write-Host "  Scheduled channels: $($schedulerResponse.data.totalScheduled)" -ForegroundColor Gray
    
    if ($schedulerResponse.data.scheduledChannels -contains $targetChannel.channelId) {
        Write-Host "[OK] Target channel is in scheduler" -ForegroundColor Green
    } else {
        Write-Host "[NOT SCHEDULED] Target channel is NOT in scheduler" -ForegroundColor Red
    }
} catch {
    Write-Host "[ERROR] Cannot get scheduler status: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

# Step 8: Diagnosis and recommendations
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DIAGNOSIS AND RECOMMENDATIONS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($shouldRecord) {
    if ($recording -and $recording.isRecording) {
        Write-Host "[CONCLUSION] Everything is working normally!" -ForegroundColor Green
        Write-Host "Channel is recording as scheduled." -ForegroundColor Green
    } else {
        Write-Host "[PROBLEM] Conditions met but channel is NOT recording!" -ForegroundColor Red
        Write-Host ""
        Write-Host "Possible causes:" -ForegroundColor Yellow
        Write-Host "  1. RecordScheduler failed to initialize after VPS restart" -ForegroundColor Gray
        Write-Host "  2. Failed to fetch config from Workers API during startup" -ForegroundColor Gray
        Write-Host "  3. FFmpeg process failed to start" -ForegroundColor Gray
        Write-Host "  4. WorkdayChecker API failed and fell back to basic mode incorrectly" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Recommended actions:" -ForegroundColor Yellow
        Write-Host "  1. Manually trigger scheduler reload:" -ForegroundColor White
        Write-Host "     curl -X POST $VpsUrl/api/simple-stream/record/reload-schedule \\" -ForegroundColor Cyan
        Write-Host "       -H 'X-API-Key: $ApiKey' \\" -ForegroundColor Cyan
        Write-Host "       -H 'Content-Type: application/json' \\" -ForegroundColor Cyan
        Write-Host "       -d '{\"channelId\":\"$($targetChannel.channelId)\"}'" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  2. Check VPS logs:" -ForegroundColor White
        Write-Host "     ssh root@yoyo-vps 'pm2 logs vps-api --lines 50 --nostream'" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  3. Restart VPS service:" -ForegroundColor White
        Write-Host "     ssh root@yoyo-vps 'pm2 restart vps-api'" -ForegroundColor Cyan
    }
} else {
    Write-Host "[CONCLUSION] Not recording is CORRECT behavior" -ForegroundColor Green
    Write-Host ""
    Write-Host "Recording will start automatically when:" -ForegroundColor White
    Write-Host "  - Time is between: $($targetChannel.startTime) - $($targetChannel.endTime)" -ForegroundColor Gray
    if ($targetChannel.workdaysOnly) {
        Write-Host "  - Day is a workday (Monday-Friday, excluding holidays)" -ForegroundColor Gray
    }
}

Write-Host ""
