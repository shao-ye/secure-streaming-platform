# 代理连接问题诊断和修复脚本
# 用于解决代理功能开启后无法连接的问题

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
    Write-Host "√ 代理服务响应正常" -ForegroundColor Green
    Write-Host "  连接状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor White
    Write-Host "  当前代理: $($proxyStatus.data.currentProxy)" -ForegroundColor White
    
    if ($proxyStatus.data.connectionStatus -eq "disconnected") {
        Write-Host "! 代理服务未连接" -ForegroundColor Yellow
    }
} catch {
    Write-Host "X 代理服务无响应: $_" -ForegroundColor Red
}

# 2. 检查代理健康状态
Write-Host ""
Write-Host "[2] 检查代理健康状态..." -ForegroundColor Yellow
try {
    $proxyHealth = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/health" -Method GET -TimeoutSec 5
    Write-Host "√ 健康检查响应正常" -ForegroundColor Green
    Write-Host "  健康状态: $($proxyHealth.status)" -ForegroundColor White
    Write-Host "  连接状态: $($proxyHealth.data.connectionStatus)" -ForegroundColor White
} catch {
    Write-Host "X 健康检查失败: $_" -ForegroundColor Red
}

# 3. 检查V2Ray进程状态
Write-Host ""
Write-Host "[3] 检查V2Ray进程状态..." -ForegroundColor Yellow
$checkV2RayCommand = @'
echo "=== 检查V2Ray进程 ==="
ps aux | grep -E "(v2ray|xray)" | grep -v grep
if [ $? -ne 0 ]; then echo "没有运行的V2Ray/Xray进程"; fi

echo ""
echo "=== 检查V2Ray安装 ==="
which v2ray 2>/dev/null
if [ $? -ne 0 ]; then 
    which xray 2>/dev/null
    if [ $? -ne 0 ]; then echo "V2Ray/Xray未安装"; fi
fi

echo ""
echo "=== 检查代理端口 ==="
netstat -tlnp | grep :1080
if [ $? -ne 0 ]; then echo "代理端口1080未监听"; fi
'@

Write-Host "执行远程检查..." -ForegroundColor Gray
$sshCommand = "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} `"$checkV2RayCommand`""
$result = cmd /c $sshCommand 2>&1
Write-Host $result

# 4. 检查ProxyManager服务
Write-Host ""
Write-Host "[4] 检查ProxyManager服务状态..." -ForegroundColor Yellow
$checkProxyManagerCommand = @'
echo "=== 检查ProxyManager日志 ==="
tail -n 20 /opt/yoyo-transcoder/logs/app.log | grep -i proxy
if [ $? -ne 0 ]; then echo "没有代理相关日志"; fi

echo ""
echo "=== 检查代理配置文件 ==="
ls -la /opt/yoyo-transcoder/config/v2ray.json 2>/dev/null
if [ $? -ne 0 ]; then echo "代理配置文件不存在"; fi

echo ""
echo "=== 检查PM2进程 ==="
pm2 list | grep vps-transcoder-api
'@

Write-Host "执行远程检查..." -ForegroundColor Gray
$sshCommand = "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} `"$checkProxyManagerCommand`""
$result = cmd /c $sshCommand 2>&1
Write-Host $result

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
if ($response -eq 'y') {
    Write-Host ""
    Write-Host "开始执行自动修复..." -ForegroundColor Green
    
    # 安装V2Ray
    Write-Host ""
    Write-Host "[修复1] 安装V2Ray客户端..." -ForegroundColor Yellow
    $installV2RayCommand = @'
# 检查是否已安装
if ! which v2ray >/dev/null 2>&1 && ! which xray >/dev/null 2>&1; then
    echo "开始安装V2Ray..."
    curl -Ls https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh | sudo bash
    echo "V2Ray安装完成"
else
    echo "V2Ray/Xray已安装"
fi

# 确保v2ray可执行
chmod +x /usr/local/bin/v2ray 2>/dev/null
'@
    
    Write-Host "执行安装命令..." -ForegroundColor Gray
    $sshCommand = "ssh -o ConnectTimeout=30 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} `"$installV2RayCommand`""
    $result = cmd /c $sshCommand 2>&1
    Write-Host $result
    
    # 重启PM2服务
    Write-Host ""
    Write-Host "[修复2] 重启PM2服务..." -ForegroundColor Yellow
    $restartCommand = "cd /opt/yoyo-transcoder && pm2 restart vps-transcoder-api"
    $sshCommand = "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} `"$restartCommand`""
    $result = cmd /c $sshCommand 2>&1
    Write-Host $result
    
    # 等待服务启动
    Write-Host ""
    Write-Host "等待服务启动..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    # 重新检查状态
    Write-Host ""
    Write-Host "[修复3] 验证修复结果..." -ForegroundColor Yellow
    try {
        $proxyStatus = Invoke-RestMethod -Uri "$VPS_API_URL/api/proxy/status" -Method GET -TimeoutSec 5
        Write-Host "√ 代理服务响应正常" -ForegroundColor Green
        Write-Host "  连接状态: $($proxyStatus.data.connectionStatus)" -ForegroundColor White
        
        if ($proxyStatus.data.connectionStatus -eq "connected") {
            Write-Host "√ 代理已成功连接！" -ForegroundColor Green
        } else {
            Write-Host "! 代理仍未连接，可能需要在前端重新配置代理" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "X 代理服务仍有问题: $_" -ForegroundColor Red
    }
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
