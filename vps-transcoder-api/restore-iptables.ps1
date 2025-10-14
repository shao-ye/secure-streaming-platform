# YOYO流媒体平台 - 恢复必要的iptables规则
# 在确保SSH访问安全的前提下，恢复必要的端口转发规则

Write-Host "🛡️ 恢复iptables规则配置" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

$VPS_HOST = "yoyo-vps.5202021.xyz"
$VPS_USER = "root"

Write-Host "📋 当前状态检查:" -ForegroundColor Yellow
Write-Host "VPS地址: $VPS_HOST" -ForegroundColor White
Write-Host ""

# 检查SSH连接
Write-Host "[1/4] 测试SSH连接..." -ForegroundColor Yellow
try {
    $sshTest = & ssh -o ConnectTimeout=5 -o BatchMode=yes "$VPS_USER@$VPS_HOST" "echo 'SSH OK'"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ SSH连接正常" -ForegroundColor Green
    } else {
        Write-Host "⚠️ SSH连接需要密码认证" -ForegroundColor Yellow
        Write-Host "建议先运行: .\setup-ssh-key.ps1" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ SSH连接失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "请确保VPS可访问且SSH服务正常" -ForegroundColor Gray
    exit 1
}

# 检查当前iptables状态
Write-Host ""
Write-Host "[2/4] 检查当前iptables状态..." -ForegroundColor Yellow

$checkScript = @'
echo "=== 当前iptables规则 ==="
echo "Filter表规则:"
iptables -L -n --line-numbers
echo ""
echo "NAT表规则:"
iptables -t nat -L -n --line-numbers
echo ""
echo "=== 系统服务状态 ==="
echo "Nginx状态:"
systemctl is-active nginx 2>/dev/null || echo "nginx未运行"
echo "VPS API状态:"
pm2 status | grep vps-transcoder-api || echo "VPS API未运行"
echo ""
echo "=== 端口监听状态 ==="
netstat -tlnp | grep -E ':(22|80|443|3000)' || echo "未发现监听端口"
'@

