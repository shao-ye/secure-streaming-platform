# YOYO流媒体平台播放功能测试脚本
# 测试完整的播放流程：API连通性 -> 用户登录 -> 频道列表 -> 播放请求 -> HLS文件访问

Write-Host "=== YOYO流媒体平台播放功能测试 ===" -ForegroundColor Green
Write-Host ""

# 配置信息
$WORKERS_API = "https://yoyoapi.5202021.xyz"
$VPS_API = "https://yoyo-vps.5202021.xyz"
$FRONTEND_URL = "https://yoyo.5202021.xyz"

# 测试结果统计
$testResults = @()

function Test-ApiEndpoint {
    param($url, $description)
    
    Write-Host "测试: $description" -ForegroundColor Yellow
    Write-Host "URL: $url"
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 10
        Write-Host "✅ 成功" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ 失败: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Test-Login {
    Write-Host "测试: 用户登录" -ForegroundColor Yellow
    
    $loginData = @{
        username = "admin"
        password = "admin123"
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri "$WORKERS_API/api/login" -Method POST -Body $loginData -ContentType "application/json" -TimeoutSec 10
        
        if ($response.success) {
            Write-Host "✅ 登录成功" -ForegroundColor Green
            return $response.sessionId
        } else {
            Write-Host "❌ 登录失败: $($response.message)" -ForegroundColor Red
            return $null
        }
    }
    catch {
        Write-Host "❌ 登录请求失败: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Test-ChannelList {
    param($sessionId)
    
    Write-Host "测试: 获取频道列表" -ForegroundColor Yellow
    
    $headers = @{
        "Cookie" = "sessionId=$sessionId"
    }
    
    try {
        $response = Invoke-RestMethod -Uri "$WORKERS_API/api/streams" -Method GET -Headers $headers -TimeoutSec 10
        
        if ($response.success -and $response.streams) {
            Write-Host "✅ 获取频道列表成功，共 $($response.streams.Count) 个频道" -ForegroundColor Green
            
            foreach ($stream in $response.streams) {
                Write-Host "  - 频道: $($stream.name) (ID: $($stream.id))" -ForegroundColor Cyan
            }
            
            return $response.streams
        } else {
            Write-Host "❌ 获取频道列表失败" -ForegroundColor Red
            return $null
        }
    }
    catch {
        Write-Host "❌ 频道列表请求失败: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Test-PlayRequest {
    param($sessionId, $streamId)
    
    Write-Host "测试: 播放请求 (频道ID: $streamId)" -ForegroundColor Yellow
    
    $headers = @{
        "Cookie" = "sessionId=$sessionId"
    }
    
    try {
        $response = Invoke-RestMethod -Uri "$WORKERS_API/api/play/$streamId" -Method POST -Headers $headers -TimeoutSec 15
        
        if ($response.success -and $response.hlsUrl) {
            Write-Host "✅ 播放请求成功" -ForegroundColor Green
            Write-Host "  HLS地址: $($response.hlsUrl)" -ForegroundColor Cyan
            return $response.hlsUrl
        } else {
            Write-Host "❌ 播放请求失败: $($response.message)" -ForegroundColor Red
            return $null
        }
    }
    catch {
        Write-Host "❌ 播放请求失败: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

function Test-HlsFile {
    param($sessionId, $hlsUrl)
    
    Write-Host "测试: HLS文件访问" -ForegroundColor Yellow
    Write-Host "URL: $WORKERS_API$hlsUrl"
    
    $headers = @{
        "Cookie" = "sessionId=$sessionId"
    }
    
    try {
        $response = Invoke-WebRequest -Uri "$WORKERS_API$hlsUrl" -Method GET -Headers $headers -TimeoutSec 10
        
        if ($response.StatusCode -eq 200) {
            $content = $response.Content
            if ($content -match "#EXTM3U") {
                Write-Host "✅ HLS文件访问成功，内容格式正确" -ForegroundColor Green
                Write-Host "  文件大小: $($content.Length) 字节" -ForegroundColor Cyan
                return $true
            } else {
                Write-Host "❌ HLS文件格式不正确" -ForegroundColor Red
                return $false
            }
        } else {
            Write-Host "❌ HLS文件访问失败，状态码: $($response.StatusCode)" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "❌ HLS文件访问失败: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# 开始测试
Write-Host "开始播放功能测试..." -ForegroundColor Green
Write-Host ""

# 1. 测试API连通性
Write-Host "=== 第1步: API连通性测试 ===" -ForegroundColor Magenta
$workersOk = Test-ApiEndpoint "$WORKERS_API/api/health" "Cloudflare Workers API"
$vpsOk = Test-ApiEndpoint "$VPS_API/health" "VPS转码API"
Write-Host ""

if (-not $workersOk) {
    Write-Host "❌ Workers API不可访问，无法继续测试" -ForegroundColor Red
    exit 1
}

# 2. 测试用户登录
Write-Host "=== 第2步: 用户登录测试 ===" -ForegroundColor Magenta
$sessionId = Test-Login
Write-Host ""

if (-not $sessionId) {
    Write-Host "❌ 用户登录失败，无法继续测试" -ForegroundColor Red
    exit 1
}

# 3. 测试频道列表
Write-Host "=== 第3步: 频道列表测试 ===" -ForegroundColor Magenta
$channels = Test-ChannelList $sessionId
Write-Host ""

if (-not $channels -or $channels.Count -eq 0) {
    Write-Host "❌ 没有可用频道，无法继续播放测试" -ForegroundColor Red
    exit 1
}

# 4. 测试播放请求
Write-Host "=== 第4步: 播放请求测试 ===" -ForegroundColor Magenta
$testChannel = $channels[0]
$hlsUrl = Test-PlayRequest $sessionId $testChannel.id
Write-Host ""

if (-not $hlsUrl) {
    Write-Host "❌ 播放请求失败" -ForegroundColor Red
} else {
    # 5. 测试HLS文件访问
    Write-Host "=== 第5步: HLS文件访问测试 ===" -ForegroundColor Magenta
    $hlsOk = Test-HlsFile $sessionId $hlsUrl
    Write-Host ""
}

# 6. VPS转码状态检查
Write-Host "=== 第6步: VPS转码状态检查 ===" -ForegroundColor Magenta
if ($vpsOk) {
    try {
        $vpsStatus = Invoke-RestMethod -Uri "$VPS_API/streams" -Method GET -Headers @{"X-API-Key" = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"} -TimeoutSec 10
        
        if ($vpsStatus.streams) {
            Write-Host "✅ VPS转码服务正常，当前运行 $($vpsStatus.streams.Count) 个转码进程" -ForegroundColor Green
            
            foreach ($stream in $vpsStatus.streams) {
                Write-Host "  - 转码进程: $($stream.streamId) (PID: $($stream.pid))" -ForegroundColor Cyan
            }
        } else {
            Write-Host "⚠️  VPS转码服务正常，但没有运行中的转码进程" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "❌ VPS转码状态检查失败: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "⚠️  VPS API不可访问，跳过转码状态检查" -ForegroundColor Yellow
}
Write-Host ""

# 测试总结
Write-Host "=== 测试总结 ===" -ForegroundColor Magenta
Write-Host "✅ Cloudflare Workers API: $(if($workersOk){'正常'}else{'异常'})" -ForegroundColor $(if($workersOk){'Green'}else{'Red'})
Write-Host "✅ VPS转码API: $(if($vpsOk){'正常'}else{'异常'})" -ForegroundColor $(if($vpsOk){'Green'}else{'Red'})
Write-Host "✅ 用户登录: $(if($sessionId){'成功'}else{'失败'})" -ForegroundColor $(if($sessionId){'Green'}else{'Red'})
Write-Host "✅ 频道列表: $(if($channels){'正常'}else{'异常'})" -ForegroundColor $(if($channels){'Green'}else{'Red'})
Write-Host "✅ 播放请求: $(if($hlsUrl){'成功'}else{'失败'})" -ForegroundColor $(if($hlsUrl){'Green'}else{'Red'})

Write-Host ""
Write-Host "=== 下一步操作建议 ===" -ForegroundColor Magenta

if ($workersOk -and $sessionId -and $channels) {
    Write-Host "🎯 系统基础功能正常，可以进行实际RTMP推流测试" -ForegroundColor Green
    Write-Host "📺 在前端页面 $FRONTEND_URL 选择频道进行播放测试" -ForegroundColor Cyan
    Write-Host "🔧 如需查看VPS转码日志: ssh到VPS执行 'pm2 logs vps-transcoder-api'" -ForegroundColor Cyan
} else {
    Write-Host "⚠️  系统存在问题，需要先解决基础服务问题" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "测试完成！" -ForegroundColor Green
