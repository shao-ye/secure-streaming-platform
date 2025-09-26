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

    // HLS配置
    this.hlsSegmentTime = parseInt(process.env.HLS_SEGMENT_TIME) || 2;
    this.hlsListSize = parseInt(process.env.HLS_LIST_SIZE) || 6;

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
    const outputFile = path.join(outputDir, 'stream.m3u8');

    return [
      // 输入配置
      '-i', rtmpUrl,
      '-fflags', '+genpts',
      '-avoid_negative_ts', 'make_zero',

      // 视频编码配置
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p',
      '-g', '50',
      '-keyint_min', '25',
      '-sc_threshold', '0',

      // 音频编码配置
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-ar', '44100',

      // HLS配置
      '-f', 'hls',
      '-hls_time', this.hlsSegmentTime.toString(),
      '-hls_list_size', this.hlsListSize.toString(),
      '-hls_wrap', (this.hlsListSize * 2).toString(),
      '-hls_delete_threshold', '1',
      '-hls_flags', 'delete_segments+round_durations+independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
      '-method', 'PUT',

      // 输出文件
      outputFile
    ];
  }

  /**
   * 启动视频流转码
   * @param {string} streamId - 流ID
   * @param {string} rtmpUrl - RTMP输入流URL
   * @returns {Promise<Object>} 启动结果
   */
  async startStream(streamId, rtmpUrl) {
    try {
      // 验证输入参数
      if (!streamId || !rtmpUrl) {
        throw new Error('streamId and rtmpUrl are required');
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

      // 等待进程稳定启动（检查输出文件生成）
      await this.waitForStreamReady(streamId, 10000); // 10秒超时

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
        hlsUrl: `/hls/${streamId}/stream.m3u8`
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
  async waitForStreamReady(streamId, timeout = 10000) {
    const startTime = Date.now();
    const outputDir = path.join(this.hlsOutputDir, streamId);
    const m3u8File = path.join(outputDir, 'stream.m3u8');

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

        // 检查m3u8文件是否生成
        if (fs.existsSync(m3u8File)) {
          try {
            const content = fs.readFileSync(m3u8File, 'utf8');
            // 检查是否包含至少一个segment
            if (content.includes('.ts')) {
              return resolve();
            }
          } catch (error) {
            // 文件可能正在写入，继续等待
          }
        }

        // 继续检查
        setTimeout(checkReady, 500);
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
