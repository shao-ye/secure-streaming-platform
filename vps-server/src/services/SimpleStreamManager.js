const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../../config');
const { randomUUID } = require('crypto');
const SegmentFinalizer = require('./recording/SegmentFinalizer');

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
    this.lastRecordingStarts = new Map();
    this.destroying = false;
    this.segmentFinalizer = new SegmentFinalizer({
      ffmpegPath: this.ffmpegPath,
      ffprobePath: process.env.FFPROBE_PATH
    });

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

  /** 在统一频道锁内执行操作；回调只能调用不重复加锁的内部方法。 */
  async withChannelLock(channelId, operation) {
    if (this.ready) await this.ready;
    const release = await this._acquireChannelLock(channelId);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /** 判断频道是否正在启动、停止或等待串行操作，供健康检查避开过渡状态。 */
  isChannelTransitioning(channelId) {
    const state = this.activeStreams.get(channelId)?.state;
    return this.channelLocks.has(channelId) || state === 'starting' || state === 'stopping';
  }

  /** 判断进程是否仍属于当前会话，防止旧进程的回调影响后继会话。 */
  _ownsStream(info) {
    return this.activeStreams.get(info.channelId) === info;
  }

  /** 配置未知时沿用现有滤镜，只有有效的显式比例才代表配置变更。 */
  _resolveVideoFilter(channelConfig, existing) {
    if (!['original', '4:3', '16:9'].includes(channelConfig?.videoAspectRatio)) {
      return existing?.videoFilter ?? null;
    }
    return this.getVideoFilter(channelConfig);
  }

  /** 在 spawn 前登记会话；调用方必须持有频道锁并已完成上一会话的收尾。 */
  _registerStream(channelId, rtmpUrl, videoFilter, recording = {}) {
    if (this.destroying) throw new Error('Stream manager is shutting down');
    if (this.activeStreams.has(channelId)) throw new Error('Previous stream has not been stopped');
    const info = {
      channelId, rtmpUrl, videoFilter,
      sessionId: randomUUID(),
      hlsUrl: `${this.vpsBaseDomain}/hls/${channelId}/playlist.m3u8`,
      startTime: Date.now(),
      process: null,
      state: 'starting',
      closed: false,
      exitSeen: false,
      expectedStop: false,
      segmentQueue: Promise.resolve(),
      lastOpenedSegment: -1,
      ...recording
    };
    this.activeStreams.set(channelId, info);
    if (info.isRecording) this.recordingChannels.add(channelId);
    return info;
  }

  /** 绑定进程归属和关闭屏障；close 后才允许封装，退出回调不直接清理频道资源。 */
  _attachProcessLifecycle(info, child) {
    info.process = child;
    info.spawnedAt = Date.now();
    info.closePromise = new Promise(resolve => {
      child.once('close', (code, signal) => {
        info.closed = true;
        info.exitSeen = true;
        info.stoppedAt = info.stoppedAt || Date.now();
        if (!info.expectedStop) info.state = 'failed';
        resolve({ code, signal });
        // 不在事件回调内改共享 Map；串行收尾还会再次检查会话身份。
        if (!info.expectedStop) {
          this.withChannelLock(info.channelId, () => this._finishStreamLocked(info))
            .catch(error => logger.error('Failed to finalize exited stream', {
              channelId: info.channelId, sessionId: info.sessionId, error: error.message
            }));
        }
      });
    });
    child.once('error', error => {
      info.spawnError = error;
      info.state = 'failed';
      logger.error('FFmpeg process error', { channelId: info.channelId, sessionId: info.sessionId, error: error.message });
    });
    child.once('exit', (code, signal) => {
      info.exitSeen = true;
      info.stoppedAt = Date.now();
      if (!info.expectedStop) info.state = 'failed';
      logger.info('FFmpeg process exited', { channelId: info.channelId, sessionId: info.sessionId, pid: child.pid, code, signal });
    });
  }

  /** 已关闭会话的唯一收尾入口；只处理本会话文件，且绝不清理后继会话的 HLS。 */
  async _finishStreamLocked(info) {
    if (!info.closed) throw new Error('Cannot finalize a stream that is still writing');
    if (info.finalizePromise) return info.finalizePromise;
    info.finalizePromise = (async () => {
      info.state = 'stopping';
      try {
        await info.segmentQueue;
        if (info.isRecording) {
          if (info.recordConfig.segmentEnabled) {
            await this.renameFinalSegment(info.channelId, info.recordConfig, info.recordingPath, info.stoppedAt);
          } else {
            await this.renameRecordingWithActualEndTime(info.recordingPath, info.stoppedAt);
          }
        }
      } catch (error) {
        // 保留未成功封装的 temp，允许使用独立的新路径继续录制。
        logger.error('Recording finalization failed; original files retained', {
          channelId: info.channelId, sessionId: info.sessionId, error: error.message
        });
      } finally {
        try {
          if (this._ownsStream(info)) await this.cleanupChannelHLS(info.channelId, info);
        } finally {
          // 文件系统清理失败也不能让已关闭的会话永久占据状态；下次启动会重试目录清理。
          if (this._ownsStream(info)) {
            this.activeStreams.delete(info.channelId);
            this.recordingChannels.delete(info.channelId);
          }
          info.state = 'stopped';
        }
      }
    })();
    return info.finalizePromise;
  }

  /** 在频道锁内停止并收尾当前会话；不清除录制意图，供重启和健康恢复复用。 */
  async _stopStreamLocked(channelId) {
    const info = this.activeStreams.get(channelId);
    if (!info) return;
    info.expectedStop = true;
    info.state = 'stopping';
    try {
      await this.stopFFmpegProcess(channelId, info);
      await this._finishStreamLocked(info);
    } catch (error) {
      // 有界停止失败后，迟到的 close 仍必须触发收尾，不能永远停在 stopping。
      info.expectedStop = false;
      if (!info.closed) info.state = 'failed';
      else if (!info.finalizePromise) await this._finishStreamLocked(info);
      throw error;
    }
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
    return this.withChannelLock(channelId, async () => {
      this.channelHeartbeats.set(channelId, Date.now());
      return this._startWatchingLocked(channelId, rtmpUrl, channelConfig);
    });
  }

  /** 在锁内复用或切换观看进程；参数变更始终保留录制意图。 */
  async _startWatchingLocked(channelId, rtmpUrl, channelConfig, forceRestart = false) {
    if (this.destroying) throw new Error('Stream manager is shutting down');
    const existing = this.activeStreams.get(channelId);
    const videoFilter = this._resolveVideoFilter(channelConfig, existing || this.recordingConfigs.get(channelId));
    const recordingConfig = this.recordingConfigs.get(channelId) || existing?.recordConfig;
    if (existing && !forceRestart && !existing.exitSeen && !existing.closed &&
        ['recording', 'running'].includes(existing.state) &&
        existing.rtmpUrl === rtmpUrl && existing.videoFilter === videoFilter) {
      return existing.hlsUrl;
    }
    await this._stopStreamLocked(channelId);
    if (recordingConfig) {
      return this.startStreamWithRecording(channelId, rtmpUrl, recordingConfig, videoFilter);
    }
    return this.startNewStream(channelId, rtmpUrl, videoFilter);
  }

  /** 手动重启频道时同样保持录制模式，避免 stop/start 两个独立操作之间插入恢复任务。 */
  async restartChannel(channelId, rtmpUrl, channelConfig = null) {
    return this.withChannelLock(channelId, () => this._startWatchingLocked(channelId, rtmpUrl, channelConfig, true));
  }

  /**
   * 启动新的转码进程
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {string|null} videoFilter - 视频滤镜
   * @returns {string} HLS播放地址
   */
  async startNewStream(channelId, rtmpUrl, videoFilter = null) {
    await this.cleanupChannelHLS(channelId);
    const info = this._registerStream(channelId, rtmpUrl, videoFilter);
    try {
      await this.spawnFFmpegProcess(channelId, rtmpUrl, videoFilter, info);
      info.state = 'running';
      logger.info('Started new FFmpeg process', { channelId, sessionId: info.sessionId });
      return info.hlsUrl;
    } catch (error) {
      await this._stopStreamLocked(channelId);
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
    if (this.destroying) return;
    this.cleanupTimer = setInterval(() => {
      if (this.destroying) return;
      this.cleanupIdleChannels().catch(error => logger.error('Idle cleanup failed', { error: error.message }));
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
      if (this.recordingConfigs.has(channelId) || this.isChannelTransitioning(channelId)) {
        continue;
      }
      
      if (now - lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
        logger.info('Channel idle timeout, cleaning up', { 
          channelId, 
          idleTime: now - lastHeartbeat 
        });
        
        await this.stopChannel(channelId, { onlyIfIdle: true });
      }
    }
  }

  /**
   * 停止频道转码进程
   * @param {string} channelId - 频道ID
   */
  async stopChannel(channelId, options = {}) {
    return this.withChannelLock(channelId, async () => {
      // 空闲清理必须拿锁后复核，防止排队期间刚启动的录制被过期检查停止。
      if (options.onlyIfIdle && (this.recordingConfigs.has(channelId) || this.preloadChannels.has(channelId) ||
          Date.now() - (this.channelHeartbeats.get(channelId) || 0) <= this.HEARTBEAT_TIMEOUT)) return;
      this.recordingConfigs.delete(channelId);
      await this._stopStreamLocked(channelId);
      this.channelHeartbeats.delete(channelId);
      this.recordingChannels.delete(channelId);
    });
  }

  /**
   * 停止FFmpeg进程
   * @param {string} channelId - 频道ID
   */
  async stopFFmpegProcess(channelId, info = this.activeStreams.get(channelId)) {
    if (!info || info.closed) return;
    if (!info.process) {
      info.closed = true;
      info.exitSeen = true;
      info.stoppedAt = Date.now();
      return;
    }
    // ChildProcess.killed 仅表示信号已发送，不能用作进程已经退出的依据。
    await new Promise((resolve, reject) => {
      let forceTimer;
      let deadlineTimer;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        clearTimeout(deadlineTimer);
        if (error) reject(error); else resolve();
      };
      info.closePromise.then(() => finish(), finish);
      forceTimer = setTimeout(() => {
        if (!info.closed) info.process.kill('SIGKILL');
      }, 5000);
      deadlineTimer = setTimeout(() => finish(new Error('FFmpeg did not close after termination')), 10000);
      if (!info.closed) info.process.kill('SIGTERM');
    });
  }

  /**
   * 启动FFmpeg进程
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {string|null} videoFilter - 视频滤镜
   * @returns {Object} FFmpeg进程对象
   */
  async spawnFFmpegProcess(channelId, rtmpUrl, videoFilter = null, info) {
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

    this._attachProcessLifecycle(info, ffmpegProcess);

    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      // 记录所有stderr输出，不只是错误
      logger.info('FFmpeg stderr', { channelId, output: output.trim() });
      if (output.includes('error') || output.includes('failed')) {
        logger.error('FFmpeg error detected', { channelId, output: output.trim() });
      }
    });

    // 等待流准备就绪 - 使用30秒超时，配合简化的FFmpeg配置
    await this.waitForStreamReady(channelId, 30000, info);

    logger.info('FFmpeg process started successfully', { channelId, pid: ffmpegProcess.pid });
    return ffmpegProcess;
  }

  /**
   * 清理频道HLS文件
   * @param {string} channelId - 频道ID
   */
  async cleanupChannelHLS(channelId, owner = null) {
    const current = this.activeStreams.get(channelId);
    if (current && (current !== owner || !current.closed)) return;
    const outputDir = path.join(this.hlsOutputDir, channelId);
    if (fs.existsSync(outputDir)) {
      for (const file of fs.readdirSync(outputDir)) fs.unlinkSync(path.join(outputDir, file));
      fs.rmdirSync(outputDir);
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
  async waitForStreamReady(channelId, timeout = 30000, info = this.activeStreams.get(channelId)) {
    const outputDir = path.join(this.hlsOutputDir, channelId);
    const playlistFile = path.join(outputDir, 'playlist.m3u8');
    const started = Date.now();
    let previousRecording = null;
    while (Date.now() - started < timeout) {
      if (this.destroying || !info || !this._ownsStream(info) || info.exitSeen || info.closed || info.spawnError) {
        throw new Error('FFmpeg exited or session changed before outputs became ready');
      }
      let hlsReady = false;
      try {
        const playlistStat = fs.statSync(playlistFile);
        const content = fs.readFileSync(playlistFile, 'utf8');
        const segments = content.match(/segment\d+\.ts/g) || [];
        hlsReady = playlistStat.mtimeMs >= info.spawnedAt && content.includes('#EXTM3U') &&
          segments.some(name => {
            const stat = fs.statSync(path.join(outputDir, name));
            return stat.size > 1024 && stat.mtimeMs >= info.spawnedAt;
          });
      } catch { /* 写入过程中播放列表或分片尚未就绪，下一轮继续检查。 */ }
      let recordingReady = !info.isRecording;
      if (info.isRecording) {
        const current = this.getRecordingFileFreshness(info.recordingPath, Date.now(), timeout);
        if (current?.exists && current.size > 0 && Date.parse(current.mtime) >= info.spawnedAt) {
          recordingReady = previousRecording && current.path === previousRecording.path && current.size > previousRecording.size;
          previousRecording = current;
        }
        // 短分段可能一直缓冲到关闭，轮询看不到单文件增长；本会话已校验的完整视频段同样能证明录像产出。
        recordingReady = recordingReady || info.lastVerifiedRecordingAt >= info.spawnedAt;
      }
      if (hlsReady && recordingReady) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Stream not ready within ${timeout}ms: fresh HLS and recording growth required`);
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
    return this.withChannelLock(channelId, async () => {
      this.channelHeartbeats.delete(channelId);
      if (!this.recordingConfigs.has(channelId) && !this.preloadChannels.has(channelId)) {
        await this._stopStreamLocked(channelId);
      }
      return { status: 'success', data: { channelId } };
    });
  }

  /**
   * 启动预加载
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   */
  async startPreload(channelId, rtmpUrl) {
    return this.withChannelLock(channelId, async () => {
      this.preloadChannels.add(channelId);
      try {
        await this._startWatchingLocked(channelId, rtmpUrl, null);
        return { status: 'success', data: { channelId, isPreload: true } };
      } catch (error) {
        this.preloadChannels.delete(channelId);
        throw error;
      }
    });
  }

  /**
   * 停止预加载
   * @param {string} channelId - 频道ID
   */
  async stopPreload(channelId) {
    return this.withChannelLock(channelId, async () => {
      this.preloadChannels.delete(channelId);
      const lastHeartbeat = this.channelHeartbeats.get(channelId);
      const hasViewers = lastHeartbeat && Date.now() - lastHeartbeat <= this.HEARTBEAT_TIMEOUT;
      if (!this.recordingConfigs.has(channelId) && !hasViewers) await this._stopStreamLocked(channelId);
      return { status: 'success', data: { channelId } };
    });
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
        },
        signal: AbortSignal.timeout(10000)
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
  async enableRecording(channelId, recordConfig, options = {}) {
    return this.withChannelLock(channelId, async () => {
      if (options.shouldStart && !(await options.shouldStart())) return { skipped: true };
      return this._enableRecordingLocked(channelId, recordConfig, { shouldRecover: options.shouldStart });
    });
  }

  /** 锁内启用录制；配置未知时沿用现有参数，并保证直接切换到带录制的进程。 */
  async _enableRecordingLocked(channelId, recordConfig, options = {}) {
    if (this.destroying) throw new Error('Stream manager is shutting down');
    const existing = this.activeStreams.get(channelId);
    if (!options.forceRestart && existing?.state === 'recording' && !existing.exitSeen) {
      this.recordingConfigs.set(channelId, {
        ...existing.recordConfig, ...recordConfig,
        sessionStartTime: existing.recordConfig.sessionStartTime,
        videoFilter: existing.videoFilter, rtmpUrl: existing.rtmpUrl
      });
      return { status: 'success', data: { channelId, isRecording: true, alreadyActive: true } };
    }
    let channelConfig = null;
    try {
      const response = await require('axios').get(`${this.workersApiUrl}/api/channel/${channelId}/config`, { timeout: 3000 });
      if (response.data?.status === 'success') channelConfig = response.data.data;
    } catch (error) {
      logger.warn('Recording channel config unavailable; preserving current parameters', {
        channelId, code: error.code, httpStatus: error.response?.status
      });
    }
    const previousConfig = this.recordingConfigs.get(channelId);
    const videoFilter = this._resolveVideoFilter(channelConfig, existing || previousConfig);
    const rtmpUrl = recordConfig.rtmpUrl || existing?.rtmpUrl || await this.fetchChannelRtmpUrl(channelId);
    if (options.shouldRecover && !(await options.shouldRecover())) return { skipped: true };
    const normalized = {
      ...recordConfig, rtmpUrl, videoFilter,
      channelName: this.resolveRecordingChannelName(channelId, recordConfig, channelConfig)
    };
    this.recordingConfigs.set(channelId, normalized);
    await this._stopStreamLocked(channelId);
    // 停止/封装可能耗时，避免跨过录制结束时刻后再次启动。
    if (options.shouldRecover && !(await options.shouldRecover())) {
      this.recordingConfigs.delete(channelId);
      return { skipped: true };
    }
    const started = await this.startStreamWithRecording(channelId, rtmpUrl, normalized, videoFilter, options.shouldRecover);
    if (!started) return { skipped: true };
    return { status: 'success', data: { channelId, isRecording: true } };
  }

  /** 健康恢复在同一锁内复核状态并直接重建录制，不经过纯观看启动。 */
  async recoverRecording(channelId, recordConfig, options = {}) {
    return this.withChannelLock(channelId, async () => {
      if (this.destroying || (options.shouldRecover && !(await options.shouldRecover()))) return { skipped: true };
      const current = this.activeStreams.get(channelId);
      if (current?.state === 'recording' && !current.exitSeen &&
          this.getRecordingOutputHealth(channelId, options).healthy) return { skipped: true };
      return this._enableRecordingLocked(channelId, recordConfig, { ...options, forceRestart: true });
    });
  }

  /**
   * 禁用录制
   * @param {string} channelId - 频道ID
   */
  async disableRecording(channelId) {
    return this.withChannelLock(channelId, async () => {
      const existing = this.activeStreams.get(channelId);
      this.recordingConfigs.delete(channelId);
      if (existing?.isRecording) {
        // 必须先退出并关闭输出，再处理本会话文件；纯直播只在正常停录后按需恢复。
        await this._stopStreamLocked(channelId);
        const lastHeartbeat = this.channelHeartbeats.get(channelId);
        const hasViewers = lastHeartbeat && Date.now() - lastHeartbeat <= this.HEARTBEAT_TIMEOUT;
        if (!this.destroying && (hasViewers || this.preloadChannels.has(channelId))) {
          await this.startNewStream(channelId, existing.rtmpUrl, existing.videoFilter);
        }
      }
      this.recordingChannels.delete(channelId);
      return { status: 'success', data: { channelId, isRecording: false } };
    });
  }

  /**
   * 启动带录制的流
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {Object} recordConfig - 录制配置
   * @param {string|null} videoFilter - 视频滤镜
   */
  async startStreamWithRecording(channelId, rtmpUrl, recordConfig, videoFilter = null, shouldStart) {
    // 文件名仍保持原有秒级格式；同秒重启等待下一秒，避免 -y 覆盖上一会话文件。
    const sessionConfig = await this._createRecordingSession(channelId, { ...recordConfig, rtmpUrl, videoFilter });
    if (shouldStart && !(await shouldStart())) {
      this.recordingConfigs.delete(channelId);
      return null;
    }
    const recordingPath = this.generateRecordingPath(channelId, sessionConfig.channelName, sessionConfig);
    await this.cleanupChannelHLS(channelId);
    const info = this._registerStream(channelId, rtmpUrl, videoFilter, {
      isRecording: true, recordingPath, recordConfig: sessionConfig
    });
    this.recordingConfigs.set(channelId, sessionConfig);
    try {
      await this.spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath, sessionConfig, videoFilter, info);
      info.state = 'recording';
      logger.info('Started stream with recording', { channelId, sessionId: info.sessionId, recordingPath });
      return info.hlsUrl;
    } catch (error) {
      await this._stopStreamLocked(channelId);
      throw error;
    }
  }

  /** 为新会话固定唯一取时；会话配置保持不变，供分段回调和退出收尾共同使用。 */
  async _createRecordingSession(channelId, recordConfig) {
    while (true) {
      if (this.destroying) throw new Error('Stream manager is shutting down');
      const sessionStartTime = Date.now();
      const sessionSecond = Math.floor(sessionStartTime / 1000);
      const candidate = {
        ...recordConfig, sessionStartTime,
        segmentDuration: Number(recordConfig.segmentDuration) > 0 ? Number(recordConfig.segmentDuration) : 60
      };
      const filePath = this.generateRecordingPath(channelId, candidate.channelName, candidate);
      const prefix = path.basename(filePath).replace(/_(?:temp_(?:%03d|\d+)|to_\d{6})\.mp4$/, '_');
      const dir = path.dirname(filePath);
      const collision = fs.existsSync(dir) && fs.readdirSync(dir).some(name => name.startsWith(prefix));
      if (this.lastRecordingStarts.get(channelId) !== sessionSecond && !collision) {
        this.lastRecordingStarts.set(channelId, sessionSecond);
        return candidate;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 - Date.now() % 1000 + 1));
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
  async spawnFFmpegWithRecording(channelId, rtmpUrl, recordingPath, recordConfig, videoFilter = null, info) {
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
        // 及时落盘已生成的片段，避免低码率录像长期仅有文件头，无法验证产出和停流。
        '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof:flush_packets=1',
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
        '-flush_packets', '1',
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

    this._attachProcessLifecycle(info, ffmpegProcess);

    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      logger.info('FFmpeg stderr', { channelId, output: output.trim() });
      if (output.includes('error') || output.includes('failed')) {
        logger.error('FFmpeg error detected', { channelId, output: output.trim() });
      }
      
      if (recordConfig.segmentEnabled) {
        info.stderrBuffer = ((info.stderrBuffer || '') + output).slice(-16384);
        const matches = info.stderrBuffer.matchAll(/Opening '([^'\r\n]*_temp_(\d+)\.mp4)' for writing/g);
        for (const match of matches) {
          const index = Number(match[2]);
          const expected = recordingPath.replace('%03d', String(index).padStart(3, '0'));
          if (path.resolve(match[1]) !== path.resolve(expected) || index <= info.lastOpenedSegment) continue;
          info.lastOpenedSegment = index;
          if (index > 0) {
            info.segmentQueue = info.segmentQueue
              .then(async () => {
                const published = await this.renameCompletedSegment(channelId, index - 1, recordConfig, recordingPath);
                if (published) info.lastVerifiedRecordingAt = Date.now();
              })
              .catch(error => logger.error('Completed segment retained after finalization failure', {
                channelId, sessionId: info.sessionId, segmentIndex: index - 1, error: error.message
              }));
          }
        }
      }
    });

    // 等待流准备就绪
    await this.waitForStreamReady(channelId, 30000, info);

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
    const now = new Date(recordConfig.sessionStartTime || Date.now());
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
    
    // 单文件也必须保留临时标识，避免上传扫描器把仍在写入的录像当作正式产物。
    const filename = `${channelName}_${channelId}_${dateStr}_${timeStr}_temp_000.mp4`;
    
    return path.join(basePath, channelId, dateStr, filename);
  }

  /**
   * 重命名录制文件，将结束时间改为实际停止时间
   * @param {string} oldPath - 原始文件路径
   */
  async renameRecordingWithActualEndTime(oldPath, stoppedAt = Date.now()) {
    if (!fs.existsSync(oldPath)) return;
    const channelId = this._extractChannelIdFromPath(oldPath);
    if (this.isRecordingFileActive(channelId, oldPath)) throw new Error('Recording file is still being written');
    const endTime = this._formatRecordingTime(stoppedAt);
    const newPath = oldPath.replace(/_(?:temp_000|to_\d{6})\.mp4$/, `_to_${endTime}.mp4`);
    await this.convertSegmentToStandardMp4(oldPath, newPath);
    this._safeFinalizeDispatch(newPath, channelId);
  }

  /** 将绝对时间格式化为录制命名采用的北京时间 HHmmss。 */
  _formatRecordingTime(timestamp) {
    return new Date(timestamp + 8 * 3600000).toISOString().slice(11, 19).replace(/:/g, '');
  }

  /** 从准确的会话模板提取分段序号；不扫描其他会话或其他日期的文件。 */
  _recordingSegmentIndex(template, filePath) {
    if (!template || !filePath || path.resolve(path.dirname(template)) !== path.resolve(path.dirname(filePath))) return null;
    const [prefix, suffix] = path.basename(template).split('%03d');
    if (suffix === undefined) return null;
    const name = path.basename(filePath);
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) return null;
    const number = name.slice(prefix.length, name.length - suffix.length);
    return /^\d+$/.test(number) ? Number(number) : null;
  }

  /** 识别当前仍在写入的录像，供自动恢复与安全封装共同排除活动文件。 */
  isRecordingFileActive(channelId, filePath) {
    const info = this.activeStreams.get(channelId);
    if (!info?.isRecording || info.closed) return false;
    if (!info.recordingPath.includes('%03d')) return path.resolve(info.recordingPath) === path.resolve(filePath);
    const index = this._recordingSegmentIndex(info.recordingPath, filePath);
    return index !== null && (info.lastOpenedSegment < 0 || index >= info.lastOpenedSegment);
  }

  /** 根据会话模板构造正式文件名；仅保留既有分段命名口径，不重定义媒体时钟。 */
  _segmentFinalPath(recordingPath, recordConfig, index, endedAt) {
    const start = recordConfig.sessionStartTime + index * recordConfig.segmentDuration * 60000;
    return recordingPath.replace(/_\d{6}_temp_%03d\.mp4$/, `_${this._formatRecordingTime(start)}_to_${this._formatRecordingTime(endedAt)}.mp4`);
  }

  /**
   * 重命名单个已完成的分段文件（录制过程中调用）
   * @param {string} channelId - 频道ID
   * @param {number} segmentIndex - 分段索引
   * @param {Object} recordConfig - 录制配置
   */
  async renameCompletedSegment(channelId, segmentIndex, recordConfig, recordingPath) {
    const template = recordingPath || this.generateRecordingPath(channelId, recordConfig.channelName, recordConfig);
    const tempPath = template.replace('%03d', String(segmentIndex).padStart(3, '0'));
    if (!fs.existsSync(tempPath)) return;
    const end = recordConfig.sessionStartTime + (segmentIndex + 1) * recordConfig.segmentDuration * 60000;
    const finalPath = this._segmentFinalPath(template, recordConfig, segmentIndex, end);
    await this.convertSegmentToStandardMp4(tempPath, finalPath);
    this._safeFinalizeDispatch(finalPath, channelId);
    return finalPath;
  }

  /**
   * 将Fragmented MP4分段文件转换为标准MP4
   * @param {string} inputPath - 输入文件路径（Fragmented MP4）
   * @param {string} outputPath - 输出文件路径（标准MP4）
   */
  async convertSegmentToStandardMp4(inputPath, outputPath) {
    const channelId = this._extractChannelIdFromPath(inputPath);
    if (this.isRecordingFileActive(channelId, inputPath)) throw new Error('Cannot convert an active recording file');
    return this.segmentFinalizer.finalize(inputPath, outputPath);
  }

  /**
   * 重命名最后一个分段文件（停止录制时调用）
   * @param {string} channelId - 频道ID
   * @param {Object} recordConfig - 录制配置
   */
  async renameFinalSegment(channelId, recordConfig, recordingPath, stoppedAt = Date.now()) {
    const template = recordingPath || this.generateRecordingPath(channelId, recordConfig.channelName, recordConfig);
    const info = this.activeStreams.get(channelId);
    if (info?.recordingPath === template && !info.closed) throw new Error('Recording must close before finalization');
    const dir = path.dirname(template);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .map(name => ({ filePath: path.join(dir, name), index: this._recordingSegmentIndex(template, path.join(dir, name)) }))
      .filter(file => file.index !== null)
      .sort((a, b) => a.index - b.index);
    for (const [position, file] of files.entries()) {
      const isLast = position === files.length - 1;
      const end = isLast ? stoppedAt : recordConfig.sessionStartTime + (file.index + 1) * recordConfig.segmentDuration * 60000;
      const finalPath = this._segmentFinalPath(template, recordConfig, file.index, end);
      try {
        await this.convertSegmentToStandardMp4(file.filePath, finalPath);
        this._safeFinalizeDispatch(finalPath, channelId);
      } catch (error) {
        logger.error('Final segment retained for recovery', { channelId, filePath: file.filePath, error: error.message });
      }
    }
  }

  /**
   * 获取录制输出健康状态
   *
   * 核心判断：
   * 1. 进程和录制标记存在，只代表 FFmpeg 没退出
   * 2. 若 HLS 播放列表和当前录制临时文件长期不更新，说明 FFmpeg 可能假活
   * 3. 返回详细检查结果，供 RecordScheduler 决定是否重启录制
   *
   * @param {string} channelId - 频道ID
   * @param {Object} options - 检查选项
   * @param {number} options.maxStaleMs - 允许输出文件不更新的最大时长
   * @returns {Object} 输出健康状态
   */
  getRecordingOutputHealth(channelId, options = {}) {
    const maxStaleMs = parseInt(options.maxStaleMs, 10) > 0
      ? parseInt(options.maxStaleMs, 10)
      : 120000;
    const now = Date.now();
    const streamInfo = this.activeStreams.get(channelId);

    if (!streamInfo) {
      return {
        healthy: false,
        reason: 'no_active_stream',
        maxStaleMs,
        checks: []
      };
    }

    if (!streamInfo.isRecording) {
      return {
        healthy: false,
        reason: 'stream_not_recording',
        maxStaleMs,
        checks: []
      };
    }

    const checks = [];
    const hlsPlaylistPath = path.join(this.hlsOutputDir, channelId, 'playlist.m3u8');
    checks.push(this.getFileFreshness(hlsPlaylistPath, now, maxStaleMs, 'hls_playlist'));

    const recordingFreshness = this.getRecordingFileFreshness(streamInfo.recordingPath, now, maxStaleMs);
    if (recordingFreshness) {
      checks.push(recordingFreshness);
    }

    const existingChecks = checks.filter(check => check.exists);
    const healthy = existingChecks.length === 2 && existingChecks.every(check => check.fresh && check.size > 0);

    return {
      healthy,
      reason: healthy ? 'output_fresh' : 'recording_output_stale',
      maxStaleMs,
      checks
    };
  }

  /**
   * 获取单个文件的新鲜度
   *
   * @param {string} filePath - 文件路径
   * @param {number} now - 当前时间戳
   * @param {number} maxStaleMs - 最大允许陈旧时间
   * @param {string} type - 检查类型
   * @returns {Object} 文件新鲜度结果
   */
  getFileFreshness(filePath, now, maxStaleMs, type) {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return {
          type,
          path: filePath || null,
          exists: false,
          fresh: false,
          ageMs: null,
          size: null,
          mtime: null
        };
      }

      const stat = fs.statSync(filePath);
      const ageMs = now - stat.mtimeMs;

      return {
        type,
        path: filePath,
        exists: true,
        fresh: ageMs <= maxStaleMs,
        ageMs: Math.max(0, Math.round(ageMs)),
        size: stat.size,
        mtime: stat.mtime.toISOString()
      };
    } catch (error) {
      return {
        type,
        path: filePath || null,
        exists: false,
        fresh: false,
        ageMs: null,
        size: null,
        mtime: null,
        error: error.message
      };
    }
  }

  /**
   * 获取当前录制文件的新鲜度
   *
   * 分段录制路径包含 %03d 模板，需要扫描同目录下匹配模板的最新临时文件；
   * 单文件录制则直接检查 recordingPath。
   *
   * @param {string} recordingPath - 录制路径或分段模板路径
   * @param {number} now - 当前时间戳
   * @param {number} maxStaleMs - 最大允许陈旧时间
   * @returns {Object|null} 录制文件新鲜度结果
   */
  getRecordingFileFreshness(recordingPath, now, maxStaleMs) {
    if (!recordingPath) {
      return null;
    }

    if (!recordingPath.includes('%')) {
      return this.getFileFreshness(recordingPath, now, maxStaleMs, 'recording_file');
    }

    try {
      const recordDir = path.dirname(recordingPath);
      const templateName = path.basename(recordingPath);
      const percentIndex = templateName.indexOf('%');
      const prefix = templateName.slice(0, percentIndex);
      const suffix = templateName.slice(percentIndex).replace(/^%0?\d*d/, '');

      if (!fs.existsSync(recordDir)) {
        return {
          type: 'recording_segment',
          path: recordDir,
          exists: false,
          fresh: false,
          ageMs: null,
          size: null,
          mtime: null
        };
      }

      const matchedFiles = fs.readdirSync(recordDir)
        .filter(file => file.startsWith(prefix) && file.endsWith(suffix))
        .map(file => path.join(recordDir, file))
        .filter(filePath => {
          try {
            return fs.statSync(filePath).isFile();
          } catch {
            return false;
          }
        });

      if (matchedFiles.length === 0) {
        return {
          type: 'recording_segment',
          path: recordingPath,
          exists: false,
          fresh: false,
          ageMs: null,
          size: null,
          mtime: null
        };
      }

      const newestFile = matchedFiles
        .map(filePath => ({ filePath, stat: fs.statSync(filePath) }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];

      return this.getFileFreshness(newestFile.filePath, now, maxStaleMs, 'recording_segment');
    } catch (error) {
      return {
        type: 'recording_segment',
        path: recordingPath,
        exists: false,
        fresh: false,
        ageMs: null,
        size: null,
        mtime: null,
        error: error.message
      };
    }
  }

  /**
   * 获取录制状态
   */
  getRecordingStatus() {
    const ids = new Set([...this.recordingConfigs.keys(), ...this.recordingChannels]);
    const channels = Array.from(ids).map(channelId => {
      const info = this.activeStreams.get(channelId);
      return {
        channelId,
        state: info?.state || 'failed',
        sessionId: info?.sessionId || null,
        isActive: !!info && !info.exitSeen && !info.closed,
        isRecording: !!info?.isRecording && info.state === 'recording' && !info.exitSeen,
        recordingPath: info?.recordingPath || null,
        startedAt: info?.startTime || null,
        config: this.recordingConfigs.get(channelId)
      };
    });
    return {
      totalRecordingChannels: channels.length,
      activeRecordingChannels: channels.filter(channel => channel.isRecording).length,
      channels
    };
  }

  /** 同步禁止新会话并关闭清理定时器，供应用在等待其他组件停止前建立关停屏障。 */
  beginShutdown() {
    this.destroying = true;
    clearInterval(this.cleanupTimer);
  }

  /** 禁止新会话后等待所有写入进程关闭与收尾；失败临时文件仍保留供后续恢复。 */
  async destroy() {
    this.beginShutdown();
    const ids = new Set([...this.activeStreams.keys(), ...this.recordingConfigs.keys(), ...this.channelLocks.keys()]);
    const results = await Promise.allSettled(Array.from(ids, channelId => this.stopChannel(channelId)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    this.channelHeartbeats.clear();
    this.preloadChannels.clear();
    this.recordingChannels.clear();
    this.recordingConfigs.clear();
    logger.info('SimpleStreamManager destroyed');
  }

}

module.exports = SimpleStreamManager;
