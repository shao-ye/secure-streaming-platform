# 录制调度器诊断脚本 - 简化版
param(
    [string]$VpsUrl = "https://yoyo-vps.your-domain.com",
    [string]$WorkersUrl = "https://yoyoapi.your-domain.com",
    [string]$ApiKey = $env:VPS_API_KEY,
    [string]$ChannelName = "二楼教室1"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "录制调度器诊断工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not $ApiKey) {
    Write-Host "[ERROR] 未设置 VPS_API_KEY 环境变量" -ForegroundColor Red
    exit 1
}

$headers = @{
    "X-API-Key" = $ApiKey
    "Content-Type" = "application/json"
}

# 获取上海时区的当前时间
$shanghaiTime = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "China Standard Time")
$currentTime = $shanghaiTime.ToString("HH:mm")
$currentDate = $shanghaiTime.ToString("yyyy-MM-dd")

Write-Host "当前时间 (上海): $currentTime" -ForegroundColor Gray
Write-Host ""

# 1. 检查Workers API获取录制配置
Write-Host "步骤 1: 从 Workers API 获取录制配置..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$WorkersUrl/api/record/configs" -Headers $headers -Method Get -TimeoutSec 10
    Write-Host "[OK] 连接成功" -ForegroundColor Green
    Write-Host "获取到 $($response.data.Count) 个启用录制的频道" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "[ERROR] 连接失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 2. 查找目标频道
Write-Host "步骤 2: 查找目标频道 '$ChannelName'..." -ForegroundColor Yellow
$targetChannel = $response.data | Where-Object { $_.channelName -eq $ChannelName }

if (-not $targetChannel) {
    Write-Host "[ERROR] 未找到频道 '$ChannelName'" -ForegroundColor Red
    Write-Host ""
    Write-Host "当前启用录制的频道列表:" -ForegroundColor Yellow
    foreach ($config in $response.data) {
        Write-Host "  - $($config.channelName) [$($config.channelId)]" -ForegroundColor Gray
    }
    exit 1
}

Write-Host "[OK] 找到目标频道" -ForegroundColor Green
Write-Host "配置详情:" -ForegroundColor Cyan
Write-Host "  频道ID: $($targetChannel.channelId)" -ForegroundColor Gray
Write-Host "  录制时间: $($targetChannel.startTime) - $($targetChannel.endTime)" -ForegroundColor Gray
Write-Host "  仅工作日: $($targetChannel.workdaysOnly)" -ForegroundColor Gray
Write-Host "  RTMP URL: $($targetChannel.rtmpUrl)" -ForegroundColor Gray
Write-Host ""

# 3. 检查时间范围
Write-Host "步骤 3: 检查当前时间是否在录制范围内..." -ForegroundColor Yellow

$startTime = [DateTime]::ParseExact($targetChannel.startTime, "HH:mm", $null)
$endTime = [DateTime]::ParseExact($targetChannel.endTime, "HH:mm", $null)
$current = [DateTime]::ParseExact($currentTime, "HH:mm", $null)

$currentMins = $current.Hour * 60 + $current.Minute
$startMins = $startTime.Hour * 60 + $startTime.Minute
$endMins = $endTime.Hour * 60 + $endTime.Minute

$inRange = $false
if ($endMins -lt $startMins) {
    $inRange = ($currentMins -ge $startMins) -or ($currentMins -lt $endMins)
} else {
    $inRange = ($currentMins -ge $startMins) -and ($currentMins -lt $endMins)
}

if ($inRange) {
    Write-Host "[OK] 当前时间在录制范围内" -ForegroundColor Green
} else {
    Write-Host "[NOT IN RANGE] 当前时间不在录制范围内" -ForegroundColor Red
}
Write-Host ""

# 4. 检查工作日
Write-Host "步骤 4: 检查工作日状态..." -ForegroundColor Yellow
if ($targetChannel.workdaysOnly) {
    Write-Host "配置要求: 仅工作日录制" -ForegroundColor Gray
    
    try {
        $holidayResponse = Invoke-RestMethod -Uri "https://timor.tech/api/holiday/info/$currentDate" -Method Get -TimeoutSec 5
        $isWorkday = ($holidayResponse.type.type -eq 0) -or ($holidayResponse.type.type -eq 3)
        
        if ($isWorkday) {
            Write-Host "[OK] 今天是工作日 ($($holidayResponse.type.name))" -ForegroundColor Green
        } else {
            Write-Host "[NOT WORKDAY] 今天不是工作日 ($($holidayResponse.type.name))" -ForegroundColor Red
        }
    } catch {
        Write-Host "[WARN] 无法查询工作日API, 使用基础判断" -ForegroundColor Yellow
        $dayOfWeek = $shanghaiTime.DayOfWeek
        $isWorkday = ($dayOfWeek -ge [DayOfWeek]::Monday) -and ($dayOfWeek -le [DayOfWeek]::Friday)
        
        if ($isWorkday) {
            Write-Host "[OK] 今天是工作日 (基础模式)" -ForegroundColor Green
        } else {
            Write-Host "[NOT WORKDAY] 今天不是工作日 (基础模式)" -ForegroundColor Red
        }
    }
} else {
    Write-Host "[INFO] 配置为每日录制, 无需检查工作日" -ForegroundColor Cyan
    $isWorkday = $true
}
Write-Host ""