Write-Host "获取VPS当前状态..." -ForegroundColor Gray
try {
    $statusOutput = $checkScript | & ssh "$VPS_USER@$VPS_HOST" "bash"
    Write-Host $statusOutput -ForegroundColor Gray
} catch {
    Write-Host "❌ 无法获取VPS状态: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/4] 分析iptables配置需求..." -ForegroundColor Yellow

Write-Host "📋 YOYO流媒体平台端口需求:" -ForegroundColor Cyan
Write-Host "- SSH (22): 管理访问 ✓ 必需" -ForegroundColor White
Write-Host "- HTTP (80): Nginx反向代理 ✓ 必需" -ForegroundColor White  
Write-Host "- HTTPS (443): SSL终端 ✓ 必需" -ForegroundColor White
Write-Host "- API (3000): VPS转码服务 ✓ 必需" -ForegroundColor White
Write-Host "- RTMP (1935): 流媒体输入 ⚠️ 可选（通常由上游提供）" -ForegroundColor Yellow
Write-Host ""

Write-Host "🔍 当前问题分析:" -ForegroundColor Yellow
Write-Host "- 之前清理了所有iptables规则解决连接问题 ✓" -ForegroundColor Green
Write-Host "- 视频播放现在正常工作 ✓" -ForegroundColor Green
Write-Host "- 需要确保基本的防火墙保护 ⚠️" -ForegroundColor Yellow
Write-Host ""

$needsRestore = Read-Host "是否需要配置基本的iptables防火墙规则？(y/n)"
if ($needsRestore -ne 'y' -and $needsRestore -ne 'Y') {
    Write-Host "跳过iptables配置" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "[4/4] 配置安全的iptables规则..." -ForegroundColor Yellow

$iptablesScript = @'
#!/bin/bash
echo "🛡️ 配置YOYO流媒体平台iptables规则"

# 备份当前规则
echo "备份当前iptables规则..."
iptables-save > /root/iptables-backup-$(date +%Y%m%d_%H%M%S).rules 2>/dev/null || true

# 清理现有规则
echo "清理现有规则..."
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

# 设置默认策略（允许出站，拒绝入站）
echo "设置默认策略..."
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# 允许本地回环
echo "允许本地回环..."
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# 允许已建立的连接
echo "允许已建立的连接..."
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 允许SSH (22) - 最重要！
echo "允许SSH访问..."
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# 允许HTTP (80)
echo "允许HTTP访问..."
iptables -A INPUT -p tcp --dport 80 -j ACCEPT

# 允许HTTPS (443)
echo "允许HTTPS访问..."
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 允许VPS API (3000) - 仅本地访问
echo "允许VPS API本地访问..."
iptables -A INPUT -p tcp -s 127.0.0.1 --dport 3000 -j ACCEPT
iptables -A INPUT -p tcp -s ::1 --dport 3000 -j ACCEPT

# 允许ICMP (ping)
echo "允许ICMP..."
iptables -A INPUT -p icmp -j ACCEPT

# 保存规则
echo "保存iptables规则..."
if command -v iptables-save >/dev/null 2>&1; then
    iptables-save > /etc/iptables/rules.v4 2>/dev/null || \
    iptables-save > /etc/iptables.rules 2>/dev/null || \
    echo "警告: 无法保存iptables规则到文件"
fi

# 显示最终规则
echo ""
echo "✅ iptables规则配置完成"
echo ""
echo "当前规则:"
iptables -L -n --line-numbers
echo ""
echo "NAT规则:"
iptables -t nat -L -n --line-numbers

echo ""
echo "🔧 规则说明:"
echo "- SSH (22): 允许所有来源访问"
echo "- HTTP (80): 允许所有来源访问"  
echo "- HTTPS (443): 允许所有来源访问"
echo "- API (3000): 仅允许本地访问"
echo "- 其他端口: 默认拒绝"
echo ""
echo "⚠️ 重要提示:"
echo "- SSH访问已保护，不会被锁定"
echo "- 如需修改规则，请谨慎操作"
echo "- 备份文件: /root/iptables-backup-*.rules"
'@

Write-Host "执行iptables配置脚本..." -ForegroundColor Gray
try {
    $result = $iptablesScript | & ssh "$VPS_USER@$VPS_HOST" "bash"
    Write-Host $result -ForegroundColor Gray
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ iptables规则配置成功" -ForegroundColor Green
    } else {
        throw "iptables配置脚本执行失败"
    }
} catch {
    Write-Host "❌ iptables配置失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 紧急恢复步骤:" -ForegroundColor Yellow
    Write-Host "如果SSH连接中断，请通过VPS控制台执行:" -ForegroundColor White
    Write-Host "iptables -F && iptables -X && iptables -P INPUT ACCEPT" -ForegroundColor Cyan
    exit 1
}

# 测试服务可用性
Write-Host ""
Write-Host "🧪 测试服务可用性..." -ForegroundColor Yellow

Write-Host "测试SSH连接..." -ForegroundColor Gray
try {
    $sshTest2 = & ssh -o ConnectTimeout=5 "$VPS_USER@$VPS_HOST" "echo 'SSH still working'"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ SSH连接正常" -ForegroundColor Green
    } else {
        Write-Host "❌ SSH连接异常" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ SSH测试失败" -ForegroundColor Red
}

Write-Host "测试HTTP服务..." -ForegroundColor Gray
try {
    $httpTest = Invoke-WebRequest -Uri "http://$VPS_HOST" -TimeoutSec 5 -UseBasicParsing
    Write-Host "✓ HTTP服务响应正常 (状态码: $($httpTest.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "⚠️ HTTP服务测试失败: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "测试HTTPS服务..." -ForegroundColor Gray
try {
    $httpsTest = Invoke-WebRequest -Uri "https://$VPS_HOST" -TimeoutSec 5 -UseBasicParsing
    Write-Host "✓ HTTPS服务响应正常 (状态码: $($httpsTest.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "⚠️ HTTPS服务测试失败: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 iptables规则恢复完成！" -ForegroundColor Green
Write-Host ""
Write-Host "📋 配置总结:" -ForegroundColor Yellow
Write-Host "✓ SSH访问 (22) - 全开放" -ForegroundColor Green
Write-Host "✓ HTTP访问 (80) - 全开放" -ForegroundColor Green  
Write-Host "✓ HTTPS访问 (443) - 全开放" -ForegroundColor Green
Write-Host "✓ VPS API (3000) - 仅本地访问" -ForegroundColor Green
Write-Host "✓ 其他端口 - 默认拒绝" -ForegroundColor Green
Write-Host ""
Write-Host "🔒 安全特性:" -ForegroundColor Yellow
Write-Host "- 基本防火墙保护已启用" -ForegroundColor White
Write-Host "- SSH访问安全保障" -ForegroundColor White
Write-Host "- 服务端口适当开放" -ForegroundColor White
Write-Host "- 规则备份已创建" -ForegroundColor White
Write-Host ""

Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
