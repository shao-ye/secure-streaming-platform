# Manual SSH Key Setup for VPS
# Since ssh-copy-id is not available on Windows, we'll do it manually

Write-Host "Manual SSH Key Setup" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""

$VPS_HOST = "yoyo-vps.5202021.xyz"
$VPS_USER = "root"
$SSH_PUB_KEY_PATH = "$env:USERPROFILE\.ssh\id_rsa.pub"

# Read the public key
Write-Host "Reading SSH public key..." -ForegroundColor Yellow
try {
    $publicKey = Get-Content $SSH_PUB_KEY_PATH -Raw
    $publicKey = $publicKey.Trim()
    Write-Host "Public key loaded successfully" -ForegroundColor Green
} catch {
    Write-Host "Error reading public key: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Create the SSH setup command
$sshSetupCommand = @"
mkdir -p ~/.ssh && \
chmod 700 ~/.ssh && \
echo '$publicKey' >> ~/.ssh/authorized_keys && \
chmod 600 ~/.ssh/authorized_keys && \
sort ~/.ssh/authorized_keys | uniq > ~/.ssh/authorized_keys.tmp && \
mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys && \
chmod 600 ~/.ssh/authorized_keys && \
echo 'SSH key setup completed successfully'
"@

Write-Host "Executing SSH key setup on VPS..." -ForegroundColor Yellow
Write-Host "You will need to enter the VPS password" -ForegroundColor Gray
Write-Host ""

try {
    # Execute the setup command on VPS
    $result = $sshSetupCommand | & ssh "$VPS_USER@$VPS_HOST" "bash"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "SSH key setup completed!" -ForegroundColor Green
        Write-Host "Result: $result" -ForegroundColor Gray
    } else {
        throw "SSH setup command failed"
    }
} catch {
    Write-Host "SSH setup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please try the manual steps shown in the previous output" -ForegroundColor Yellow
    exit 1
}

# Test the SSH connection
Write-Host ""
Write-Host "Testing passwordless SSH connection..." -ForegroundColor Yellow
try {
    $testResult = & ssh -o ConnectTimeout=10 -o BatchMode=yes "$VPS_USER@$VPS_HOST" "echo 'SSH key authentication successful'"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "SUCCESS! SSH key authentication is working!" -ForegroundColor Green
        Write-Host "Response: $testResult" -ForegroundColor Gray
    } else {
        Write-Host "SSH key test failed - you may still need to enter password" -ForegroundColor Yellow
        Write-Host "This could be due to VPS SSH configuration" -ForegroundColor Gray
    }
} catch {
    Write-Host "SSH test failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Create SSH config for convenience
Write-Host ""
Write-Host "Creating SSH config for convenience..." -ForegroundColor Yellow
$sshConfigPath = "$env:USERPROFILE\.ssh\config"
$sshConfigContent = @"

# YOYO VPS Configuration
Host yoyo-vps
    HostName $VPS_HOST
    User $VPS_USER
    IdentityFile $env:USERPROFILE\.ssh\id_rsa
    IdentitiesOnly yes
    ServerAliveInterval 60
    ServerAliveCountMax 3

"@

try {
    if (Test-Path $sshConfigPath) {
        $existingConfig = Get-Content $sshConfigPath -Raw
        if ($existingConfig -notmatch "Host yoyo-vps") {
            Add-Content -Path $sshConfigPath -Value $sshConfigContent
            Write-Host "SSH config added" -ForegroundColor Green
        } else {
            Write-Host "SSH config already exists" -ForegroundColor Green
        }
    } else {
        Set-Content -Path $sshConfigPath -Value $sshConfigContent.TrimStart()
        Write-Host "SSH config file created" -ForegroundColor Green
    }
} catch {
    Write-Host "SSH config creation failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "You can now try:" -ForegroundColor Yellow
Write-Host "  ssh yoyo-vps" -ForegroundColor Cyan
Write-Host "  ssh $VPS_USER@$VPS_HOST" -ForegroundColor Cyan
Write-Host ""

Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
