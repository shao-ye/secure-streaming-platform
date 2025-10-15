#!/usr/bin/env pwsh

Write-Host "🎬 完整前端播放流程测试" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# 测试用的RTMP源（已验证可用）
$validRtmpUrl = "rtmp://push228.dodool.com.cn/55/19?auth_key=1413753727-0-0-12f6098bc64f30e11339cd4799325c5f"
$testChannelId = "frontend_test_channel"

Write-Host ""
Write-Host "📋 测试步骤:" -ForegroundColor Yellow
Write-Host "1. 模拟前端发送播放请求"
Write-Host "2. 检查VPS转码服务响应"
Write-Host "3. 验证FFmpeg进程启动"
Write-Host "4. 检查HLS文件生成"
Write-Host "5. 测试前端播放器访问"
Write-Host ""

# 步骤1: 模拟前端播放请求
Write-Host "🚀 步骤1: 发送播放请求..." -ForegroundColor Green
$playbackData = @{
    channelId = $testChannelId
    rtmpUrl = $validRtmpUrl
    userId = "test_user_frontend"
    sessionId = "session_" + (Get-Date -Format "yyyyMMddHHmmss")
} | ConvertTo-Json

Write-Host "请求数据: $playbackData" -ForegroundColor Gray

try {
    $startTime = Get-Date
    $playResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/simple-stream/start-watching" -Method POST -Body $playbackData -ContentType "application/json" -TimeoutSec 30
    $responseTime = ((Get-Date) - $startTime).TotalMilliseconds
    
    Write-Host "✅ 播放请求成功 (响应时间: ${responseTime}ms)" -ForegroundColor Green
    Write-Host "HLS URL: $($playResponse.data.hlsUrl)" -ForegroundColor Cyan
    
    # 步骤2: 等待转码启动
    Write-Host ""
    Write-Host "⏳ 步骤2: 等待FFmpeg转码启动..." -ForegroundColor Green
    Start-Sleep -Seconds 5
    
    # 步骤3: 检查进程状态
    Write-Host ""
    Write-Host "🔍 步骤3: 检查转码进程..." -ForegroundColor Green
    $statusResponse = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/simple-stream/system/status" -Method GET -TimeoutSec 10
    
    if ($statusResponse.data.activeStreams -gt 0) {
        Write-Host "✅ 转码进程正常运行" -ForegroundColor Green
        Write-Host "活跃流数: $($statusResponse.data.activeStreams)" -ForegroundColor White
        Write-Host "会话数: $($statusResponse.data.totalSessions)" -ForegroundColor White
    } else {
        Write-Host "❌ 转码进程未启动" -ForegroundColor Red
        return
    }
    
    # 步骤4: 检查HLS文件
    Write-Host ""
    Write-Host "📁 步骤4: 检查HLS文件生成..." -ForegroundColor Green
    Start-Sleep -Seconds 3
    
    try {
        $hlsContent = Invoke-WebRequest -Uri $playResponse.data.hlsUrl -TimeoutSec 10
        Write-Host "✅ HLS播放列表访问成功" -ForegroundColor Green
        Write-Host "Content-Type: $($hlsContent.Headers['Content-Type'])" -ForegroundColor White
        Write-Host "内容长度: $($hlsContent.Content.Length) 字符" -ForegroundColor White
        
        # 解析m3u8内容，获取第一个TS文件
        $m3u8Lines = $hlsContent.Content -split "`n"
        $firstTsFile = $m3u8Lines | Where-Object { $_ -match "\.ts$" } | Select-Object -First 1
        
        if ($firstTsFile) {
            $tsUrl = $playResponse.data.hlsUrl -replace "playlist\.m3u8", $firstTsFile.Trim()
            Write-Host "第一个TS文件: $tsUrl" -ForegroundColor Cyan
            
            # 步骤5: 测试TS文件访问
            Write-Host ""
            Write-Host "🎥 步骤5: 测试视频分片访问..." -ForegroundColor Green
            try {
                $tsResponse = Invoke-WebRequest -Uri $tsUrl -TimeoutSec 10
                Write-Host "✅ 视频分片访问成功" -ForegroundColor Green
                Write-Host "Content-Type: $($tsResponse.Headers['Content-Type'])" -ForegroundColor White
                Write-Host "文件大小: $([Math]::Round($tsResponse.Content.Length / 1024, 2)) KB" -ForegroundColor White
                
                Write-Host ""
                Write-Host "🎉 完整播放流程测试成功！" -ForegroundColor Green
                Write-Host "系统可以正常播放视频" -ForegroundColor White
                
            } catch {
                Write-Host "❌ 视频分片访问失败: $($_.Exception.Message)" -ForegroundColor Red
            }
        } else {
            Write-Host "⚠️ 未在播放列表中找到TS文件" -ForegroundColor Yellow
            Write-Host "播放列表内容:" -ForegroundColor Gray
            Write-Host $hlsContent.Content -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "❌ HLS播放列表访问失败: $($_.Exception.Message)" -ForegroundColor Red
    }
    
} catch {
    Write-Host "❌ 播放请求失败: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        Write-Host "HTTP状态码: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
