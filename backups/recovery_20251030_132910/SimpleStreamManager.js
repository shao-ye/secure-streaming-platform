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

    // 🆕 用户会话跟踪 Map<sessionId, { channelId, timestamp }>
    this.userSessions = new Map();

    // 🆕 预加载频道集合 Set<channelId>
    this.preloadChannels = new Set();

    // 🆕 录制功能属性
    this.recordingChannels = new Set();  // 录制中的频道集合
    this.recordingConfigs = new Map();   // 频道录制配置 Map<channelId, recordConfig>
    this.recordingBaseDir = process.env.RECORDINGS_BASE_DIR || '/var/www/recordings';

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
   * 🆕 跟踪用户会话（可选，用于统计活跃用户数）
   * @param {string} channelId - 频道ID
   * @param {string} sessionId - 会话ID
   */
  trackUserSession(channelId, sessionId) {
    if (sessionId) {
      this.userSessions.set(sessionId, {
        channelId: channelId,
        timestamp: Date.now()
      });
      logger.debug('User session tracked', { channelId, sessionId });
    }
  }

  /**
   * 定期清理超时的频道
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanupIdleChannels();
      this.cleanupStaleSessions(); // 🆕 同时清理过期会话
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * 🆕 清理过期的用户会话
   */
  cleanupStaleSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.userSessions.entries()) {
      if (now - session.timestamp > this.HEARTBEAT_TIMEOUT) {
        this.userSessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.info('Cleaned stale user sessions', { 
        cleanedCount, 
        remainingSessions: this.userSessions.size 
      });
    }
  }

  /**
   * 清理空闲频道
   */
  async cleanupIdleChannels() {
    const now = Date.now();
    
    for (const [channelId, lastHeartbeat] of this.channelHeartbeats) {
      // 🆕 跳过预加载频道
      if (this.preloadChannels.has(channelId)) {
        continue;
      }
      
      // 🆕 跳过录制频道
      if (this.recordingChannels.has(channelId)) {
        continue;
      }
      
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
    
    // 构建FFmpeg命令 - 简化且稳定的配置（基于成功测试）
    const outputFile = path.join(outputDir, 'playlist.m3u8');
    const ffmpegArgs = [
      // 基本输入配置
      '-i', rtmpUrl,

      // 视频编码 - 简化配置
      '-c:v', 'libx264',
      '-preset', 'ultrafast',

      // 🔥 禁用音频输出 - 避免PCM μ-law转码问题
      '-an',  // 不处理音频流

      // 🔥 HLS输出 - 简化配置
      '-f', 'hls',
      '-hls_time', '2',  // 2秒分片
      '-hls_list_size', '6',  // 保持6个分片
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

    // 检查代理状态并设置环境变量
    const env = { ...process.env };
    
    try {
      // 检查V2Ray代理是否运行
      const { execSync } = require('child_process');
      const result = execSync('ps aux | grep v2ray | grep -v grep', { encoding: 'utf8' });
      
      if (result.trim()) {
        // V2Ray正在运行，设置代理环境变量
        env.http_proxy = 'socks5://127.0.0.1:1080';
        env.https_proxy = 'socks5://127.0.0.1:1080';
        env.HTTP_PROXY = 'socks5://127.0.0.1:1080';
        env.HTTPS_PROXY = 'socks5://127.0.0.1:1080';
        
        logger.info('FFmpeg will use proxy for RTMP connection', { 
          channelId, 
          proxyPort: '1080',
          rtmpUrl 
        });
      } else {
        logger.info('FFmpeg will use direct connection (no proxy)', { channelId });
      }
    } catch (error) {
      logger.warn('Failed to check proxy status, using direct connection', { 
        channelId, 
        error: error.message 
      });
    }

    // 启动FFmpeg进程
    const ffmpegProcess = spawn(this.ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: env  // 添加环境变量支持
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

    // 等待流准备就绪 - 使用30秒超时，配合简化的FFmpeg配置
    await this.waitForStreamReady(channelId, 30000);

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
      activeStreams: this.activeStreams.size,      // FFmpeg转码进程数
      totalSessions: this.userSessions.size,        // 🆕 真实用户会话数
      activeChannels: this.channelHeartbeats.size,  // 🆕 活跃频道数（向后兼容）
      activeRecordings: this.recordingChannels.size // 🆕 活跃录制数量
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


  // ===== 🆕 预加载功能 =====

  /**
   * 启动预加载
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   */
  async startPreload(channelId, rtmpUrl) {
    try {
      logger.info('Starting preload', { channelId });
      
      // 添加到预加载集合
      this.preloadChannels.add(channelId);
      
      // 检查是否已经在转码
      if (this.activeStreams.has(channelId)) {
        const streamInfo = this.activeStreams.get(channelId);
        
        // 如果RTMP URL变了，需要重启
        if (streamInfo.rtmpUrl !== rtmpUrl) {
          logger.info('RTMP URL changed, restarting preload', { 
            channelId, 
            oldUrl: streamInfo.rtmpUrl, 
            newUrl: rtmpUrl 
          });
          await this.stopChannel(channelId);
        } else {
          logger.info('Channel already transcoding, skip', { channelId });
          return {
            status: 'success',
            message: 'Channel already transcoding',
            data: { channelId, isPreload: true }
          };
        }
      }
      
      // 启动转码（复用startWatching的逻辑）
      const result = await this.startWatching(channelId, rtmpUrl);
      
      // 更新心跳时间（预加载不需要心跳，但设置一个很大的值防止被清理）
      this.channelHeartbeats.set(channelId, Date.now());
      
      logger.info('Preload started successfully', { channelId });
      
      return {
        status: 'success',
        message: 'Preload started',
        data: { channelId, isPreload: true }
      };
    } catch (error) {
      logger.error('Failed to start preload', { 
        channelId, 
        error: error.message 
      });
      
      // 失败时从预加载集合中移除
      this.preloadChannels.delete(channelId);
      
      throw error;
    }
  }

  /**
   * 停止预加载
   * @param {string} channelId - 频道ID
   */
  async stopPreload(channelId) {
    try {
      logger.info('Stopping preload', { channelId });
      
      // 从预加载集合中移除
      this.preloadChannels.delete(channelId);
      
      // 停止转码
      await this.stopChannel(channelId);
      
      // 移除心跳记录
      this.channelHeartbeats.delete(channelId);
      
      logger.info('Preload stopped successfully', { channelId });
      
      return {
        status: 'success',
        message: 'Preload stopped',
        data: { channelId }
      };
    } catch (error) {
      logger.error('Failed to stop preload', { 
        channelId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * 获取预加载状态
   */
  getPreloadStatus() {
    const preloadChannels = Array.from(this.preloadChannels).map(channelId => {
      const streamInfo = this.activeStreams.get(channelId);
      return {
        channelId,
        isActive: streamInfo ? true : false,
        rtmpUrl: streamInfo ? streamInfo.rtmpUrl : null,
        startedAt: streamInfo ? streamInfo.startedAt : null
      };
    });
    
    return {
      totalPreloadChannels: this.preloadChannels.size,
      activePreloadChannels: preloadChannels.filter(c => c.isActive).length,
      channels: preloadChannels
    };
  }

  // ===== 🆕 录制功能 =====

  /**
   * 从Workers API获取频道RTMP URL
   * @param {string} channelId - 频道ID
   * @returns {string} RTMP URL
   */
  async fetchChannelRtmpUrl(channelId) {
    try {
      const workersApiUrl = process.env.WORKERS_API_URL || 'https://yoyoapi.5202021.xyz';
      const apiKey = process.env.VPS_API_KEY;
      
      const response = await fetch(`${workersApiUrl}/api/channels/${channelId}`, {
        headers: {
          'X-API-Key': apiKey
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch channel config: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.data.rtmpUrl;
    } catch (error) {
      logger.error('Failed to fetch channel RTMP URL', { channelId, error: error.message });
      throw error;
    }
  }

  /**
   * 启用录制
   * @param {string} channelId - 频道ID
   * @param {Object} recordConfig - 录制配置（包含channelName）
   */
  async enableRecording(channelId, recordConfig) {
    try {
      logger.info('Enabling recording', { channelId, recordConfig });
      
      // 检查是否已经在录制中
      const existing = this.activeStreams.get(channelId);
      if (existing && existing.isRecording) {
        logger.info('Recording already active for channel', { 
          channelId,
          recordingPath: existing.recordingPath 
        });
        
        // 更新配置但不重启进程
        this.recordingConfigs.set(channelId, recordConfig);
        this.recordingChannels.add(channelId);
        
        return {
          status: 'success',
          message: 'Recording already active',
          data: { channelId, isRecording: true, alreadyActive: true }
        };
      }
      
      // 保存录制配置
      const configWithSession = {
        ...recordConfig,
        sessionStartTime: Date.now()  // 🆕 记录会话开始时间
      };
      this.recordingConfigs.set(channelId, configWithSession);
      this.recordingChannels.add(channelId);
      
      if (existing) {
        // 已有进程但未录制，需要重启以添加录制输出
        logger.info('Restarting stream with recording', { channelId });
        await this.stopFFmpegProcess(channelId);
        await this.startStreamWithRecording(channelId, existing.rtmpUrl, configWithSession);
      } else {
        // 无进程，启动新进程（包含录制）
        const rtmpUrl = recordConfig.rtmpUrl || await this.fetchChannelRtmpUrl(channelId);
        await this.startStreamWithRecording(channelId, rtmpUrl, configWithSession);
      }
      
      return {
        status: 'success',
        message: 'Recording enabled',
        data: { channelId, isRecording: true }
      };
    } catch (error) {
      logger.error('Failed to enable recording', { channelId, error: error.message });
      this.recordingChannels.delete(channelId);
      this.recordingConfigs.delete(channelId);
      throw error;
    }
  }

  /**
   * 禁用录制
   * @param {string} channelId - 频道ID
   */
  async disableRecording(channelId) {
    try {
      logger.info('Disabling recording', { channelId });
      
      const existing = this.activeStreams.get(channelId);
      const oldRecordingPath = existing?.recordingPath;
      
      // 🐛 修复：先获取配置，再删除（重命名需要用到配置）
      const recordConfig = this.recordingConfigs.get(channelId);
      
      // 移除录制标记
      this.recordingChannels.delete(channelId);
      this.recordingConfigs.delete(channelId);
      
      if (existing && existing.isRecording) {
        const hasViewers = this.channelHeartbeats.has(channelId);
        const isPreload = this.preloadChannels.has(channelId);
        
        // 🆕 录制结束前重命名文件
        if (recordConfig && recordConfig.segmentEnabled) {
          // 分段模式：只重命名最后一个分段（其他已在录制过程中重命名）
          await this.renameFinalSegment(channelId, recordConfig);
        } else if (oldRecordingPath) {
          // 单文件模式：重命名为实际结束时间
          await this.renameRecordingWithActualEndTime(oldRecordingPath);
        }
        
        if (hasViewers || isPreload) {
          // 有观看者或预加载，重启进程移除录制
          logger.info('Restarting stream without recording', { channelId });
          await this.stopFFmpegProcess(channelId);
          await this.startWatching(channelId, existing.rtmpUrl);
        } else {
          // 无观看者和预加载，直接停止
          await this.stopChannel(channelId);
        }
      }
      
      return {
        status: 'success',
        message: 'Recording disabled',
        data: { channelId }
      };
    } catch (error) {
      logger.error('Failed to disable recording', { channelId, error: error.message });
      throw error;
    }
  }

  /**
   * 启动带录制的流
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {Object} recordConfig - 录制配置
   */
  async startStreamWithRecording(channelId, rtmpUrl, recordConfig) {
    const recordingPath = this.generateRecordingPath(channelId, recordConfig.channelName, recordConfig);
    
    const processInfo = {
      channelId: channelId,
      rtmpUrl: rtmpUrl,
      hlsUrl: `https://yoyo-vps.5202021.xyz/hls/${channelId}/playlist.m3u8`,
      startTime: Date.now(),
      process: null,
      isRecording: true,
      recordingPath: recordingPath
    };
    
    try {
      // 启动FFmpeg进程（包含录制）🆕 传递完整配置
      processInfo.process = await this.spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath, recordConfig);
      
      // 保存进程信息
      this.activeStreams.set(channelId, processInfo);
      
      // 设置心跳
      this.channelHeartbeats.set(channelId, Date.now());
      
      logger.info('Started stream with recording', { 
        channelId, 
        recordingPath,
        segmentEnabled: recordConfig.segmentEnabled,
        segmentDuration: recordConfig.segmentDuration
      });
      return processInfo.hlsUrl;
    } catch (error) {
      logger.error('Failed to start stream with recording', { channelId, error: error.message });
      throw error;
    }
  }

  /**
   * 启动带录制的FFmpeg进程
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {string} recordingPath - 录制文件路径
   * @param {Object} recordConfig - 录制配置（含分段设置）🆕
   */
  async spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath, recordConfig) {
    const outputDir = path.join(this.hlsOutputDir, channelId);
    const recordDir = path.dirname(recordingPath);
    
    // 确保目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(recordDir)) {
      fs.mkdirSync(recordDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, 'playlist.m3u8');
    const ffmpegArgs = [
      '-i', rtmpUrl,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-an',
      
      // HLS输出
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
      '-hls_allow_cache', '0',
      '-start_number', '0',
      '-y',
      outputFile,
      
      // MP4录制输出（复制视频，不录制音频）🆕支持分段
      // 🔧 修复：使用-an而不是-c:a copy，因为某些RTMP源的音频编码（如pcm_mulaw）不被MP4支持
      '-c:v', 'copy',
      '-an'  // 不录制音频，避免音频编码兼容性问题
    ];
    
    // 🆕 根据配置决定录制方式
    if (recordConfig && recordConfig.segmentEnabled) {
      // 分段录制
      const segmentSeconds = (recordConfig.segmentDuration || 60) * 60;
      ffmpegArgs.push(
        '-f', 'segment',
        '-segment_time', segmentSeconds.toString(),
        '-segment_format', 'mp4',
        '-reset_timestamps', '1',
        '-y',
        recordingPath
      );
      logger.info('Using segment recording', { 
        segmentDuration: recordConfig.segmentDuration,
        segmentSeconds 
      });
    } else {
      // 单文件录制
      ffmpegArgs.push(
        '-f', 'mp4',
        '-y',
        recordingPath
      );
      logger.info('Using single file recording');
    }

    logger.info('Starting FFmpeg with recording', {
      channelId,
      rtmpUrl,
      recordingPath,
      command: `${this.ffmpegPath} ${ffmpegArgs.join(' ')}`
    });

    // 检查代理状态
    const env = { ...process.env };
    try {
      const { execSync } = require('child_process');
      const result = execSync('ps aux | grep v2ray | grep -v grep', { encoding: 'utf8' });
      
      if (result.trim()) {
        env.http_proxy = 'socks5://127.0.0.1:1080';
        env.https_proxy = 'socks5://127.0.0.1:1080';
        env.HTTP_PROXY = 'socks5://127.0.0.1:1080';
        env.HTTPS_PROXY = 'socks5://127.0.0.1:1080';
        logger.info('FFmpeg will use proxy for RTMP connection', { channelId });
      }
    } catch (error) {
      logger.warn('No proxy detected, using direct connection', { channelId });
    }

    // 启动FFmpeg进程
    const ffmpegProcess = spawn(this.ffmpegPath, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: env
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

    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      logger.info('FFmpeg stderr', { channelId, output: output.trim() });
      if (output.includes('error') || output.includes('failed')) {
        logger.error('FFmpeg error detected', { channelId, output: output.trim() });
      }
      
      // 🆕 分段模式：监听segment切换，实时重命名已完成的分段
      if (recordConfig && recordConfig.segmentEnabled) {
        // 匹配FFmpeg输出: Opening 'xxx_temp_001.mp4' for writing
        const match = output.match(/Opening '.*_temp_(\d+)\.mp4' for writing/);
        if (match) {
          const currentIndex = parseInt(match[1]);
          
          // 当检测到新segment开始时，说明上一个segment已完成
          if (currentIndex > 0) {
            const completedIndex = currentIndex - 1;
            
            logger.info('Segment switch detected, scheduling rename', { 
              channelId, 
              completedIndex,
              currentIndex
            });
            
            // 等待2秒后重命名（确保FFmpeg完成文件写入）
            setTimeout(() => {
              this.renameCompletedSegment(channelId, completedIndex, recordConfig)
                .catch(err => {
                  logger.error('Failed to rename completed segment', {
                    channelId,
                    completedIndex,
                    error: err.message
                  });
                });
            }, 2000);
          }
        }
      }
    });

    // 等待流准备就绪
    await this.waitForStreamReady(channelId, 30000);

    logger.info('FFmpeg process with recording started successfully', { 
      channelId, 
      pid: ffmpegProcess.pid,
      recordingPath 
    });
    
    return ffmpegProcess;
  }

  /**
   * 生成录制文件路径
   * @param {string} channelId - 频道ID
   * @param {string} channelName - 频道名称
   * @param {Object} recordConfig - 录制配置
   * @returns {string} 录制文件完整路径
   */
  generateRecordingPath(channelId, channelName, recordConfig) {
    // 🔧 使用北京时间（UTC+8）
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
    
    const dateStr = `${year}${month}${day}`;
    const timeStr = `${hours}${minutes}${seconds}`;
    
    const basePath = recordConfig.storagePath || this.recordingBaseDir;
    
    // 🆕 分段录制：使用临时文件名
    if (recordConfig.segmentEnabled) {
      const filename = `${channelName}_${channelId}_${dateStr}_temp_%03d.mp4`;
      return path.join(basePath, channelId, dateStr, filename);
    }
    
    // 单文件录制：使用完整文件名
    const [endHour, endMin] = recordConfig.endTime.split(':');
    const endTimeStr = `${endHour}${endMin}00`;
    const filename = `${channelName}_${channelId}_${dateStr}_${timeStr}_to_${endTimeStr}.mp4`;
    
    return path.join(basePath, channelId, dateStr, filename);
  }

  /**
   * 重命名录制文件，将结束时间改为实际停止时间
   * @param {string} oldPath - 原始文件路径
   */
  async renameRecordingWithActualEndTime(oldPath) {
    try {
      // 等待2秒确保FFmpeg完成文件写入
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (!fs.existsSync(oldPath)) {
        logger.warn('Recording file not found for rename', { oldPath });
        return;
      }
      
      // 获取当前北京时间作为实际结束时间
      const now = new Date();
      const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
      const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
      const actualEndTime = `${hours}${minutes}${seconds}`;
      
      // 解析原文件名
      const filename = path.basename(oldPath);
      const match = filename.match(/_to_(\d{6})\.mp4$/);
      
      if (!match) {
        logger.warn('Failed to parse recording filename for rename', { filename });
        return;
      }
      
      const configuredEndTime = match[1];
      
      // 🔧 统一逻辑：无论定时任务还是手动关闭，都使用实际结束时间
      // 这样文件名完全反映真实的录制时段
      const newFilename = filename.replace(/_to_\d{6}\.mp4$/, `_to_${actualEndTime}.mp4`);
      
      // 如果实际时间和配置时间相同，无需重命名
      if (actualEndTime === configuredEndTime) {
        logger.info('Recording end time matches configured time, skip rename', {
          filename,
          actualEndTime
        });
        return;
      }
      
      const newPath = path.join(path.dirname(oldPath), newFilename);
      
      // 重命名文件
      fs.renameSync(oldPath, newPath);
      
      logger.info('Recording file renamed with actual end time', {
        oldPath,
        newPath,
        configuredEndTime,
        actualEndTime
      });
    } catch (error) {
      logger.error('Failed to rename recording file', {
        oldPath,
        error: error.message
      });
    }
  }

  /**
   * 重命名单个已完成的分段文件（录制过程中调用）
   * @param {string} channelId - 频道ID
   * @param {number} segmentIndex - 分段索引
   * @param {Object} recordConfig - 录制配置
   */
  async renameCompletedSegment(channelId, segmentIndex, recordConfig) {
    try {
      const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const dateStr = `${beijingNow.getUTCFullYear()}${String(beijingNow.getUTCMonth() + 1).padStart(2, '0')}${String(beijingNow.getUTCDate()).padStart(2, '0')}`;
      
      const basePath = recordConfig.storagePath || this.recordingBaseDir;
      const outputDir = path.join(basePath, channelId, dateStr);
      
      const tempFile = `${recordConfig.channelName}_${channelId}_${dateStr}_temp_${String(segmentIndex).padStart(3, '0')}.mp4`;
      const tempPath = path.join(outputDir, tempFile);
      
      // 检查文件是否存在
      if (!fs.existsSync(tempPath)) {
        logger.warn('Segment file not found for rename', { channelId, tempPath });
        return;
      }
      
      // 计算该segment的时间范围
      const sessionStart = new Date(recordConfig.sessionStartTime + 8 * 60 * 60 * 1000);
      const segmentDurationMs = recordConfig.segmentDuration * 60 * 1000;
      
      const startTime = new Date(sessionStart.getTime() + segmentIndex * segmentDurationMs);
      const endTime = new Date(startTime.getTime() + segmentDurationMs);
      
      const startTimeStr = `${String(startTime.getUTCHours()).padStart(2, '0')}${String(startTime.getUTCMinutes()).padStart(2, '0')}${String(startTime.getUTCSeconds()).padStart(2, '0')}`;
      const endTimeStr = `${String(endTime.getUTCHours()).padStart(2, '0')}${String(endTime.getUTCMinutes()).padStart(2, '0')}${String(endTime.getUTCSeconds()).padStart(2, '0')}`;
      
      // 生成正式文件名
      const finalFilename = `${recordConfig.channelName}_${channelId}_${dateStr}_${startTimeStr}_to_${endTimeStr}.mp4`;
      const finalPath = path.join(outputDir, finalFilename);
      
      // 检查是否已重命名（避免重复）
      if (fs.existsSync(finalPath)) {
        logger.info('Segment already renamed, skipping', { channelId, finalFilename });
        return;
      }
      
      // 重命名
      fs.renameSync(tempPath, finalPath);
      
      const fileSize = fs.statSync(finalPath).size;
      logger.info('Segment renamed after 2s delay', { 
        channelId,
        segmentIndex,
        from: tempFile,
        to: finalFilename,
        size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`
      });
    } catch (error) {
      logger.error('Failed to rename completed segment', {
        channelId,
        segmentIndex,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * 重命名最后一个分段文件（停止录制时调用）
   * @param {string} channelId - 频道ID
   * @param {Object} recordConfig - 录制配置
   */
  async renameFinalSegment(channelId, recordConfig) {
    try {
      // 等待2秒确保FFmpeg完成文件写入
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const dateStr = `${beijingNow.getUTCFullYear()}${String(beijingNow.getUTCMonth() + 1).padStart(2, '0')}${String(beijingNow.getUTCDate()).padStart(2, '0')}`;
      
      const basePath = recordConfig.storagePath || this.recordingBaseDir;
      const outputDir = path.join(basePath, channelId, dateStr);
      
      if (!fs.existsSync(outputDir)) {
        logger.warn('Output directory not found', { channelId, outputDir });
        return;
      }
      
      // 查找所有临时文件（只应该剩下最后一个）
      const tempFiles = fs.readdirSync(outputDir)
        .filter(f => f.includes('_temp_') && f.endsWith('.mp4'))
        .sort();
      
      if (tempFiles.length === 0) {
        logger.info('No temp files found (all segments already renamed)', { channelId });
        return;
      }
      
      logger.info(`Found ${tempFiles.length} temp file(s) to rename as final segment`, { channelId, tempFiles });
      
      const sessionStart = new Date(recordConfig.sessionStartTime + 8 * 60 * 60 * 1000);
      const segmentDurationMs = recordConfig.segmentDuration * 60 * 1000;
      
      // 重命名所有剩余的临时文件（通常只有最后一个）
      for (const tempFile of tempFiles) {
        const tempPath = path.join(outputDir, tempFile);
        
        // 提取segment索引
        const match = tempFile.match(/_temp_(\d+)\.mp4$/);
        if (!match) {
          logger.warn('Invalid temp file name format', { tempFile });
          continue;
        }
        
        const segmentIndex = parseInt(match[1]);
        
        // 计算该段的开始和结束时间
        const startTime = new Date(sessionStart.getTime() + segmentIndex * segmentDurationMs);
        const endTime = beijingNow;  // 最后一段使用实际停止时间
        
        const startTimeStr = `${String(startTime.getUTCHours()).padStart(2, '0')}${String(startTime.getUTCMinutes()).padStart(2, '0')}${String(startTime.getUTCSeconds()).padStart(2, '0')}`;
        const endTimeStr = `${String(endTime.getUTCHours()).padStart(2, '0')}${String(endTime.getUTCMinutes()).padStart(2, '0')}${String(endTime.getUTCSeconds()).padStart(2, '0')}`;
        
        // 生成正式文件名
        const finalFilename = `${recordConfig.channelName}_${channelId}_${dateStr}_${startTimeStr}_to_${endTimeStr}.mp4`;
        const finalPath = path.join(outputDir, finalFilename);
        
        // 重命名
        fs.renameSync(tempPath, finalPath);
        
        const fileSize = fs.statSync(finalPath).size;
        logger.info('Final segment renamed', { 
          channelId,
          segmentIndex,
          from: tempFile,
          to: finalFilename,
          size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`
        });
      }
      
      logger.info('All final segments renamed successfully', { channelId });
    } catch (error) {
      logger.error('Failed to rename final segment', {
        channelId,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * 获取录制状态
   */
  getRecordingStatus() {
    const recordingChannels = Array.from(this.recordingChannels).map(channelId => {
      const streamInfo = this.activeStreams.get(channelId);
      const config = this.recordingConfigs.get(channelId);
      return {
        channelId,
        isActive: streamInfo ? true : false,
        isRecording: streamInfo ? streamInfo.isRecording : false,
        recordingPath: streamInfo ? streamInfo.recordingPath : null,
        startedAt: streamInfo ? streamInfo.startedAt : null,
        config: config
      };
    });
    
    return {
      totalRecordingChannels: this.recordingChannels.size,
      activeRecordingChannels: recordingChannels.filter(c => c.isActive).length,
      channels: recordingChannels
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
    this.preloadChannels.clear();
    this.recordingChannels.clear();
    this.recordingConfigs.clear();
    
    logger.info('SimpleStreamManager destroyed');
  }
}

module.exports = SimpleStreamManager;
