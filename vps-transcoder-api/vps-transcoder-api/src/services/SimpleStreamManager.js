const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

/**
 * 简化的实时流管理器 - 纯频道级管理
 *
 * 核心设计原则：
 * 1. VPS无状态：不存储频道配置，按需传递参数
 * 2. 心跳保活：前端定期发送心跳维持观看状态
 * 3. 超时清理：自动清理无心跳的频道转码进程
 * 4. RTMP变更检测：管理员更新RTMP地址时自动重启进程
 * 5. 频道独立：每个频道ID对应独立的FFmpeg转码进程
 * 6. 极简架构：频道到进程的一对一映射，无复杂复用逻辑
 */
class SimpleStreamManager {
  constructor() {
    // 频道到进程的映射 Map<channelId, processInfo>
    this.activeStreams = new Map();

    // 频道心跳时间 Map<channelId, lastHeartbeatTime>
    this.channelHeartbeats = new Map();

    // FFmpeg配置
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    this.hlsOutputDir = process.env.HLS_OUTPUT_DIR || '/var/www/hls';

    // 时间配置
    this.HEARTBEAT_TIMEOUT = 60000; // 60秒心跳超时
    this.CLEANUP_INTERVAL = 30000; // 30秒清理间隔

    // 初始化
    this.initialize();
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    try {
      // 1. 清理僵尸FFmpeg进程
      await this.cleanupZombieProcesses();

      // 2. 清理旧的HLS文件
      await this.cleanupOldHLSFiles();

      // 3. 重置内存状态
      this.activeStreams.clear();
      this.channelHeartbeats.clear();

      // 4. 启动定时器
      this.startCleanupTimer();

      // 确保输出目录存在
      this.ensureOutputDirectory();

      logger.info('SimpleStreamManager initialized and cleaned up', {
        hlsOutputDir: this.hlsOutputDir,
        heartbeatTimeout: this.HEARTBEAT_TIMEOUT,
        cleanupInterval: this.CLEANUP_INTERVAL
      });
    } catch (error) {
      logger.error('Failed to initialize SimpleStreamManager', { error: error.message });
      throw error;
    }
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
   * 启动观看 - 按频道ID管理
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @returns {Object} 观看结果
   */
  async startWatching(channelId, rtmpUrl) {
    try {
      // 检查频道是否已在处理
      const existingChannel = this.activeStreams.get(channelId);
      if (existingChannel) {
        // 检查RTMP地址是否变更
        if (existingChannel.rtmpUrl !== rtmpUrl) {
          logger.info('RTMP URL changed for channel, restarting process', { 
            channelId, 
            oldRtmp: existingChannel.rtmpUrl, 
            newRtmp: rtmpUrl 
          });
          
          // RTMP地址变更，停止旧进程并启动新进程
          await this.stopFFmpegProcess(channelId);
          return await this.startNewStream(channelId, rtmpUrl);
        }
        
        // RTMP地址未变更，直接返回现有进程
        logger.debug('Channel already active, returning existing stream', { channelId });
        return existingChannel.hlsUrl;
      }
      
      // 频道未在处理，启动新的FFmpeg进程
      return await this.startNewStream(channelId, rtmpUrl);
      
    } catch (error) {
      logger.error('Failed to start watching', { channelId, rtmpUrl, error: error.message });
      throw error;
    }
  }

  /**
   * 启动新的转码进程
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @returns {string} HLS播放地址
   */
  async startNewStream(channelId, rtmpUrl) {
    const processInfo = {
      channelId: channelId,
      rtmpUrl: rtmpUrl,
      hlsUrl: `https://yoyo-vps.5202021.xyz/hls/${channelId}/playlist.m3u8`,
      startTime: Date.now(),
      process: null
    };
    
    try {
      // 启动FFmpeg进程
      processInfo.process = await this.spawnFFmpegProcess(channelId, rtmpUrl);
      
      // 保存进程信息
      this.activeStreams.set(channelId, processInfo);
      
      // 设置心跳
      this.channelHeartbeats.set(channelId, Date.now());
      
      logger.info('Started new FFmpeg process', { channelId, rtmpUrl });
      return processInfo.hlsUrl;
    } catch (error) {
      logger.error('Failed to start FFmpeg process', { channelId, rtmpUrl, error: error.message });
      throw error;
    }
  }

  /**
   * 处理心跳请求 - 只更新时间戳
   * @param {string} channelId - 频道ID
   */
  handleHeartbeat(channelId) {
    this.channelHeartbeats.set(channelId, Date.now());
    logger.debug('Heartbeat received', { channelId });
  }

  /**
   * 定期清理超时的频道
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupIdleChannels();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * 清理空闲频道
   */
  async cleanupIdleChannels() {
    const now = Date.now();
    
    for (const [channelId, lastHeartbeat] of this.channelHeartbeats) {
      if (now - lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
        logger.info('Channel idle timeout, cleaning up', { 
          channelId, 
          idleTime: now - lastHeartbeat 
        });
        
        await this.stopChannel(channelId);
        this.channelHeartbeats.delete(channelId);
      }
    }
  }

  /**
   * 停止频道转码进程
   * @param {string} channelId - 频道ID
   */
  async stopChannel(channelId) {
    const processInfo = this.activeStreams.get(channelId);
    if (!processInfo) return;
    
    try {
      // 简化逻辑：直接停止FFmpeg进程并清理
      await this.stopFFmpegProcess(channelId);
      
      // 清理HLS文件
      await this.cleanupChannelHLS(channelId);
      
      // 移除频道映射
      this.activeStreams.delete(channelId);
      
      logger.info('Channel stopped successfully', { channelId });
    } catch (error) {
      logger.error('Failed to stop channel', { channelId, error: error.message });
    }
  }

  /**
   * 停止FFmpeg进程
   * @param {string} channelId - 频道ID
   */
  async stopFFmpegProcess(channelId) {
    const processInfo = this.activeStreams.get(channelId);
    if (!processInfo || !processInfo.process) return;
    
    return new Promise((resolve) => {
      processInfo.process.on('exit', () => {
        logger.debug('FFmpeg process exited', { channelId });
        resolve();
      });
      
      // 发送终止信号
      processInfo.process.kill('SIGTERM');
      
      // 5秒后强制杀死
      setTimeout(() => {
        if (!processInfo.process.killed) {
          processInfo.process.kill('SIGKILL');
          logger.warn('FFmpeg process force killed', { channelId });
        }
        resolve();
      }, 5000);
    });
  }

  /**
   * 启动FFmpeg进程
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @returns {Object} FFmpeg进程对象
   */
  async spawnFFmpegProcess(channelId, rtmpUrl) {
    // 创建输出目录
    const outputDir = path.join(this.hlsOutputDir, channelId);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // 构建FFmpeg命令 - 超低延迟配置 + 网络优化
    const outputFile = path.join(outputDir, 'playlist.m3u8');
    const ffmpegArgs = [
      // 🔥 网络输入优化配置
      '-fflags', '+genpts',  // 生成时间戳
      '-timeout', '10000000',  // 10秒网络超时 (微秒)
      '-reconnect', '1',  // 启用自动重连
      '-reconnect_at_eof', '1',  // EOF时重连
      '-reconnect_streamed', '1',  // 流式重连
      '-reconnect_delay_max', '2',  // 最大重连延迟2秒

      // 基本输入配置
      '-i', rtmpUrl,

      // 🔥 输入处理优化
      '-avoid_negative_ts', 'make_zero',  // 避免负时间戳
      '-fflags', '+discardcorrupt',  // 丢弃损坏的包
      '-err_detect', 'ignore_err',  // 忽略某些错误继续处理

      // 视频编码 - 超低延迟配置
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-g', '15',  // 强制关键帧间隔15帧 (0.5秒@30fps)
      '-keyint_min', '15',  // 最小关键帧间隔
      '-sc_threshold', '0',  // 禁用场景切换检测
      '-b:v', '1000k',  // 设置视频比特率
      '-maxrate', '1200k',  // 最大比特率
      '-bufsize', '2000k',  // 缓冲区大小

      // 音频编码 - 简化配置
      '-c:a', 'aac',
      '-b:a', '128k',  // 音频比特率
      '-ar', '44100',  // 音频采样率

      // 🔥 HLS输出 - 优化配置
      '-f', 'hls',
      '-hls_time', '2',  // 增加分片时间到2秒，提高稳定性
      '-hls_list_size', '6',  // 减少播放列表大小
      '-hls_flags', 'delete_segments+append_list+split_by_time',
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
      '-hls_allow_cache', '0',  // 禁用缓存
      '-start_number', '0',  // 从0开始编号
      '-y',  // 覆盖输出文件

      outputFile
    ];

    logger.info('Starting FFmpeg process', {
      channelId,
      rtmpUrl,
      command: `${this.ffmpegPath} ${ffmpegArgs.join(' ')}`
    });

    // 启动FFmpeg进程
    const ffmpegProcess = spawn(this.ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    // 设置进程事件处理
    ffmpegProcess.on('error', (error) => {
      logger.error('FFmpeg process error', { channelId, error: error.message });
      this.activeStreams.delete(channelId);
    });

    ffmpegProcess.on('exit', (code, signal) => {
      logger.info('FFmpeg process exited', { channelId, code, signal });
      this.activeStreams.delete(channelId);
    });

    // 监听stderr输出
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // 记录所有stderr输出，不只是错误
      logger.info('FFmpeg stderr', { channelId, output: output.trim() });
      if (output.includes('error') || output.includes('failed')) {
        logger.error('FFmpeg error detected', { channelId, output: output.trim() });
      }
    });

    // 等待流准备就绪 - 使用15秒超时，配合优化的检测逻辑
    await this.waitForStreamReady(channelId, 15000);

    logger.info('FFmpeg process started successfully', { channelId, pid: ffmpegProcess.pid });
    return ffmpegProcess;
  }

