# ========================================
# VPS .env 文件更新脚本
# 用于添加新的必需配置项
# ========================================

Write-Host "=== VPS .env 文件更新工具 ===" -ForegroundColor Cyan
Write-Host ""

$envFile = ".env"
$envExampleFile = ".env.example"

# 检查.env文件是否存在
if (-not (Test-Path $envFile)) {
    Write-Host "❌ .env文件不存在" -ForegroundColor Red
    Write-Host "建议：复制.env.example并修改" -ForegroundColor Yellow
    Write-Host "  cp .env.example .env" -ForegroundColor Gray
    exit 1
}

Write-Host "✅ 找到.env文件" -ForegroundColor Green
Write-Host ""

# 读取现有配置
$existingContent = Get-Content $envFile -Raw

# 需要检查的必需配置项
$requiredConfigs = @(
    "VPS_BASE_URL",
    "WORKERS_API_URL",
    "VPS_API_KEY",
    "HLS_OUTPUT_DIR",
    "LOG_DIR"
)

Write-Host "检查必需配置项..." -ForegroundColor Yellow
Write-Host ""

$missingConfigs = @()
foreach ($config in $requiredConfigs) {
    if ($existingContent -match "^$config\s*=") {
        Write-Host "  ✅ $config - 已配置" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $config - 缺失" -ForegroundColor Red
        $missingConfigs += $config
    }
}

Write-Host ""

if ($missingConfigs.Count -eq 0) {
    Write-Host "🎉 所有必需配置项已存在！" -ForegroundColor Green
    Write-Host ""
    Write-Host "可选配置项检查..." -ForegroundColor Yellow
    
    $optionalConfigs = @(
        "TUNNEL_BASE_URL",
        "WORKERS_API_KEY",
        "HOLIDAY_API_URL",
        "PROXY_TEST_BAIDU",
        "PROXY_TEST_GOOGLE"
    )
    
    foreach ($config in $optionalConfigs) {
        if ($existingContent -match "^$config\s*=") {
            Write-Host "  ✅ $config - 已配置" -ForegroundColor Green
        } else {
            Write-Host "  ⚪ $config - 未配置（可选）" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
    Write-Host "✅ 配置检查完成" -ForegroundColor Green
    exit 0
}

# 有缺失的配置项
Write-Host "⚠️  发现 $($missingConfigs.Count) 个缺失的必需配置项" -ForegroundColor Yellow
Write-Host ""
Write-Host "需要添加的配置项：" -ForegroundColor Cyan
foreach ($config in $missingConfigs) {
    Write-Host "  - $config" -ForegroundColor Gray
}
Write-Host ""

# 询问是否自动添加
$response = Read-Host "是否自动添加缺失配置项到.env文件？(y/n)"

if ($response -ne "y") {
    Write-Host ""
    Write-Host "已取消。请手动添加以下配置项到.env文件：" -ForegroundColor Yellow
    Write-Host ""
    
    if ($missingConfigs -contains "VPS_BASE_URL") {
        Write-Host "VPS_BASE_URL=https://yoyo-vps.5202021.xyz" -ForegroundColor Gray
    }
    if ($missingConfigs -contains "WORKERS_API_URL") {
        Write-Host "WORKERS_API_URL=https://yoyoapi.5202021.xyz" -ForegroundColor Gray
    }
    if ($missingConfigs -contains "VPS_API_KEY") {
        Write-Host "VPS_API_KEY=your-vps-api-key-here" -ForegroundColor Gray
    }
    if ($missingConfigs -contains "HLS_OUTPUT_DIR") {
        Write-Host "HLS_OUTPUT_DIR=./hls" -ForegroundColor Gray
    }
    if ($missingConfigs -contains "LOG_DIR") {
        Write-Host "LOG_DIR=./logs" -ForegroundColor Gray
    }
    
    Write-Host ""
    exit 0
}

# 备份现有.env文件
$backupFile = ".env.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $envFile $backupFile
Write-Host ""
Write-Host "✅ 已备份到: $backupFile" -ForegroundColor Green
Write-Host ""

# 准备要添加的内容
$newContent = @"

# ========================================
# 自动添加的配置项 ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
# ========================================

"@

if ($missingConfigs -contains "VPS_BASE_URL") {
    $newContent += @"

# VPS基础域名（本服务的公网访问地址）
VPS_BASE_URL=https://yoyo-vps.5202021.xyz

"@
}

if ($missingConfigs -contains "WORKERS_API_URL") {
    $newContent += @"

# Workers API域名（Cloudflare Workers的访问地址）
WORKERS_API_URL=https://yoyoapi.5202021.xyz

"@
}

if ($missingConfigs -contains "VPS_API_KEY") {
    $newContent += @"

# VPS API密钥（请修改为实际密钥）
VPS_API_KEY=your-vps-api-key-change-in-production

"@
}

if ($missingConfigs -contains "HLS_OUTPUT_DIR") {
    $newContent += @"

# HLS输出目录
HLS_OUTPUT_DIR=./hls

"@
}

if ($missingConfigs -contains "LOG_DIR") {
    $newContent += @"

# 日志目录
LOG_DIR=./logs

"@
}

# 添加到.env文件
Add-Content -Path $envFile -Value $newContent

Write-Host "✅ 已添加缺失配置项到.env文件" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  重要提示：" -ForegroundColor Yellow
Write-Host "  1. 请检查并修改.env文件中的配置值" -ForegroundColor Gray
Write-Host "  2. 特别是API密钥，需要改成实际的值" -ForegroundColor Gray
Write-Host "  3. 修改完成后再启动服务" -ForegroundColor Gray
Write-Host ""
Write-Host "查看添加的内容：" -ForegroundColor Cyan
Write-Host "  cat .env | Select-String -Pattern 'VPS_BASE_URL|WORKERS_API_URL'" -ForegroundColor Gray
Write-Host ""
