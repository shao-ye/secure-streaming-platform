# 本地代理解码性能测试脚本
# 通过API控制VPS代理，在本地测试性能差异

$RTMP_URL = "rtmp://push228.dodool.com.cn/55/19?auth_key=1413753727-0-0-12f6098bc64f30e11339cd4799325c5f"
$PROXY_CONFIG = "vless://3129f1b0-95f2-4602-a6b4-23fb3c7df4e1@104.194.86.189:443?encryption=none&security=tls&type=xhttp&host=rn.262777.xyz&path=%2F3129f1b0&mode=auto#RN-proxy-xhttp-cdn"
$API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$VPS_API = "https://yoyo-vps.5202021.xyz"
$TEST_DURATION = 30  # 测试时长（秒）

Write-Host "========================================"
Write-Host "代理解码性能测试（本地执行）"
Write-Host "========================================"
Write-Host "RTMP源: $RTMP_URL"
Write-Host "代理: RN-proxy-xhttp-cdn"
Write-Host "测试时长: ${TEST_DURATION}秒"
Write-Host "========================================"
Write-Host ""

# 检查FFmpeg是否可用
$ffmpegExists = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegExists) {
    Write-Host "✗ 错误: 未找到FFmpeg，请先安装FFmpeg"
    Write-Host "下载地址: https://ffmpeg.org/download.html"
    exit 1
}

$outputDir = ".\test_results_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

# ==========================================
# 测试1: 直接解码RTMP源
# ==========================================
Write-Host "[测试1] 直接解码RTMP源..."
Write-Host "----------------------------------------"

$directLog = "$outputDir\direct_decode.log"
$directStart = Get-Date

try {
    # 运行FFmpeg测试
    $ffmpegArgs = @(
        "-i", $RTMP_URL,
        "-t", $TEST_DURATION,
        "-c", "copy",
        "-f", "null",
        "-"
    )
    
    Write-Host "开始测试... (${TEST_DURATION}秒)"
    
    $process = Start-Process -FilePath "ffmpeg" -ArgumentList $ffmpegArgs `
        -RedirectStandardError $directLog -NoNewWindow -Wait -PassThru
    
    $directEnd = Get-Date
    $directDuration = ($directEnd - $directStart).TotalSeconds
    
    Write-Host "✓ 直接解码测试完成 (耗时: $([math]::Round($directDuration, 2))秒)"
    
} catch {
    Write-Host "✗ 直接解码测试失败: $_"
}

Start-Sleep -Seconds 3

# ==========================================
# 测试2: 通过代理解码RTMP源
# ==========================================
Write-Host ""
Write-Host "[测试2] 通过VLESS代理解码RTMP源..."
Write-Host "----------------------------------------"

# 启用代理
Write-Host "启用VPS代理..."
try {
    $proxyData = @{
        proxyUrl = $PROXY_CONFIG
    } | ConvertTo-Json
    
    $enableResult = Invoke-RestMethod -Uri "$VPS_API/api/proxy/connect" `
        -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "X-API-Key" = $API_KEY
        } `
        -Body $proxyData `
        -TimeoutSec 15
    
    Write-Host "代理启用结果: $($enableResult | ConvertTo-Json -Compress)"
    
} catch {
    Write-Host "✗ 代理启用失败: $_"
    Write-Host "跳过代理模式测试"
    $proxyTestSkipped = $true
}

if (-not $proxyTestSkipped) {
    # 等待代理连接建立
    Write-Host "等待代理连接建立..."
    Start-Sleep -Seconds 5
    
    # 检查代理状态
    try {
        $proxyStatus = Invoke-RestMethod -Uri "$VPS_API/api/proxy/status" `
            -Method GET `
            -Headers @{"X-API-Key" = $API_KEY} `
            -TimeoutSec 10
        
        Write-Host "代理状态: $($proxyStatus.data.connectionStatus)"
        
        if ($proxyStatus.data.connectionStatus -eq "connected") {
            Write-Host "✓ 代理已连接，开始测试..."
            
            # 在VPS上测试（需要通过API触发）
            Write-Host ""
            Write-Host "注意: 代理模式测试需要在VPS上执行FFmpeg"
            Write-Host "因为代理SOCKS5端口(1080)在VPS本地"
            Write-Host ""
            Write-Host "建议方案:"
            Write-Host "1. 登录VPS执行以下命令测试代理性能:"
            Write-Host ""
            Write-Host "export http_proxy='socks5://127.0.0.1:1080'"
            Write-Host "export https_proxy='socks5://127.0.0.1:1080'"
            Write-Host "ffmpeg -i '$RTMP_URL' -t $TEST_DURATION -c copy -f null - 2>&1 | tee proxy_test.log"
            Write-Host ""
            Write-Host "2. 查看日志文件分析性能指标"
            Write-Host ""
            
        } else {
            Write-Host "✗ 代理未成功连接: $($proxyStatus.data.connectionStatus)"
        }
        
    } catch {
        Write-Host "✗ 代理状态检查失败: $_"
    }
    
    # 断开代理
    Write-Host ""
    Write-Host "断开代理..."
    try {
        $disconnectResult = Invoke-RestMethod -Uri "$VPS_API/api/proxy/disconnect" `
            -Method POST `
            -Headers @{"X-API-Key" = $API_KEY} `
            -TimeoutSec 10
        
        Write-Host "✓ 代理已断开"
    } catch {
        Write-Host "✗ 代理断开失败: $_"
    }
}

# ==========================================
# 分析直接解码结果
# ==========================================
Write-Host ""
Write-Host "========================================"
Write-Host "直接解码性能分析"
Write-Host "========================================"

if (Test-Path $directLog) {
    $logContent = Get-Content $directLog -Raw
    
    # 提取关键指标
    if ($logContent -match 'frame=\s*(\d+)') {
        $frames = $matches[1]
        Write-Host "总帧数: $frames"
    }
    
    if ($logContent -match 'fps=\s*([\d\.]+)') {
        $fps = $matches[1]
        Write-Host "平均FPS: $fps"
    }
    
    if ($logContent -match 'speed=\s*([\d\.]+)x') {
        $speed = $matches[1]
        Write-Host "解码速度: ${speed}x"
    }
    
    if ($logContent -match 'bitrate=\s*([\d\.]+)kbits/s') {
        $bitrate = $matches[1]
        Write-Host "比特率: ${bitrate} kbits/s"
    }
    
    # 检查错误
    $errors = Select-String -Path $directLog -Pattern "error|Error|ERROR" | Measure-Object
    Write-Host "错误数: $($errors.Count)"
    
    Write-Host ""
    Write-Host "完整日志: $directLog"
}

Write-Host ""
Write-Host "========================================"
Write-Host "测试总结"
Write-Host "========================================"
Write-Host "✓ 直接解码测试完成"
Write-Host "⚠ 代理解码需要在VPS上执行（见上述建议）"
Write-Host ""
Write-Host "测试结果保存在: $outputDir"
Write-Host "========================================"
