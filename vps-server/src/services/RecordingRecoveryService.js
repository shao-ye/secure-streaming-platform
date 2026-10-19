/**
 * 录制文件恢复服务
 * 
 * 功能：启动时扫描并修复录制文件名和格式
 * 使用：在 app.js 中初始化并调用 startup()
 * 
 * 核心逻辑：
 * 1. 延迟5秒启动（确保主服务稳定）
 * 2. 扫描指定时长内的录制文件（可配置，默认48小时）
 * 3. 识别temp文件和错误结束时间文件
 * 4. 自动修复文件名
 * 5. 必要时修复文件格式
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

class RecordingRecoveryService {
  constructor(streamManager, systemConfig = {}) {
    this.streamManager = streamManager;
    this.isRunning = false;
    this.isStopping = false;
    this.startupTimer = null;
    this.sizeCheckTimer = null;
    this.finishSizeCheck = null;
    this.recoveryPromise = null;
    this.config = {
      enabled: true,
      delayStart: 5000,
      // 从系统配置读取扫描时长，默认48小时，范围12-168小时
      scanRecentHours: systemConfig.recoveryScanHours || 48,
      timeoutPerFile: 300000,
      // 录制目录根路径（从环境变量或默认值）
      recordingsPath: process.env.RECORDINGS_PATH || '/srv/filebrowser/yoyo-k'
    };
    
    // 🆕 文件最终化调度器（迭代 3：恢复后的文件也触发自动上传）
    // 由 app.js 调 setFinalizeDispatcher(...) 注入；未注入时所有 dispatch 会被忽略
    this.finalizeDispatcher = null;

    logger.info('RecordingRecoveryService initialized', {
      scanRecentHours: this.config.scanRecentHours,
      recordingsPath: this.config.recordingsPath
    });
  }

  /**
   * 注入文件最终化调度器（迭代 3）
   *
   * 和 SimpleStreamManager 的符号一致，app.js 启动时注入。
   * Recovery Service 会一批处理历史文件，一次可能产生数十个 dispatch，
   * 依靠 UploadQueueService 的去重 + Worker 的 15s 节流避免洪峰。
   *
   * @param {Object|null} dispatcher FileFinalizeDispatcher 实例
   */
  setFinalizeDispatcher(dispatcher) {
    this.finalizeDispatcher = dispatcher || null;
    if (dispatcher) {
      logger.info('RecordingRecoveryService 已注入 FileFinalizeDispatcher');
    }
  }

  /**
   * 安全调用 dispatcher.onFinalize
   *
   * 行为与 SimpleStreamManager._safeFinalizeDispatch 一致：未注入直接 return，
   * 任何异常吃掉不押塞主流程。
   *
   * @param {string} filePath 改名完成后的文件绝对路径
   * @param {string} channelId 频道 ID
   */
  _safeFinalizeDispatch(filePath, channelId) {
    try {
      if (!this.finalizeDispatcher || typeof this.finalizeDispatcher.onFinalize !== 'function') {
        return;
      }
      if (!channelId) {
        logger.warn('RecoveryService dispatch 时 channelId 缺失，跳过', { filePath });
        return;
      }
      this.finalizeDispatcher.onFinalize(filePath, channelId);
    } catch (err) {
      logger.warn('RecoveryService 派发 onFinalize 失败（已吞）', {
        filePath,
        channelId,
        error: err && err.message
      });
    }
  }

  // ==================== 启动入口 ====================
  
  /** 调度一次启动恢复；重复调用不会产生并行扫描，关停后不再启动新恢复。 */
  async startup() {
    if (!this.config.enabled || this.isStopping) {
      logger.warn('⚠️ Recovery service disabled');
      return;
    }
    if (this.isRunning || this.startupTimer) {
      logger.warn('⚠️ Recovery service already running');
      return;
    }
    
    logger.info('🕒 Recovery service scheduled with smart size detection', { 
      delayStart: this.config.delayStart,
      checkInterval: 30000,  // 30秒后检查大小
      scanRecentHours: this.config.scanRecentHours,
      recordingsPath: this.config.recordingsPath
    });
    
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      logger.info('🚀 Starting recovery service...');
      this.runRecoveryWithSizeCheck().catch(err => {
        logger.error('Recovery failed', { error: err.message, stack: err.stack });
      });
    }, this.config.delayStart);
  }

  /** 取消尚未开始的恢复和大小观察，等待正在封装的文件处理完后再允许服务退出。 */
  async stop() {
    this.isStopping = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.sizeCheckTimer) {
      clearTimeout(this.sizeCheckTimer);
      this.sizeCheckTimer = null;
    }
    if (this.finishSizeCheck) {
      this.finishSizeCheck(false);
      this.finishSizeCheck = null;
    }
    if (this.recoveryPromise) await this.recoveryPromise;
  }

  /** 自动与手动恢复共用单次运行门闩，避免同一批临时文件被重复转换。 */
  _runExclusiveRecovery(run) {
    if (this.isStopping || this.recoveryPromise) {
      logger.info('Skipping recovery because service is stopping or a scan is already running');
      return Promise.resolve({ status: 'skipped' });
    }
    this.isRunning = true;
    const pending = Promise.resolve().then(run).finally(() => {
      this.isRunning = false;
      if (this.recoveryPromise === pending) this.recoveryPromise = null;
    });
    this.recoveryPromise = pending;
    return pending;
  }

  /** 等待大小观察窗口；关停时可立即取消，不必空等 30 秒。 */
  _waitForSizeObservation() {
    return new Promise(resolve => {
      if (this.isStopping) {
        resolve(false);
        return;
      }
      this.finishSizeCheck = resolve;
      this.sizeCheckTimer = setTimeout(() => {
        this.sizeCheckTimer = null;
        this.finishSizeCheck = null;
        resolve(true);
      }, 30000);
    });
  }

  // ==================== 主执行流程 ====================
  
  /**
   * 🔥 新逻辑：基于文件大小增长检测
   * 1. 扫描temp文件并记录初始大小
   * 2. 等待30秒
   * 3. 再次检查大小，未增长的文件进行修复
   */
  runRecoveryWithSizeCheck() {
    return this._runExclusiveRecovery(() => this._runRecoveryWithSizeCheck());
  }

  /** 执行启动恢复；扫描结果仅作候选，真正处理前还要在频道锁内复查。 */
  async _runRecoveryWithSizeCheck() {
    this.isRunning = true;
    const startTime = Date.now();
    logger.info('🔧 Starting recording file recovery with size check...');

    try {
      // Step 1: 找到所有temp文件并记录初始大小
      logger.info('🔍 Step 1: Scanning temp files and recording sizes...');
      const tempFiles = await this.findTempFiles();
      
      if (tempFiles.length === 0) {
        logger.info('✅ No temp files found');
        return;
      }

      logger.info(`📊 Found ${tempFiles.length} temp file(s), recording initial sizes...`);
      const fileSizes = new Map();
      for (const file of tempFiles) {
        try {
          const stat = fs.statSync(file.path);
          fileSizes.set(file.path, stat.size);
          logger.info(`📏 Initial size: ${file.path.split('/').pop()} = ${stat.size} bytes`);
        } catch (error) {
          logger.error('Failed to get file size', { file: file.path, error: error.message });
        }
      }

      // Step 2: 等待30秒
      logger.info('⏳ Waiting 30 seconds to check if files are still growing...');
      if (!(await this._waitForSizeObservation())) return;

      // Step 3: 检查文件大小是否增长
      logger.info('🔍 Step 2: Checking if file sizes changed...');
      const filesToFix = [];
      for (const file of tempFiles) {
        try {
          const stat = fs.statSync(file.path);
          const initialSize = fileSizes.get(file.path);
          const currentSize = stat.size;
          
          if (currentSize === initialSize) {
            logger.info(`✅ File stopped growing: ${file.path.split('/').pop()} (${currentSize} bytes)`);
            filesToFix.push({
              ...file,
              recoverySnapshot: { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino }
            });
          } else {
            logger.info(`⏭️ File still growing: ${file.path.split('/').pop()} (${initialSize} → ${currentSize} bytes, +${currentSize - initialSize})`);
          }
        } catch (error) {
          logger.error('Failed to check file size', { file: file.path, error: error.message });
        }
      }

      if (filesToFix.length === 0) {
        logger.info('✅ All temp files are still being recorded');
        return;
      }

      // Step 4: 在频道锁内重查会话占用，再安全重封装；失败时保留原始临时文件。
      logger.info(`🔧 Step 3: Renaming ${filesToFix.length} stopped file(s)...`);
      let renamed = 0, failed = 0, skipped = 0;

      for (const file of filesToFix) {
        if (this.isStopping) break;
        await new Promise(resolve => setImmediate(resolve));
        
        try {
          if (await this._recoverFileWithChannelLock(file, false)) renamed++;
          else skipped++;
        } catch (error) {
          logger.error('Processing failed', { file: file.path, error: error.message });
          failed++;
        }
      }

      logger.info('Recovery completed', {
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        scanned: tempFiles.length,
        candidates: filesToFix.length,
        fixed: renamed,
        renamed,
        skipped,
        failed
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 旧方法：保留用于手动触发API（不等待30秒）
   */
  runRecovery() {
    return this._runExclusiveRecovery(() => this._runRecovery());
  }

  /** 执行手动扫描；保留其 30 秒修改时间保护和预设结束时间筛选。 */
  async _runRecovery() {
    this.isRunning = true;
    const startTime = Date.now();
    logger.info('🔧 Starting recording file recovery (immediate mode)...');

    try {
      logger.info('🔍 Finding files needing recovery...');
      const filesToFix = await this.findFilesNeedingRecovery();
      
      logger.info(`📊 Found ${filesToFix.length} file(s) needing recovery`);
      
      if (filesToFix.length === 0) {
        logger.info('✅ No files need recovery');
        return;
      }

      let renamed = 0, failed = 0, skipped = 0;

      for (const file of filesToFix) {
        if (this.isStopping) break;
        await new Promise(resolve => setImmediate(resolve));
        
        try {
          if (await this._recoverFileWithChannelLock(file, true)) renamed++;
          else skipped++;
        } catch (error) {
          logger.error('Processing failed', { file: file.path, error: error.message });
          failed++;
        }
      }

      logger.info('Recovery completed', {
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        total: filesToFix.length,
        renamed,
        skipped,
        failed
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 将候选复查与文件处理放在同一频道临界区，阻止新录制在检查后抢占该路径。
   * 锁内只调用不再获取频道锁的文件最终化方法；否则会与启停流程形成同锁重入死锁。
   */
  async _recoverFileWithChannelLock(file, manual) {
    const channelId = file.channel && file.channel.id;
    if (!channelId || typeof this.streamManager.withChannelLock !== 'function'
        || typeof this.streamManager.isRecordingFileActive !== 'function') {
      throw new Error('Recovery requires channel lock and active recording file detection');
    }

    return this.streamManager.withChannelLock(channelId, async () => {
      if (this.isStopping) return false;
      const activeStream = this.streamManager.activeStreams && this.streamManager.activeStreams.get(channelId);
      // 此处已持有频道锁，不能用“锁是否存在”推断过渡状态，否则会将自己的锁误判为占用。
      if ((activeStream && ['starting', 'stopping'].includes(activeStream.state))
          || this.streamManager.isRecordingFileActive(channelId, file.path)) {
        logger.info('Skipping recovery file owned by an active recording session', { channelId, file: file.path });
        return false;
      }
      if (!fs.existsSync(file.path)) return false;

      const before = fs.statSync(file.path);
      const snapshot = file.recoverySnapshot;
      if (!before.isFile() || before.size === 0
          || (snapshot && (before.size !== snapshot.size || before.mtimeMs !== snapshot.mtimeMs || before.ino !== snapshot.ino))) {
        logger.info('Skipping recovery candidate changed since scan', { file: file.path });
        return false;
      }
      if (manual && file.type === 'temp') {
        const processInfo = this.streamManager.activeStreams && this.streamManager.activeStreams.get(channelId);
        if (Date.now() - before.mtimeMs < 30000 || (processInfo && processInfo.isRecording)) return false;
      }

      // 扫描与排队期间外部写入者仍可能改变文件；锁内再次观察，不能把旧快照当作关闭证明。
      await new Promise(resolve => setTimeout(resolve, 300));
      if (this.isStopping || !fs.existsSync(file.path)
          || this.streamManager.isRecordingFileActive(channelId, file.path)) return false;
      const after = fs.statSync(file.path);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) return false;
      return this.fixFileName(file);
    });
  }

  // ==================== 文件扫描逻辑 ====================
  
  /**
   * 🔥 新方法：只扫描temp文件，不做判断
   */
  async findTempFiles() {
    const files = [];
    const cutoffTime = Date.now() - this.config.scanRecentHours * 60 * 60 * 1000;

    try {
      const channels = await this.getRecordingChannels();
      
      for (const channel of channels) {
        const channelDir = path.join(channel.storagePath, channel.id);
        if (!fs.existsSync(channelDir)) continue;

        // 扫描最近3个日期目录
        const dates = fs.readdirSync(channelDir)
          .filter(d => /^\d{8}$/.test(d))
          .sort()
          .slice(-3);

        for (const date of dates) {
          const dateDir = path.join(channelDir, date);
          if (!fs.existsSync(dateDir)) continue;

          const dateFiles = fs.readdirSync(dateDir)
            .filter(f => f.endsWith('.mp4') && f.includes('_temp_'))
            .map(f => path.join(dateDir, f))
            .filter(f => {
              try {
                return fs.statSync(f).mtimeMs > cutoffTime;
              } catch {
                return false;
              }
            });

          for (const filePath of dateFiles) {
            files.push({ 
              path: filePath, 
              type: 'temp', 
              channel 
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error finding temp files', { error: error.message });
    }
    
    return files;
  }
  
  /**
   * 旧方法：基于时间和状态判断（用于手动触发API）
   */
  async findFilesNeedingRecovery() {
    const files = [];
    const cutoffTime = Date.now() - this.config.scanRecentHours * 60 * 60 * 1000;

    try {
      const channels = await this.getRecordingChannels();
      
      for (const channel of channels) {
        const channelDir = path.join(channel.storagePath, channel.id);
        if (!fs.existsSync(channelDir)) continue;

        // 只扫描最近3个日期目录
        const dates = fs.readdirSync(channelDir)
          .filter(d => /^\d{8}$/.test(d))
          .sort()
          .slice(-3);

        for (const date of dates) {
          const dateDir = path.join(channelDir, date);
          if (!fs.existsSync(dateDir)) continue;

          const dateFiles = fs.readdirSync(dateDir)
            .filter(f => f.endsWith('.mp4'))
            .map(f => path.join(dateDir, f))
            .filter(f => {
              try {
                return fs.statSync(f).mtimeMs > cutoffTime;
              } catch {
                return false;
              }
            });

          for (const filePath of dateFiles) {
            const fileName = path.basename(filePath);
            
            // 识别temp文件
            if (fileName.includes('_temp_')) {
              // 🔥 关键修复：检查文件是否正在被录制
              const stat = fs.statSync(filePath);
              const fileAge = Date.now() - stat.mtimeMs;
              const protectionPeriod = 30 * 1000;  // 30秒保护期（录制分片60分钟，30秒足够判断）
              
              // 🔒 安全检查1：只处理修改时间超过30秒的temp文件
              // 录制时FFmpeg每秒都在写入，30秒足够判断文件是否停止增长
              if (fileAge < protectionPeriod) {
                logger.info(`⏭️ Skipping recent temp file (possibly recording): ${fileName} (age: ${Math.round(fileAge / 1000)}s)`);
                continue;
              }
              
              // 🔒 安全检查2：检查是否有活跃的录制进程在使用该频道
              const isRecording = this.streamManager.activeStreams?.has(channel.id) && 
                                  this.streamManager.activeStreams.get(channel.id)?.isRecording;
              if (isRecording) {
                logger.warn(`⚠️ Skipping temp file - channel is actively recording: ${fileName}`);
                continue;
              }
              
              logger.info(`📦 Found old temp file: ${fileName} (age: ${Math.round(fileAge / 60000)}min)`);
              files.push({ path: filePath, type: 'temp', channel });
            } else if (channel.recordConfig) {
              // 识别错误结束时间文件（仅当有录制配置时）
              const match = fileName.match(/_(\d{6})_to_(\d{6})\.mp4$/);
              if (match && this.isPresetEndTime(match[2], channel.recordConfig.endTime)) {
                if (await this.needsEndTimeCheck(filePath)) {
                  files.push({ path: filePath, type: 'wrongEndTime', channel });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error finding files', { error: error.message });
    }
    
    return files;
  }

  async getRecordingChannels() {
    const channels = [];
    
    logger.info('🔍 Checking streamManager.recordingConfigs...');
    logger.info(`recordingConfigs size: ${this.streamManager.recordingConfigs.size}`);
    
    // 方式1：从streamManager获取（如果有配置）
    for (const [channelId, config] of this.streamManager.recordingConfigs.entries()) {
      channels.push({
        id: channelId,
        name: config.channelName,
        storagePath: config.storagePath || this.config.recordingsPath,
        recordConfig: config
      });
    }
    
    if (channels.length > 0) {
      logger.info(`✅ Found ${channels.length} channels from streamManager`);
    }
    
    // 方式2：直接扫描录制目录（兜底方案）
    if (channels.length === 0) {
      logger.info(`📁 Scanning directory: ${this.config.recordingsPath}`);
      
      if (!fs.existsSync(this.config.recordingsPath)) {
        logger.warn(`⚠️ Directory not found: ${this.config.recordingsPath}`);
        return channels;
      }
      
      const dirs = fs.readdirSync(this.config.recordingsPath)
        .filter(d => d.startsWith('stream_'));
      
      logger.info(`📊 Found ${dirs.length} stream directories: ${dirs.join(', ')}`);
      
      for (const channelId of dirs) {
        channels.push({
          id: channelId,
          name: channelId,
          storagePath: this.config.recordingsPath,
          recordConfig: null  // 无录制配置，跳过结束时间检查
        });
      }
      
      logger.info(`✅ Found ${dirs.length} channels from directory scan`);
    }
    
    return channels;
  }

  // ==================== 文件识别逻辑 ====================
  
  isPresetEndTime(endTime, configEndTime) {
    return endTime === configEndTime.replace(':', '') + '00';
  }

  async needsEndTimeCheck(filePath) {
    try {
      const duration = await this.getVideoDuration(filePath);
      const match = path.basename(filePath).match(/_(\d{6})_to_(\d{6})\.mp4$/);
      if (!match) return false;
      
      const expectedDuration = (this.parseTimeString(match[2]) - this.parseTimeString(match[1])) / 1000;
      return Math.abs(duration - expectedDuration) > 300;
    } catch {
      return false;
    }
  }

  parseTimeString(timeStr) {
    return parseInt(timeStr.substr(0, 2)) * 3600 + 
           parseInt(timeStr.substr(2, 2)) * 60 + 
           parseInt(timeStr.substr(4, 2));
  }

  // ==================== 文件修复逻辑 ====================
  
  /** 分派已经过锁内占用检查的候选；仅实际完成文件处理时返回 true。 */
  async fixFileName(file) {
    if (file.type === 'temp') {
      return this.renameTempFile(file);
    } else if (file.type === 'wrongEndTime') {
      return this.fixEndTime(file);
    }
    return false;
  }

  /** 按既有 mtime/媒体时长口径恢复临时名，安全封装失败时向上传播并保留原件。 */
  async renameTempFile(file) {
    try {
      logger.info(`🔧 Renaming temp file: ${path.basename(file.path)}`);
      
      // 匹配新格式：频道名_频道ID_日期_时间_temp_XXX.mp4
      const match = path.basename(file.path).match(/(.+)_(.+)_(\d{8})_(\d{6})_temp_(\d{3})\.mp4$/);
      if (!match) {
        logger.info('Trying old format match...');
        // 兼容旧格式：频道名_频道ID_日期_temp_XXX.mp4
        const oldMatch = path.basename(file.path).match(/(.+)_(.+)_(\d{8})_temp_(\d{3})\.mp4$/);
        if (!oldMatch) {
          logger.warn(`⚠️ File name does not match any pattern: ${path.basename(file.path)}`);
          return false;
        }
        
        logger.info('✅ Matched old format');
        const [, channelName, channelId, date] = oldMatch;
        const duration = await this.getVideoDuration(file.path);
        const stat = fs.statSync(file.path);
        const fileEndTime = new Date(stat.mtimeMs);
        const fileStartTime = new Date(fileEndTime.getTime() - duration * 1000);
        
        const newFileName = `${channelName}_${channelId}_${date}_${this.formatTime(fileStartTime)}_to_${this.formatTime(fileEndTime)}.mp4`;
        const newPath = path.join(path.dirname(file.path), newFileName);
        
        if (!fs.existsSync(newPath)) {
          // 🔥 关键修复：转换为标准MP4（与新格式处理一致）
          logger.info('🔄 Converting temp file to standard MP4 (old format)...');
          await this.streamManager.convertSegmentToStandardMp4(file.path, newPath);
          if (!fs.existsSync(newPath)) throw new Error('Recovered output was not published');
          logger.info('✅ Temp file converted and renamed (old format)', { from: path.basename(file.path), to: newFileName });

          // 🆕 迭代 3：旧格式恢复后派发自动上传事件
          this._safeFinalizeDispatch(newPath, file.channel && file.channel.id);
          return true;
        } else {
          logger.warn(`⚠️ Target file already exists: ${newFileName}`);
        }
        return false;
      }
      
      logger.info('✅ Matched new format');
      // 新格式处理：使用文件修改时间作为结束时间（最可靠）
      const [, channelName, channelId, date, startTimeFromName] = match;
      const duration = await this.getVideoDuration(file.path);
      
      // 🔥 使用文件修改时间作为结束时间（最可靠的数据源）
      // 录制时持续写入文件，mtime会不断更新，程序终止后mtime就是实际结束时间
      const stat = fs.statSync(file.path);
      const fileEndTime = new Date(stat.mtimeMs);
      
      // 反推开始时间 = 结束时间 - 视频时长
      const calculatedStartTime = new Date(fileEndTime.getTime() - duration * 1000);
      
      // 🔍 解析文件名中的开始时间（用于验证）
      const year = parseInt(date.substr(0, 4));
      const month = parseInt(date.substr(4, 2)) - 1;
      const day = parseInt(date.substr(6, 2));
      const nameStartHour = parseInt(startTimeFromName.substr(0, 2));
      const nameStartMin = parseInt(startTimeFromName.substr(2, 2));
      const nameStartSec = parseInt(startTimeFromName.substr(4, 2));
      const nameStartTime = new Date(year, month, day, nameStartHour, nameStartMin, nameStartSec);
      
      // 🚨 对比验证：检测时间差异（发现录制超时或异常）
      const timeDiff = Math.abs(calculatedStartTime.getTime() - nameStartTime.getTime()) / 1000;
      if (timeDiff > 60) {
        logger.warn('⚠️ Start time mismatch detected', {
          file: path.basename(file.path),
          nameStartTime: startTimeFromName,
          calculatedStartTime: this.formatTime(calculatedStartTime),
          diffSeconds: Math.round(timeDiff),
          reason: 'Possible recording overtime or file corruption'
        });
      }
      
      // ✅ 使用计算出的时间（基于可靠的mtime）
      const startTime = this.formatTime(calculatedStartTime);
      const endTime = this.formatTime(fileEndTime);
      
      logger.info(`🎯 Calculated times from mtime: ${endTime} - ${Math.round(duration)}s = ${startTime}`);
      
      // 使用计算出的时间生成文件名
      const newFileName = `${channelName}_${channelId}_${date}_${startTime}_to_${endTime}.mp4`;
      const newPath = path.join(path.dirname(file.path), newFileName);
      
      logger.info(`🎯 Target name: ${newFileName}`);
      
      if (!fs.existsSync(newPath)) {
        // 🔥 关键修复：转换为标准MP4而非简单重命名
        // 
        // 问题根因：
        // - temp文件使用Fragmented MP4（防崩溃保护）
        // - 异常中断后，Fragmented MP4可能只能播放部分内容
        // - 需要转换为标准MP4确保完整播放
        //
        // 解决方案：
        // - 调用streamManager的转换方法（与分段完成逻辑一致）
        // - 使用 -c copy 避免重新编码
        // - 转换或校验失败时抛错并保留原始文件，不把直接改名当作转换成功
        logger.info('🔄 Converting temp file to standard MP4...');
        await this.streamManager.convertSegmentToStandardMp4(file.path, newPath);
        if (!fs.existsSync(newPath)) throw new Error('Recovered output was not published');
        logger.info('✅ Temp file converted and renamed', { from: path.basename(file.path), to: newFileName });

        // 🆕 迭代 3：新格式恢复后派发自动上传事件
        this._safeFinalizeDispatch(newPath, file.channel && file.channel.id);
        return true;
      } else {
        logger.warn(`⚠️ Target file already exists: ${newFileName}`);
      }
      return false;
    } catch (error) {
      logger.error('❌ Rename temp failed', { file: file.path, error: error.message, stack: error.stack });
      throw error;
    }
  }

  /** 对手动恢复选中的非活动正式文件修正结束时间，不覆盖已存在的目标文件。 */
  async fixEndTime(file) {
    try {
      const match = path.basename(file.path).match(/_(\d{6})_to_(\d{6})\.mp4$/);
      if (!match) return false;
      
      const stat = fs.statSync(file.path);
      const endTimeStr = this.formatTime(new Date(stat.mtimeMs));
      const newFileName = path.basename(file.path).replace(/_to_\d{6}\.mp4$/, `_to_${endTimeStr}.mp4`);
      
      if (newFileName === path.basename(file.path)) return false;
      
      const newPath = path.join(path.dirname(file.path), newFileName);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(file.path, newPath);
        logger.info('End time fixed', { from: path.basename(file.path), to: newFileName });

        // 🆕 迭代 3：修正结束时间后派发自动上传事件
        this._safeFinalizeDispatch(newPath, file.channel && file.channel.id);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Fix end time failed', { file: file.path, error: error.message });
      throw error;
    }
  }

  // ==================== 格式修复逻辑 ====================
  
  async checkFilePlayable(filePath) {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
      ]);

      let hasOutput = false;
      ffprobe.stdout.on('data', () => { hasOutput = true; });
      ffprobe.on('close', (code) => { resolve(code === 0 && hasOutput); });

      setTimeout(() => {
        ffprobe.kill();
        resolve(false);
      }, 5000);
    });
  }

  async repairFileFormat(filePath) {
    const tempPath = filePath + '.repair.mp4';
    
    return new Promise((resolve, reject) => {
      // 🔥 关键修复：对于已录制完成的损坏文件，需要重新编码修复
      // 
      // 原因分析：
      // 1. VPS重启导致的temp文件可能严重损坏（EOF不完整）
      // 2. `-c copy` 只重新封装容器，不修复损坏的视频流
      // 3. Fragmented MP4 要求严格结构，损坏流无法正确分片
      // 4. 结果：只能播放开头的完整moof（通常2秒）
      //
      // 解决方案：
      // - 使用 libx264 重新编码（修复损坏帧）
      // - 使用 faststart（标准MP4，已录制完成不需要流式写入）
      // - preset ultrafast（速度优先，质量已由原始编码决定）
      const ffmpeg = spawn('ffmpeg', [
        '-i', filePath,
        '-c:v', 'libx264',     // 重新编码修复损坏帧
        '-preset', 'ultrafast', // 快速编码
        '-crf', '23',           // 质量控制
        '-an',                  // 无音频
        '-movflags', 'faststart', // 标准MP4格式（元数据前置）
        '-y',
        tempPath
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, filePath);
          logger.info('✅ File format repaired (re-encoded to standard MP4)', { filePath });
          resolve();
        } else {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          logger.error('❌ Repair failed', { filePath, code, stderr: stderr.slice(-500) });
          reject(new Error('Repair failed'));
        }
      });

      setTimeout(() => {
        ffmpeg.kill();
        reject(new Error('Timeout'));
      }, this.config.timeoutPerFile);
    });
  }

  // ==================== 工具方法 ====================
  
  async getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => { output += data.toString(); });
      
      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          resolve(isNaN(duration) ? 0 : duration);
        } else {
          reject(new Error('Failed'));
        }
      });

      setTimeout(() => {
        ffprobe.kill();
        reject(new Error('Timeout'));
      }, 5000);
    });
  }

  formatTime(date) {
    return String(date.getHours()).padStart(2, '0') + 
           String(date.getMinutes()).padStart(2, '0') + 
           String(date.getSeconds()).padStart(2, '0');
  }
}

module.exports = RecordingRecoveryService;
