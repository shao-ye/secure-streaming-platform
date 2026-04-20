const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../../config');

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
    this.recordingBaseDir = process.env.RECORDINGS_PATH || process.env.RECORDINGS_BASE_DIR || '/var/www/recordings';

    // FFmpeg配置
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    this.hlsOutputDir = process.env.HLS_OUTPUT_DIR || '/var/www/hls';
    
    // 从统一配置读取域名，无默认值
    this.vpsBaseDomain = config.vpsBaseUrl;
    this.workersApiUrl = config.workersApiUrl;
    
    // 从统一配置读取SOCKS5端口，默认1080
    this.socks5Port = config.getOptionalValue(config.socks5Port, 1080);

    // 时间配置
    this.HEARTBEAT_TIMEOUT = 60000; // 60秒心跳超时
    this.CLEANUP_INTERVAL = 30000; // 30秒清理间隔

    // 🛡️ 频道级异步串行锁
    // 防止 startWatching / enableRecording 等对同一频道的并发调用
    // 同时看到 activeStreams 为空、各自 spawn 一个 ffmpeg 造成重复录制
    // Map<channelId, Promise>，保存当前频道正在执行的锁端 Promise
    this.channelLocks = new Map();

    // 🆕 文件最终化调度器（迭代 3：录制文件改名成功后触发自动上传）
    // 由 app.js 调 setFinalizeDispatcher(...) 注入；未注入时保持 null
    // 所有 dispatch 调用走 _safeFinalizeDispatch，不会押塞或影响原有 rename 流程
    this.finalizeDispatcher = null;

    // 初始化
    // 注意：initialize 是异步的（要清理僵尸 ffmpeg、扫 HLS 目录），
    // 为避免构造器返回时 activeStreams 尚未就绪、外部直接调 enableRecording
    // 导致重复启动 ffmpeg（见重复录制 bug 根因），这里把 Promise 暴露为 this.ready，
    // 由调用方（app.js）在启动 RecordScheduler 之前 await 一次。
    this.ready = this.initialize();
    
    logger.info('🎬 SimpleStreamManager initialized', {
      vpsBaseDomain: this.vpsBaseDomain,
      workersApiUrl: this.workersApiUrl,
      hlsOutputDir: this.hlsOutputDir,
      recordingBaseDir: this.recordingBaseDir
    });
  }

  /**
   * 获取频道级串行锁
   *
   * 使用示例：
   *   const release = await this._acquireChannelLock(channelId);
   *   try {
   *     // 对单频道的临界区操作，如判断 activeStreams、spawn、set
   *   } finally {
   *     release();
   *   }
   *
   * 实现：链式排队——新任务先 await 前一任务完成，再执行自己。
   * 释放时调 release()，同时如果队尾已空则清理 Map 条目避免内存泄漏。
   *
   * @param {string} channelId - 频道ID
   * @returns {Promise<Function>} 释放函数，必须在临界区执行后调用
   */
  async _acquireChannelLock(channelId) {
    // 前一个任务的 Promise（如果有）
    const prev = this.channelLocks.get(channelId) || Promise.resolve();

    // 创建当前任务的 Promise，release 是触发其 resolve 的闸门
    let release;
    const current = new Promise(resolve => { release = resolve; });

    // 将队尾更新为「等前一个完成后再等当前完成」的复合 Promise
    // 这样紧跟在后面的新任务会自动排到队尾
    const chained = prev.catch(() => {}).then(() => current);
    this.channelLocks.set(channelId, chained);

    // 等上一个任务完成（忽略其异常），才返回给调用方
    await prev.catch(() => {});

    // 返回释放函数
    return () => {
      // 触发当前任务的 resolve，让后续等待者拿到锁
      release();
      // 如果队尾就是自己（没有后续者），清除 Map 条目避免内存泄漏
      // 用 queueMicrotask 延后一个微任务，给 chained 链上的后续 then 机会被触发
      queueMicrotask(() => {
        if (this.channelLocks.get(channelId) === chained) {
          this.channelLocks.delete(channelId);
        }
      });
    };
  }

  /**
   * 注入文件最终化调度器（迭代 3）
   *
   * 属于依赖注入模式：app.js 启动时实例化 FileFinalizeDispatcher 后调本方法。
   * 未注入时所有 dispatch 调用会被安静忽略，适用于禁用上传模块的部署场景。
   *
   * @param {Object|null} dispatcher FileFinalizeDispatcher 实例，传 null 可撤销
   */
  setFinalizeDispatcher(dispatcher) {
    this.finalizeDispatcher = dispatcher || null;
    if (dispatcher) {
      logger.info('SimpleStreamManager 已注入 FileFinalizeDispatcher');
    }
  }

  /**
   * 安全调用 dispatcher.onFinalize
   *
   * 设计原则：
   *   - dispatcher 未注入时直接 return
   *   - 任何异常吃掉，不押塞录制改名流程
   *   - onFinalize 本身内部用 setImmediate 异步化，无需在此 await
   *
   * @param {string} filePath  改名完成后的最终文件路径
   * @param {string} channelId 频道 ID
   */
  _safeFinalizeDispatch(filePath, channelId) {
    try {
      if (!this.finalizeDispatcher || typeof this.finalizeDispatcher.onFinalize !== 'function') {
        return;
      }
      this.finalizeDispatcher.onFinalize(filePath, channelId);
    } catch (err) {
      logger.warn('SimpleStreamManager 派发 onFinalize 失败（已吞）', {
        filePath,
        channelId,
        error: err && err.message
      });
    }
  }

  /**
   * 从文件路径反推频道 ID
   *
   * 约定录制文件路径结构为 {root}/{channelId}/{YYYYMMDD}/{file.mp4}，
   * 因此倒数第二层目录名 = channelId。只有 stream_ 开头的视为有效。
   *
   * @param {string} filePath
   * @returns {string|null}
   */
  _extractChannelIdFromPath(filePath) {
    try {
      const dateDir = path.dirname(filePath);
      const channelDir = path.dirname(dateDir);
      const channelId = path.basename(channelDir);
      return /^stream_/.test(channelId) ? channelId : null;
    } catch {
      return null;
    }
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
   * 根据频道配置生成视频滤镜
   * @param {Object} channelConfig - 频道配置（含videoAspectRatio）
   * @returns {string|null} FFmpeg滤镜参数
   */
  getVideoFilter(channelConfig) {
    const aspectRatio = channelConfig?.videoAspectRatio || 'original';
    
    switch (aspectRatio) {
      case '4:3':
        return 'scale=ih*4/3:ih';
      case '16:9':
        return 'scale=ih*16/9:ih';
      case 'original':
      default:
        return null;  // 不使用滤镜
    }
  }

  /**
   * 解析录制文件名使用的频道名称
   * 优先使用频道配置接口返回的权威名称，避免调度配置链路中中文被替换成问号
   * @param {string} channelId - 频道ID
   * @param {Object} recordConfig - 录制配置
   * @param {Object|null} channelConfig - 频道配置接口返回的数据
   * @returns {string} 可用于文件名的频道名称
   */
  resolveRecordingChannelName(channelId, recordConfig, channelConfig = null) {
    const configChannelName = typeof recordConfig?.channelName === 'string'
      ? recordConfig.channelName.trim()
      : '';
    const authoritativeChannelName = typeof channelConfig?.channelName === 'string'
      ? channelConfig.channelName.trim()
      : '';

    if (authoritativeChannelName) {
      if (configChannelName && configChannelName !== authoritativeChannelName) {
        logger.warn('Recording channel name corrected from channel config', {
          channelId,
          configChannelName,
          authoritativeChannelName
        });
      }

      return authoritativeChannelName;
    }

    if (configChannelName) {
      return configChannelName;
    }

    return channelId;
  }

  /**
   * 启动观看 - 按频道ID管理
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {Object} channelConfig - 频道配置（含videoAspectRatio）
   * @returns {Object} 观看结果
   */
  async startWatching(channelId, rtmpUrl, channelConfig = null) {
    // 🛡️ 申请频道级串行锁，避免与 enableRecording 并发重复 spawn ffmpeg
    const release = await this._acquireChannelLock(channelId);
    // 🆕 为每个频道生成独立的滤镜（作为局部变量）
    const videoFilter = this.getVideoFilter(channelConfig);
    logger.info('Video filter for channel', { 
      channelId, 
      aspectRatio: channelConfig?.videoAspectRatio || 'original',
      filter: videoFilter || 'none'
    });
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
          return await this.startNewStream(channelId, rtmpUrl, videoFilter);
        }
        
        // RTMP地址未变更，检查视频比例是否变更
        const oldFilter = existingChannel.videoFilter;
        const newFilter = videoFilter;
        if (oldFilter !== newFilter) {
          logger.info('Video filter changed for channel, restarting process', { 
            channelId, 
            oldFilter: oldFilter || 'none', 
            newFilter: newFilter || 'none'
          });
          
          // 视频比例变更，停止旧进程并启动新进程
          await this.stopFFmpegProcess(channelId);
          return await this.startNewStream(channelId, rtmpUrl, videoFilter);
        }
        
        logger.debug('Channel already active, returning existing stream', { channelId });
        return existingChannel.hlsUrl;
      }
      
      // 频道未在处理，启动新的FFmpeg进程
      return await this.startNewStream(channelId, rtmpUrl, videoFilter);
      
    } catch (error) {
      logger.error('Failed to start watching', { channelId, rtmpUrl, error: error.message });
      throw error;
    } finally {
      // 🛡️ 释放频道锁
      release();
    }
  }

  /**
   * 启动新的转码进程
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {string|null} videoFilter - 视频滤镜
   * @returns {string} HLS播放地址
   */
  async startNewStream(channelId, rtmpUrl, videoFilter = null) {
    const processInfo = {
      channelId: channelId,
      rtmpUrl: rtmpUrl,
      hlsUrl: `${this.vpsBaseDomain}/hls/${channelId}/playlist.m3u8`,
      startTime: Date.now(),
      process: null,
      videoFilter: videoFilter  // 🆕 保存当前滤镜
    };
    
    try {
      // 启动FFmpeg进程
      processInfo.process = await this.spawnFFmpegProcess(channelId, rtmpUrl, videoFilter);
      
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
    
    // ✅ 如果进程正在录制，清理录制标记
    if (processInfo.isRecording) {
      logger.info('Cleaning up recording markers on process stop', { channelId });
      this.recordingChannels.delete(channelId);
      this.recordingConfigs.delete(channelId);
    }
    
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
   * @param {string|null} videoFilter - 视频滤镜
   * @returns {Object} FFmpeg进程对象
   */
  async spawnFFmpegProcess(channelId, rtmpUrl, videoFilter = null) {
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

      // 🆕 根据配置动态添加滤镜
      ...(videoFilter ? ['-vf', videoFilter] : []),

      // 🔥 HLS输出 - 简化配置
      '-f', 'hls',
      '-hls_time', '2',  // 2秒分片
      '-hls_list_size', '6',  // 保持6个分片
      '-hls_flags', 'delete_segments',  // 🔥 自动删除旧分片
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
        const proxyUrl = `socks5://127.0.0.1:${this.socks5Port}`;
        env.http_proxy = proxyUrl;
        env.https_proxy = proxyUrl;
        env.HTTP_PROXY = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
        
        logger.info('FFmpeg will use proxy for RTMP connection', { 
          channelId, 
          proxyPort: this.socks5Port,
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
   *
   * 策略：
   *  1) 扫出所有 ffmpeg 进程 PID
   *  2) 发 SIGTERM（给 FFmpeg 机会 flush 输出、关闭文件）
   *  3) 等待 3 秒
   *  4) 对仍存活的进程发 SIGKILL 强制回收
   *
   * 背景：早期实现只发 SIGTERM 不等待、不兜底，遇到 RTMP I/O 阻塞时
   * ffmpeg 会忽略 SIGTERM，Node 进程继续跑，activeStreams 被清空，
   * 随后 RecordScheduler 启动新 ffmpeg → 同一频道残留两份录制进程。
   */
  async cleanupZombieProcesses() {
    try {
      const { stdout } = await execAsync('ps aux | grep ffmpeg | grep -v grep || true');
      // 提取 PID 列表并过滤掉非数字项，避免把 ps 输出中的奇怪列当 pid 用
      const pids = stdout
        .split('\n')
        .map(line => line.trim().split(/\s+/)[1])
        .filter(pid => pid && /^\d+$/.test(pid))
        .map(pid => Number(pid));

      if (pids.length === 0) {
        return;
      }

      // 阶段 1：发 SIGTERM 让 ffmpeg 尝试优雅退出
      for (const pid of pids) {
        logger.warn('清理僵尸 FFmpeg 进程 (SIGTERM)', { pid });
        try {
          process.kill(pid, 'SIGTERM');
        } catch (error) {
          // ESRCH 表示进程已经不在，忽略
          if (error.code !== 'ESRCH') {
            logger.warn('发送 SIGTERM 失败', { pid, error: error.message });
          }
        }
      }

      // 阶段 2：等待 3 秒给 ffmpeg flush + 退出
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 阶段 3：对仍存活的进程发 SIGKILL 兜底
      for (const pid of pids) {
        try {
          // kill(pid, 0) 不发信号，只探测进程是否存在
          process.kill(pid, 0);
          // 没抛异常说明进程还活着 → 强制 kill
          logger.warn('FFmpeg 进程未响应 SIGTERM，强制清理 (SIGKILL)', { pid });
          try {
            process.kill(pid, 'SIGKILL');
          } catch (killError) {
            if (killError.code !== 'ESRCH') {
              logger.warn('发送 SIGKILL 失败', { pid, error: killError.message });
            }
          }
        } catch (error) {
          // ESRCH = 进程已退出，这是期望结果
          if (error.code !== 'ESRCH') {
            logger.warn('探测进程存活状态异常', { pid, error: error.message });
          }
        }
      }
    } catch (error) {
      logger.warn('清理僵尸进程过程异常', { error: error.message });
    }
  }

  /**
   * 清理指定频道的孤儿 FFmpeg 进程
   *
   * 用途：在 enableRecording 真正启动新 ffmpeg 前做一次 OS 级别检查，
   * 防止以下场景出现重复录制：
   *   - 服务重启后 cleanupZombieProcesses 发的 SIGTERM 被旧 ffmpeg 忽略；
   *   - activeStreams 被清空，enableRecording 判断为「未录制」；
   *   - 于是又启动一个新的 ffmpeg，同频道两个进程并存。
   *
   * 识别方式：
   *   - pgrep -f 匹配命令行中含 channelId 的 ffmpeg 进程
   *   - 排除本 Node 进程 activeStreams 里已登记的 pid（那些是正常进程）
   *   - 剩下的视为孤儿进程，直接 SIGKILL
   *
   * @param {string} channelId - 频道ID
   */
  async killOrphanFfmpegForChannel(channelId) {
    try {
      // 命令行里含 channelId 的 ffmpeg 进程（输出路径、HLS 目录都会带 channelId）
      // 用 shell 转义防止 channelId 里有特殊字符（虽然业务上不会，但做好防御）
      const safeChannelId = String(channelId).replace(/[^a-zA-Z0-9_\-]/g, '');
      if (!safeChannelId) {
        return;
      }
      const { stdout } = await execAsync(`pgrep -f "ffmpeg.*${safeChannelId}" || true`);
      const osPids = stdout
        .trim()
        .split('\n')
        .map(p => p.trim())
        .filter(p => /^\d+$/.test(p));

      if (osPids.length === 0) {
        return;
      }

      // 收集本 Node 进程在 activeStreams 里已知的所有 ffmpeg pid
      const knownPids = new Set();
      for (const info of this.activeStreams.values()) {
        if (info && info.process && info.process.pid) {
          knownPids.add(String(info.process.pid));
        }
      }

      // OS 有、本进程不知道 → 孤儿
      const orphans = osPids.filter(pid => !knownPids.has(pid));
      if (orphans.length === 0) {
        return;
      }

      logger.warn('🧹 发现频道的孤儿 FFmpeg 进程，强制清理', {
        channelId,
        orphanPids: orphans,
        knownPids: Array.from(knownPids)
      });

      // 直接 SIGKILL（这些进程已经游离于本服务管理之外，不需要优雅退出）
      for (const pid of orphans) {
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') {
            logger.warn('SIGKILL 孤儿 ffmpeg 失败', { pid, error: error.message });
          }
        }
      }

      // 等一小段时间让 OS 回收 PID / 释放文件描述符，避免后续 ffmpeg 输出路径冲突
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      // 清理失败不阻塞后续录制启动（安全兜底）
      logger.error('清理孤儿 FFmpeg 进程失败', {
        channelId,
        error: error.message
      });
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
      
      // 🔥 先移除预加载的心跳记录（避免误判为有观看者）
      this.channelHeartbeats.delete(channelId);
      
      // ✅ 检查是否还在录制或有真实观看者
      const isRecording = this.recordingChannels.has(channelId);
      const hasViewers = this.channelHeartbeats.has(channelId);
      
      if (isRecording) {
        // 还在录制，保留进程
        logger.info('Preload stopped but recording is active, keeping process', { 
          channelId,
          hasViewers
        });
      } else if (hasViewers) {
        // 有观看者但不录制，保留进程（普通HLS）
        logger.info('Preload stopped but has viewers, keeping process', { channelId });
      } else {
        // 既不录制也无观看者，停止进程
        logger.info('No recording or viewers, stopping channel', { channelId });
        await this.stopChannel(channelId);
      }
      
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
      const apiKey = process.env.VPS_API_KEY;
      
      const response = await fetch(`${this.workersApiUrl}/api/channels/${channelId}`, {
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
    // 🛡️ 申请频道级串行锁，避免与 startWatching 并发重复 spawn ffmpeg
    const release = await this._acquireChannelLock(channelId);
    try {
      logger.info('Enabling recording', { channelId, recordConfig });

      // 🛡️ 防重复录制：启动前先清理本频道的孤儿 ffmpeg 进程
      // （可能来自上次服务重启后未被 SIGTERM 成功回收的旧进程）
      await this.killOrphanFfmpegForChannel(channelId);
      
      // 🆕 获取频道配置（包含videoAspectRatio）
      let channelConfig = null;
      try {
        const axios = require('axios');
        const config = require('../../config');
        const configUrl = `${config.workersApiUrl}/api/channel/${channelId}/config`;
        const response = await axios.get(configUrl, { timeout: 3000 });
        if (response.data.status === 'success') {
          channelConfig = response.data.data;
          logger.info('Fetched channel config for recording', { 
            channelId, 
            channelName: channelConfig.channelName,
            videoAspectRatio: channelConfig.videoAspectRatio 
          });
        }
      } catch (error) {
        logger.warn('Failed to fetch channel config for recording, using defaults', { 
          channelId, 
          error: error.message 
        });
      }
      
      // 生成视频滤镜
      const videoFilter = this.getVideoFilter(channelConfig);
      const resolvedChannelName = this.resolveRecordingChannelName(channelId, recordConfig, channelConfig);
      const normalizedRecordConfig = {
        ...recordConfig,
        channelName: resolvedChannelName
      };
      
      // 检查是否已经在录制中
      const existing = this.activeStreams.get(channelId);
      if (existing && existing.isRecording) {
        logger.info('Recording already active for channel', { 
          channelId,
          recordingPath: existing.recordingPath 
        });
        
        // 更新配置但不重启进程
        this.recordingConfigs.set(channelId, {
          ...normalizedRecordConfig,
          sessionStartTime: this.recordingConfigs.get(channelId)?.sessionStartTime || Date.now()
        });
        this.recordingChannels.add(channelId);
        
        return {
          status: 'success',
          message: 'Recording already active',
          data: { channelId, isRecording: true, alreadyActive: true }
        };
      }
      
      // 保存录制配置
      const configWithSession = {
        ...normalizedRecordConfig,
        sessionStartTime: Date.now()  // 🆕 记录会话开始时间
      };
      this.recordingConfigs.set(channelId, configWithSession);
      // ❌ 不在这里手动添加标记，startStreamWithRecording会自动添加
      
      if (existing) {
        // 已有进程但未录制，需要重启以添加录制输出
        logger.info('Restarting stream with recording', { channelId });
        await this.stopFFmpegProcess(channelId);
        await this.startStreamWithRecording(channelId, existing.rtmpUrl, configWithSession, videoFilter);
      } else {
        // 无进程，启动新进程（包含录制）
        const rtmpUrl = recordConfig.rtmpUrl || await this.fetchChannelRtmpUrl(channelId);
        await this.startStreamWithRecording(channelId, rtmpUrl, configWithSession, videoFilter);
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
    } finally {
      // 🛡️ 释放频道锁
      release();
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
      
      // 先获取配置（重命名文件需要）
      const recordConfig = this.recordingConfigs.get(channelId);
      
      // ✅ 步骤1: 无论进程状态如何，都尝试重命名temp文件
      if (recordConfig) {
        logger.info('Attempting to rename temp files before cleanup', { 
          channelId,
          segmentEnabled: recordConfig.segmentEnabled,
          hasProcess: !!existing
        });
        
        try {
          if (recordConfig.segmentEnabled) {
            // 分段模式：renameFinalSegment会扫描所有temp文件
            await this.renameFinalSegment(channelId, recordConfig);
          } else if (oldRecordingPath) {
            // 单文件模式：重命名为实际结束时间
            await this.renameRecordingWithActualEndTime(oldRecordingPath);
          }
        } catch (renameError) {
          logger.error('Failed to rename temp files, continuing cleanup', { 
            channelId, 
            error: renameError.message 
          });
        }
      }
      
      // ✅ 步骤2: 清理录制标记
      this.recordingChannels.delete(channelId);
      this.recordingConfigs.delete(channelId);
      logger.info('Recording markers cleared', { channelId });
      
      // ✅ 步骤3: 如果进程存在且正在录制，停止进程
      if (existing && existing.isRecording) {
        const hasViewers = this.channelHeartbeats.has(channelId);
        const isPreload = this.preloadChannels.has(channelId);
        
        if (hasViewers || isPreload) {
          // 有观看者或预加载，重启进程移除录制
          logger.info('Restarting stream without recording', { 
            channelId,
            hasViewers,
            isPreload 
          });
          await this.stopFFmpegProcess(channelId);
          await this.startWatching(channelId, existing.rtmpUrl);
        } else {
          // 无观看者和预加载，直接停止
          logger.info('No viewers or preload, stopping channel', { channelId });
          await this.stopChannel(channelId);
        }
      } else {
        logger.info('Process not recording or not exists, cleanup completed', { 
          channelId,
          hasProcess: !!existing,
          isRecording: existing?.isRecording || false
        });
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
   * 处理录制进程异常退出后的文件收尾
   * 保留录制标记给调度器做自动恢复，同时尽量把当前录制文件改成可识别的正式文件名
   * @param {string} channelId - 频道ID
   * @param {Object} recordConfig - 录制配置
   * @param {string} recordingPath - 当前录制路径
   * @param {number|null} code - 退出码
   * @param {string|null} signal - 退出信号
   */
  async handleUnexpectedRecordingExit(channelId, recordConfig, recordingPath, code, signal) {
    try {
      logger.warn('Handling unexpected recording exit', {
        channelId,
        code,
        signal,
        recordingPath,
        segmentEnabled: !!recordConfig?.segmentEnabled
      });

      if (recordConfig?.segmentEnabled) {
        await this.renameFinalSegment(channelId, recordConfig);
      } else if (recordingPath) {
        await this.renameRecordingWithActualEndTime(recordingPath);
      }
    } catch (error) {
      logger.error('Failed to finalize recording after unexpected exit', {
        channelId,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * 启动带录制的流
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {Object} recordConfig - 录制配置
   * @param {string|null} videoFilter - 视频滤镜
   */
  async startStreamWithRecording(channelId, rtmpUrl, recordConfig, videoFilter = null) {
    const recordingPath = this.generateRecordingPath(channelId, recordConfig.channelName, recordConfig);
    
    const processInfo = {
      channelId: channelId,
      rtmpUrl: rtmpUrl,
      hlsUrl: `${this.vpsBaseDomain}/hls/${channelId}/playlist.m3u8`,
      startTime: Date.now(),
      process: null,
      isRecording: true,
      recordingPath: recordingPath,
      videoFilter: videoFilter  // 🆕 保存视频滤镜
    };
    
    try {
      // 启动FFmpeg进程（包含录制）🆕 传递完整配置
      processInfo.process = await this.spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath, recordConfig, videoFilter);
      
      // 保存进程信息
      this.activeStreams.set(channelId, processInfo);
      
      // ✅ 添加录制标记（与进程状态绑定）
      this.recordingChannels.add(channelId);
      
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
   * @param {string|null} videoFilter - 视频滤镜
   */
  async spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath, recordConfig, videoFilter = null) {
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
      '-i', rtmpUrl
    ];
    
    // 🆕 根据是否有滤镜决定使用不同的策略
    if (videoFilter) {
      // 有滤镜：使用filter_complex
      ffmpegArgs.push(
        '-filter_complex', `[0:v]${videoFilter},split=2[vout1][vout2]`,
      
        // HLS输出 - 使用第一路视频流
        '-map', '[vout1]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-an',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments',  // 🔥 自动删除旧分片
        '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
        '-hls_allow_cache', '0',
        '-start_number', '0',
        '-y',
        outputFile,
        
        // MP4录制输出 - 使用第二路视频流
        '-map', '[vout2]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-an'
      );
    } else {
      // 原始比例：不用滤镜，可以优化性能
      ffmpegArgs.push(
        // HLS输出
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-an',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments',  // 🔥 自动删除旧分片
        '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
        '-hls_allow_cache', '0',
        '-start_number', '0',
        '-y',
        outputFile,
        
        // MP4录制输出 - 原始比例
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-an'
      );
    }
    
    // 🆕 根据配置决定录制方式
    if (recordConfig && recordConfig.segmentEnabled) {
      // 分段录制 - 使用fragmented MP4防止分段文件损坏
      const segmentSeconds = (recordConfig.segmentDuration || 60) * 60;
      ffmpegArgs.push(
        '-f', 'segment',
        '-segment_time', segmentSeconds.toString(),
        '-segment_format', 'mp4',
        '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof',
        '-reset_timestamps', '1',
        '-y',
        recordingPath
      );
      logger.info('Using segment recording with fragmented MP4', { 
        segmentDuration: recordConfig.segmentDuration,
        segmentSeconds 
      });
    } else {
      // 单文件录制 - 使用fragmented MP4防止文件损坏
      ffmpegArgs.push(
        '-f', 'mp4',
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        '-y',
        recordingPath
      );
      logger.info('Using single file recording with fragmented MP4');
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
        const proxyUrl = `socks5://127.0.0.1:${this.socks5Port}`;
        env.http_proxy = proxyUrl;
        env.https_proxy = proxyUrl;
        env.HTTP_PROXY = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
        logger.info('FFmpeg will use proxy for RTMP connection', { 
          channelId,
          proxyPort: this.socks5Port 
        });
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

      if (recordConfig) {
        setImmediate(() => {
          this.handleUnexpectedRecordingExit(channelId, recordConfig, recordingPath, code, signal)
            .catch((error) => {
              logger.error('Unexpected recording exit cleanup failed', {
                channelId,
                error: error.message,
                stack: error.stack
              });
            });
        });
      }
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
    
    // 🆕 分段录制：使用临时文件名（包含实际开始时间，避免文件名冲突）
    if (recordConfig.segmentEnabled) {
      const filename = `${channelName}_${channelId}_${dateStr}_${timeStr}_temp_%03d.mp4`;
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

      // 🆕 迭代 3：从路径反推 channelId 后派发文件最终化事件
      const channelId = this._extractChannelIdFromPath(newPath);
      if (channelId) {
        this._safeFinalizeDispatch(newPath, channelId);
      } else {
        logger.warn('无法从路径反推 channelId，跳过上传触发', { newPath });
      }
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
      
      // 计算session开始时间字符串（用于构造temp文件名）
      const sessionStart = new Date(recordConfig.sessionStartTime + 8 * 60 * 60 * 1000);
      const sessionStartTimeStr = `${String(sessionStart.getUTCHours()).padStart(2, '0')}${String(sessionStart.getUTCMinutes()).padStart(2, '0')}${String(sessionStart.getUTCSeconds()).padStart(2, '0')}`;
      
      const tempFile = `${recordConfig.channelName}_${channelId}_${dateStr}_${sessionStartTimeStr}_temp_${String(segmentIndex).padStart(3, '0')}.mp4`;
      const tempPath = path.join(outputDir, tempFile);
      
      // 检查文件是否存在
      if (!fs.existsSync(tempPath)) {
        logger.warn('Segment file not found for rename', { channelId, tempPath });
        return;
      }
      
      // 计算该segment的时间范围
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
      
      // 🔥 关键修复：segment完成后转换为标准MP4
      // 
      // 问题根因：
      // - 录制时使用Fragmented MP4防止崩溃损坏 ✅
      // - 但segment muxer关闭Fragmented MP4时存在BUG
      // - 导致完成的segment文件只能播放第一个fragment（2秒）
      //
      // 解决方案：
      // - 保留Fragmented MP4用于防崩溃（录制过程中）
      // - segment完成后，自动转换为标准MP4（修复播放问题）
      // - 使用 -c copy 避免重新编码（速度快，无质量损失）
      await this.convertSegmentToStandardMp4(tempPath, finalPath);
      
      const fileSize = fs.statSync(finalPath).size;
      logger.info('Segment converted and renamed', { 
        channelId,
        segmentIndex,
        from: tempFile,
        to: finalFilename,
        size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`
      });

      // 🆕 迭代 3：派发文件最终化事件，由 FileFinalizeDispatcher 判断是否入队上传
      this._safeFinalizeDispatch(finalPath, channelId);
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
   * 将Fragmented MP4分段文件转换为标准MP4
   * @param {string} inputPath - 输入文件路径（Fragmented MP4）
   * @param {string} outputPath - 输出文件路径（标准MP4）
   */
  async convertSegmentToStandardMp4(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpegProcess = spawn(this.ffmpegPath, [
        '-i', inputPath,
        '-c', 'copy',              // 不重新编码，只重新封装
        '-movflags', 'faststart',  // 转换为标准MP4（moov前置）
        '-y',
        outputPath
      ]);

      let stderr = '';
      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpegProcess.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          // 转换成功，删除临时文件
          fs.unlinkSync(inputPath);
          logger.info('✅ Segment converted to standard MP4', { 
            from: path.basename(inputPath),
            to: path.basename(outputPath)
          });
          resolve();
        } else {
          // 转换失败，保留原文件，至少可以部分播放
          logger.error('❌ Segment conversion failed, keeping original file', {
            inputPath,
            code,
            stderr: stderr.slice(-200)
          });
          // 降级方案：直接重命名
          if (fs.existsSync(inputPath)) {
            fs.renameSync(inputPath, outputPath);
          }
          resolve(); // 不抛出错误，继续运行
        }
      });

      ffmpegProcess.on('error', (error) => {
        logger.error('FFmpeg process error during conversion', { error: error.message });
        // 降级方案：直接重命名
        if (fs.existsSync(inputPath) && !fs.existsSync(outputPath)) {
          fs.renameSync(inputPath, outputPath);
        }
        resolve();
      });

      // 60秒超时
      setTimeout(() => {
        ffmpegProcess.kill('SIGTERM');
        logger.error('Segment conversion timeout, using direct rename', { inputPath });
        // 降级方案：直接重命名
        if (fs.existsSync(inputPath) && !fs.existsSync(outputPath)) {
          fs.renameSync(inputPath, outputPath);
        }
        resolve();
      }, 60000);
    });
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
        
        // 提取segment索引和session开始时间
        // 新格式：频道名_频道ID_日期_时间_temp_XXX.mp4
        const newMatch = tempFile.match(/_(\d{6})_temp_(\d+)\.mp4$/);
        let segmentIndex, sessionStartTimeStr;
        
        if (newMatch) {
          // 新格式：从文件名提取session开始时间
          sessionStartTimeStr = newMatch[1];
          segmentIndex = parseInt(newMatch[2]);
        } else {
          // 兼容旧格式：频道名_频道ID_日期_temp_XXX.mp4
          const oldMatch = tempFile.match(/_temp_(\d+)\.mp4$/);
          if (!oldMatch) {
            logger.warn('Invalid temp file name format', { tempFile });
            continue;
          }
          segmentIndex = parseInt(oldMatch[1]);
          // 旧格式使用recordConfig中的sessionStartTime
          const sessionStart = new Date(recordConfig.sessionStartTime + 8 * 60 * 60 * 1000);
          sessionStartTimeStr = `${String(sessionStart.getUTCHours()).padStart(2, '0')}${String(sessionStart.getUTCMinutes()).padStart(2, '0')}${String(sessionStart.getUTCSeconds()).padStart(2, '0')}`;
        }
        
        // 从session开始时间字符串计算该段的开始时间
        const hours = parseInt(sessionStartTimeStr.substr(0, 2));
        const minutes = parseInt(sessionStartTimeStr.substr(2, 2));
        const seconds = parseInt(sessionStartTimeStr.substr(4, 2));
        const sessionStartMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
        const segmentStartMs = sessionStartMs + segmentIndex * segmentDurationMs;
        
        // 计算开始时间
        const startHours = Math.floor(segmentStartMs / 3600000) % 24;
        const startMinutes = Math.floor((segmentStartMs % 3600000) / 60000);
        const startSeconds = Math.floor((segmentStartMs % 60000) / 1000);
        const startTimeStr = `${String(startHours).padStart(2, '0')}${String(startMinutes).padStart(2, '0')}${String(startSeconds).padStart(2, '0')}`;
        
        // 结束时间使用实际停止时间
        const endTime = beijingNow;
        const endTimeStr = `${String(endTime.getUTCHours()).padStart(2, '0')}${String(endTime.getUTCMinutes()).padStart(2, '0')}${String(endTime.getUTCSeconds()).padStart(2, '0')}`;
        
        // 生成正式文件名
        const finalFilename = `${recordConfig.channelName}_${channelId}_${dateStr}_${startTimeStr}_to_${endTimeStr}.mp4`;
        const finalPath = path.join(outputDir, finalFilename);
        
        // 🔥 关键修复：转换为标准MP4（与中间分段相同的处理）
        await this.convertSegmentToStandardMp4(tempPath, finalPath);
        
        const fileSize = fs.statSync(finalPath).size;
        logger.info('Final segment converted and renamed', { 
          channelId,
          segmentIndex,
          from: tempFile,
          to: finalFilename,
          size: `${(fileSize / 1024 / 1024).toFixed(2)}MB`
        });

        // 🆕 迭代 3：派发文件最终化事件
        this._safeFinalizeDispatch(finalPath, channelId);
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
