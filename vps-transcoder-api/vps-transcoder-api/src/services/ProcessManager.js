const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class ProcessManager {
  constructor() {
    // 存储所有运行中的转码进程
    this.runningStreams = new Map();

    // FFmpeg路径
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

    // HLS输出目录
    this.hlsOutputDir = process.env.HLS_OUTPUT_DIR || '/var/www/hls';

    // HLS配置 - 低延迟优化
    this.hlsSegmentTime = parseInt(process.env.HLS_SEGMENT_TIME) || 1; // 减少到1秒
    this.hlsListSize = parseInt(process.env.HLS_LIST_SIZE) || 3; // 减少到3个分片

    // CPU优化配置 - 限制最大并发进程数
    this.maxConcurrentStreams = parseInt(process.env.MAX_CONCURRENT_STREAMS) || 4; // 限制最多4个并发流
    this.cpuThreshold = parseFloat(process.env.CPU_THRESHOLD) || 80.0; // CPU使用率阈值

    // 确保输出目录存在
    this.ensureOutputDirectory();

    logger.info('ProcessManager initialized', {
      ffmpegPath: this.ffmpegPath,
      hlsOutputDir: this.hlsOutputDir,
      hlsSegmentTime: this.hlsSegmentTime,
      hlsListSize: this.hlsListSize
    });
  }

  /**
   * 确保HLS输出目录存在
   */
  ensureOutputDirectory() {
    try {
      if (!fs.existsSync(this.hlsOutputDir)) {
        fs.mkdirSync(this.hlsOutputDir, { recursive: true });
        logger.info(`Created HLS output directory: ${this.hlsOutputDir}`);
      }
    } catch (error) {
      logger.error('Failed to create HLS output directory:', error);
      throw new Error(`Cannot create HLS output directory: ${this.hlsOutputDir}`);
    }
  }

  /**
   * 构建FFmpeg命令参数
   * @param {string} rtmpUrl - RTMP输入流URL
   * @param {string} streamId - 流ID
   * @returns {Array} FFmpeg命令参数数组
   */
  buildFFmpegArgs(rtmpUrl, streamId) {
    const outputDir = path.join(this.hlsOutputDir, streamId);
    const outputFile = path.join(outputDir, 'playlist.m3u8');

    return [
      // 输入配置 - 极速启动优化
      '-fflags', '+nobuffer+flush_packets+genpts',
      '-flags', 'low_delay',
      '-strict', 'experimental',
      '-analyzeduration', '500000',
      '-probesize', '500000',
      '-i', rtmpUrl,
      '-avoid_negative_ts', 'make_zero',
      '-copyts',
      '-start_at_zero',
      
      // 低延迟连接参数 - 减少重连延迟
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '1', // 减少重连延迟从2秒到1秒
      
      // 视频编码配置 - 极低延迟优化
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // 使用最快预设减少编码延迟
      '-tune', 'zerolatency', // 零延迟调优
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-g', '30', // 减少GOP大小，增加关键帧频率以减少延迟
      '-keyint_min', '15', // 减少最小关键帧间隔
      '-sc_threshold', '0', // 禁用场景切换检测
      '-threads', '2',
      '-crf', '23', // 提高编码质量，减少延迟
      '-maxrate', '2000k', // 限制最大码率
      '-bufsize', '1000k', // 减少缓冲区大小
      '-x264opts', 'no-scenecut:force-cfr:no-mbtree:sliced-threads:sync-lookahead=0:bframes=0:rc-lookahead=0',
      
      // 音频编码配置 - 低延迟
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-ar', '44100',
      '-aac_coder', 'fast',
      
      // HLS输出配置 - 极速启动设置
      '-f', 'hls',
      '-hls_time', '0.5', // 🔥 减少分片时间到0.5秒，更快生成第一个分片
      '-hls_list_size', '6', // 增加播放列表大小确保流畅
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
      '-hls_flags', 'delete_segments+round_durations+independent_segments+program_date_time',
      '-hls_allow_cache', '0',
      '-hls_segment_type', 'mpegts',
      '-start_number', '0',
      '-hls_base_url', '',
      
      // 低延迟流控制
      '-flush_packets', '1',
      '-max_delay', '0',
      '-max_interleave_delta', '0',
      
      // 输出文件
      outputFile
    ];
  }

  /**
   * 启动视频流转码
   * @param {string} rtmpUrl - RTMP输入流URL
   * @param {string} streamId - 流ID
   * @returns {Promise<Object>} 启动结果
   */
  async startStream(rtmpUrl, streamId) {
    try {
      // 验证输入参数
      if (!streamId || !rtmpUrl) {
        throw new Error('streamId and rtmpUrl are required');
      }

      // 检查并发进程数限制
      if (this.runningStreams.size >= this.maxConcurrentStreams) {
        logger.warn(`Maximum concurrent streams (${this.maxConcurrentStreams}) reached. Current: ${this.runningStreams.size}`);
        throw new Error(`Maximum concurrent streams limit (${this.maxConcurrentStreams}) reached. Please stop some streams first.`);
      }

      // 如果流已经在运行，先停止旧的进程
      if (this.runningStreams.has(streamId)) {
        logger.info(`Stream ${streamId} already running, stopping old process`);
        await this.stopStream(streamId);
      }

      // 创建输出目录
      const outputDir = path.join(this.hlsOutputDir, streamId);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 构建FFmpeg命令
      const ffmpegArgs = this.buildFFmpegArgs(rtmpUrl, streamId);

      logger.info(`Starting stream ${streamId}`, {
        rtmpUrl,
        outputDir,
        command: `${this.ffmpegPath} ${ffmpegArgs.join(' ')}`
      });

      // 启动FFmpeg进程
      const ffmpegProcess = spawn(this.ffmpegPath, ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      // 生成进程唯一ID
      const processId = uuidv4();

      // 存储进程信息
      const streamInfo = {
        processId,
        streamId,
        rtmpUrl,
        process: ffmpegProcess,
        startTime: new Date(),
        outputDir,
        status: 'starting'
      };

      this.runningStreams.set(streamId, streamInfo);

      // 设置进程事件监听器
      this.setupProcessEventHandlers(streamInfo);

      // 🔥 快速启动：只等待playlist生成，不等待segment
      await this.waitForStreamReady(streamId, 15000); // 15秒超时

      streamInfo.status = 'running';

      logger.info(`Stream ${streamId} started successfully`, {
        processId,
        pid: ffmpegProcess.pid
      });

      return {
        success: true,
        streamId,
        processId,
        pid: ffmpegProcess.pid,
        outputDir,
        hlsUrl: `/hls/${streamId}/playlist.m3u8`
      };

    } catch (error) {
      logger.error(`Failed to start stream ${streamId}:`, error);

      // 清理失败的进程
      if (this.runningStreams.has(streamId)) {
        await this.stopStream(streamId);
      }

      throw error;
    }
  }

  /**
   * 设置进程事件处理器
   * @param {Object} streamInfo - 流信息对象
   */
  setupProcessEventHandlers(streamInfo) {
    const { process: ffmpegProcess, streamId, processId } = streamInfo;

    // 标准输出处理
    ffmpegProcess.stdout.on('data', (data) => {
      logger.debug(`Stream ${streamId} stdout:`, data.toString());
    });

    // 标准错误输出处理（FFmpeg主要输出在stderr）
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      logger.debug(`Stream ${streamId} stderr:`, output);

      // 检测错误信息
      if (output.includes('Connection refused') || 
          output.includes('Server returned 404') ||
          output.includes('No route to host')) {
        logger.warn(`Stream ${streamId} connection issue:`, output);
      }
    });

    // 进程退出处理
    ffmpegProcess.on('exit', (code, signal) => {
      logger.info(`Stream ${streamId} process exited`, {
        processId,
        code,
        signal,
        pid: ffmpegProcess.pid
      });

      // 从运行列表中移除
      this.runningStreams.delete(streamId);

      // 如果是异常退出，记录错误
      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
        logger.error(`Stream ${streamId} exited with error`, {
          code,
          signal,
          processId
        });
      }
    });

    // 进程错误处理
    ffmpegProcess.on('error', (error) => {
      logger.error(`Stream ${streamId} process error:`, {
        processId,
        error: error.message,
        stack: error.stack
      });

      // 从运行列表中移除
      this.runningStreams.delete(streamId);
    });
  }

  /**
   * 等待流准备就绪
   * @param {string} streamId - 流ID
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<void>}
   */
  async waitForStreamReady(streamId, timeout = 15000) {
    const startTime = Date.now();
    const outputDir = path.join(this.hlsOutputDir, streamId);
    const m3u8File = path.join(outputDir, 'playlist.m3u8');

    return new Promise((resolve, reject) => {
      const checkReady = () => {
        // 检查是否超时
        if (Date.now() - startTime > timeout) {
          return reject(new Error(`Stream ${streamId} startup timeout`));
        }

        // 检查进程是否还在运行
        if (!this.runningStreams.has(streamId)) {
          return reject(new Error(`Stream ${streamId} process terminated during startup`));
        }

        // 🔥 快速启动优化：只要playlist文件存在且有内容就返回
        // 不再等待segment完全生成，让播放器尽早开始尝试加载
        if (fs.existsSync(m3u8File)) {
          try {
            const content = fs.readFileSync(m3u8File, 'utf8');
            // 只要playlist有内容（包含#EXTM3U头）就认为ready
            if (content.length > 0 && content.includes('#EXTM3U')) {
              logger.info(`Stream ${streamId} playlist ready (fast start mode)`, {
                waitTime: Date.now() - startTime
              });
              return resolve();
            }
          } catch (error) {
            // 文件可能正在写入，继续等待
          }
        }

        // 🔥 减少检查间隔到200ms，更快响应
        setTimeout(checkReady, 200);
      };

      checkReady();
    });
  }

  /**
   * 停止指定的视频流转码
   * @param {string} streamId - 流ID
   * @returns {Promise<Object>} 停止结果
   */
  async stopStream(streamId) {
    try {
      if (!this.runningStreams.has(streamId)) {
        logger.warn(`Stream ${streamId} not found, may already be stopped`);
        return {
          success: true,
          message: `Stream ${streamId} was not running`
        };
      }

      const streamInfo = this.runningStreams.get(streamId);
      const { process: ffmpegProcess, processId } = streamInfo;

      logger.info(`Stopping stream ${streamId}`, {
        processId,
        pid: ffmpegProcess.pid
      });

      // 发送SIGTERM信号进行优雅退出
      ffmpegProcess.kill('SIGTERM');

      // 等待进程退出，如果超时则强制终止
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (!ffmpegProcess.killed) {
            logger.warn(`Force killing stream ${streamId} process`);
            ffmpegProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000); // 5秒超时

        ffmpegProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // 从运行列表中移除
      this.runningStreams.delete(streamId);

      logger.info(`Stream ${streamId} stopped successfully`);

      return {
        success: true,
        streamId,
        processId
      };

    } catch (error) {
      logger.error(`Failed to stop stream ${streamId}:`, error);
      throw error;
    }
  }

  /**
   * 停止所有运行中的流
   * @returns {Promise<Array>} 停止结果数组
   */
  async stopAllStreams() {
    const streamIds = Array.from(this.runningStreams.keys());

    if (streamIds.length === 0) {
      logger.info('No running streams to stop');
      return [];
    }

    logger.info(`Stopping ${streamIds.length} running streams`);

    const stopPromises = streamIds.map(streamId => 
      this.stopStream(streamId).catch(error => ({
        streamId,
        error: error.message
      }))
    );

    const results = await Promise.all(stopPromises);

    logger.info('All streams stop operation completed', {
      total: streamIds.length,
      results
    });

    return results;
  }

  /**
   * 获取所有运行中的流信息
   * @returns {Array} 流信息数组
   */
  getRunningStreams() {
    const streams = [];

    for (const [streamId, streamInfo] of this.runningStreams) {
      streams.push({
        streamId,
        processId: streamInfo.processId,
        pid: streamInfo.process.pid,
        rtmpUrl: streamInfo.rtmpUrl,
        startTime: streamInfo.startTime,
        status: streamInfo.status,
        outputDir: streamInfo.outputDir,
        uptime: Date.now() - streamInfo.startTime.getTime()
      });
    }

    return streams;
  }

  /**
   * 检查指定流是否在运行
   * @param {string} streamId - 流ID
   * @returns {boolean} 是否在运行
   */
  isStreamRunning(streamId) {
    return this.runningStreams.has(streamId);
  }

  /**
   * 获取系统状态
   * @returns {Object} 系统状态信息
   */
  getSystemStatus() {
    const runningStreams = this.getRunningStreams();

    return {
      totalStreams: runningStreams.length,
      runningStreams,
      hlsOutputDir: this.hlsOutputDir,
      ffmpegPath: this.ffmpegPath,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ProcessManager;
