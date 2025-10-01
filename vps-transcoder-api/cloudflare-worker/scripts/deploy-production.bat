@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   🚀 YOYO流媒体平台 - 生产环境部署
echo ========================================
echo.

echo 📋 部署信息:
echo   - 环境: Production
echo   - VPS域名: yoyo-vps.5202021.xyz
echo   - API密钥: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938
echo.

echo [STEP] 1/4: 配置环境变量...

echo 正在设置VPS API URL...
echo http://yoyo-vps.5202021.xyz/api | wrangler secret put VPS_API_URL --env production
if !errorlevel! neq 0 (
    echo [ERROR] 设置VPS_API_URL失败
    pause
    exit /b 1
)

echo 正在设置VPS API密钥...
echo 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938 | wrangler secret put VPS_API_KEY --env production
if !errorlevel! neq 0 (
    echo [ERROR] 设置VPS_API_KEY失败
    pause
    exit /b 1
)

echo 正在设置VPS HLS URL...
echo http://yoyo-vps.5202021.xyz/hls | wrangler secret put VPS_HLS_URL --env production
if !errorlevel! neq 0 (
    echo [ERROR] 设置VPS_HLS_URL失败
    pause
    exit /b 1
)

echo 正在启用VPS功能...
echo true | wrangler secret put VPS_ENABLED --env production
if !errorlevel! neq 0 (
    echo [ERROR] 设置VPS_ENABLED失败
    pause
    exit /b 1
)

echo [SUCCESS] 环境变量配置完成！
echo.

echo [STEP] 2/4: 部署Workers到生产环境...
wrangler deploy --env production
if !errorlevel! neq 0 (
    echo [ERROR] Workers部署失败
    pause
    exit /b 1
)

echo [SUCCESS] Workers部署成功！
echo.

echo [STEP] 3/4: 初始化管理员用户...
echo 正在初始化管理员用户...
curl -X POST "https://yoyo-streaming-worker.shao-ye.workers.dev/api/init-admin" ^
     -H "Content-Type: application/json" ^
     -d "{}"

echo.
echo [SUCCESS] 管理员用户初始化完成！
echo.

echo [STEP] 4/4: 验证部署状态...

echo 测试Workers API状态...
curl -s "https://yoyo-streaming-worker.shao-ye.workers.dev/api/status"
echo.

echo 测试VPS连接...
curl -s "https://yoyo-streaming-worker.shao-ye.workers.dev/api/admin/vps/health"
echo.

echo ========================================
echo   🎉 生产环境部署完成！
echo ========================================
echo.

echo 📊 服务端点:
echo   - Workers API: https://yoyo-streaming-worker.shao-ye.workers.dev
echo   - 前端页面: https://yoyo-streaming-worker.shao-ye.workers.dev/
echo   - 管理后台: https://yoyo-streaming-worker.shao-ye.workers.dev/admin
echo   - VPS API: http://yoyo-vps.5202021.xyz/api/health
echo   - VPS HLS: http://yoyo-vps.5202021.xyz/hls/
echo.

echo 🔐 登录信息:
echo   - 用户名: admin
echo   - 密码: admin123
echo   - 登录页面: https://yoyo-streaming-worker.shao-ye.workers.dev/login
echo.

echo 🧪 测试命令:
echo   curl https://yoyo-streaming-worker.shao-ye.workers.dev/api/status
echo   curl http://yoyo-vps.5202021.xyz/health
echo.

echo 📋 下一步操作:
echo   1. 访问管理后台添加测试频道
echo   2. 使用OBS推送RTMP流: rtmp://yoyo-vps.5202021.xyz/live/STREAM_KEY
echo   3. 在前端播放HLS流验证转码功能
echo.

echo ========================================

pause
