# 录制调度器诊断脚本
# 用于检查VPS重启后录制未自动启动的原因

param(
    [string]$VpsUrl = "https://yoyo-vps.your-domain.com",
    [string]$WorkersUrl = "https://yoyoapi.your-domain.com",
    [string]$ApiKey = $env:VPS_API_KEY,
    [string]$ChannelName = "二楼教室1"
)

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "录制调度器诊断工具" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

if (-not $ApiKey) {
    Write-Host "错误: 未设置 VPS_API_KEY 环境变量" -ForegroundColor Red
    exit 1
}

$headers = @{
    "X-API-Key" = $ApiKey
    "Content-Type" = "application/json"
}

# 1. 检查Workers API连接
Write-Host "1. 检查 Workers API 连接..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$WorkersUrl/api/record/configs" -Headers $headers -Method Get -TimeoutSec 10
    Write-Host "   [OK] Workers API 连接正常" -ForegroundColor Green
    Write-Host "   获取到 $($response.data.Count) 个启用录制的频道" -ForegroundColor Gray
} catch {
    Write-Host "   [ERROR] Workers API 连接失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 2. 显示所有录制配置
Write-Host ""
Write-Host "2. 录制配置列表:" -ForegroundColor Yellow
$targetChannel = $null
foreach ($config in $response.data) {
    $isTarget = if ($config.channelName -eq $ChannelName) { " [TARGET]" } else { "" }
    Write-Host "   - [$($config.channelId)]$isTarget" -ForegroundColor Cyan
    Write-Host "     频道名: $($config.channelName)" -ForegroundColor Gray
    Write-Host "     录制时间: $($config.startTime) - $($config.endTime)" -ForegroundColor Gray
    Write-Host "     仅工作日: $($config.workdaysOnly)" -ForegroundColor Gray
    Write-Host "     已启用: $($config.enabled)" -ForegroundColor Gray
    
    if ($config.channelName -eq $ChannelName) {
        $targetChannel = $config
    }
}

# 3. 检查目标频道配置
Write-Host ""
Write-Host "3. 检查目标频道 '$ChannelName'..." -ForegroundColor Yellow
if (-not $targetChannel) {
    Write-Host "   [ERROR] 未找到频道 '$ChannelName' 的录制配置" -ForegroundColor Red
    Write-Host "   可能原因:" -ForegroundColor Yellow
    Write-Host "   - 频道录制未启用 (enabled: false)" -ForegroundColor Gray
    Write-Host "   - 频道配置数据损坏" -ForegroundColor Gray
    Write-Host "   - 频道索引未包含该频道" -ForegroundColor Gray
    exit 1
}

Write-Host "   [OK] 找到目标频道配置" -ForegroundColor Green
Write-Host ""
Write-Host "   详细配置:" -ForegroundColor Cyan
Write-Host "   ----------------------------------------"
$targetChannel | ConvertTo-Json -Depth 5 | Write-Host
Write-Host "   ----------------------------------------"

# 4. 检查当前时间是否在录制范围内
Write-Host ""
Write-Host "4. 检查当前时间..." -ForegroundColor Yellow

# 获取上海时区的当前时间
$shanghaiTime = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "China Standard Time")
$currentTime = $shanghaiTime.ToString("HH:mm")
Write-Host "   当前时间 (上海): $currentTime" -ForegroundColor Gray

# 解析时间范围
$startTime = [DateTime]::ParseExact($targetChannel.startTime, "HH:mm", $null)
$endTime = [DateTime]::ParseExact($targetChannel.endTime, "HH:mm", $null)
$current = [DateTime]::ParseExact($currentTime, "HH:mm", $null)

# 转换为分钟数进行比较
$currentMins = $current.Hour * 60 + $current.Minute
$startMins = $startTime.Hour * 60 + $startTime.Minute
$endMins = $endTime.Hour * 60 + $endTime.Minute

$inRange = $false
if ($endMins -lt $startMins) {
    # 跨天情况
    $inRange = ($currentMins -ge $startMins) -or ($currentMins -lt $endMins)
} else {
    # 正常情况
    $inRange = ($currentMins -ge $startMins) -and ($currentMins -lt $endMins)
}

if ($inRange) {
    Write-Host "   [OK] 当前时间在录制范围内" -ForegroundColor Green
} else {
    Write-Host "   [NOT IN RANGE] 当前时间不在录制范围内" -ForegroundColor Red
    Write-Host "   录制时间: $($targetChannel.startTime) - $($targetChannel.endTime)" -ForegroundColor Gray
}

# 5. 检查工作日状态
Write-Host ""
Write-Host "5. 检查工作日状态..." -ForegroundColor Yellow
if ($targetChannel.workdaysOnly) {
    Write-Host "   配置要求: 仅工作日录制" -ForegroundColor Gray
    
    try {
        # 调用VPS的工作日检查端点（如果有）
        $dateStr = $shanghaiTime.ToString("yyyy-MM-dd")
        Write-Host "   检查日期: $dateStr" -ForegroundColor Gray
        
        # 尝试从Timor API直接查询
        $holidayResponse = Invoke-RestMethod -Uri "https://timor.tech/api/holiday/info/$dateStr" -Method Get -TimeoutSec 5
        $isWorkday = ($holidayResponse.type.type -eq 0) -or ($holidayResponse.type.type -eq 3)
        
        if ($isWorkday) {
            Write-Host "   [OK] 今天是工作日 ($($holidayResponse.type.name))" -ForegroundColor Green
        } else {
            Write-Host "   [NOT WORKDAY] 今天不是工作日 ($($holidayResponse.type.name))" -ForegroundColor Red
        }
    } catch {
        Write-Host "   [WARN] 无法查询工作日状态: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "   降级判断: 周一至周五视为工作日" -ForegroundColor Gray
        
        $dayOfWeek = $shanghaiTime.DayOfWeek
        $isWorkday = ($dayOfWeek -ge [DayOfWeek]::Monday) -and ($dayOfWeek -le [DayOfWeek]::Friday)
        
        if ($isWorkday) {
            Write-Host "   [OK] 今天是工作日 (基础模式)" -ForegroundColor Green
        } else {
            Write-Host "   [NOT WORKDAY] 今天不是工作日 (基础模式)" -ForegroundColor Red
        }
    }
} else {
    Write-Host "   [INFO] 配置为每日录制，无需检查工作日" -ForegroundColor Cyan
    $isWorkday = $true
}

