# 代理RTMP性能测试脚本（不修改项目代码）
# 通过API控制代理，在VPS上执行FFmpeg测试

$RTMP_URL = "rtmp://push228.dodool.com.cn/55/19?auth_key=1413753727-0-0-12f6098bc64f30e11339cd4799325c5f"
$PROXY_CONFIG_URL = "vless://3129f1b0-95f2-4602-a6b4-23fb3c7df4e1@104.194.86.189:443?encryption=none&security=tls&type=xhttp&host=rn.262777.xyz&path=%2F3129f1b0&mode=auto#RN-proxy-xhttp-cdn"
$API_KEY = "85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
$VPS_API = "https://yoyo-vps.5202021.xyz"
$TEST_DURATION = 15  # 测试时长（秒）

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "代理RTMP解码性能对比测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 步骤1: 创建测试脚本
Write-Host "[步骤1] 创建VPS测试脚本..." -ForegroundColor Yellow

$testScript = @"
#!/bin/bash
RTMP_URL="$RTMP_URL"
TEST_DURATION=$TEST_DURATION
OUTPUT_DIR="/tmp/rtmp_test_\$(date +%s)"

mkdir -p "\$OUTPUT_DIR"

echo "========================================"
echo "RTMP解码性能测试"
echo "========================================"
echo "RTMP源: \$RTMP_URL"
echo "测试时长: \${TEST_DURATION}秒"
echo "========================================"

# 测试1: 直接解码
echo ""
echo "[测试1] 直接解码RTMP源..."
echo "----------------------------------------"

timeout \${TEST_DURATION} ffmpeg -i "\$RTMP_URL" -t \${TEST_DURATION} -c copy -f null - 2>&1 | tee "\$OUTPUT_DIR/direct.log" || true

# 提取关键指标
echo "" > "\$OUTPUT_DIR/direct_summary.txt"
echo "【直接解码性能】" >> "\$OUTPUT_DIR/direct_summary.txt"
echo "----------------------------------------" >> "\$OUTPUT_DIR/direct_summary.txt"

# 提取帧率、速度、比特率
FRAMES=\$(grep -oP 'frame=\s*\K[\d]+' "\$OUTPUT_DIR/direct.log" | tail -1 || echo "N/A")
FPS=\$(grep -oP 'fps=\s*\K[\d\.]+' "\$OUTPUT_DIR/direct.log" | tail -1 || echo "N/A")
SPEED=\$(grep -oP 'speed=\s*\K[\d\.]+' "\$OUTPUT_DIR/direct.log" | tail -1 || echo "N/A")
BITRATE=\$(grep -oP 'bitrate=\s*\K[\d\.]+' "\$OUTPUT_DIR/direct.log" | tail -1 || echo "N/A")

echo "总帧数: \$FRAMES" >> "\$OUTPUT_DIR/direct_summary.txt"
echo "平均FPS: \$FPS" >> "\$OUTPUT_DIR/direct_summary.txt"
echo "解码速度: \${SPEED}x" >> "\$OUTPUT_DIR/direct_summary.txt"
echo "比特率: \${BITRATE} kbits/s" >> "\$OUTPUT_DIR/direct_summary.txt"

# 检查错误
ERRORS=\$(grep -c "error\|Error\|ERROR" "\$OUTPUT_DIR/direct.log" || echo "0")
echo "错误数: \$ERRORS" >> "\$OUTPUT_DIR/direct_summary.txt"

# 测试2: 通过代理解码
echo ""
echo "[测试2] 通过代理解码RTMP源..."
echo "----------------------------------------"
echo "检查代理状态..."

