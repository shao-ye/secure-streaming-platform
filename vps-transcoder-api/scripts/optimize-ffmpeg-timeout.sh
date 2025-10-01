#!/bin/bash

# FFmpeg转码超时优化脚本
# 优化转码进程启动时间和连接超时设置

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}🔧 优化FFmpeg转码超时设置...${NC}"

APP_DIR="/opt/yoyo-transcoder"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
TEST_RTMP="rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"

# 检查应用目录
if [ ! -d "$APP_DIR" ]; then
    echo -e "${RED}❌ 应用目录不存在: $APP_DIR${NC}"
    exit 1
fi

cd "$APP_DIR"

echo -e "${YELLOW}1. 优化ProcessManager.js中的超时设置...${NC}"

# 备份ProcessManager.js
cp src/services/ProcessManager.js src/services/ProcessManager.js.backup-$(date +%Y%m%d_%H%M%S)

# 优化ProcessManager.js的超时和连接设置
cat > src/services/ProcessManager.js << 'EOF'
/**
 * 进程管理器 - 优化版本
 * 管理FFmpeg转码进程的生命周期
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class ProcessManager {
  constructor() {
    this.processes = new Map();
    this.hlsOutputDir = process.env.HLS_OUTPUT_DIR || '/var/www/hls';
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    
    // 优化的超时设置
    this.startupTimeout = 20000; // 启动超时：20秒（增加）
    this.connectionTimeout = 15000; // 连接超时：15秒
    this.hlsSegmentTime = parseInt(process.env.HLS_SEGMENT_TIME) || 6;
    this.hlsListSize = parseInt(process.env.HLS_LIST_SIZE) || 10;
    
    // 确保输出目录存在
    if (!fs.existsSync(this.hlsOutputDir)) {
      fs.mkdirSync(this.hlsOutputDir, { recursive: true });
      logger.info(`Created HLS output directory: ${this.hlsOutputDir}`);
    }
  }

  /**
   * 构建优化的FFmpeg命令参数
   */
  buildFFmpegArgs(rtmpUrl, streamId) {
    const outputDir = path.join(this.hlsOutputDir, streamId);
    const outputFile = path.join(outputDir, 'playlist.m3u8');

    return [
      // 输入配置 - 优化连接参数
      '-i', rtmpUrl,
      '-fflags', '+genpts',
      '-avoid_negative_ts', 'make_zero',
      
      // 连接优化参数
      '-rtmp_conn', 'S:authmod=adobe',
      '-rtmp_conn', 'S:user=',
      '-timeout', '10000000', // 10秒连接超时
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '2',
      
      // 视频编码配置 - 基于成功的手动测试
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-g', '30',
      '-keyint_min', '15',
      
      // 音频编码配置
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ac', '2',
      '-ar', '44100',
      
      // HLS输出配置 - 与手动测试保持一致
      '-f', 'hls',
      '-hls_time', this.hlsSegmentTime.toString(),
      '-hls_list_size', this.hlsListSize.toString(),
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
      '-hls_flags', 'delete_segments+round_durations+independent_segments',
      '-hls_allow_cache', '0',
      
      // 输出文件
      outputFile
    ];
  }

  /**
   * 启动视频流转码 - 优化版本
   */
  async startStream(streamId, rtmpUrl) {
    try {
      // 检查是否已存在
      if (this.processes.has(streamId)) {
        const existingProcess = this.processes.get(streamId);
        if (existingProcess.process && !existingProcess.process.killed) {
          logger.warn(`Stream ${streamId} is already running`);
          return {
            success: true,
            message: `Stream ${streamId} is already active`,
            data: { streamId, status: 'already_running' }
          };
        }
      }

      // 创建输出目录
      const outputDir = path.join(this.hlsOutputDir, streamId);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 构建FFmpeg命令
      const args = this.buildFFmpegArgs(rtmpUrl, streamId);
      logger.info(`Starting FFmpeg for stream ${streamId}:`, {
        command: `${this.ffmpegPath} ${args.join(' ')}`,
        rtmpUrl: rtmpUrl.replace(/auth_key=[^&\s]+/, 'auth_key=***'),
        outputDir
      });

      // 启动FFmpeg进程
      const ffmpegProcess = spawn(this.ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      // 创建进程信息对象
      const processInfo = {
        process: ffmpegProcess,
        streamId,
        rtmpUrl,
        startTime: Date.now(),
        outputDir,
        status: 'starting'
      };

      this.processes.set(streamId, processInfo);

      // 返回启动成功的Promise
      return new Promise((resolve, reject) => {
        let resolved = false;
        let startupTimer;
        let outputBuffer = '';
        let errorBuffer = '';

        // 启动超时定时器
        startupTimer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            logger.error(`Stream ${streamId} startup timeout after ${this.startupTimeout}ms`);
            this.stopStream(streamId);
            reject(new Error(`Stream ${streamId} startup timeout`));
          }
        }, this.startupTimeout);

        // 监听stdout输出
        ffmpegProcess.stdout.on('data', (data) => {
          const output = data.toString();
          outputBuffer += output;
          
          // 检查是否开始生成HLS文件
          if (output.includes('Opening') && output.includes('.ts') && !resolved) {
            resolved = true;
            clearTimeout(startupTimer);
            processInfo.status = 'running';
            logger.info(`Stream ${streamId} started successfully`);
            resolve({
              success: true,
              message: `Stream ${streamId} started successfully`,
              data: {
                streamId,
                status: 'running',
                outputDir,
                hlsUrl: `/hls/${streamId}/playlist.m3u8`,
                startTime: processInfo.startTime
              }
            });
          }
        });

        // 监听stderr输出
        ffmpegProcess.stderr.on('data', (data) => {
          const error = data.toString();
          errorBuffer += error;
          
          // 检查关键的启动成功标志
          if ((error.includes('Opening') && error.includes('for writing')) || 
              (error.includes('frame=') && error.includes('fps=')) && !resolved) {
            resolved = true;
            clearTimeout(startupTimer);
            processInfo.status = 'running';
            logger.info(`Stream ${streamId} started successfully (detected from stderr)`);
            resolve({
              success: true,
              message: `Stream ${streamId} started successfully`,
              data: {
                streamId,
                status: 'running',
                outputDir,
                hlsUrl: `/hls/${streamId}/playlist.m3u8`,
                startTime: processInfo.startTime
              }
            });
          }
          
          // 检查连接错误
          if (error.includes('Connection refused') || 
              error.includes('No route to host') ||
              error.includes('Connection timed out')) {
            if (!resolved) {
              resolved = true;
              clearTimeout(startupTimer);
              logger.error(`Stream ${streamId} connection failed:`, error);
              this.stopStream(streamId);
              reject(new Error(`Connection failed: ${error}`));
            }
          }
        });

        // 监听进程退出
        ffmpegProcess.on('exit', (code, signal) => {
          logger.info(`FFmpeg process for stream ${streamId} exited with code ${code}, signal ${signal}`);
          
          if (!resolved) {
            resolved = true;
            clearTimeout(startupTimer);
            
            if (code === 0) {
              // 正常退出，可能是流结束
              resolve({
                success: true,
                message: `Stream ${streamId} completed normally`,
                data: { streamId, status: 'completed', exitCode: code }
              });
            } else {
              // 异常退出
              const errorMsg = errorBuffer || `Process exited with code ${code}`;
              logger.error(`Stream ${streamId} process terminated:`, errorMsg);
              reject(new Error(`Process terminated: ${errorMsg}`));
            }
          }
          
          // 清理进程信息
          this.processes.delete(streamId);
        });

        // 监听进程错误
        ffmpegProcess.on('error', (error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(startupTimer);
            logger.error(`Stream ${streamId} process error:`, error);
            this.stopStream(streamId);
            reject(error);
          }
        });
      });

    } catch (error) {
      logger.error(`Failed to start stream ${streamId}:`, error);
      throw error;
    }
  }

  /**
   * 停止视频流转码
   */
  async stopStream(streamId) {
    try {
      const processInfo = this.processes.get(streamId);
      
      if (!processInfo) {
        return {
          success: false,
          message: `Stream ${streamId} not found`,
          data: { streamId }
        };
      }

      const { process: ffmpegProcess } = processInfo;
      
      if (ffmpegProcess && !ffmpegProcess.killed) {
        // 优雅停止
        ffmpegProcess.kill('SIGTERM');
        
        // 等待进程退出，如果超时则强制杀死
        setTimeout(() => {
          if (!ffmpegProcess.killed) {
            logger.warn(`Force killing FFmpeg process for stream ${streamId}`);
            ffmpegProcess.kill('SIGKILL');
          }
        }, 5000);
      }

      this.processes.delete(streamId);
      
      logger.info(`Stream ${streamId} stopped successfully`);
      return {
        success: true,
        message: `Stream ${streamId} stopped successfully`,
        data: { streamId, status: 'stopped' }
      };

    } catch (error) {
      logger.error(`Failed to stop stream ${streamId}:`, error);
      throw error;
    }
  }

  /**
   * 获取所有活动流状态
   */
  getActiveStreams() {
    const streams = [];
    
    for (const [streamId, processInfo] of this.processes) {
      streams.push({
        streamId,
        status: processInfo.status,
        startTime: processInfo.startTime,
        uptime: Date.now() - processInfo.startTime,
        outputDir: processInfo.outputDir,
        hlsUrl: `/hls/${streamId}/playlist.m3u8`
      });
    }
    
    return streams;
  }

  /**
   * 停止所有流
   */
  async stopAllStreams() {
    const promises = [];
    
    for (const streamId of this.processes.keys()) {
      promises.push(this.stopStream(streamId));
    }
    
    await Promise.all(promises);
    logger.info('All streams stopped');
  }
}