# 6. 综合判断
Write-Host ""
Write-Host "6. 综合判断..." -ForegroundColor Yellow
$shouldRecord = $inRange -and ($targetChannel.workdaysOnly -eq $false -or $isWorkday)

if ($shouldRecord) {
    Write-Host "   [OK] 符合所有条件，应该自动开始录制" -ForegroundColor Green
} else {
    Write-Host "   [NOT QUALIFIED] 不符合录制条件" -ForegroundColor Red
    Write-Host ""
    Write-Host "   原因分析:" -ForegroundColor Yellow
    if (-not $inRange) {
        Write-Host "   - 当前时间不在录制范围内" -ForegroundColor Red
    }
    if ($targetChannel.workdaysOnly -and -not $isWorkday) {
        Write-Host "   - 今天不是工作日，但配置要求仅工作日录制" -ForegroundColor Red
    }
}

# 7. 检查VPS当前的录制状态
Write-Host ""
Write-Host "7. 检查 VPS 当前录制状态..." -ForegroundColor Yellow
try {
    $statusResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/recording/status" -Headers $headers -Method Get -TimeoutSec 10
    
    $recording = $statusResponse.data.channels | Where-Object { $_.channelName -eq $ChannelName }
    
    if ($recording) {
        if ($recording.isRecording) {
            Write-Host "   [OK] 频道正在录制中" -ForegroundColor Green
            Write-Host "   录制文件: $($recording.outputFile)" -ForegroundColor Gray
            Write-Host "   已录制时长: $($recording.duration)" -ForegroundColor Gray
        } else {
            Write-Host "   [WARN] 频道已配置但未在录制" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   [NOT RECORDING] 频道未在录制状态中" -ForegroundColor Red
    }
} catch {
    Write-Host "   [WARN] 无法获取录制状态: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 8. 检查RecordScheduler状态
Write-Host ""
Write-Host "8. 检查 RecordScheduler 调度器状态..." -ForegroundColor Yellow
try {
    $schedulerResponse = Invoke-RestMethod -Uri "$VpsUrl/api/simple-stream/record/status" -Headers $headers -Method Get -TimeoutSec 10
    
    Write-Host "   调度器运行状态: $($schedulerResponse.data.isRunning)" -ForegroundColor Gray
    Write-Host "   已调度频道数: $($schedulerResponse.data.totalScheduled)" -ForegroundColor Gray
    
    if ($schedulerResponse.data.scheduledChannels -contains $targetChannel.channelId) {
        Write-Host "   [OK] 目标频道已添加到调度器" -ForegroundColor Green
    } else {
        Write-Host "   [NOT SCHEDULED] 目标频道未在调度器中" -ForegroundColor Red
    }
} catch {
    Write-Host "   [WARN] 无法获取调度器状态: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 9. 建议操作
Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "建议操作:" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

if ($shouldRecord -and (-not $recording -or -not $recording.isRecording)) {
    Write-Host ""
    Write-Host "问题: 符合录制条件但未在录制" -ForegroundColor Red
    Write-Host ""
    Write-Host "可能的解决方案:" -ForegroundColor Yellow
    Write-Host "1. 手动触发录制调度重载:" -ForegroundColor White
    Write-Host "   Invoke-RestMethod -Uri '$VpsUrl/api/simple-stream/record/reload-schedule' ``" -ForegroundColor Gray
    Write-Host "     -Headers @{'X-API-Key'='$ApiKey'; 'Content-Type'='application/json'} ``" -ForegroundColor Gray
    Write-Host "     -Method Post -Body (ConvertTo-Json @{channelId='$($targetChannel.channelId)'})" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. 检查VPS服务日志:" -ForegroundColor White
    Write-Host "   ssh root@yoyo-vps 'pm2 logs vps-api --lines 100 --nostream'" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. 重启VPS服务:" -ForegroundColor White
    Write-Host "   ssh root@yoyo-vps 'pm2 restart vps-api'" -ForegroundColor Gray
} elseif (-not $shouldRecord) {
    Write-Host ""
    Write-Host "当前不符合录制条件，这是正常的。" -ForegroundColor Green
    Write-Host "录制将在以下时间自动开始:" -ForegroundColor White
    Write-Host "  - 时间范围: $($targetChannel.startTime) - $($targetChannel.endTime)" -ForegroundColor Gray
    if ($targetChannel.workdaysOnly) {
        Write-Host "  - 限制条件: 仅工作日" -ForegroundColor Gray
    }
} else {
    Write-Host ""
    Write-Host "[OK] 一切正常！频道正在按计划录制。" -ForegroundColor Green
}

Write-Host ""