# 检查端口1080是否在监听
if lsof -i :1080 > /dev/null 2>&1; then
    echo "✓ 代理端口1080已开启"
    
    # 使用代理
    export http_proxy="socks5://127.0.0.1:1080"
    export https_proxy="socks5://127.0.0.1:1080"
    export all_proxy="socks5://127.0.0.1:1080"
    
    timeout \${TEST_DURATION} ffmpeg -i "\$RTMP_URL" -t \${TEST_DURATION} -c copy -f null - 2>&1 | tee "\$OUTPUT_DIR/proxy.log" || true
    
    # 提取代理模式下的指标
    echo "" > "\$OUTPUT_DIR/proxy_summary.txt"
    echo "【代理解码性能】" >> "\$OUTPUT_DIR/proxy_summary.txt"
    echo "----------------------------------------" >> "\$OUTPUT_DIR/proxy_summary.txt"
    
    FRAMES_PROXY=\$(grep -oP 'frame=\s*\K[\d]+' "\$OUTPUT_DIR/proxy.log" | tail -1 || echo "N/A")
    FPS_PROXY=\$(grep -oP 'fps=\s*\K[\d\.]+' "\$OUTPUT_DIR/proxy.log" | tail -1 || echo "N/A")
    SPEED_PROXY=\$(grep -oP 'speed=\s*\K[\d\.]+' "\$OUTPUT_DIR/proxy.log" | tail -1 || echo "N/A")
    BITRATE_PROXY=\$(grep -oP 'bitrate=\s*\K[\d\.]+' "\$OUTPUT_DIR/proxy.log" | tail -1 || echo "N/A")
    
    echo "总帧数: \$FRAMES_PROXY" >> "\$OUTPUT_DIR/proxy_summary.txt"
    echo "平均FPS: \$FPS_PROXY" >> "\$OUTPUT_DIR/proxy_summary.txt"
    echo "解码速度: \${SPEED_PROXY}x" >> "\$OUTPUT_DIR/proxy_summary.txt"
    echo "比特率: \${BITRATE_PROXY} kbits/s" >> "\$OUTPUT_DIR/proxy_summary.txt"
    
    ERRORS_PROXY=\$(grep -c "error\|Error\|ERROR" "\$OUTPUT_DIR/proxy.log" || echo "0")
    echo "错误数: \$ERRORS_PROXY" >> "\$OUTPUT_DIR/proxy_summary.txt"
else
    echo "✗ 代理端口1080未开启，跳过代理测试"
    echo "请先通过API启用代理" > "\$OUTPUT_DIR/proxy_summary.txt"
fi

# 生成对比报告
echo "" > "\$OUTPUT_DIR/comparison.txt"
echo "========================================" >> "\$OUTPUT_DIR/comparison.txt"
echo "性能对比报告" >> "\$OUTPUT_DIR/comparison.txt"
echo "========================================" >> "\$OUTPUT_DIR/comparison.txt"
echo "" >> "\$OUTPUT_DIR/comparison.txt"
cat "\$OUTPUT_DIR/direct_summary.txt" >> "\$OUTPUT_DIR/comparison.txt"
echo "" >> "\$OUTPUT_DIR/comparison.txt"
cat "\$OUTPUT_DIR/proxy_summary.txt" >> "\$OUTPUT_DIR/comparison.txt"
echo "" >> "\$OUTPUT_DIR/comparison.txt"
echo "========================================" >> "\$OUTPUT_DIR/comparison.txt"
echo "测试完成时间: \$(date)" >> "\$OUTPUT_DIR/comparison.txt"
echo "详细日志目录: \$OUTPUT_DIR" >> "\$OUTPUT_DIR/comparison.txt"
echo "========================================" >> "\$OUTPUT_DIR/comparison.txt"

# 输出结果到控制台
cat "\$OUTPUT_DIR/comparison.txt"

# 将结果保存到固定位置方便查看
cp "\$OUTPUT_DIR/comparison.txt" /tmp/latest_rtmp_test.txt
echo ""
echo "结果已保存到: /tmp/latest_rtmp_test.txt"
echo "详细日志: \$OUTPUT_DIR"
"@

# 保存脚本到本地
$localScriptPath = ".\test_rtmp_performance.sh"
$testScript | Out-File -FilePath $localScriptPath -Encoding UTF8 -NoNewline

Write-Host "✓ 测试脚本已创建: $localScriptPath" -ForegroundColor Green
Write-Host ""