module.exports = ProcessManager;
EOF

echo -e "${GREEN}✅ ProcessManager.js优化完成${NC}"

echo -e "${YELLOW}2. 重启服务应用优化...${NC}"
pm2 restart vps-transcoder-api

# 等待服务重启
sleep 5

echo -e "${YELLOW}3. 测试优化后的转码功能...${NC}"

# 清理之前的测试文件
rm -rf /var/www/hls/test_* 2>/dev/null || true

# 测试转码API
echo -e "${BLUE}测试真实RTMP地址转码...${NC}"
TEST_STREAM_ID="test_optimized_$(date +%H%M%S)"

RESPONSE=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"streamId\":\"$TEST_STREAM_ID\",\"rtmpUrl\":\"$TEST_RTMP\"}" \
  http://localhost:52535/api/start-stream 2>/dev/null || echo "error")

echo -e "${CYAN}转码API响应:${NC}"
echo "$RESPONSE"

if echo "$RESPONSE" | grep -q "success.*true"; then
    echo -e "${GREEN}✅ 转码启动成功!${NC}"
    
    # 等待HLS文件生成
    echo -e "${YELLOW}⏳ 等待HLS文件生成...${NC}"
    for i in {1..30}; do
        if [ -f "/var/www/hls/$TEST_STREAM_ID/playlist.m3u8" ]; then
            echo -e "${GREEN}✅ HLS文件生成成功!${NC}"
            echo -e "${CYAN}HLS文件路径: /var/www/hls/$TEST_STREAM_ID/playlist.m3u8${NC}"
            
            # 显示HLS文件内容
            echo -e "${BLUE}HLS播放列表内容:${NC}"
            head -20 "/var/www/hls/$TEST_STREAM_ID/playlist.m3u8"
            
            # 检查TS文件
            TS_COUNT=$(ls -1 /var/www/hls/$TEST_STREAM_ID/*.ts 2>/dev/null | wc -l)
            echo -e "${CYAN}生成的TS文件数量: $TS_COUNT${NC}"
            
            break
        else
            echo -e "${YELLOW}等待中... ($i/30)${NC}"
            sleep 2
        fi
        
        if [ $i -eq 30 ]; then
            echo -e "${RED}❌ HLS文件生成超时${NC}"
            echo -e "${YELLOW}检查输出目录:${NC}"
            ls -la /var/www/hls/$TEST_STREAM_ID/ 2>/dev/null || echo "目录不存在"
        fi
    done
    
elif echo "$RESPONSE" | grep -q "already"; then
    echo -e "${YELLOW}⚠️ 流已在运行中${NC}"
else
    echo -e "${RED}❌ 转码启动失败${NC}"
    echo -e "${YELLOW}检查PM2日志:${NC}"
    pm2 logs vps-transcoder-api --lines 10
fi

echo -e "${YELLOW}4. 检查服务状态...${NC}"
pm2 status vps-transcoder-api

echo -e "${GREEN}🎉 FFmpeg超时优化完成!${NC}"
echo -e "${BLUE}==================== 优化信息 ====================${NC}"
echo -e "${YELLOW}启动超时:${NC} 20秒 (增加)"
echo -e "${YELLOW}连接超时:${NC} 15秒"
echo -e "${YELLOW}重连机制:${NC} 启用"
echo -e "${YELLOW}测试流ID:${NC} $TEST_STREAM_ID"
echo -e "${YELLOW}HLS访问URL:${NC} https://yoyo-vps.5202021.xyz/hls/$TEST_STREAM_ID/playlist.m3u8"
echo -e "${BLUE}=================================================${NC}"

echo -e "${GREEN}✅ 现在可以在前端测试播放功能了!${NC}"
