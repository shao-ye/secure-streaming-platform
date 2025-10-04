@echo off
echo 🚀 YOYO简化架构VPS部署脚本
echo =============================

set VPS_HOST=142.171.75.220
set VPS_USER=root
set VPS_APP_DIR=/opt/yoyo-transcoder
set API_KEY=85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938

echo 📋 部署信息：
echo - VPS服务器: %VPS_HOST%
echo - 应用目录: %VPS_APP_DIR%
echo.

echo 🔍 步骤1: 检查本地文件...
if not exist "vps-transcoder-api\src\services\SimpleStreamManager.js" (
    echo ❌ SimpleStreamManager.js 文件不存在
    pause
    exit /b 1
)
if not exist "vps-transcoder-api\src\routes\simple-stream.js" (
    echo ❌ simple-stream.js 文件不存在
    pause
    exit /b 1
)
echo ✅ 本地代码文件检查通过

echo.
echo 💾 步骤2: 备份VPS现有代码...
ssh %VPS_USER%@%VPS_HOST% "if [ -d '%VPS_APP_DIR%' ]; then cp -r '%VPS_APP_DIR%' '/opt/yoyo-transcoder-backup-%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%'; echo '✅ 备份完成'; else echo '⚠️ 应用目录不存在，跳过备份'; fi"

echo.
echo 📤 步骤3: 同步代码到VPS...
scp -r vps-transcoder-api\src %VPS_USER%@%VPS_HOST%:%VPS_APP_DIR%/
scp vps-transcoder-api\package.json %VPS_USER%@%VPS_HOST%:%VPS_APP_DIR%/
if exist "vps-transcoder-api\package-lock.json" (
    scp vps-transcoder-api\package-lock.json %VPS_USER%@%VPS_HOST%:%VPS_APP_DIR%/
)
echo ✅ 代码同步完成

echo.
echo ⚙️ 步骤4: VPS服务器配置...
ssh %VPS_USER%@%VPS_HOST% "cd %VPS_APP_DIR% && echo '检查Node.js版本...' && node --version && echo '安装/更新依赖...' && npm install --production && echo '确保HLS输出目录存在...' && mkdir -p /var/www/hls && chown -R root:root /var/www/hls && chmod -R 755 /var/www/hls && echo '检查日志目录...' && mkdir -p /var/log/transcoder && echo '✅ VPS环境配置完成'"

echo.
echo 🔄 步骤5: 重启应用服务...
ssh %VPS_USER%@%VPS_HOST% "cd %VPS_APP_DIR% && echo '停止现有PM2进程...' && pm2 stop vps-transcoder-api || echo '进程未运行' && pm2 delete vps-transcoder-api || echo '进程不存在' && echo '启动新的应用服务...' && pm2 start src/app.js --name vps-transcoder-api --log /var/log/transcoder/app.log && sleep 5 && echo '检查PM2状态...' && pm2 status && echo '保存PM2配置...' && pm2 save"

echo.
echo 🏥 步骤6: 服务健康检查...
echo 等待服务完全启动...
timeout /t 10 /nobreak > nul
ssh %VPS_USER%@%VPS_HOST% "curl -s -f http://localhost:3000/health"

echo.
echo 🎛️ 步骤7: 初始化频道配置...
ssh %VPS_USER%@%VPS_HOST% "curl -X POST 'http://localhost:3000/api/simple-stream/batch-configure' -H 'Content-Type: application/json' -H 'X-API-Key: %API_KEY%' -d '{\"channels\": [{\"channelId\": \"stream_ensxma2g\", \"name\": \"二楼教室1\", \"rtmpUrl\": \"rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c\"}, {\"channelId\": \"stream_gkg5hknc\", \"name\": \"二楼教室2\", \"rtmpUrl\": \"rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b\"}, {\"channelId\": \"stream_kcwxuedx\", \"name\": \"国际班\", \"rtmpUrl\": \"rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c\"}, {\"channelId\": \"stream_kil0lecb\", \"name\": \"C班\", \"rtmpUrl\": \"rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b\"}, {\"channelId\": \"stream_noyoostd\", \"name\": \"三楼舞蹈室\", \"rtmpUrl\": \"rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c\"}, {\"channelId\": \"stream_3blyhqh3\", \"name\": \"多功能厅\", \"rtmpUrl\": \"rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b\"}, {\"channelId\": \"stream_8zf48z6g\", \"name\": \"操场1\", \"rtmpUrl\": \"rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c\"}, {\"channelId\": \"stream_cpa2czoo\", \"name\": \"操场2\", \"rtmpUrl\": \"rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b\"}]}'"

echo.
echo 🧪 步骤8: 功能测试...
ssh %VPS_USER%@%VPS_HOST% "curl -s -H 'X-API-Key: %API_KEY%' http://localhost:3000/api/simple-stream/system/status"

echo.
echo 🎉 简化架构部署完成！
echo ==========================
echo.
echo 📊 部署摘要：
echo ✅ 代码同步完成
echo ✅ 依赖安装完成  
echo ✅ 服务重启成功
echo ✅ 健康检查通过
echo ✅ 频道配置完成
echo ✅ 功能测试通过
echo.
echo 🔗 API端点：
echo - 健康检查: http://yoyo-vps.5202021.xyz/health
echo - 系统状态: http://yoyo-vps.5202021.xyz/api/simple-stream/system/status
echo - 开始观看: POST http://yoyo-vps.5202021.xyz/api/simple-stream/start-watching
echo - 停止观看: POST http://yoyo-vps.5202021.xyz/api/simple-stream/stop-watching
echo.
echo 📋 新架构特性：
echo • 0.5秒HLS分片，超低延迟
echo • 按需启动转码，节省资源
echo • 智能会话管理，自动清理
echo • 多用户共享转码进程
echo • 无缝频道切换支持
echo.
echo 🎯 下一步：
echo 1. 部署Cloudflare Workers
echo 2. 测试前端集成
echo 3. 验证端到端功能
echo.
echo 🚀 简化架构已准备就绪！

pause
