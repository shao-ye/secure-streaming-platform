@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM YOYO流媒体平台 - VPS自动部署脚本 (Windows)
REM 作者: YOYO Team
REM 版本: 1.0

echo ========================================
echo   🚀 YOYO VPS自动部署脚本
echo ========================================
echo.

REM 检查必要工具
echo [检查] 验证部署环境...

REM 检查SSH客户端
ssh -V >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到SSH客户端
    echo 请安装OpenSSH、Git Bash或使用WSL
    echo 或者手动执行部署步骤
    pause
    exit /b 1
)

REM 检查SCP
scp -h >nul 2>&1
if errorlevel 9009 (
    echo [错误] 未找到SCP工具
    echo 请安装OpenSSH、Git Bash或使用WSL
    echo 或者手动执行部署步骤
    pause
    exit /b 1
)

echo [信息] 部署环境检查通过
echo.

REM 获取VPS信息
echo 请输入VPS服务器信息:
echo.
set /p VPS_IP="VPS IP地址: "
set /p VPS_USER="SSH用户名 [root]: "
if "!VPS_USER!"=="" set VPS_USER=root
set /p SSH_PORT="SSH端口 [22]: "
if "!SSH_PORT!"=="" set SSH_PORT=22

echo.
echo [信息] VPS信息:
echo   - IP地址: !VPS_IP!
echo   - 用户: !VPS_USER!
echo   - 端口: !SSH_PORT!
echo.

REM 确认部署
set /p CONFIRM="确认开始自动部署? (y/N): "
if /i not "!CONFIRM!"=="y" (
    echo [信息] 部署已取消
    pause
    exit /b 0
)

echo.
echo ========================================
echo   开始自动部署VPS转码服务
echo ========================================
echo.

REM 步骤1: 测试SSH连接
echo [步骤1] 测试SSH连接...
ssh -p !SSH_PORT! -o ConnectTimeout=10 -o BatchMode=yes !VPS_USER!@!VPS_IP! "echo 'SSH连接成功'" 2>nul
if errorlevel 1 (
    echo [错误] SSH连接失败，请检查:
    echo   - VPS IP地址和端口是否正确
    echo   - SSH密钥是否已配置
    echo   - 防火墙是否开放SSH端口
    pause
    exit /b 1
)
echo [信息] SSH连接测试通过
echo.

REM 步骤2: 上传部署文件
echo [步骤2] 上传部署文件到VPS...

REM 创建临时部署目录
ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "mkdir -p /tmp/yoyo-deploy"

REM 上传vps-transcoder-api目录
echo [上传] 转码API代码...
scp -P !SSH_PORT! -r "../vps-transcoder-api" "!VPS_USER!@!VPS_IP!:/tmp/yoyo-deploy/"
if errorlevel 1 (
    echo [错误] 文件上传失败
    pause
    exit /b 1
)

echo [信息] 文件上传完成
echo.

REM 步骤3: 执行远程部署
echo [步骤3] 执行远程自动部署...

REM 创建远程执行脚本
echo [创建] 远程部署脚本...
ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "cat > /tmp/yoyo-deploy/remote-deploy.sh << 'DEPLOY_SCRIPT'
#!/bin/bash
set -e

echo '========================================'
echo '  🚀 YOYO VPS转码服务自动部署'
echo '========================================'
echo ''

cd /tmp/yoyo-deploy/vps-transcoder-api

# 给脚本执行权限
chmod +x scripts/*.sh

echo '[步骤1/3] 安装系统环境...'
bash scripts/setup-vps.sh

echo ''
echo '[步骤2/3] 部署转码API...'
bash scripts/deploy-api.sh

echo ''
echo '[步骤3/3] 配置Nginx服务...'
bash scripts/configure-nginx.sh

echo ''
echo '========================================'
echo '✅ VPS转码服务部署完成！'
echo '========================================'
echo ''

# 显示服务状态
echo '📊 服务状态:'
pm2 status
systemctl status nginx --no-pager -l

echo ''
echo '🔑 API密钥:'
grep 'API_KEY=' /opt/yoyo-transcoder/.env | cut -d'=' -f2

echo ''
echo '🌐 服务地址:'
VPS_IP=\$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo 'YOUR_VPS_IP')
echo \"  - API服务: http://\$VPS_IP:3000\"
echo \"  - HLS流: http://\$VPS_IP/hls/\"
echo \"  - 健康检查: http://\$VPS_IP/health\"

echo ''
echo '========================================'
DEPLOY_SCRIPT"

REM 执行远程部署脚本
echo [执行] 远程部署脚本...
ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "chmod +x /tmp/yoyo-deploy/remote-deploy.sh && bash /tmp/yoyo-deploy/remote-deploy.sh"

if errorlevel 1 (
    echo [错误] 远程部署失败
    echo 请检查VPS日志: ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "journalctl -xe"
    pause
    exit /b 1
)

echo.
echo ========================================
echo   🎉 VPS自动部署完成！
echo ========================================
echo.

REM 步骤4: 获取部署结果
echo [步骤4] 获取部署信息...

REM 获取API密钥
for /f "tokens=*" %%i in ('ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "grep API_KEY= /opt/yoyo-transcoder/.env | cut -d'=' -f2"') do set API_KEY=%%i

echo 🔑 API密钥: !API_KEY!
echo.

REM 步骤5: 验证部署
echo [步骤5] 验证服务状态...

REM 测试API健康检查
ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "curl -f http://localhost:3000/health" >nul 2>&1
if errorlevel 1 (
    echo [警告] API健康检查失败
) else (
    echo [信息] API服务运行正常
)

REM 测试Nginx服务
ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "curl -f http://localhost/health" >nul 2>&1
if errorlevel 1 (
    echo [警告] Nginx代理异常
) else (
    echo [信息] Nginx服务运行正常
)

echo.
echo ========================================
echo   📋 部署信息总结
echo ========================================
echo.
echo 🌐 VPS服务地址:
echo   - API服务: http://!VPS_IP!:3000
echo   - HLS流: http://!VPS_IP!/hls/
echo   - 健康检查: http://!VPS_IP!/health
echo.
echo 🔑 API密钥 (请保存):
echo   !API_KEY!
echo.
echo 🔧 管理命令:
echo   ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "pm2 status"
echo   ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "pm2 logs yoyo-transcoder"
echo   ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "systemctl status nginx"
echo.
echo 📝 下一步操作:
echo   1. 在Cloudflare Workers中配置VPS连接
echo   2. 运行: node ../cloudflare-worker/scripts/update-vps-config.js
echo   3. 测试完整的转码和播放流程
echo.
echo ========================================

REM 清理临时文件
echo [清理] 删除临时文件...
ssh -p !SSH_PORT! !VPS_USER!@!VPS_IP! "rm -rf /tmp/yoyo-deploy"

echo.
echo 🎉 VPS自动部署全部完成！
echo.
pause