# 5. 综合判断
$shouldRecord = $inRange -and ((-not $targetChannel.workdaysOnly) -or $isWorkday)

Write-Host "步骤 5: 综合判断..." -ForegroundColor Yellow
if ($shouldRecord) {
    Write-Host "[OK] 符合所有条件, 应该自动开始录制" -ForegroundColor Green
} else {
    Write-Host "[NOT QUALIFIED] 不符合录制条件" -ForegroundColor Red
    if (-not $inRange) {
        Write-Host "  原因: 当前时间不在录制范围内" -ForegroundColor Red
    }
    if ($targetChannel.workdaysOnly -and -not $isWorkday) {
        Write-Host "  原因: 今天不是工作日" -ForegroundColor Red
    }
}
Write-Host ""

# 6. 检查VPS当前状态
Write-Host "步骤 6: 检查 VPS 当前录制状态..." -ForegroundColor Yellow
try {
    $statusResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/recording/status" -Headers $headers -Method Get -TimeoutSec 10
    
    $recording = $statusResponse.data.channels | Where-Object { $_.channelName -eq $ChannelName }
    
    if ($recording) {
        if ($recording.isRecording) {
            Write-Host "[OK] 频道正在录制中" -ForegroundColor Green
            Write-Host "  录制文件: $($recording.outputFile)" -ForegroundColor Gray
        } else {
            Write-Host "[WARN] 频道已配置但未在录制" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[NOT RECORDING] 频道未在录制状态中" -ForegroundColor Red
    }
} catch {
    Write-Host "[ERROR] 无法获取录制状态: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

# 7. 检查调度器状态
Write-Host "步骤 7: 检查 RecordScheduler 调度器..." -ForegroundColor Yellow
try {
    $schedulerResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/record/status" -Headers $headers -Method Get -TimeoutSec 10
    
    Write-Host "  调度器运行: $($schedulerResponse.data.isRunning)" -ForegroundColor Gray
    Write-Host "  已调度频道数: $($schedulerResponse.data.totalScheduled)" -ForegroundColor Gray
    
    if ($schedulerResponse.data.scheduledChannels -contains $targetChannel.channelId) {
        Write-Host "[OK] 目标频道已添加到调度器" -ForegroundColor Green
    } else {
        Write-Host "[NOT SCHEDULED] 目标频道未在调度器中" -ForegroundColor Red
    }
} catch {
    Write-Host "[ERROR] 无法获取调度器状态: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

# 8. 建议操作
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "诊断结果和建议:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($shouldRecord) {
    if ($recording -and $recording.isRecording) {
        Write-Host "[结论] 一切正常, 频道正在按计划录制" -ForegroundColor Green
    } else {
        Write-Host "[问题] 符合录制条件但未在录制!" -ForegroundColor Red
        Write-Host ""
        Write-Host "可能原因:" -ForegroundColor Yellow
        Write-Host "  1. VPS重启后RecordScheduler未正确初始化" -ForegroundColor Gray
        Write-Host "  2. 从Workers获取配置时失败" -ForegroundColor Gray
        Write-Host "  3. FFmpeg进程启动失败" -ForegroundColor Gray
        Write-Host ""
        Write-Host "建议操作:" -ForegroundColor Yellow
        Write-Host "  执行以下命令手动触发录制:" -ForegroundColor White
        Write-Host "  curl -X POST $VpsUrl/api/simple-stream/record/reload-schedule -H 'X-API-Key: YOUR_KEY' -H 'Content-Type: application/json'" -ForegroundColor Cyan
    }
} else {
    Write-Host "[结论] 当前不符合录制条件, 这是正常的" -ForegroundColor Green
    Write-Host ""
    Write-Host "录制将在以下条件满足时自动开始:" -ForegroundColor White
    Write-Host "  - 时间范围: $($targetChannel.startTime) - $($targetChannel.endTime)" -ForegroundColor Gray
    if ($targetChannel.workdaysOnly) {
        Write-Host "  - 限制: 仅工作日" -ForegroundColor Gray
    }
}

Write-Host ""
