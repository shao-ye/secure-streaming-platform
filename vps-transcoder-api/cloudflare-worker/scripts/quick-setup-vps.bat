@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   🔗 YOYO流媒体平台 - 快速VPS配置
echo ========================================
echo.

echo 📋 VPS信息:
echo   - 域名: yoyo-vps.5202021.xyz
echo   - API端点: http://yoyo-vps.5202021.xyz/api/health
echo   - HLS服务: http://yoyo-vps.5202021.xyz/hls/
echo.

echo 🔑 请输入API密钥 (从VPS部署输出中获取):
set /p API_KEY="API密钥: "

if "%API_KEY%"=="" (
    echo [ERROR] API密钥不能为空
    pause
    exit /b 1
)

echo.
echo [INFO] 正在配置Cloudflare Workers环境变量...

echo 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938 | wrangler secret put VPS_API_KEY --env production
echo http://yoyo-vps.5202021.xyz/api | wrangler secret put VPS_API_URL --env production  
echo http://yoyo-vps.5202021.xyz/hls | wrangler secret put VPS_HLS_URL --env production
echo true | wrangler secret put VPS_ENABLED --env production

echo.
echo [INFO] 环境变量配置完成！

echo.
echo 是否立即部署Workers? (Y/n)
set /p DEPLOY_CHOICE="选择: "

if /i not "%DEPLOY_CHOICE%"=="n" (
    echo.
    echo [INFO] 正在部署Workers...
    wrangler deploy --env production
    
    if !errorlevel! equ 0 (
        echo [SUCCESS] Workers部署成功！
    ) else (
        echo [ERROR] Workers部署失败
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo   🎉 VPS配置完成！
echo ========================================
echo.
echo 📊 服务端点:
echo   - VPS API: http://yoyo-vps.5202021.xyz/api/health
echo   - VPS HLS: http://yoyo-vps.5202021.xyz/hls/
echo   - Workers: https://your-worker.your-subdomain.workers.dev
echo.
echo 🧪 测试命令:
echo   curl http://yoyo-vps.5202021.xyz/health
echo   curl http://yoyo-vps.5202021.xyz/api/health
echo.
echo 📋 下一步:
echo   1. 测试Workers与VPS连接
echo   2. 在前端添加测试频道
echo   3. 推送RTMP流进行转码测试
echo.
echo ========================================

pause
