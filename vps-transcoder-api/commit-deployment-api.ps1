# Git提交脚本 - 提交部署API和相关文件

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  提交部署API到Git仓库" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查Git状态
Write-Host "检查Git仓库状态..." -ForegroundColor Yellow
try {
    $gitStatus = git status --porcelain
    if ($gitStatus) {
        Write-Host "发现以下文件变更:" -ForegroundColor Green
        $gitStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    } else {
        Write-Host "没有文件变更" -ForegroundColor Gray
    }
} catch {
    Write-Host "Git状态检查失败: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# 添加所有新文件和修改
Write-Host "添加文件到Git..." -ForegroundColor Yellow
try {
    # 添加新创建的API和脚本文件
    git add vps-transcoder-api/src/routes/deployment.js
    git add vps-transcoder-api/src/app.js
    git add integrate-proxy-streaming.sh
    git add deploy-via-api.ps1
    git add one-click-deploy.ps1
    git add verify-proxy-streaming.ps1
    git add deploy-proxy-streaming.ps1
    git add commit-deployment-api.ps1
    
    Write-Host "✓ 文件已添加到Git暂存区" -ForegroundColor Green
} catch {
    Write-Host "Git添加文件失败: $_" -ForegroundColor Red
    exit 1
}

# 显示即将提交的文件
Write-Host ""
Write-Host "即将提交的文件:" -ForegroundColor Yellow
try {
    $stagedFiles = git diff --cached --name-only
    $stagedFiles | ForEach-Object { Write-Host "  + $_" -ForegroundColor Green }
} catch {
    Write-Host "获取暂存文件列表失败" -ForegroundColor Red
}

Write-Host ""

# 用户确认
$response = Read-Host "确认提交这些文件？(y/n)"
if ($response -ne 'y' -and $response -ne 'Y') {
    Write-Host "用户取消提交" -ForegroundColor Yellow
    exit 0
}

# 提交代码
Write-Host ""
Write-Host "提交代码到Git..." -ForegroundColor Yellow
try {
    $commitMessage = "feat: 实现API自动部署系统

✨ 新增功能:
- VPS部署API接口 (deployment.js)
- 支持通过HTTP API拉取Git代码
- 支持远程执行脚本和重启服务
- Windows端API调用脚本 (deploy-via-api.ps1)
- 一键部署脚本 (one-click-deploy.ps1)
- 代理流媒体集成脚本 (integrate-proxy-streaming.sh)

🔧 技术特性:
- 无需SSH连接，纯HTTP API操作
- 完整的错误处理和日志记录
- 支持脚本执行状态实时监控
- 自动化代码同步和服务重启
- 透明代理规则自动管理

📋 API端点:
- GET /api/deployment/git/status - 检查Git状态
- POST /api/deployment/git/pull - 拉取最新代码
- POST /api/deployment/sync/code - 同步代码到运行目录
- POST /api/deployment/execute/script - 执行指定脚本
- POST /api/deployment/pm2/restart - 重启PM2服务
- POST /api/deployment/deploy/complete - 一键部署流程
- GET /api/deployment/status - 获取部署状态

🎯 解决问题:
- SSH连接卡死问题
- 手动部署效率低
- 代理流媒体功能集成复杂
- 缺少自动化部署工具

Co-authored-by: AI Assistant <assistant@windsurf.dev>"

    git commit -m $commitMessage
    Write-Host "✓ 代码提交成功" -ForegroundColor Green
} catch {
    Write-Host "Git提交失败: $_" -ForegroundColor Red
    exit 1
}

# 推送到远程仓库
Write-Host ""
Write-Host "推送到远程仓库..." -ForegroundColor Yellow
$pushResponse = Read-Host "是否推送到远程仓库？(y/n)"
if ($pushResponse -eq 'y' -or $pushResponse -eq 'Y') {
    try {
        git push origin master
        Write-Host "✓ 代码推送成功" -ForegroundColor Green
    } catch {
        Write-Host "Git推送失败: $_" -ForegroundColor Red
        Write-Host "请手动执行: git push origin master" -ForegroundColor Yellow
    }
} else {
    Write-Host "跳过推送，请稍后手动执行: git push origin master" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Git操作完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "📋 已提交的功能:" -ForegroundColor Green
Write-Host "✅ VPS部署API系统 - 支持远程代码部署" -ForegroundColor White
Write-Host "✅ 代理流媒体集成脚本 - 实现视频流代理传输" -ForegroundColor White
Write-Host "✅ Windows端自动化部署工具" -ForegroundColor White
Write-Host "✅ 一键部署和验证脚本" -ForegroundColor White
Write-Host ""

Write-Host "🚀 下一步操作:" -ForegroundColor Yellow
Write-Host "1. 在VPS上拉取最新代码: cd /tmp/github/secure-streaming-platform/vps-transcoder-api && git pull" -ForegroundColor Cyan
Write-Host "2. 同步代码到运行目录: cp -r src/* /opt/yoyo-transcoder/src/" -ForegroundColor Cyan
Write-Host "3. 重启VPS服务: pm2 restart vps-transcoder-api" -ForegroundColor Cyan
Write-Host "4. 测试部署API: curl https://yoyo-vps.5202021.xyz/api/deployment/status" -ForegroundColor Cyan
Write-Host "5. 执行一键部署: .\one-click-deploy.ps1" -ForegroundColor Cyan
Write-Host ""

Write-Host "Git提交完成！" -ForegroundColor Green
