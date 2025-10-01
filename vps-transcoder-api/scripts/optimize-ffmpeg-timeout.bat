@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo 🔧 优化FFmpeg转码超时设置...

set APP_DIR=D:\项目文件\yoyo-kindergarten\code\secure-streaming-platform\vps-transcoder-api\vps-transcoder-api
set API_KEY=85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938
set TEST_RTMP=rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4

echo 检查应用目录: %APP_DIR%
if not exist "%APP_DIR%" (
    echo ❌ 应用目录不存在: %APP_DIR%
    pause
    exit /b 1
)

cd /d "%APP_DIR%"

echo 1. 优化ProcessManager.js中的超时设置...

REM 备份ProcessManager.js
set BACKUP_FILE=src\services\ProcessManager.js.backup-%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set BACKUP_FILE=%BACKUP_FILE: =0%
copy "src\services\ProcessManager.js" "%BACKUP_FILE%" >nul

echo 正在更新ProcessManager.js...
echo 已创建备份文件: %BACKUP_FILE%

REM 创建优化后的ProcessManager.js
(
echo /**
echo  * 进程管理器 - 优化版本
echo  * 管理FFmpeg转码进程的生命周期
echo  */
echo.
echo const { spawn } = require('child_process'^);
echo const path = require('path'^);
echo const fs = require('fs'^);
echo const logger = require('../utils/logger'^);
echo.
echo class ProcessManager {
echo   constructor(^) {
echo     this.processes = new Map(^);
echo     this.hlsOutputDir = process.env.HLS_OUTPUT_DIR ^|^| '/var/www/hls';
echo     this.ffmpegPath = process.env.FFMPEG_PATH ^|^| 'ffmpeg';
echo     
echo     // 优化的超时设置
echo     this.startupTimeout = 30000; // 启动超时：30秒（增加）
echo     this.connectionTimeout = 20000; // 连接超时：20秒
echo     this.hlsSegmentTime = parseInt(process.env.HLS_SEGMENT_TIME^) ^|^| 6;
echo     this.hlsListSize = parseInt(process.env.HLS_LIST_SIZE^) ^|^| 10;
echo     
echo     // 确保输出目录存在
echo     if (^!fs.existsSync(this.hlsOutputDir^)^) {
echo       fs.mkdirSync(this.hlsOutputDir, { recursive: true }^);
echo       logger.info(`Created HLS output directory: ${this.hlsOutputDir}`^);
echo     }
echo   }
echo.
echo   /**
echo    * 构建优化的FFmpeg命令参数
echo    */
echo   buildFFmpegArgs(rtmpUrl, streamId^) {
echo     const outputDir = path.join(this.hlsOutputDir, streamId^);
echo     const outputFile = path.join(outputDir, 'playlist.m3u8'^);
echo.
echo     return [
echo       // 输入配置 - 优化连接参数
echo       '-i', rtmpUrl,
echo       '-fflags', '+genpts',
echo       '-avoid_negative_ts', 'make_zero',
echo       
echo       // 连接优化参数
echo       '-rtmp_conn', 'S:authmod=adobe',
echo       '-rtmp_conn', 'S:user=',
echo       '-reconnect', '1',
echo       '-reconnect_at_eof', '1',
echo       '-reconnect_streamed', '1',
echo       '-reconnect_delay_max', '2',
echo       
echo       // 视频编码配置 - 基于成功的手动测试
echo       '-c:v', 'libx264',
echo       '-preset', 'ultrafast',
echo       '-tune', 'zerolatency',
echo       '-profile:v', 'baseline',
echo       '-level', '3.0',
echo       '-g', '30',
echo       '-keyint_min', '15',
echo       
echo       // 音频编码配置
echo       '-c:a', 'aac',
echo       '-b:a', '96k',
echo       '-ac', '2',
echo       '-ar', '44100',
echo       
echo       // HLS输出配置 - 与手动测试保持一致
echo       '-f', 'hls',
echo       '-hls_time', this.hlsSegmentTime.toString(^),
echo       '-hls_list_size', this.hlsListSize.toString(^),
echo       '-hls_segment_filename', path.join(outputDir, 'segment%%03d.ts'^),
echo       '-hls_flags', 'delete_segments+round_durations+independent_segments',
echo       '-hls_allow_cache', '0',
echo       
echo       // 输出文件
echo       outputFile
echo     ];
echo   }
echo.
echo   /**
echo    * 启动视频流转码 - 优化版本
echo    */
echo   async startStream(streamId, rtmpUrl^) {
echo     try {
echo       // 检查是否已存在
echo       if (this.processes.has(streamId^)^) {
echo         const existingProcess = this.processes.get(streamId^);
echo         if (existingProcess.process ^&^& ^!existingProcess.process.killed^) {
echo           logger.warn(`Stream ${streamId} is already running`^);
echo           return {
echo             success: true,
echo             message: `Stream ${streamId} is already active`,
echo             data: { streamId, status: 'already_running' }
echo           };
echo         }
echo       }
echo.
echo       // 创建输出目录
echo       const outputDir = path.join(this.hlsOutputDir, streamId^);
echo       if (^!fs.existsSync(outputDir^)^) {
echo         fs.mkdirSync(outputDir, { recursive: true }^);
echo       }
echo.
echo       // 构建FFmpeg命令
echo       const args = this.buildFFmpegArgs(rtmpUrl, streamId^);
echo       logger.info(`Starting FFmpeg for stream ${streamId}:`, {
echo         command: `${this.ffmpegPath} ${args.join(' '^)}`,
echo         rtmpUrl: rtmpUrl.replace(/auth_key=[^^&\s]+/, 'auth_key=***'^),
echo         outputDir
echo       }^);
echo.
echo       // 启动FFmpeg进程
echo       const ffmpegProcess = spawn(this.ffmpegPath, args, {
echo         stdio: ['ignore', 'pipe', 'pipe'],
echo         env: { ...process.env }
echo       }^);
echo.
echo       // 创建进程信息对象
echo       const processInfo = {
echo         process: ffmpegProcess,
echo         streamId,
echo         rtmpUrl,
echo         startTime: Date.now(^),
echo         outputDir,
echo         status: 'starting'
echo       };
echo.
echo       this.processes.set(streamId, processInfo^);
echo.
echo       // 返回启动成功的Promise
echo       return new Promise((resolve, reject^) =^> {
echo         let resolved = false;
echo         let startupTimer;
echo         let outputBuffer = '';
echo         let errorBuffer = '';
echo.
echo         // 启动超时定时器
echo         startupTimer = setTimeout((^) =^> {
echo           if (^!resolved^) {
echo             resolved = true;
echo             logger.error(`Stream ${streamId} startup timeout after ${this.startupTimeout}ms`^);
echo             this.stopStream(streamId^);
echo             reject(new Error(`Stream ${streamId} startup timeout`^)^);
echo           }
echo         }, this.startupTimeout^);
echo.
echo         // 监听stdout输出
echo         ffmpegProcess.stdout.on('data', (data^) =^> {
echo           const output = data.toString(^);
echo           outputBuffer += output;
echo           
echo           // 检查是否开始生成HLS文件
echo           if (output.includes('Opening'^) ^&^& output.includes('.ts'^) ^&^& ^!resolved^) {
echo             resolved = true;
echo             clearTimeout(startupTimer^);
echo             processInfo.status = 'running';
echo             logger.info(`Stream ${streamId} started successfully`^);
echo             resolve({
echo               success: true,
echo               message: `Stream ${streamId} started successfully`,
echo               data: {
echo                 streamId,
echo                 status: 'running',
echo                 outputDir,
echo                 hlsUrl: `/hls/${streamId}/playlist.m3u8`,
echo                 startTime: processInfo.startTime
echo               }
echo             }^);
echo           }
echo         }^);
echo.
echo         // 监听stderr输出
echo         ffmpegProcess.stderr.on('data', (data^) =^> {
echo           const error = data.toString(^);
echo           errorBuffer += error;
echo           
echo           // 检查关键的启动成功标志
echo           if ((error.includes('Opening'^) ^&^& error.includes('for writing'^)^) ^|^| 
echo               (error.includes('frame='^) ^&^& error.includes('fps='^)^) ^&^& ^!resolved^) {
echo             resolved = true;
echo             clearTimeout(startupTimer^);
echo             processInfo.status = 'running';
echo             logger.info(`Stream ${streamId} started successfully (detected from stderr^)`^);
echo             resolve({
echo               success: true,
echo               message: `Stream ${streamId} started successfully`,
echo               data: {
echo                 streamId,
echo                 status: 'running',
echo                 outputDir,
echo                 hlsUrl: `/hls/${streamId}/playlist.m3u8`,
echo                 startTime: processInfo.startTime
echo               }
echo             }^);
echo           }
echo           
echo           // 检查连接错误
echo           if (error.includes('Connection refused'^) ^|^| 
echo               error.includes('No route to host'^) ^|^|
echo               error.includes('Connection timed out'^)^) {
echo             if (^!resolved^) {
echo               resolved = true;
echo               clearTimeout(startupTimer^);
echo               logger.error(`Stream ${streamId} connection failed:`, error^);
echo               this.stopStream(streamId^);
echo               reject(new Error(`Connection failed: ${error}`^)^);
echo             }
echo           }
echo         }^);
echo.
echo         // 监听进程退出
echo         ffmpegProcess.on('exit', (code, signal^) =^> {
echo           logger.info(`FFmpeg process for stream ${streamId} exited with code ${code}, signal ${signal}`^);
echo           
echo           if (^!resolved^) {
echo             resolved = true;
echo             clearTimeout(startupTimer^);
echo             
echo             if (code === 0^) {
echo               // 正常退出，可能是流结束
echo               resolve({
echo                 success: true,
echo                 message: `Stream ${streamId} completed normally`,
echo                 data: { streamId, status: 'completed', exitCode: code }
echo               }^);
echo             } else {
echo               // 异常退出
echo               const errorMsg = errorBuffer ^|^| `Process exited with code ${code}`;
echo               logger.error(`Stream ${streamId} process terminated:`, errorMsg^);
echo               reject(new Error(`Process terminated: ${errorMsg}`^)^);
echo             }
echo           }
echo           
echo           // 清理进程信息
echo           this.processes.delete(streamId^);
echo         }^);
echo.
echo         // 监听进程错误
echo         ffmpegProcess.on('error', (error^) =^> {
echo           if (^!resolved^) {
echo             resolved = true;
echo             clearTimeout(startupTimer^);
echo             logger.error(`Stream ${streamId} process error:`, error^);
echo             this.stopStream(streamId^);
echo             reject(error^);
echo           }
echo         }^);
echo       }^);
echo.
echo     } catch (error^) {
echo       logger.error(`Failed to start stream ${streamId}:`, error^);
echo       throw error;
echo     }
echo   }
echo.
echo   /**
echo    * 停止视频流转码
echo    */
echo   async stopStream(streamId^) {
echo     try {
echo       const processInfo = this.processes.get(streamId^);
echo       
echo       if (^!processInfo^) {
echo         return {
echo           success: false,
echo           message: `Stream ${streamId} not found`,
echo           data: { streamId }
echo         };
echo       }
echo.
echo       const { process: ffmpegProcess } = processInfo;
echo       
echo       if (ffmpegProcess ^&^& ^!ffmpegProcess.killed^) {
echo         // 优雅停止
echo         ffmpegProcess.kill('SIGTERM'^);
echo         
echo         // 等待进程退出，如果超时则强制杀死
echo         setTimeout((^) =^> {
echo           if (^!ffmpegProcess.killed^) {
echo             logger.warn(`Force killing FFmpeg process for stream ${streamId}`^);
echo             ffmpegProcess.kill('SIGKILL'^);
echo           }
echo         }, 5000^);
echo       }
echo.
echo       this.processes.delete(streamId^);
echo       
echo       logger.info(`Stream ${streamId} stopped successfully`^);
echo       return {
echo         success: true,
echo         message: `Stream ${streamId} stopped successfully`,
echo         data: { streamId, status: 'stopped' }
echo       };
echo.
echo     } catch (error^) {
echo       logger.error(`Failed to stop stream ${streamId}:`, error^);
echo       throw error;
echo     }
echo   }
echo.
echo   /**
echo    * 获取所有活动流状态
echo    */
echo   getActiveStreams(^) {
echo     const streams = [];
echo     
echo     for (const [streamId, processInfo] of this.processes^) {
echo       streams.push({
echo         streamId,
echo         status: processInfo.status,
echo         startTime: processInfo.startTime,
echo         uptime: Date.now(^) - processInfo.startTime,
echo         outputDir: processInfo.outputDir,
echo         hlsUrl: `/hls/${streamId}/playlist.m3u8`
echo       }^);
echo     }
echo     
echo     return streams;
echo   }
echo.
echo   /**
echo    * 停止所有流
echo    */
echo   async stopAllStreams(^) {
echo     const promises = [];
echo     
echo     for (const streamId of this.processes.keys(^)^) {
echo       promises.push(this.stopStream(streamId^)^);
echo     }
echo     
echo     await Promise.all(promises^);
echo     logger.info('All streams stopped'^);
echo   }
echo }
echo.
echo module.exports = ProcessManager;
) > "src\services\ProcessManager.js"

echo ✅ ProcessManager.js优化完成

echo.
echo 🎉 FFmpeg超时优化完成!
echo ==================== 优化信息 ====================
echo 启动超时: 30秒 (增加)
echo 连接超时: 20秒
echo 重连机制: 启用
echo 移除了无效的timeout参数
echo 优化了FFmpeg命令行参数
echo =================================================

echo.
echo ✅ 优化完成! 现在需要将修改后的代码上传到VPS并重启服务。
echo.
pause
