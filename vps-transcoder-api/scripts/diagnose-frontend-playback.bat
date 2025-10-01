@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo 🔍 诊断前端播放问题...

set API_KEY=85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938
set TEST_RTMP=rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4

echo 1. 检查API服务状态...

REM 检查健康状态
echo 检查API健康状态...
curl -s https://yoyo-vps.5202021.xyz/health > temp_health.json 2>nul
if exist temp_health.json (
    findstr /C:"healthy" temp_health.json >nul
    if !errorlevel! equ 0 (
        echo ✅ API健康检查正常
    ) else (
        echo ❌ API健康检查失败
        type temp_health.json
        del temp_health.json
        pause
        exit /b 1
    )
    del temp_health.json
) else (
    echo ❌ 无法连接到API服务
    pause
    exit /b 1
)

REM 检查API状态
echo 检查API状态...
curl -s -H "X-API-Key: %API_KEY%" https://yoyo-vps.5202021.xyz/api/status > temp_status.json 2>nul
if exist temp_status.json (
    findstr /C:"running" temp_status.json >nul
    if !errorlevel! equ 0 (
        echo ✅ API状态正常
    ) else (
        echo ❌ API状态异常
        type temp_status.json
    )
    del temp_status.json
) else (
    echo ❌ 无法获取API状态
)

echo.
echo 2. 测试转码API端点...

REM 生成测试流ID
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set mydate=%%c%%a%%b
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set mytime=%%a%%b
set FRONTEND_STREAM_ID=stream_%mydate%_%mytime%

echo 启动转码流: %FRONTEND_STREAM_ID%

REM 调用转码API
curl -s -X POST ^
  -H "Content-Type: application/json" ^
  -H "X-API-Key: %API_KEY%" ^
  -d "{\"streamId\":\"%FRONTEND_STREAM_ID%\",\"rtmpUrl\":\"%TEST_RTMP%\"}" ^
  https://yoyo-vps.5202021.xyz/api/start-stream > temp_start.json 2>nul

if exist temp_start.json (
    echo 转码启动响应:
    type temp_start.json
    echo.
    
    findstr /C:"success" temp_start.json | findstr /C:"true" >nul
    if !errorlevel! equ 0 (
        echo ✅ 转码API调用成功
        set HLS_URL=/hls/%FRONTEND_STREAM_ID%/playlist.m3u8
    ) else (
        findstr /C:"already" temp_start.json >nul
        if !errorlevel! equ 0 (
            echo ⚠️ 流已在运行，继续检查HLS文件
            set HLS_URL=/hls/%FRONTEND_STREAM_ID%/playlist.m3u8
        ) else (
            echo ❌ 转码API调用失败
            echo 可能的原因：超时、连接失败或FFmpeg启动问题
        )
    )
    del temp_start.json
) else (
    echo ❌ 无法调用转码API
    set HLS_URL=/hls/%FRONTEND_STREAM_ID%/playlist.m3u8
)

echo.
echo 3. 检查HLS文件生成...
echo HLS URL: !HLS_URL!

echo 等待HLS文件生成...
set /a counter=0
:check_hls
set /a counter+=1
if !counter! gtr 30 goto hls_timeout

REM 检查HLS文件
curl -s -I "https://yoyo-vps.5202021.xyz!HLS_URL!" > temp_hls_check.txt 2>nul
if exist temp_hls_check.txt (
    findstr /C:"200 OK" temp_hls_check.txt >nul
    if !errorlevel! equ 0 (
        echo ✅ HLS文件可通过外部URL访问!
        echo HLS访问地址: https://yoyo-vps.5202021.xyz!HLS_URL!
        
        REM 获取HLS内容
        curl -s "https://yoyo-vps.5202021.xyz!HLS_URL!" > temp_hls_content.txt 2>nul
        if exist temp_hls_content.txt (
            findstr /C:"#EXTM3U" temp_hls_content.txt >nul
            if !errorlevel! equ 0 (
                echo ✅ HLS播放列表格式正确
                echo HLS内容预览:
                more +1 temp_hls_content.txt | head -10
                
                REM 检查TS文件
                findstr /C:".ts" temp_hls_content.txt >nul
                if !errorlevel! equ 0 (
                    echo ✅ HLS流正在正常生成!
                    del temp_hls_content.txt
                    del temp_hls_check.txt
                    goto hls_success
                ) else (
                    echo ⚠️ HLS文件存在但没有TS片段，继续等待...
                )
            ) else (
                echo ❌ HLS文件格式错误
                echo 内容:
                type temp_hls_content.txt
            )
            del temp_hls_content.txt
        )
        del temp_hls_check.txt
        goto hls_success
    ) else (
        findstr /C:"404" temp_hls_check.txt >nul
        if !errorlevel! equ 0 (
            echo ⏳ HLS文件尚未生成... (!counter!/30)
        ) else (
            echo ⏳ 等待HLS文件... (!counter!/30)
        )
    )
    del temp_hls_check.txt
) else (
    echo ⏳ 检查HLS文件... (!counter!/30)
)

timeout /t 4 /nobreak >nul
goto check_hls

:hls_timeout
echo ❌ HLS文件生成超时（2分钟）
echo 可能的问题：
echo   1. FFmpeg进程启动失败
echo   2. RTMP源连接问题
echo   3. HLS输出路径配置错误
echo   4. Nginx HLS文件服务配置问题

:hls_success
echo.
echo 4. 检查活动流状态...

curl -s -H "X-API-Key: %API_KEY%" https://yoyo-vps.5202021.xyz/api/streams > temp_streams.json 2>nul
if exist temp_streams.json (
    echo 活动流状态:
    type temp_streams.json
    del temp_streams.json
) else (
    echo ❌ 无法获取活动流状态
)

echo.
echo 5. 前端播放建议...

echo 如果HLS文件正常生成，前端播放问题可能是：
echo   1. 前端HLS.js配置问题
echo   2. CORS配置问题
echo   3. 前端API调用逻辑问题
echo   4. 视频播放器初始化问题

echo.
echo 🎯 建议的前端测试步骤：
echo 1. 在浏览器开发者工具中检查网络请求
echo 2. 确认前端是否正确调用了转码API
echo 3. 检查HLS.js是否能加载播放列表
echo 4. 验证视频元素是否正确初始化

echo.
echo ==================== 诊断完成 ====================
echo 测试流ID: %FRONTEND_STREAM_ID%
echo HLS播放地址: https://yoyo-vps.5202021.xyz!HLS_URL!
echo 可以在浏览器中直接访问上述HLS地址测试播放
echo =================================================

echo.
pause