# 步骤2: 上传脚本到VPS
Write-Host "[步骤2] 上传测试脚本到VPS..." -ForegroundColor Yellow

try {
    # 使用scp上传（需要安装OpenSSH客户端）
    $scpResult = scp $localScriptPath root@142.171.75.220:/tmp/test_rtmp_perf.sh 2>&1
    Write-Host "✓ 脚本已上传到VPS:/tmp/test_rtmp_perf.sh" -ForegroundColor Green
} catch {
    Write-Host "✗ SCP上传失败: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "请手动执行以下步骤：" -ForegroundColor Yellow
    Write-Host "1. 将脚本 $localScriptPath 上传到VPS的 /tmp/test_rtmp_perf.sh"
    Write-Host "2. 执行: ssh root@142.171.75.220 'chmod +x /tmp/test_rtmp_perf.sh'"
    exit 1
}

Write-Host ""

# 步骤3: 检查VPS代理状态
Write-Host "[步骤3] 检查VPS代理状态..." -ForegroundColor Yellow

try {
    $proxyStatus = Invoke-RestMethod -Uri "$VPS_API/api/proxy/status" `
        -Method GET `
        -Headers @{"X-API-Key" = $API_KEY} `
        -TimeoutSec 10
    
    Write-Host "代理状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor Cyan
    
    if ($proxyStatus.data.connectionStatus -eq "connected") {
        Write-Host "✓ 代理已连接，可以进行对比测试" -ForegroundColor Green
    } else {
        Write-Host "⚠ 代理未连接，只能测试直接解码" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "是否启用代理进行对比测试？(Y/N)" -ForegroundColor Yellow
        $enableProxy = Read-Host
        
        if ($enableProxy -eq 'Y' -or $enableProxy -eq 'y') {
            Write-Host "启用代理..." -ForegroundColor Yellow
            
            $proxyData = @{
                proxyUrl = $PROXY_CONFIG_URL
            } | ConvertTo-Json
            
            $enableResult = Invoke-RestMethod -Uri "$VPS_API/api/proxy/connect" `
                -Method POST `
                -Headers @{
                    "Content-Type" = "application/json"
                    "X-API-Key" = $API_KEY
                } `
                -Body $proxyData `
                -TimeoutSec 15
            
            Write-Host "✓ 代理已启用" -ForegroundColor Green
            Start-Sleep -Seconds 3
        }
    }
} catch {
    Write-Host "✗ 代理状态检查失败: $_" -ForegroundColor Red
}

Write-Host ""

# 步骤4: 执行测试
Write-Host "[步骤4] 执行性能测试..." -ForegroundColor Yellow
Write-Host "测试需要约 $($TEST_DURATION * 2) 秒，请耐心等待..." -ForegroundColor Cyan
Write-Host ""

try {
    # 使用SSH执行测试脚本（单层命令）
    ssh root@142.171.75.220 "bash /tmp/test_rtmp_perf.sh"
    
    Write-Host ""
    Write-Host "✓ 测试执行完成" -ForegroundColor Green
    
} catch {
    Write-Host "✗ 测试执行失败: $_" -ForegroundColor Red
}

Write-Host ""

# 步骤5: 获取测试结果
Write-Host "[步骤5] 获取测试结果..." -ForegroundColor Yellow

try {
    $result = ssh root@142.171.75.220 "cat /tmp/latest_rtmp_test.txt 2>/dev/null || echo '未找到测试结果'"
    Write-Host ""
    Write-Host $result
    Write-Host ""
} catch {
    Write-Host "✗ 获取结果失败: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "查看详细日志:" -ForegroundColor Yellow
Write-Host "ssh root@142.171.75.220 'ls -la /tmp/rtmp_test_*'" -ForegroundColor Gray
Write-Host ""
Write-Host "查看最新结果:" -ForegroundColor Yellow
Write-Host "ssh root@142.171.75.220 'cat /tmp/latest_rtmp_test.txt'" -ForegroundColor Gray