  /**
   * 清理频道HLS文件
   * @param {string} channelId - 频道ID
   */
  async cleanupChannelHLS(channelId) {
    try {
      const outputDir = path.join(this.hlsOutputDir, channelId);
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          fs.unlinkSync(path.join(outputDir, file));
        }
        fs.rmdirSync(outputDir);
        logger.debug('Cleaned up HLS files', { channelId });
      }
    } catch (error) {
      logger.warn('Failed to cleanup HLS files', { channelId, error: error.message });
    }
  }

  /**
   * 清理僵尸FFmpeg进程
   */
  async cleanupZombieProcesses() {
    try {
      const { stdout } = await execAsync('ps aux | grep ffmpeg | grep -v grep || true');
      const processes = stdout.split('\n').filter(line => line.trim());

      for (const processLine of processes) {
        const pid = processLine.split(/\s+/)[1];
        if (pid) {
          logger.warn('Killing zombie FFmpeg process', { pid });
          try {
            process.kill(pid, 'SIGTERM');
          } catch (error) {
            logger.warn('Failed to kill process', { pid, error: error.message });
          }
        }
      }
    } catch (error) {
      logger.warn('No zombie processes found or cleanup failed', { error: error.message });
    }
  }

  /**
   * 清理旧的HLS文件
   */
  async cleanupOldHLSFiles() {
    try {
      if (fs.existsSync(this.hlsOutputDir)) {
        const channels = fs.readdirSync(this.hlsOutputDir);
        for (const channelId of channels) {
          await this.cleanupChannelHLS(channelId);
        }
        logger.info('Cleaned up old HLS files');
      }
    } catch (error) {
      logger.warn('Failed to cleanup old HLS files', { error: error.message });
    }
  }

  /**
   * 等待流准备就绪（确保是实时的新分片）
   * @param {string} channelId - 频道ID
   * @param {number} timeout - 超时时间（毫秒）
   */
  async waitForStreamReady(channelId, timeout = 30000) {
    const outputDir = path.join(this.hlsOutputDir, channelId);
    const playlistFile = path.join(outputDir, 'playlist.m3u8');

    const startTime = Date.now();

    logger.info('Waiting for stream to be ready', { channelId, timeout });

    while (Date.now() - startTime < timeout) {
      if (fs.existsSync(playlistFile)) {
        try {
          const content = fs.readFileSync(playlistFile, 'utf8');

          // 🔥 优化：检查playlist文件是否包含有效的HLS内容
          if (content.includes('#EXTM3U') && content.includes('#EXT-X-VERSION')) {
            logger.info('Stream ready - valid HLS playlist detected', {
              channelId,
              contentLength: content.length,
              elapsed: Date.now() - startTime
            });
            return;
          }

          // 检查是否有分片文件引用
          const segments = content.match(/segment\d+\.ts/g) || [];

          if (segments.length > 0) {
            // 检查至少一个分片文件存在
            const firstSegment = segments[0];
            const segmentPath = path.join(outputDir, firstSegment);

            if (fs.existsSync(segmentPath)) {
              const stats = fs.statSync(segmentPath);
              const segmentSize = stats.size;

              // 分片文件应该有合理的大小（至少1KB）
              if (segmentSize > 1024) {
                logger.info('Stream ready with valid segments', {
                  channelId,
                  segmentCount: segments.length,
                  firstSegmentSize: segmentSize,
                  elapsed: Date.now() - startTime
                });
                return;
              }
            }
          }

          // 🔥 新增：如果playlist存在但没有分片，检查是否刚开始生成
          if (content.includes('#EXTM3U') && content.length > 20) {
            logger.info('Stream starting - playlist exists, waiting for segments', {
              channelId,
              elapsed: Date.now() - startTime
            });
          }

        } catch (error) {
          logger.warn('Error reading playlist file', { channelId, error: error.message });
        }
      }

      // 🔥 优化：更频繁的检查，更快响应
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 🔥 增强错误信息：提供更多诊断信息
    const diagnostics = {
      playlistExists: fs.existsSync(playlistFile),
      outputDirExists: fs.existsSync(outputDir),
      outputDirContents: []
    };

    if (diagnostics.outputDirExists) {
      try {
        diagnostics.outputDirContents = fs.readdirSync(outputDir);
      } catch (e) {
        diagnostics.outputDirError = e.message;
      }
    }

    logger.error('Stream failed to be ready within timeout', {
      channelId,
      timeout,
      diagnostics
    });

    throw new Error(`Stream not ready within ${timeout}ms - diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  /**
   * 获取系统状态
   */
  getSystemStatus() {
    return {
      activeStreams: this.activeStreams.size,
      totalSessions: this.channelHeartbeats.size
    };
  }

  /**
   * 停止观看频道
   * @param {string} channelId - 频道ID
   */
  async stopWatching(channelId) {
    logger.info('Stopping watching channel', { channelId });
    
    // 停止心跳
    this.channelHeartbeats.delete(channelId);
    
    // 停止频道进程
    await this.stopChannel(channelId);
    
    return {
      status: 'success',
      message: 'Stopped watching successfully',
      data: { channelId }
    };
  }


  /**
   * 销毁管理器
   */
  async destroy() {
    // 停止所有转码进程
    const stopPromises = [];
    for (const channelId of this.activeStreams.keys()) {
      stopPromises.push(this.stopChannel(channelId));
    }
    
    await Promise.all(stopPromises);
    
    // 清理所有数据
    this.activeStreams.clear();
    this.channelHeartbeats.clear();
    
    logger.info('SimpleStreamManager destroyed');
  }
}

module.exports = SimpleStreamManager;
