# YOYO流媒体平台 - SSH密钥认证配置脚本
# 配置免密码SSH登录到VPS

Write-Host "SSH密钥认证配置" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""

$VPS_HOST = "yoyo-vps.5202021.xyz"
$VPS_USER = "root"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\id_rsa"
$SSH_PUB_KEY_PATH = "$env:USERPROFILE\.ssh\id_rsa.pub"

Write-Host "配置信息:" -ForegroundColor Yellow
Write-Host "VPS地址: $VPS_HOST" -ForegroundColor White
Write-Host "用户名: $VPS_USER" -ForegroundColor White
Write-Host "密钥路径: $SSH_KEY_PATH" -ForegroundColor White
Write-Host ""

# 1. 检查SSH目录
Write-Host "[1/5] 检查SSH目录..." -ForegroundColor Yellow
$sshDir = "$env:USERPROFILE\.ssh"
if (!(Test-Path $sshDir)) {
    Write-Host "创建SSH目录: $sshDir" -ForegroundColor Gray
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
}
Write-Host "SSH目录准备完成" -ForegroundColor Green

# 2. 检查现有密钥
Write-Host ""
Write-Host "[2/5] 检查现有SSH密钥..." -ForegroundColor Yellow
$keyExists = Test-Path $SSH_KEY_PATH
$pubKeyExists = Test-Path $SSH_PUB_KEY_PATH

if ($keyExists -and $pubKeyExists) {
    Write-Host "发现现有密钥对" -ForegroundColor Green
    Write-Host "私钥: $SSH_KEY_PATH" -ForegroundColor Gray
    Write-Host "公钥: $SSH_PUB_KEY_PATH" -ForegroundColor Gray
    
    $useExisting = Read-Host "是否使用现有密钥(y/n)"
    if ($useExisting -eq 'n' -or $useExisting -eq 'N') {
        $keyExists = $false
    }
} else {
    Write-Host "未发现现有密钥，需要生成新密钥" -ForegroundColor Yellow
}

# 3. 生成SSH密钥（如果需要）
if (!$keyExists) {
    Write-Host ""
    Write-Host "[3/5] 生成SSH密钥对..." -ForegroundColor Yellow
    
    Write-Host "正在生成RSA密钥对..." -ForegroundColor Gray
    try {
        # 使用ssh-keygen生成密钥
        $keygenArgs = @(
            "-t", "rsa",
            "-b", "4096",
            "-f", $SSH_KEY_PATH,
            "-N", '""',  # 空密码
            "-C", "yoyo-vps-access-$(Get-Date -Format 'yyyyMMdd')"
        )
        
        & ssh-keygen @keygenArgs
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ SSH密钥对生成成功" -ForegroundColor Green
        } else {
            throw "ssh-keygen命令执行失败"
        }
    } catch {
        Write-Host "❌ SSH密钥生成失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "🔧 手动生成步骤:" -ForegroundColor Yellow
        Write-Host "1. 打开PowerShell或命令提示符" -ForegroundColor White
        Write-Host "2. 运行: ssh-keygen -t rsa -b 4096 -f `"$SSH_KEY_PATH`" -N `"`" -C `"yoyo-vps-access`"" -ForegroundColor White
        Write-Host "3. 重新运行此脚本" -ForegroundColor White
        exit 1
    }
} else {
    Write-Host ""
    Write-Host "[3/5] 使用现有SSH密钥" -ForegroundColor Yellow
    Write-Host "✓ 跳过密钥生成" -ForegroundColor Green
}

