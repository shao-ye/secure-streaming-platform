@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   YOYO流媒体平台 - 前端快速验证
echo ========================================
echo.

:: 设置颜色
set "GREEN=[92m"
set "RED=[91m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "RESET=[0m"

:: 检查Node.js
echo %BLUE%🔍 检查Node.js版本...%RESET%
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%❌ Node.js未安装或不在PATH中%RESET%
    goto :error
) else (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo %GREEN%✅ Node.js版本: %NODE_VERSION%%RESET%
)

:: 检查npm
echo %BLUE%🔍 检查npm版本...%RESET%
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%❌ npm未安装%RESET%
    goto :error
) else (
    for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo %GREEN%✅ npm版本: %NPM_VERSION%%RESET%
)

:: 检查项目文件
echo %BLUE%🔍 检查项目文件结构...%RESET%
if not exist "package.json" (
    echo %RED%❌ package.json不存在%RESET%
    goto :error
)
echo %GREEN%✅ package.json存在%RESET%

if not exist "vite.config.js" (
    echo %RED%❌ vite.config.js不存在%RESET%
    goto :error
)
echo %GREEN%✅ vite.config.js存在%RESET%

if not exist "src\main.js" (
    echo %RED%❌ src\main.js不存在%RESET%
    goto :error
)
echo %GREEN%✅ src\main.js存在%RESET%

if not exist ".env.development" (
    echo %YELLOW%⚠ .env.development不存在%RESET%
) else (
    echo %GREEN%✅ .env.development存在%RESET%
)

if not exist ".env.production" (
    echo %YELLOW%⚠ .env.production不存在%RESET%
) else (
    echo %GREEN%✅ .env.production存在%RESET%
)

:: 检查依赖安装
echo %BLUE%🔍 检查依赖安装...%RESET%
if not exist "node_modules" (
    echo %YELLOW%⚠ node_modules不存在，正在安装依赖...%RESET%
    npm install
    if %errorlevel% neq 0 (
        echo %RED%❌ 依赖安装失败%RESET%
        goto :error
    )
    echo %GREEN%✅ 依赖安装成功%RESET%
) else (
    echo %GREEN%✅ node_modules存在%RESET%
)

:: 测试构建
echo %BLUE%🔍 测试项目构建...%RESET%
npm run build >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%❌ 项目构建失败%RESET%
    echo %YELLOW%💡 尝试运行: npm run build%RESET%
    goto :error
) else (
    echo %GREEN%✅ 项目构建成功%RESET%
)

:: 检查构建产物
if exist "dist\index.html" (
    echo %GREEN%✅ 构建产物正常%RESET%
) else (
    echo %RED%❌ 构建产物异常%RESET%
    goto :error
)

echo.
echo %GREEN%🎉 前端项目验证通过！%RESET%
echo.
echo %BLUE%📋 下一步操作建议：%RESET%
echo   1. 启动开发服务器: npm run dev
echo   2. 在浏览器中访问: http://localhost:8080
echo   3. 测试登录功能（用户名: admin, 密码: admin123）
echo   4. 验证视频播放和管理功能
echo.
echo %YELLOW%💡 如需详细验证，请运行: node scripts\verify-frontend.js%RESET%
echo.
pause
exit /b 0

:error
echo.
echo %RED%❌ 验证失败！请检查上述问题。%RESET%
echo.
pause
exit /b 1
