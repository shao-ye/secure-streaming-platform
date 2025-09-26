@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   YOYO流媒体平台 - 开发服务器测试
echo ========================================
echo.

:: 设置颜色
set "GREEN=[92m"
set "RED=[91m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "CYAN=[96m"
set "RESET=[0m"

echo %BLUE%🚀 启动开发服务器...%RESET%
echo %YELLOW%💡 服务器启动后，请在浏览器中进行以下测试：%RESET%
echo.
echo %CYAN%📋 测试清单：%RESET%
echo   1. 访问 http://localhost:8080
echo   2. 检查是否自动跳转到登录页面
echo   3. 尝试登录（用户名: admin, 密码: admin123）
echo   4. 验证主控制台页面加载
echo   5. 测试管理员面板功能
echo.
echo %YELLOW%⚠ 注意：如果看到404错误，请检查URL是否正确%RESET%
echo %YELLOW%⚠ 如果页面空白，请打开浏览器开发者工具查看错误%RESET%
echo.
echo %BLUE%🔍 启动中...%RESET%
echo %CYAN%按 Ctrl+C 停止服务器%RESET%
echo.

:: 启动开发服务器
npm run dev

echo.
echo %GREEN%✅ 开发服务器已停止%RESET%
pause
