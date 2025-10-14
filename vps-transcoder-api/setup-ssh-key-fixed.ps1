# YOYO SSH Key Setup Script
# Configure passwordless SSH login to VPS

Write-Host "SSH Key Authentication Setup" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

$VPS_HOST = "yoyo-vps.5202021.xyz"
$VPS_USER = "root"
$SSH_KEY_PATH = "$env:USERPROFILE\.ssh\id_rsa"
$SSH_PUB_KEY_PATH = "$env:USERPROFILE\.ssh\id_rsa.pub"

Write-Host "Configuration Info:" -ForegroundColor Yellow
Write-Host "VPS Address: $VPS_HOST" -ForegroundColor White
Write-Host "Username: $VPS_USER" -ForegroundColor White
Write-Host "Key Path: $SSH_KEY_PATH" -ForegroundColor White
Write-Host ""

# 1. Check SSH directory
Write-Host "[1/5] Checking SSH directory..." -ForegroundColor Yellow
$sshDir = "$env:USERPROFILE\.ssh"
if (!(Test-Path $sshDir)) {
    Write-Host "Creating SSH directory: $sshDir" -ForegroundColor Gray
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
}
Write-Host "SSH directory ready" -ForegroundColor Green

# 2. Check existing keys
Write-Host ""
Write-Host "[2/5] Checking existing SSH keys..." -ForegroundColor Yellow
$keyExists = Test-Path $SSH_KEY_PATH
$pubKeyExists = Test-Path $SSH_PUB_KEY_PATH

if ($keyExists -and $pubKeyExists) {
    Write-Host "Found existing key pair" -ForegroundColor Green
    Write-Host "Private key: $SSH_KEY_PATH" -ForegroundColor Gray
    Write-Host "Public key: $SSH_PUB_KEY_PATH" -ForegroundColor Gray
    
    $useExisting = Read-Host "Use existing key? (y/n)"
    if ($useExisting -eq 'n' -or $useExisting -eq 'N') {
        $keyExists = $false
    }
} else {
    Write-Host "No existing keys found, will generate new ones" -ForegroundColor Yellow
}

# 3. Generate SSH keys if needed
if (!$keyExists) {
    Write-Host ""
    Write-Host "[3/5] Generating SSH key pair..." -ForegroundColor Yellow
    
    Write-Host "Generating RSA key pair..." -ForegroundColor Gray
    try {
        # Generate SSH key using ssh-keygen
        $keygenArgs = @(
            "-t", "rsa",
            "-b", "4096",
            "-f", $SSH_KEY_PATH,
            "-N", '""',
            "-C", "yoyo-vps-access-$(Get-Date -Format 'yyyyMMdd')"
        )
        
        & ssh-keygen @keygenArgs
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "SSH key pair generated successfully" -ForegroundColor Green
        } else {
            throw "ssh-keygen command failed"
        }
    } catch {
        Write-Host "SSH key generation failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Manual generation steps:" -ForegroundColor Yellow
        Write-Host "1. Open PowerShell or Command Prompt" -ForegroundColor White
        Write-Host "2. Run: ssh-keygen -t rsa -b 4096 -f `"$SSH_KEY_PATH`" -N `"`" -C `"yoyo-vps-access`"" -ForegroundColor White
        Write-Host "3. Re-run this script" -ForegroundColor White
        exit 1
    }
} else {
    Write-Host ""
    Write-Host "[3/5] Using existing SSH keys" -ForegroundColor Yellow
    Write-Host "Skipping key generation" -ForegroundColor Green
}

