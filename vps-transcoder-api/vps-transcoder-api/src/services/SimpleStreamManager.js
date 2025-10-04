const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

/**
 * 简化的实时流管理器 - 纯频道级管理 + RTMP变更检测
 *
 * 核心设计原则：
 * 1. VPS无状态：不存储频道配置，按需传递参数
 * 2. 心跳保活：前端定期发送心跳维持观看状态
 * 3. 超时清理：自动清理无心跳的频道转码进程
 * 4. RTMP变更检测：管理员更新RTMP地址时自动重启进程
 * 5. 极简架构：只需要频道到进程的一对一映射
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
      // 停止FFmpeg进程
      await this.stopFFmpegProcess(channelId);
      
      // 清理HLS文件
      await this.cleanupChannelHLS(channelId);
      
      // 移除进程映射
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
    
    // 构建FFmpeg命令 - 超低延迟配置
    const outputFile = path.join(outputDir, 'playlist.m3u8');
    const ffmpegArgs = [
      // 基本输入配置
      '-i', rtmpUrl,
      
      // 视频编码 - 简化配置
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      
      // 音频编码 - 简化配置
      '-c:a', 'aac',
      
      // HLS输出 - 基本配置
      '-f', 'hls',
      '-hls_time', '0.5',
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
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
    
    // 等待流准备就绪
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
  async waitForStreamReady(channelId, timeout = 15000) {
    const outputDir = path.join(this.hlsOutputDir, channelId);
    const playlistFile = path.join(outputDir, 'playlist.m3u8');
    
    const startTime = Date.now();
    
    logger.info('Waiting for stream to be ready', { channelId, timeout });
    
    while (Date.now() - startTime < timeout) {
      if (fs.existsSync(playlistFile)) {
        try {
          const content = fs.readFileSync(playlistFile, 'utf8');
          
          // 检查是否有分片文件
          const segments = content.match(/segment\d+\.ts/g) || [];
          
          if (segments.length > 0) {
            // 检查最新分片文件
            const latestSegment = segments[segments.length - 1];
            const segmentPath = path.join(outputDir, latestSegment);
            
            if (fs.existsSync(segmentPath)) {
              const stats = fs.statSync(segmentPath);
              const segmentAge = Date.now() - stats.mtime.getTime();
              
              // 分片文件应该是最近5秒内生成的
              if (segmentAge < 5000) {
                logger.info('Stream ready with segments', { 
                  channelId, 
                  segmentCount: segments.length,
                  latestSegmentAge: segmentAge
                });
                return;
              }
            }
          }
        } catch (error) {
          logger.warn('Error reading playlist file', { channelId, error: error.message });
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`Stream not ready within ${timeout}ms`);
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
