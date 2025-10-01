# 创建VPS部署包
# 将修复后的vps-transcoder-api代码打包成zip文件

Write-Host "📦 创建VPS部署包..." -ForegroundColor Green

$SourceDir = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api"
$OutputZip = "D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api.zip"

# 检查源目录
if (-not (Test-Path $SourceDir)) {
    Write-Host "❌ 错误: 源目录不存在: $SourceDir" -ForegroundColor Red
    exit 1
}

# 删除旧的zip文件
if (Test-Path $OutputZip) {
    Write-Host "🗑️  删除旧的部署包..." -ForegroundColor Yellow
    Remove-Item $OutputZip -Force
}

# 创建临时目录来准备打包内容
$TempDir = "$env:TEMP\vps-transcoder-deploy-$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Write-Host "📁 准备打包内容到: $TempDir" -ForegroundColor Yellow

# 创建临时目录
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

# 复制需要的文件和目录
$ItemsToCopy = @(
    "package.json",
    "package-lock.json", 
    "src",
    ".env.example"
)

foreach ($item in $ItemsToCopy) {
    $sourcePath = Join-Path $SourceDir $item
    $destPath = Join-Path $TempDir $item
    
    if (Test-Path $sourcePath) {
        if (Test-Path $sourcePath -PathType Container) {
            # 复制目录
            Copy-Item $sourcePath $destPath -Recurse -Force
            Write-Host "✅ 复制目录: $item" -ForegroundColor Green
        } else {
            # 复制文件
            Copy-Item $sourcePath $destPath -Force
            Write-Host "✅ 复制文件: $item" -ForegroundColor Green
        }
    } else {
        Write-Host "⚠️  跳过不存在的项目: $item" -ForegroundColor Yellow
    }
}

# 验证关键文件
$criticalFiles = @("package.json", "src\app.js", "src\services\ProcessManager.js")
foreach ($file in $criticalFiles) {
    $filePath = Join-Path $TempDir $file
    if (-not (Test-Path $filePath)) {
        Write-Host "❌ 错误: 关键文件缺失: $file" -ForegroundColor Red
        Remove-Item $TempDir -Recurse -Force
        exit 1
    }
}

Write-Host "✅ 所有关键文件验证通过" -ForegroundColor Green

# 创建zip包
Write-Host "🗜️  创建zip包..." -ForegroundColor Yellow
try {
    # 使用.NET压缩类创建zip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($TempDir, $OutputZip)
    
    Write-Host "✅ 部署包创建成功: $OutputZip" -ForegroundColor Green
    
    # 显示包信息
    $zipInfo = Get-Item $OutputZip
    $sizeKB = [math]::Round($zipInfo.Length / 1KB, 2)
    Write-Host "📊 包大小: $sizeKB KB" -ForegroundColor Cyan
    
} catch {
    Write-Host "❌ 创建zip包失败: $($_.Exception.Message)" -ForegroundColor Red
    Remove-Item $TempDir -Recurse -Force
    exit 1
}

# 清理临时目录
Write-Host "🗑️  清理临时文件..." -ForegroundColor Yellow
Remove-Item $TempDir -Recurse -Force

# 显示部署说明
Write-Host "`n🚀 部署说明:" -ForegroundColor Green
Write-Host "1. 将 vps-transcoder-api.zip 上传到VPS服务器" -ForegroundColor Yellow
Write-Host "2. 在VPS上执行以下命令:" -ForegroundColor Yellow
Write-Host "   chmod +x vps-deploy-from-zip.sh" -ForegroundColor Cyan
Write-Host "   ./vps-deploy-from-zip.sh vps-transcoder-api.zip" -ForegroundColor Cyan

Write-Host "`n✅ 部署包准备完成!" -ForegroundColor Green
