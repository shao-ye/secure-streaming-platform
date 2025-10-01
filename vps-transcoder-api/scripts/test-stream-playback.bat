@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo 🧪 YOYO流媒体平台播放功能测试脚本
echo =====================================
echo.

:: 配置变量
set "API_BASE=https://yoyoapi.5202021.xyz"
set "VPS_BASE=http://yoyo-vps.5202021.xyz"
set "FRONTEND_BASE=https://yoyo.5202021.xyz"

echo 📊 测试环境信息:
echo   前端地址: %FRONTEND_BASE%
echo   API地址: %API_BASE%
echo   VPS地址: %VPS_BASE%
echo.

echo 🔍 第一步: 测试API连通性...
echo.

:: 测试API状态
echo 📡 测试API状态...
powershell -Command "try { $response = Invoke-RestMethod -Uri '%API_BASE%/api/status' -Method GET -ContentType 'application/json'; Write-Host '✅ API状态正常:' $response.message } catch { Write-Host '❌ API连接失败:' $_.Exception.Message }"

echo.

:: 测试VPS健康状态
echo 🖥️ 测试VPS健康状态...
powershell -Command "try { $response = Invoke-RestMethod -Uri '%VPS_BASE%/health' -Method GET -ContentType 'application/json'; Write-Host '✅ VPS状态正常:' $response.message } catch { Write-Host '❌ VPS连接失败:' $_.Exception.Message }"

echo.

echo 🔐 第二步: 测试用户认证...
echo.

:: 提示用户输入管理员凭据
set /p "username=请输入用户名 (默认: admin): "
if "%username%"=="" set "username=admin"

set /p "password=请输入密码 (默认: admin123): "
if "%password%"=="" set "password=admin123"

echo.
echo 🔑 尝试登录...

:: 执行登录并获取Cookie
powershell -Command "
try {
    $loginData = @{
        username = '%username%'
        password = '%password%'
    } | ConvertTo-Json
    
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $response = Invoke-RestMethod -Uri '%API_BASE%/api/login' -Method POST -Body $loginData -ContentType 'application/json' -SessionVariable session
    
    Write-Host '✅ 登录成功:' $response.message
    
    # 保存会话信息到临时文件
    $session | Export-Clixml -Path 'temp_session.xml'
    
    Write-Host '📋 用户信息:'
    Write-Host '  用户名:' $response.data.user.username
    Write-Host '  角色:' $response.data.user.role
    
} catch {
    Write-Host '❌ 登录失败:' $_.Exception.Message
    exit 1
}"

if errorlevel 1 (
    echo.
    echo ❌ 登录失败，无法继续测试
    pause
    exit /b 1
)

echo.

echo 📺 第三步: 获取频道列表...
echo.

:: 获取频道列表
powershell -Command "
try {
    $session = Import-Clixml -Path 'temp_session.xml'
    $response = Invoke-RestMethod -Uri '%API_BASE%/api/streams' -Method GET -WebSession $session
    
    Write-Host '✅ 频道列表获取成功'
    Write-Host '📊 频道数量:' $response.data.count
    Write-Host '📋 频道列表:'
    
    $global:streamId = $null
    foreach ($stream in $response.data.streams) {
        Write-Host ('  - ID: {0}, 名称: {1}' -f $stream.id, $stream.name)
        if ($global:streamId -eq $null) {
            $global:streamId = $stream.id
        }
    }
    
    # 保存第一个频道ID
    $global:streamId | Out-File -FilePath 'temp_stream_id.txt' -Encoding UTF8
    
} catch {
    Write-Host '❌ 获取频道列表失败:' $_.Exception.Message
    exit 1
}"

if errorlevel 1 (
    echo.
    echo ❌ 获取频道列表失败
    pause
    exit /b 1
)

echo.

:: 读取保存的频道ID
set /p streamId=<temp_stream_id.txt

echo 🎬 第四步: 测试频道播放 (频道ID: %streamId%)...
echo.

:: 测试播放请求
powershell -Command "
try {
    $session = Import-Clixml -Path 'temp_session.xml'
    $streamId = '%streamId%'
    
    Write-Host '🚀 发送播放请求...'
    $response = Invoke-RestMethod -Uri '%API_BASE%/api/play/$streamId' -Method POST -WebSession $session
    
    Write-Host '✅ 播放请求成功'
    Write-Host '📊 响应信息:'
    Write-Host ('  频道ID: {0}' -f $response.data.streamId)
    Write-Host ('  频道名称: {0}' -f $response.data.streamName)
    Write-Host ('  HLS地址: {0}' -f $response.data.hlsUrl)
    Write-Host ('  响应时间: {0}ms' -f $response.data.responseTime)
    
    if ($response.data.transcoderInfo) {
        Write-Host '🔧 转码器信息:'
        Write-Host ('  进程ID: {0}' -f $response.data.transcoderInfo.processId)
        Write-Host ('  状态: {0}' -f $response.data.transcoderInfo.status)
    }
    
    # 保存HLS URL用于后续测试
    $response.data.hlsUrl | Out-File -FilePath 'temp_hls_url.txt' -Encoding UTF8
    
} catch {
    Write-Host '❌ 播放请求失败:' $_.Exception.Message
    Write-Host '详细错误信息:'
    Write-Host $_.Exception
    exit 1
}"

