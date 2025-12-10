@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   YOYO流媒体平台 - 构建测试
echo ========================================
echo.

:: 设置颜色
set "GREEN=[92m"
set "RED=[91m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "RESET=[0m"

echo %BLUE%🔍 检查当前目录...%RESET%
if not exist "package.json" (
    echo %RED%❌ 请在前端项目根目录运行此脚本%RESET%
    pause
    exit /b 1
)
echo %GREEN%✅ 在正确的项目目录%RESET%

echo %BLUE%🔍 检查Node.js和npm...%RESET%
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%❌ Node.js未安装%RESET%
    pause
    exit /b 1
)

npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%❌ npm未安装%RESET%
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo %GREEN%✅ Node.js: %NODE_VERSION%, npm: %NPM_VERSION%%RESET%

echo %BLUE%🔍 检查依赖安装...%RESET%
if not exist "node_modules" (
    echo %YELLOW%⚠ 正在安装依赖...%RESET%
    npm install
    if %errorlevel% neq 0 (
        echo %RED%❌ 依赖安装失败%RESET%
        pause
        exit /b 1
    )
    echo %GREEN%✅ 依赖安装成功%RESET%
) else (
    echo %GREEN%✅ 依赖已安装%RESET%
)

echo %BLUE%🔍 清理之前的构建...%RESET%
if exist "dist" (
    rmdir /s /q "dist"
    echo %GREEN%✅ 清理完成%RESET%
)

echo %BLUE%🔍 执行构建测试...%RESET%
npm run build
if %errorlevel% neq 0 (
    echo %RED%❌ 构建失败%RESET%
    echo %YELLOW%💡 请检查上面的错误信息%RESET%
    pause
    exit /b 1
)

echo %BLUE%🔍 检查构建产物...%RESET%
if exist "dist\index.html" (
    echo %GREEN%✅ 构建成功！%RESET%
    echo %GREEN%✅ 找到 dist\index.html%RESET%

    :: 检查其他重要文件
    if exist "dist\assets" (
        echo %GREEN%✅ 找到 assets 目录%RESET%
    )

    :: 显示构建产物大小
    echo %BLUE%📊 构建产物信息：%RESET%
    dir dist /s /-c | find "个文件"

) else (
    echo %RED%❌ 构建产物异常，未找到 index.html%RESET%
    pause
    exit /b 1
)

echo.
echo %GREEN%🎉 构建测试通过！%RESET%
echo.
echo %BLUE%📋 下一步可以：%RESET%
echo   1. 测试开发服务器: npm run dev
echo   2. 预览构建结果: npm run preview
echo   3. 运行完整验证: node scripts\verify-frontend.js
echo.
pause
exit /b 0
