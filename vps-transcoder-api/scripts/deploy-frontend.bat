@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo 🚀 YOYO流媒体平台前端部署脚本
echo ================================
echo.

:: 配置变量
set "FRONTEND_DIR=..\frontend"
set "VPS_HOST=yoyo-vps.5202021.xyz"
set "VPS_USER=root"

:: 检查前端目录
if not exist "%FRONTEND_DIR%" (
    echo ❌ 前端目录不存在: %FRONTEND_DIR%
    pause
    exit /b 1
)

echo 📁 切换到前端目录...
cd /d "%FRONTEND_DIR%"

:: 检查Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js未安装，请先安装Node.js
    pause
    exit /b 1
)

echo 📦 安装依赖...
call npm install
if errorlevel 1 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

echo 🔧 更新生产环境配置...
(
echo # 生产环境配置 - VPS部署
echo VITE_API_BASE_URL=https://yoyoapi.5202021.xyz
echo VITE_APP_TITLE=YOYO流媒体平台
echo VITE_APP_VERSION=1.0.0
echo VITE_HLS_PROXY_URL=https://yoyoapi.5202021.xyz/hls
echo VITE_ENVIRONMENT=production
echo VITE_WORKER_URL=https://yoyoapi.5202021.xyz
echo VITE_DEBUG=false
echo VITE_LOG_LEVEL=error
echo VITE_VPS_DOMAIN=yoyo.5202021.xyz
) > .env.production

echo 🏗️ 构建生产版本...
call npm run build
if errorlevel 1 (
    echo ❌ 构建失败
    pause
    exit /b 1
)

:: 检查构建结果
if not exist "dist" (
    echo ❌ 构建失败，dist目录不存在
    pause
    exit /b 1
)

echo ✅ 前端构建完成！
echo.
echo 📊 构建信息:
echo   构建目录: %cd%\dist
echo   文件数量: 
dir /s /b dist\*.* | find /c /v ""

echo.
echo 📤 准备上传到VPS...
echo.
echo 🔧 请手动执行以下步骤完成部署:
echo.
echo 1. 将 dist 目录内容上传到VPS:
echo    scp -r dist/* root@%VPS_HOST%:/var/www/yoyo-frontend/
echo.
echo 2. 或者使用FTP/SFTP工具上传 dist 目录内容到:
echo    /var/www/yoyo-frontend/
echo.
echo 3. SSH到VPS执行配置:
echo    ssh root@%VPS_HOST%
echo.
echo 4. 在VPS上运行以下命令:

echo.
echo    # 设置权限
echo    sudo chown -R nginx:nginx /var/www/yoyo-frontend
echo    sudo chmod -R 755 /var/www/yoyo-frontend
echo.
echo    # 创建Nginx配置
echo    sudo tee /etc/nginx/conf.d/yoyo-frontend.conf ^> /dev/null ^<^< 'EOF'
echo    server {
echo        listen 80;
echo        server_name yoyo.5202021.xyz;
echo        root /var/www/yoyo-frontend;
echo        index index.html;
echo.
echo        # 静态资源缓存
echo        location ~* \.(js^|css^|png^|jpg^|jpeg^|gif^|ico^|svg^|woff^|woff2^|ttf^|eot)$ {
echo            expires 1y;
echo            add_header Cache-Control "public, immutable";
echo        }
echo.
echo        # API代理到Workers
echo        location /api/ {
echo            proxy_pass https://yoyoapi.5202021.xyz/api/;
echo            proxy_set_header Host $host;
echo            proxy_set_header X-Real-IP $remote_addr;
echo            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
echo            add_header Access-Control-Allow-Origin *;
echo        }
echo.
echo        # HLS代理
echo        location /hls/ {
echo            proxy_pass https://yoyoapi.5202021.xyz/hls/;
echo            add_header Access-Control-Allow-Origin *;
echo        }
echo.
echo        # SPA路由支持
echo        location / {
echo            try_files $uri $uri/ /index.html;
echo        }
echo    }
echo    EOF
echo.
echo    # 测试并重载Nginx
echo    sudo nginx -t ^&^& sudo systemctl reload nginx
echo.

echo 🎉 构建完成！请按照上述步骤完成VPS部署。
echo.
echo 📊 部署后访问地址:
echo   前端: http://yoyo.5202021.xyz
echo   管理后台: http://yoyo.5202021.xyz/admin
echo   API: https://yoyoapi.5202021.xyz
echo.

pause