# 4. 读取公钥内容
Write-Host ""
Write-Host "[4/5] 读取公钥内容..." -ForegroundColor Yellow
try {
    $publicKey = Get-Content $SSH_PUB_KEY_PATH -Raw
    $publicKey = $publicKey.Trim()
    Write-Host "✓ 公钥读取成功" -ForegroundColor Green
    Write-Host "公钥内容: $($publicKey.Substring(0, [Math]::Min(50, $publicKey.Length)))..." -ForegroundColor Gray
} catch {
    Write-Host "❌ 无法读取公钥文件: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 5. 上传公钥到VPS
Write-Host ""
Write-Host "[5/5] 配置VPS SSH认证..." -ForegroundColor Yellow
Write-Host "⚠️ 需要输入VPS密码来完成初始配置" -ForegroundColor Yellow

try {
    # 方法1: 使用ssh-copy-id（如果可用）
    Write-Host "尝试使用ssh-copy-id..." -ForegroundColor Gray
    & ssh-copy-id -i $SSH_PUB_KEY_PATH "$VPS_USER@$VPS_HOST"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 使用ssh-copy-id配置成功" -ForegroundColor Green
    } else {
        # 方法2: 手动配置
        Write-Host "ssh-copy-id不可用，使用手动方法..." -ForegroundColor Gray
        
        # 创建临时脚本
        $tempScript = @"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo '$publicKey' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
# 去重
sort ~/.ssh/authorized_keys | uniq > ~/.ssh/authorized_keys.tmp
mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo "SSH key added successfully"
"@
        
        Write-Host "执行SSH密钥配置..." -ForegroundColor Gray
        $tempScript | & ssh "$VPS_USER@$VPS_HOST" "bash"
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ 手动配置SSH密钥成功" -ForegroundColor Green
        } else {
            throw "SSH密钥配置失败"
        }
    }
} catch {
    Write-Host "❌ SSH密钥配置失败: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "🔧 手动配置步骤:" -ForegroundColor Yellow
    Write-Host "1. 复制以下公钥内容:" -ForegroundColor White
    Write-Host "   $publicKey" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "2. SSH登录到VPS:" -ForegroundColor White
    Write-Host "   ssh $VPS_USER@$VPS_HOST" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. 在VPS上执行以下命令:" -ForegroundColor White
    Write-Host "   mkdir -p ~/.ssh" -ForegroundColor Gray
    Write-Host "   chmod 700 ~/.ssh" -ForegroundColor Gray
    Write-Host "   echo '$publicKey' >> ~/.ssh/authorized_keys" -ForegroundColor Gray
    Write-Host "   chmod 600 ~/.ssh/authorized_keys" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

# 6. 测试SSH连接
Write-Host ""
Write-Host "🧪 测试SSH密钥认证..." -ForegroundColor Yellow
Write-Host "尝试免密码连接VPS..." -ForegroundColor Gray

try {
    # 测试连接（设置较短超时）
    $testResult = & ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS_USER@$VPS_HOST" "echo 'SSH key authentication successful'"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ SSH密钥认证测试成功！" -ForegroundColor Green
        Write-Host "响应: $testResult" -ForegroundColor Gray
    } else {
        throw "SSH连接测试失败"
    }
} catch {
    Write-Host "⚠️ SSH密钥认证测试失败" -ForegroundColor Yellow
    Write-Host "可能原因:" -ForegroundColor Gray
    Write-Host "- VPS SSH服务配置问题" -ForegroundColor Gray
    Write-Host "- 密钥权限问题" -ForegroundColor Gray
    Write-Host "- 网络连接问题" -ForegroundColor Gray
    
    Write-Host ""
    Write-Host "🔧 手动测试步骤:" -ForegroundColor Yellow
    Write-Host "ssh -v $VPS_USER@$VPS_HOST" -ForegroundColor Gray
}

# 7. 配置SSH客户端
Write-Host ""
Write-Host "📝 配置SSH客户端..." -ForegroundColor Yellow
$sshConfigPath = "$env:USERPROFILE\.ssh\config"
$sshConfigContent = @"

# YOYO VPS Configuration
Host yoyo-vps
    HostName $VPS_HOST
    User $VPS_USER
    IdentityFile $SSH_KEY_PATH
    IdentitiesOnly yes
    ServerAliveInterval 60
    ServerAliveCountMax 3

"@

try {
    # 检查是否已存在配置
    if (Test-Path $sshConfigPath) {
        $existingConfig = Get-Content $sshConfigPath -Raw
        if ($existingConfig -notmatch "Host yoyo-vps") {
            Add-Content -Path $sshConfigPath -Value $sshConfigContent
            Write-Host "✓ SSH配置已添加到现有config文件" -ForegroundColor Green
        } else {
            Write-Host "✓ SSH配置已存在" -ForegroundColor Green
        }
    } else {
        Set-Content -Path $sshConfigPath -Value $sshConfigContent.TrimStart()
        Write-Host "✓ 创建SSH配置文件" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️ SSH配置文件写入失败: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 SSH密钥认证配置完成！" -ForegroundColor Green
Write-Host ""
Write-Host "📋 使用方法:" -ForegroundColor Yellow
Write-Host "方法1 - 使用别名:" -ForegroundColor White
Write-Host "  ssh yoyo-vps" -ForegroundColor Cyan
Write-Host ""
Write-Host "方法2 - 使用完整地址:" -ForegroundColor White
Write-Host "  ssh $VPS_USER@$VPS_HOST" -ForegroundColor Cyan
Write-Host ""
Write-Host "方法3 - SCP文件传输:" -ForegroundColor White
Write-Host "  scp localfile yoyo-vps:/path/to/destination" -ForegroundColor Cyan
Write-Host ""
Write-Host "🔧 故障排除:" -ForegroundColor Yellow
Write-Host "如果仍需要密码，请检查:" -ForegroundColor White
Write-Host "1. VPS上的SSH服务配置: /etc/ssh/sshd_config" -ForegroundColor Gray
Write-Host "2. 确保PubkeyAuthentication yes" -ForegroundColor Gray
Write-Host "3. 重启SSH服务: systemctl restart sshd" -ForegroundColor Gray
Write-Host ""

Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
