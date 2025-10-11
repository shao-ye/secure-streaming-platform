# SSH免密登录设置脚本
# 使用expect工具自动输入密码

$VPS_HOST = "142.171.75.220"
$VPS_USER = "root"
$VPS_PASSWORD = "kNX66a7P3q6rtCV5Ql"
$PUBLIC_KEY_PATH = "$env:USERPROFILE\.ssh\id_rsa.pub"

Write-Host "🔑 开始设置SSH免密登录..." -ForegroundColor Green

# 检查公钥文件是否存在
if (-not (Test-Path $PUBLIC_KEY_PATH)) {
    Write-Host "❌ 公钥文件不存在: $PUBLIC_KEY_PATH" -ForegroundColor Red
    exit 1
}

# 读取公钥内容
$publicKey = Get-Content $PUBLIC_KEY_PATH -Raw
$publicKey = $publicKey.Trim()

Write-Host "📋 公钥内容:" -ForegroundColor Yellow
Write-Host $publicKey

# 创建expect脚本来自动输入密码
$expectScript = @"
spawn ssh -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST "mkdir -p ~/.ssh && echo '$publicKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh && echo 'SSH key added successfully'"
expect "password:"
send "$VPS_PASSWORD\r"
expect eof
"@

# 将expect脚本写入临时文件
$tempExpectFile = "$env:TEMP\ssh_setup.exp"
$expectScript | Out-File -FilePath $tempExpectFile -Encoding ASCII

Write-Host "🚀 正在上传SSH公钥到VPS..." -ForegroundColor Cyan

# 检查是否安装了expect（通过WSL或Git Bash）
$expectPath = $null
if (Get-Command "expect" -ErrorAction SilentlyContinue) {
    $expectPath = "expect"
} elseif (Get-Command "wsl" -ErrorAction SilentlyContinue) {
    # 使用WSL中的expect
    Write-Host "📦 使用WSL执行expect脚本..." -ForegroundColor Blue
    wsl expect $tempExpectFile.Replace('\', '/').Replace('C:', '/mnt/c')
} else {
    Write-Host "⚠️  未找到expect工具，使用备用方案..." -ForegroundColor Yellow
    
    # 备用方案：使用PowerShell直接连接
    Write-Host "🔄 尝试使用PowerShell SSH模块..." -ForegroundColor Blue
    
    # 创建SSH连接脚本
    $sshCommand = "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no $VPS_USER@$VPS_HOST"
    $remoteCommand = "mkdir -p ~/.ssh && echo '$publicKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && chmod 700 ~/.ssh"
    
    Write-Host "📝 请手动执行以下命令并输入密码:" -ForegroundColor Magenta
    Write-Host "$sshCommand `"$remoteCommand`"" -ForegroundColor White
    Write-Host "密码: $VPS_PASSWORD" -ForegroundColor Yellow
}

# 清理临时文件
if (Test-Path $tempExpectFile) {
    Remove-Item $tempExpectFile -Force
}

Write-Host "`n✅ SSH密钥设置脚本执行完成！" -ForegroundColor Green
Write-Host "🧪 现在可以测试免密登录: ssh $VPS_USER@$VPS_HOST" -ForegroundColor Cyan
