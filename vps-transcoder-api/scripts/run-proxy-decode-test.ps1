# 代理解码性能测试执行脚本
# 上传测试脚本到VPS并执行

$VPS_HOST = "142.171.75.220"
$VPS_USER = "root"
$VPS_PASSWORD = "kNX66a7P3q6rtCV5Ql"
$SCRIPT_PATH = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\scripts\test-proxy-decode-performance.sh"

Write-Host "========================================"
Write-Host "代理解码性能测试"
Write-Host "========================================"

# 步骤1: 上传测试脚本到VPS
Write-Host ""
Write-Host "[步骤1] 上传测试脚本到VPS..."

$sshPassword = ConvertTo-SecureString $VPS_PASSWORD -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($VPS_USER, $sshPassword)

# 使用SCP上传脚本
try {
    # 读取脚本内容
    $scriptContent = Get-Content $SCRIPT_PATH -Raw
    
    # 使用SSH直接写入文件（避免SCP问题）
    Write-Host "正在上传脚本..."
    
    # 创建临时脚本
    $tempScript = @"
cat > /tmp/test-proxy-decode.sh << 'EOFSCRIPT'
$scriptContent
EOFSCRIPT
chmod +x /tmp/test-proxy-decode.sh
"@
    
    # 使用plink上传
    $tempScript | ssh ${VPS_USER}@${VPS_HOST} "bash"
    
    Write-Host "✓ 脚本上传成功"
} catch {
    Write-Host "✗ 脚本上传失败: $_"
    exit 1
}

# 步骤2: 执行测试
Write-Host ""
Write-Host "[步骤2] 执行性能测试..."
Write-Host "----------------------------------------"
Write-Host "测试需要约1-2分钟，请耐心等待..."
Write-Host "----------------------------------------"
Write-Host ""

# 执行测试脚本
try {
    # 注意：这个命令会阻塞直到测试完成
    ssh ${VPS_USER}@${VPS_HOST} "bash /tmp/test-proxy-decode.sh"
    
    Write-Host ""
    Write-Host "✓ 测试执行完成"
} catch {
    Write-Host "✗ 测试执行失败: $_"
    Write-Host ""
    Write-Host "尝试查看测试日志..."
    ssh ${VPS_USER}@${VPS_HOST} "ls -la /tmp/proxy_test_* 2>/dev/null || echo '未找到测试日志'"
}

Write-Host ""
Write-Host "========================================"
Write-Host "测试完成"
Write-Host "========================================"
