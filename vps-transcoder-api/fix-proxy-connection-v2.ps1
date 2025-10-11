# 代理连接问题诊断和修复脚本 V2
# 纯PowerShell版本，可在Windows上直接运行

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  YOYO平台代理连接问题诊断和修复工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 配置
$VPS_HOST = "142.171.75.220"
$VPS_USER = "root"
$VPS_API_URL = "https://yoyo-vps.5202021.xyz"

# 1. 检查VPS代理服务状态
Write-Host "[1] 检查VPS代理服务状态..." -ForegroundColor Yellow
try {
    $proxyStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/status" -Method GET -TimeoutSec 5
    Write-Host "  [OK] 代理服务响应正常" -ForegroundColor Green
    Write-Host "  连接状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor White
    Write-Host "  当前代理: $($proxyStatus.data.currentProxy)" -ForegroundColor White
    
    if ($proxyStatus.data.connectionStatus -eq "disconnected") {
        Write-Host "  [!] 代理服务未连接" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [X] 代理服务无响应: $_" -ForegroundColor Red
}

# 2. 检查代理健康状态
Write-Host ""
Write-Host "[2] 检查代理健康状态..." -ForegroundColor Yellow
try {
    $proxyHealth = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/health" -Method GET -TimeoutSec 5
    Write-Host "  [OK] 健康检查响应正常" -ForegroundColor Green
    Write-Host "  健康状态: $($proxyHealth.status)" -ForegroundColor White
    Write-Host "  连接状态: $($proxyHealth.data.connectionStatus)" -ForegroundColor White
} catch {
    Write-Host "  [X] 健康检查失败: $_" -ForegroundColor Red
}

# 3. 检查VPS基础服务
Write-Host ""
Write-Host "[3] 检查VPS基础服务..." -ForegroundColor Yellow
try {
    $healthCheck = Invoke-RestMethod -Uri "$VPS_API_URL/health" -Method GET -TimeoutSec 5
    Write-Host "  [OK] VPS服务正常" -ForegroundColor Green
    Write-Host "  版本: $($healthCheck.version)" -ForegroundColor White
    Write-Host "  环境: $($healthCheck.environment)" -ForegroundColor White
} catch {
    Write-Host "  [X] VPS服务检查失败: $_" -ForegroundColor Red
}

# 4. 检查SimpleStream状态
Write-Host ""
Write-Host "[4] 检查SimpleStream服务..." -ForegroundColor Yellow
try {
    $streamStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/simple-stream/system/status" -Method GET -TimeoutSec 5
    Write-Host "  [OK] SimpleStream服务正常" -ForegroundColor Green
    Write-Host "  活跃流: $($streamStatus.data.activeStreams)" -ForegroundColor White
    Write-Host "  总会话: $($streamStatus.data.totalSessions)" -ForegroundColor White
} catch {
    Write-Host "  [X] SimpleStream服务检查失败: $_" -ForegroundColor Red
}

# 5. 诊断结果和建议
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  诊断结果和修复建议" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "问题分析：" -ForegroundColor Yellow
Write-Host "1. 代理功能已在前端开启，但VPS上的V2Ray/Xray客户端未正确启动" -ForegroundColor White
Write-Host "2. ProxyManager服务可能缺少V2Ray/Xray二进制文件" -ForegroundColor White
Write-Host "3. 代理配置可能未正确同步到VPS" -ForegroundColor White

Write-Host ""
Write-Host "修复步骤：" -ForegroundColor Yellow
Write-Host "1. 安装V2Ray客户端（如果未安装）" -ForegroundColor White
Write-Host "2. 确保代理配置正确同步" -ForegroundColor White
Write-Host "3. 重启ProxyManager服务" -ForegroundColor White
Write-Host "4. 配置iptables透明代理规则" -ForegroundColor White

# 询问是否执行自动修复
Write-Host ""
$response = Read-Host "是否执行自动修复？(y/n)"

if ($response -eq 'y' -or $response -eq 'Y') {
    Write-Host ""
    Write-Host "开始执行自动修复..." -ForegroundColor Green
    
    # 创建VPS上的修复脚本
    Write-Host ""
    Write-Host "[修复1] 创建VPS修复脚本..." -ForegroundColor Yellow
    
    $vpsFixScript = @'
#!/bin/bash
echo "=== VPS代理修复脚本 ==="

# 1. 检查并安装V2Ray
echo ""
echo "检查V2Ray安装..."
if ! command -v v2ray &> /dev/null && ! command -v xray &> /dev/null; then
    echo "V2Ray/Xray未安装，开始安装..."
    curl -Ls https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh | sudo bash
    echo "V2Ray安装完成"
else
    echo "V2Ray/Xray已安装"
    which v2ray 2>/dev/null || which xray 2>/dev/null
fi

# 2. 创建配置目录
echo ""
echo "创建配置目录..."
mkdir -p /opt/yoyo-transcoder/config
mkdir -p /opt/yoyo-transcoder/logs

# 3. 检查V2Ray进程
echo ""
echo "检查V2Ray进程..."
ps aux | grep -E "(v2ray|xray)" | grep -v grep || echo "没有运行的V2Ray进程"

# 4. 检查代理端口
echo ""
echo "检查代理端口..."
netstat -tlnp | grep :1080 || echo "代理端口1080未监听"

# 5. 重启PM2服务
echo ""
echo "重启PM2服务..."
cd /opt/yoyo-transcoder
pm2 restart vps-transcoder-api
pm2 list

echo ""
echo "=== 修复完成 ==="
'@
    
    # 将脚本内容保存到临时文件
    $tempFile = "$env:TEMP\vps-fix-proxy.sh"
    $vpsFixScript | Out-File -FilePath $tempFile -Encoding UTF8 -NoNewline
    
    Write-Host "  脚本已创建: $tempFile" -ForegroundColor Gray
    
    # 上传脚本到VPS
    Write-Host ""
    Write-Host "[修复2] 上传脚本到VPS..." -ForegroundColor Yellow
    $scpCommand = "scp -o StrictHostKeyChecking=no `"$tempFile`" ${VPS_USER}@${VPS_HOST}:/tmp/fix-proxy.sh"
    Write-Host "  执行: $scpCommand" -ForegroundColor Gray
    $result = cmd /c $scpCommand 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] 脚本上传成功" -ForegroundColor Green
    } else {
        Write-Host "  [X] 脚本上传失败: $result" -ForegroundColor Red
    }
    
    # 执行VPS上的修复脚本
    Write-Host ""
    Write-Host "[修复3] 在VPS上执行修复脚本..." -ForegroundColor Yellow
    $sshCommand = "ssh -o ConnectTimeout=30 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} 'chmod +x /tmp/fix-proxy.sh && /tmp/fix-proxy.sh'"
    Write-Host "  执行SSH命令..." -ForegroundColor Gray
    $result = cmd /c $sshCommand 2>&1
    Write-Host $result
    
    # 等待服务启动
    Write-Host ""
    Write-Host "等待服务启动..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    # 重新检查状态
    Write-Host ""
    Write-Host "[修复4] 验证修复结果..." -ForegroundColor Yellow
    try {
        $proxyStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/status" -Method GET -TimeoutSec 5
        Write-Host "  [OK] 代理服务响应正常" -ForegroundColor Green
        Write-Host "  连接状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor White
        
        if ($proxyStatus.data.connectionStatus -eq "connected") {
            Write-Host "  [OK] 代理已成功连接！" -ForegroundColor Green
        } else {
            Write-Host "  [!] 代理仍未连接，可能需要在前端重新配置代理" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [X] 代理服务仍有问题: $_" -ForegroundColor Red
    }
    
    # 清理临时文件
    Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  诊断完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步操作建议：" -ForegroundColor Yellow
Write-Host "1. 如果代理仍未连接，请在管理后台重新选择并激活代理" -ForegroundColor White
Write-Host "2. 确保代理配置（VLESS URL）正确无误" -ForegroundColor White
Write-Host "3. 测试代理连接是否正常" -ForegroundColor White
Write-Host ""

# 提供手动SSH命令
Write-Host "如需手动检查，可以使用以下SSH命令：" -ForegroundColor Cyan
Write-Host "ssh root@142.171.75.220" -ForegroundColor White
Write-Host ""
Write-Host "然后执行以下命令检查：" -ForegroundColor Cyan
Write-Host "ps aux | grep v2ray" -ForegroundColor White
Write-Host "netstat -tlnp | grep :1080" -ForegroundColor White
Write-Host "pm2 list" -ForegroundColor White
Write-Host ""