if errorlevel 1 (
    echo.
    echo ❌ 播放请求失败
    pause
    exit /b 1
)

echo.

:: 读取HLS URL
set /p hlsUrl=<temp_hls_url.txt

echo 🎥 第五步: 测试HLS文件访问...
echo.

:: 测试HLS文件访问
powershell -Command "
try {
    $session = Import-Clixml -Path 'temp_session.xml'
    $hlsUrl = '%hlsUrl%'
    $fullHlsUrl = '%API_BASE%' + $hlsUrl
    
    Write-Host '🔗 测试HLS播放列表访问:'
    Write-Host ('  URL: {0}' -f $fullHlsUrl)
    
    $response = Invoke-WebRequest -Uri $fullHlsUrl -Method GET -WebSession $session
    
    if ($response.StatusCode -eq 200) {
        Write-Host '✅ HLS播放列表访问成功'
        Write-Host ('  状态码: {0}' -f $response.StatusCode)
        Write-Host ('  内容类型: {0}' -f $response.Headers['Content-Type'])
        Write-Host ('  内容长度: {0} 字节' -f $response.Content.Length)
        
        # 显示前几行内容
        $lines = $response.Content -split '`n' | Select-Object -First 10
        Write-Host '📄 播放列表内容预览:'
        foreach ($line in $lines) {
            if ($line.Trim() -ne '') {
                Write-Host ('  {0}' -f $line.Trim())
            }
        }
    } else {
        Write-Host ('⚠️ HLS访问返回状态码: {0}' -f $response.StatusCode)
    }
    
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value__
    if ($statusCode -eq 202) {
        Write-Host '⏳ HLS文件正在生成中 (202 Accepted)'
        Write-Host '💡 这是正常的，转码需要一些时间'
        Write-Host '🔄 建议等待几秒后重试'
    } elseif ($statusCode -eq 404) {
        Write-Host '❌ HLS文件未找到 (404)'
        Write-Host '💡 可能原因:'
        Write-Host '  1. 转码尚未开始或失败'
        Write-Host '  2. RTMP推流未连接'
        Write-Host '  3. 文件路径配置错误'
    } else {
        Write-Host ('❌ HLS访问失败: {0}' -f $_.Exception.Message)
    }
}"

echo.

echo 🔍 第六步: 检查VPS转码状态...
echo.

:: 检查VPS上的转码进程
powershell -Command "
try {
    Write-Host '🖥️ 检查VPS转码进程状态...'
    $response = Invoke-RestMethod -Uri '%VPS_BASE%/api/streams' -Method GET -Headers @{'X-API-Key'='85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938'}
    
    Write-Host '✅ VPS转码API访问成功'
    Write-Host ('📊 运行中的流数量: {0}' -f $response.data.count)
    
    if ($response.data.count -gt 0) {
        Write-Host '🎬 运行中的流:'
        foreach ($stream in $response.data.streams) {
            Write-Host ('  - 流ID: {0}' -f $stream.streamId)
            Write-Host ('    进程ID: {0}' -f $stream.processId)
            Write-Host ('    PID: {0}' -f $stream.pid)
            Write-Host ('    状态: {0}' -f $stream.status)
            Write-Host ('    开始时间: {0}' -f $stream.startTime)
        }
    } else {
        Write-Host '⚠️ 当前没有运行中的转码流'
        Write-Host '💡 这可能意味着:'
        Write-Host '  1. 转码进程启动失败'
        Write-Host '  2. RTMP推流未连接'
        Write-Host '  3. 转码进程已停止'
    }
    
} catch {
    Write-Host ('❌ VPS转码API访问失败: {0}' -f $_.Exception.Message)
}"

echo.

echo 📋 第七步: 生成诊断报告...
echo.

echo ===============================================
echo 🎯 播放功能诊断报告
echo ===============================================
echo.
echo 📊 测试结果总结:
echo   ✅ 如果所有步骤都成功，说明系统正常运行
echo   ⚠️ 如果HLS返回202，说明转码正在进行中
echo   ❌ 如果出现错误，请查看上述详细信息
echo.
echo 🔧 常见问题解决方案:
echo.
echo 1. 如果播放请求失败:
echo    - 检查频道配置中的RTMP地址是否正确
echo    - 确认VPS转码服务正常运行
echo    - 验证API密钥配置
echo.
echo 2. 如果HLS文件访问失败:
echo    - 等待转码完成 (通常需要5-10秒)
echo    - 检查是否有实际的RTMP推流输入
echo    - 验证VPS上的HLS文件生成
echo.
echo 3. 如果没有运行中的转码流:
echo    - 检查FFmpeg是否正确安装
echo    - 验证RTMP推流是否连接
echo    - 查看VPS转码服务日志
echo.
echo 🚀 下一步建议:
echo   1. 使用OBS或FFmpeg推送RTMP流到配置的地址
echo   2. 等待转码完成后重新测试播放
echo   3. 在前端页面选择频道进行播放测试
echo.

:: 清理临时文件
if exist "temp_session.xml" del "temp_session.xml"
if exist "temp_stream_id.txt" del "temp_stream_id.txt"
if exist "temp_hls_url.txt" del "temp_hls_url.txt"

echo 测试完成！
pause