# 4. Read public key content
Write-Host ""
Write-Host "[4/5] Reading public key content..." -ForegroundColor Yellow
try {
    $publicKey = Get-Content $SSH_PUB_KEY_PATH -Raw
    $publicKey = $publicKey.Trim()
    Write-Host "Public key read successfully" -ForegroundColor Green
    Write-Host "Key preview: $($publicKey.Substring(0, [Math]::Min(50, $publicKey.Length)))..." -ForegroundColor Gray
} catch {
    Write-Host "Cannot read public key file: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 5. Upload public key to VPS
Write-Host ""
Write-Host "[5/5] Configuring VPS SSH authentication..." -ForegroundColor Yellow
Write-Host "You will need to enter VPS password for initial setup" -ForegroundColor Yellow

try {
    # Method 1: Use ssh-copy-id if available
    Write-Host "Trying ssh-copy-id..." -ForegroundColor Gray
    & ssh-copy-id -i $SSH_PUB_KEY_PATH "$VPS_USER@$VPS_HOST"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Configuration successful using ssh-copy-id" -ForegroundColor Green
    } else {
        # Method 2: Manual configuration
        Write-Host "ssh-copy-id not available, using manual method..." -ForegroundColor Gray
        
        # Create temporary script
        $tempScript = @"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo '$publicKey' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
# Remove duplicates
sort ~/.ssh/authorized_keys | uniq > ~/.ssh/authorized_keys.tmp
mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo "SSH key added successfully"
"@
        
        Write-Host "Executing SSH key configuration..." -ForegroundColor Gray
        $tempScript | & ssh "$VPS_USER@$VPS_HOST" "bash"
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Manual SSH key configuration successful" -ForegroundColor Green
        } else {
            throw "SSH key configuration failed"
        }
    }
} catch {
    Write-Host "SSH key configuration failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Manual configuration steps:" -ForegroundColor Yellow
    Write-Host "1. Copy the following public key content:" -ForegroundColor White
    Write-Host "   $publicKey" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "2. SSH login to VPS:" -ForegroundColor White
    Write-Host "   ssh $VPS_USER@$VPS_HOST" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Execute the following commands on VPS:" -ForegroundColor White
    Write-Host "   mkdir -p ~/.ssh" -ForegroundColor Gray
    Write-Host "   chmod 700 ~/.ssh" -ForegroundColor Gray
    Write-Host "   echo '$publicKey' >> ~/.ssh/authorized_keys" -ForegroundColor Gray
    Write-Host "   chmod 600 ~/.ssh/authorized_keys" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

# 6. Test SSH connection
Write-Host ""
Write-Host "Testing SSH key authentication..." -ForegroundColor Yellow
Write-Host "Attempting passwordless connection to VPS..." -ForegroundColor Gray

try {
    # Test connection with short timeout
    $testResult = & ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS_USER@$VPS_HOST" "echo 'SSH key authentication successful'"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "SSH key authentication test successful!" -ForegroundColor Green
        Write-Host "Response: $testResult" -ForegroundColor Gray
    } else {
        throw "SSH connection test failed"
    }
} catch {
    Write-Host "SSH key authentication test failed" -ForegroundColor Yellow
    Write-Host "Possible causes:" -ForegroundColor Gray
    Write-Host "- VPS SSH service configuration issues" -ForegroundColor Gray
    Write-Host "- Key permission issues" -ForegroundColor Gray
    Write-Host "- Network connection issues" -ForegroundColor Gray
    
    Write-Host ""
    Write-Host "Manual test steps:" -ForegroundColor Yellow
    Write-Host "ssh -v $VPS_USER@$VPS_HOST" -ForegroundColor Gray
}

# 7. Configure SSH client
Write-Host ""
Write-Host "Configuring SSH client..." -ForegroundColor Yellow
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
    # Check if configuration already exists
    if (Test-Path $sshConfigPath) {
        $existingConfig = Get-Content $sshConfigPath -Raw
        if ($existingConfig -notmatch "Host yoyo-vps") {
            Add-Content -Path $sshConfigPath -Value $sshConfigContent
            Write-Host "SSH configuration added to existing config file" -ForegroundColor Green
        } else {
            Write-Host "SSH configuration already exists" -ForegroundColor Green
        }
    } else {
        Set-Content -Path $sshConfigPath -Value $sshConfigContent.TrimStart()
        Write-Host "SSH configuration file created" -ForegroundColor Green
    }
} catch {
    Write-Host "SSH configuration file write failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "SSH key authentication setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Usage methods:" -ForegroundColor Yellow
Write-Host "Method 1 - Using alias:" -ForegroundColor White
Write-Host "  ssh yoyo-vps" -ForegroundColor Cyan
Write-Host ""
Write-Host "Method 2 - Using full address:" -ForegroundColor White
Write-Host "  ssh $VPS_USER@$VPS_HOST" -ForegroundColor Cyan
Write-Host ""
Write-Host "Method 3 - SCP file transfer:" -ForegroundColor White
Write-Host "  scp localfile yoyo-vps:/path/to/destination" -ForegroundColor Cyan
Write-Host ""
Write-Host "Troubleshooting:" -ForegroundColor Yellow
Write-Host "If password is still required, check:" -ForegroundColor White
Write-Host "1. VPS SSH service configuration: /etc/ssh/sshd_config" -ForegroundColor Gray
Write-Host "2. Ensure PubkeyAuthentication yes" -ForegroundColor Gray
Write-Host "3. Restart SSH service: systemctl restart sshd" -ForegroundColor Gray
Write-Host ""

Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
