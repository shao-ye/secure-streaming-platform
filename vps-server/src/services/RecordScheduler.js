const cron = require('node-cron');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const WorkdayChecker = require('./WorkdayChecker');
const config = require('../../config');

/**
 * 录制调度器 - 管理频道定时录制
 * 
 * 核心功能：
 * 1. 定时启动/停止录制
 * 2. 工作日判断
 * 3. 跨天支持
 * 4. 配置热重载
 */
class RecordScheduler {
  constructor(streamManager) {
    this.streamManager = streamManager;
    this.cronTasks = new Map();  // Map<channelId, {startTask, stopTask}>
    this.channelConfigs = new Map();  // Map<channelId, config>
    this.recoveryLocks = new Set();
    this.workdayChecker = new WorkdayChecker();
    
    // 从统一配置读取Workers API配置，无默认值
    this.workersApiUrl = config.workersApiUrl;
    this.isRunning = false;
    this.isStarting = false;
    // 生命周期代次用于整体停止/重载；频道代次用于单频道停录，避免过期异步任务复活进程。
    this.operationVersion = 0;
    this.channelOperationVersions = new Map();
    this.healthCheckTimer = null;
    this.healthCheckIntervalMs = 60000;
    this.recordingOutputStaleMs = parseInt(process.env.RECORDING_OUTPUT_STALE_MS, 10) > 0
      ? parseInt(process.env.RECORDING_OUTPUT_STALE_MS, 10)
      : 120000;
    
    logger.info('📼 RecordScheduler initialized', {
      workersApiUrl: this.workersApiUrl,
      recordingOutputStaleMs: this.recordingOutputStaleMs
    });
  }
  
  /**
   * 启动调度器
   */
  async start() {
    if (this.isRunning || this.isStarting) {
      logger.warn('RecordScheduler already running or starting');
      return;
    }
    const operationVersion = ++this.operationVersion;
    const channelVersions = new Map(this.channelOperationVersions);
    this.isStarting = true;
    try {
      logger.info('Starting RecordScheduler...');
      await this.workdayChecker.initialize();
      if (!this.isOperationCurrent(operationVersion)) return;

      const configs = await this.fetchRecordConfigs();
      if (!this.isOperationCurrent(operationVersion)) return;
      logger.info('Fetched record configs', { count: configs.length });

      for (const config of configs) {
        if (!this.isOperationCurrent(operationVersion)) return;
        // 初始化等待期间收到的单频道配置更新优先，不能被较早的整批响应覆盖。
        if ((this.channelOperationVersions.get(config.channelId) || 0)
          !== (channelVersions.get(config.channelId) || 0)) continue;
        try {
          // 先登记本代配置；初始化阶段尚未 isRunning，但仍允许受代次约束的立即录制。
          this.scheduleChannel(config);
          await this.startRecording(this.channelConfigs.get(config.channelId), { operationVersion });
        } catch (error) {
          logger.error('Failed to process record config', { channelId: config.channelId, error: error.message });
        }
      }
      if (!this.isOperationCurrent(operationVersion)) return;
      this.isRunning = true;
      this.startHealthCheck();
      logger.info('RecordScheduler started successfully', { scheduledChannels: this.cronTasks.size });
    } catch (error) {
      if (this.operationVersion === operationVersion) await this.stop();
      logger.error('Failed to start RecordScheduler', { error: error.message });
      throw error;
    } finally {
      if (this.operationVersion === operationVersion) this.isStarting = false;
    }
  }

  /** 判断整体调度操作是否仍有效，初始化阶段与正常运行阶段均可接受本代任务。 */
  isOperationCurrent(operationVersion) {
    return this.operationVersion === operationVersion && (this.isRunning || this.isStarting);
  }

  /** 使指定频道先前排队的启动或恢复失效，不影响其他频道和下一次正常定时任务。 */
  invalidateChannelOperations(channelId) {
    this.channelOperationVersions.set(channelId, (this.channelOperationVersions.get(channelId) || 0) + 1);
  }

  /**
   * 为频道设置定时任务
   * @param {Object} config - 录制配置
   */
  scheduleChannel(config) {
    const { channelId, startTime, endTime } = config;
    
    // 清除已存在的任务
    this.unscheduleChannel(channelId);
    const scheduledConfig = { ...config };
    
    const [startH, startM] = startTime.split(':');
    const [endH, endM] = endTime.split(':');
    
    // 开始录制任务
    const startCron = `${startM} ${startH} * * *`;
    const startTask = cron.schedule(startCron, async () => {
      logger.info('Record start time triggered', { channelId, startTime });
      
      if (!this.isRunning || this.channelConfigs.get(channelId) !== scheduledConfig) return;
      // startRecording 在任何配置请求前捕获代次，并在管理器拿锁后再次验证。
      try {
        await this.startRecording(scheduledConfig);
      } catch (error) {
        logger.error('Scheduled recording start failed', { channelId, error: error.message });
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });
    
    // 停止录制任务
    const stopCron = `${endM} ${endH} * * *`;
    const stopTask = cron.schedule(stopCron, async () => {
      if (!this.isRunning || this.channelConfigs.get(channelId) !== scheduledConfig) return;
      logger.info('Record stop time triggered', { channelId, endTime });
      await this.stopRecording(channelId);
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });
    
    this.cronTasks.set(channelId, { startTask, stopTask });
    this.channelConfigs.set(channelId, scheduledConfig);
    
    logger.info('Scheduled record tasks', {
      channelId,
      startCron,
      stopCron,
      timezone: 'Asia/Shanghai'
    });
  }
  
  /**
   * 取消频道的定时任务
   * @param {string} channelId - 频道ID
   */
  unscheduleChannel(channelId) {
    this.invalidateChannelOperations(channelId);
    const tasks = this.cronTasks.get(channelId);
    if (tasks) {
      tasks.startTask.stop();
      tasks.stopTask.stop();
      this.cronTasks.delete(channelId);
      logger.info('Unscheduled record tasks', { channelId });
    }
    this.channelConfigs.delete(channelId);
  }

  /**
   * 启动录制健康检查定时器
   * 用于在录制时段内检测 FFmpeg 意外退出，并自动恢复录制
   */
  startHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      this.recoverInterruptedRecordings().catch((error) => {
        logger.error('RecordScheduler health check failed', {
          error: error.message,
          stack: error.stack
        });
      });
    }, this.healthCheckIntervalMs);

    if (typeof this.healthCheckTimer.unref === 'function') {
      this.healthCheckTimer.unref();
    }

    logger.info('RecordScheduler health check started', {
      intervalMs: this.healthCheckIntervalMs
    });
  }

  /**
   * 停止录制健康检查定时器
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      logger.info('RecordScheduler health check stopped');
    }
  }

  /**
   * 复核启动令牌、当前配置和录制时段，供普通启动及管理器锁内回调共同使用。
   * 工作日检查可能异步等待，返回后必须再次检查代次和时间，避免越过停录/重载边界。
   * @param {string} channelId - 频道ID
   * @param {Object} expectedConfig - 启动时登记的配置对象
   * @param {number} operationVersion - 整体调度操作代次
   * @param {number} channelVersion - 频道停录/重载代次
   * @returns {Promise<boolean>} 是否仍允许启动
   */
  async canStartRecording(channelId, expectedConfig, operationVersion, channelVersion) {
    const isCurrent = () => this.isOperationCurrent(operationVersion)
      && expectedConfig && expectedConfig.enabled !== false
      && this.channelConfigs.get(channelId) === expectedConfig
      && (this.channelOperationVersions.get(channelId) || 0) === channelVersion;
    if (!isCurrent()) return false;
    const shouldRecord = await this.shouldRecordNow(expectedConfig);
    return shouldRecord && isCurrent()
      && this.isInTimeRange(moment().tz('Asia/Shanghai').format('HH:mm'),
        expectedConfig.startTime, expectedConfig.endTime);
  }

  /** 判断本轮健康恢复是否仍有效；恢复不在初始化或停止状态下执行。 */
  async canRecoverRecording(channelId, expectedConfig, operationVersion = this.operationVersion,
    channelVersion = this.channelOperationVersions.get(channelId) || 0) {
    return this.isRunning && await this.canStartRecording(channelId, expectedConfig, operationVersion, channelVersion)
      && this.isRunning;
  }

  /**
   * 巡检当前录制状态。
   * 跳过正在启动或停止的频道；恢复由管理器在频道锁内复核并直接启动录制，避免先切成纯观看。
   */
  async recoverInterruptedRecordings() {
    if (!this.isRunning || this.channelConfigs.size === 0) {
      return;
    }

    for (const [channelId, channelConfig] of this.channelConfigs.entries()) {
      const operationVersion = this.operationVersion;
      const channelVersion = this.channelOperationVersions.get(channelId) || 0;
      if (this.recoveryLocks.has(channelId)
        || this.streamManager.isChannelTransitioning(channelId)
        || !(await this.canRecoverRecording(channelId, channelConfig, operationVersion, channelVersion))) {
        continue;
      }

      // 每个频道读取即时状态，不复用上一频道异步恢复之前的整批快照。
      const currentStatus = this.streamManager.getRecordingStatus().channels
        .find(channel => channel.channelId === channelId);
      if (['starting', 'stopping'].includes(currentStatus?.state)
        || this.streamManager.isChannelTransitioning(channelId)) {
        continue;
      }

      const isHealthyRecording = currentStatus?.state !== 'failed'
        && currentStatus?.isActive && currentStatus?.isRecording;
      let recoveryReason = 'recording_status_inactive';
      let outputHealth = null;

      if (isHealthyRecording) {
        outputHealth = this.streamManager.getRecordingOutputHealth(channelId, {
          maxStaleMs: this.recordingOutputStaleMs
        });
        if (outputHealth.healthy) {
          continue;
        }
        recoveryReason = outputHealth.reason;
      }

      // 前面的工作日判断可能让两轮巡检交错，申请本轮恢复标记前再检查一次。
      if (this.recoveryLocks.has(channelId)) {
        continue;
      }
      this.recoveryLocks.add(channelId);
      try {
        const fullConfig = await this.buildRecordingConfig(channelConfig);
        if (!(await this.canRecoverRecording(channelId, channelConfig, operationVersion, channelVersion))) {
          continue;
        }

        logger.warn('Detected interrupted recording, attempting recovery', {
          channelId,
          reason: recoveryReason,
          state: currentStatus?.state || null,
          hasRecordingMarker: !!currentStatus,
          isActive: currentStatus?.isActive || false,
          isRecording: currentStatus?.isRecording || false,
          outputHealth
        });

        await this.streamManager.recoverRecording(channelId, fullConfig, {
          maxStaleMs: this.recordingOutputStaleMs,
          // 管理器拿到锁后必须再次调用，防止排队期间用户关停、重载或越过结束时刻。
          shouldRecover: () => this.canRecoverRecording(channelId, channelConfig, operationVersion, channelVersion)
        });
      } catch (error) {
        logger.error('Failed to recover interrupted recording', {
          channelId,
          error: error.message,
          stack: error.stack
        });
      } finally {
        this.recoveryLocks.delete(channelId);
      }
    }
  }

  /**
   * 判断当前是否应该录制
   * @param {Object} config - 录制配置
   * @returns {boolean}
   */
  async shouldRecordNow(config) {
    const currentTime = moment().tz('Asia/Shanghai').format('HH:mm');
    const inTimeRange = this.isInTimeRange(currentTime, config.startTime, config.endTime);
    
    if (!inTimeRange) {
      logger.debug('Not in time range', { 
        channelId: config.channelId, 
        currentTime, 
        startTime: config.startTime, 
        endTime: config.endTime 
      });
      return false;
    }
    
    if (config.workdaysOnly) {
      const isWorkday = await this.workdayChecker.isWorkday();
      if (!isWorkday) {
        logger.debug('Not a workday, skipping', { channelId: config.channelId });
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * 判断当前时间是否在时间范围内
   * @param {string} current - 当前时间 HH:mm
   * @param {string} start - 开始时间 HH:mm
   * @param {string} end - 结束时间 HH:mm
   * @returns {boolean}
   */
  isInTimeRange(current, start, end) {
    const [ch, cm] = current.split(':').map(Number);
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    
    const currentMins = ch * 60 + cm;
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    
    // 跨天情况（如 23:00 - 01:00）
    if (endMins < startMins) {
      return currentMins >= startMins || currentMins < endMins;
    }
    
    // 正常情况
    return currentMins >= startMins && currentMins < endMins;
  }
  
  /**
   * 获取系统设置（包含分段配置）
   * @returns {Object} 系统设置
   */
  async fetchSystemSettings() {
    try {
      const apiKey = process.env.VPS_API_KEY;
      
      const response = await fetch(`${this.workersApiUrl}/api/admin/cleanup/config`, {
        headers: {
          'X-API-Key': apiKey
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch system settings: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'success' && result.data) {
        logger.debug('Fetched system settings', {
          segmentEnabled: result.data.segmentEnabled,
          segmentDuration: result.data.segmentDuration
        });
        
        return {
          segmentEnabled: result.data.segmentEnabled || false,
          segmentDuration: result.data.segmentDuration || 60
        };
      }
      
      return {
        segmentEnabled: false,
        segmentDuration: 60
      };
    } catch (error) {
      logger.error('Failed to fetch system settings', { error: error.message });
      return {
        segmentEnabled: false,
        segmentDuration: 60
      };
    }
  }
  
  /**
   * 为启动和健康恢复构建一致的录制配置。
   * 分段设置以本次读取的全局配置为准，频道自己的录制时段等字段保持原值。
   * @param {Object} channelConfig - 频道录制配置
   * @returns {Promise<Object>} 包含全局分段参数的录制配置
   */
  async buildRecordingConfig(channelConfig) {
    const systemSettings = await this.fetchSystemSettings();
    return {
      ...channelConfig,
      segmentEnabled: systemSettings.segmentEnabled,
      segmentDuration: systemSettings.segmentDuration
    };
  }

  /**
   * 启动当前代次的录制；网络等待或频道锁等待期间停录、重载、关停均会取消本轮启动。
   * @param {Object} config - 已登记到 channelConfigs 的录制配置
   * @param {Object} options - 上层初始化或重载操作的代次
   * @returns {Promise<Object>} 管理器结果，过期任务返回 skipped
   */
  async startRecording(config, options = {}) {
    const operationVersion = options.operationVersion ?? this.operationVersion;
    const channelVersion = this.channelOperationVersions.get(config.channelId) || 0;
    const shouldStart = () => this.canStartRecording(config.channelId, config, operationVersion, channelVersion);
    try {
      if (!(await shouldStart())) return { skipped: true };
      logger.info('Starting recording', { channelId: config.channelId, channelName: config.channelName });
      const fullConfig = await this.buildRecordingConfig(config);
      if (!(await shouldStart())) return { skipped: true };
      logger.info('Recording config prepared', {
        channelId: config.channelId,
        segmentEnabled: fullConfig.segmentEnabled,
        segmentDuration: fullConfig.segmentDuration
      });
      const result = await this.streamManager.enableRecording(config.channelId, fullConfig, { shouldStart });
      if (!result?.skipped) logger.info('Recording started successfully', { channelId: config.channelId });
      return result;
    } catch (error) {
      logger.error('Failed to start recording', { channelId: config.channelId, error: error.message });
      throw error;
    }
  }

  /**
   * 停止录制
   * @param {string} channelId - 频道ID
   */
  async stopRecording(channelId) {
    this.invalidateChannelOperations(channelId);
    try {
      logger.info('Stopping recording', { channelId });
      
      await this.streamManager.disableRecording(channelId);
      
      logger.info('Recording stopped successfully', { channelId });
    } catch (error) {
      logger.error('Failed to stop recording', { 
        channelId, 
        error: error.message 
      });
    }
  }
  
  /**
   * 从Workers API获取录制配置
   * @returns {Array} 录制配置列表
   */
  async fetchRecordConfigs() {
    try {
      const apiKey = process.env.VPS_API_KEY;
      
      logger.debug('Fetching record configs from Workers API', {
        url: `${this.workersApiUrl}/api/record/configs`
      });
      
      const response = await fetch(`${this.workersApiUrl}/api/record/configs`, {
        headers: {
          'X-API-Key': apiKey
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'success' && result.data) {
        logger.info('Successfully fetched record configs', { count: result.data.length });
        return result.data;
      }
      
      logger.warn('No record configs returned from API');
      return [];
    } catch (error) {
      logger.error('Failed to fetch record configs', { 
        error: error.message,
        workersApiUrl: this.workersApiUrl
      });
      return [];
    }
  }
  
  /**
   * 重新加载配置（用于配置更新后热重载）
   */
  async reloadSchedule() {
    if (!this.isRunning && !this.isStarting) return { skipped: true };
    const operationVersion = ++this.operationVersion;
    // 请求新配置之前先让旧任务失效，不能让旧 cron 在请求返回后继续启用录制。
    for (const channelId of this.cronTasks.keys()) this.unscheduleChannel(channelId);
    this.channelConfigs.clear();
    const channelVersions = new Map(this.channelOperationVersions);
    try {
      logger.info('Reloading record schedule...');
      const configs = await this.fetchRecordConfigs();
      if (!this.isOperationCurrent(operationVersion)) return { skipped: true };
      const newEnabledChannels = new Set(configs.map(config => config.channelId));
      const recordingStatus = this.streamManager.getRecordingStatus();
      for (const channel of recordingStatus.channels) {
        if (!this.isOperationCurrent(operationVersion)) return { skipped: true };
        if ((this.channelOperationVersions.get(channel.channelId) || 0)
          !== (channelVersions.get(channel.channelId) || 0)) continue;
        if (channel.isRecording && !newEnabledChannels.has(channel.channelId)) {
          await this.stopRecording(channel.channelId);
        }
      }
      for (const config of configs) {
        if (!this.isOperationCurrent(operationVersion)) return { skipped: true };
        if ((this.channelOperationVersions.get(config.channelId) || 0)
          !== (channelVersions.get(config.channelId) || 0)) continue;
        try {
          this.scheduleChannel(config);
          const currentConfig = this.channelConfigs.get(config.channelId);
          const channelVersion = this.channelOperationVersions.get(config.channelId) || 0;
          const isAlreadyRecording = this.streamManager.getRecordingStatus().channels
            .some(channel => channel.channelId === config.channelId && channel.isRecording);
          if (!isAlreadyRecording) {
            await this.startRecording(currentConfig, { operationVersion });
          } else {
            const shouldRecord = await this.shouldRecordNow(currentConfig);
            if (!this.isOperationCurrent(operationVersion)) return { skipped: true };
            if (this.channelConfigs.get(config.channelId) !== currentConfig
              || (this.channelOperationVersions.get(config.channelId) || 0) !== channelVersion) continue;
            // 配置请求可能跨过旧 cron 的结束时刻，重建调度时立即补上应执行的停录。
            if (!shouldRecord || !this.isInTimeRange(moment().tz('Asia/Shanghai').format('HH:mm'),
              currentConfig.startTime, currentConfig.endTime)) await this.stopRecording(config.channelId);
          }
        } catch (error) {
          logger.error('Failed to reload config', { channelId: config.channelId, error: error.message });
        }
      }
      if (!this.isOperationCurrent(operationVersion)) return { skipped: true };
      if (this.isStarting && !this.isRunning) {
        this.isRunning = true;
        this.isStarting = false;
        this.startHealthCheck();
      }
      logger.info('Record schedule reloaded successfully', { scheduledChannels: this.cronTasks.size });
      return { status: 'success', scheduledChannels: this.cronTasks.size };
    } catch (error) {
      if (this.isStarting && !this.isRunning && this.operationVersion === operationVersion) await this.stop();
      logger.error('Failed to reload schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * 使用直接传递的配置重载单个频道的录制调度
   * @param {string} channelId - 频道ID
   * @param {Object} config - 完整的录制配置对象
   */
  async reloadScheduleWithConfig(channelId, config) {
    if (!this.isRunning && !this.isStarting) return { skipped: true };
    const operationVersion = this.operationVersion;
    this.unscheduleChannel(channelId);
    try {
      logger.info('Reloading schedule with direct config', {
        channelId, enabled: config.enabled, startTime: config.startTime, endTime: config.endTime
      });
      const recordingStatus = this.streamManager.getRecordingStatus();
      const isCurrentlyRecording = recordingStatus.channels.some(
        channel => channel.channelId === channelId && channel.isRecording);
      const hasRecordingMarker = this.streamManager.recordingChannels.has(channelId);
      if (config.enabled) {
        // 先发布新配置，使旧代启动立即失效；后续异步操作都以这个对象和代次为准。
        this.scheduleChannel(config);
        const currentConfig = this.channelConfigs.get(channelId);
        const channelVersion = this.channelOperationVersions.get(channelId) || 0;
        if (!isCurrentlyRecording) {
          await this.startRecording(currentConfig, { operationVersion });
        } else {
          const shouldRecord = await this.shouldRecordNow(currentConfig);
          if (!this.isOperationCurrent(operationVersion)
            || this.channelConfigs.get(channelId) !== currentConfig
            || (this.channelOperationVersions.get(channelId) || 0) !== channelVersion) return { skipped: true };
          if (!shouldRecord || !this.isInTimeRange(moment().tz('Asia/Shanghai').format('HH:mm'),
            currentConfig.startTime, currentConfig.endTime)) await this.stopRecording(channelId);
        }
      } else if (isCurrentlyRecording || hasRecordingMarker) {
        await this.stopRecording(channelId);
      }
      if (!this.isOperationCurrent(operationVersion)) return { skipped: true };
      logger.info('Schedule reloaded successfully with direct config', {
        channelId, enabled: config.enabled, hasScheduledTask: this.cronTasks.has(channelId)
      });
      return { status: 'success', channelId, enabled: config.enabled };
    } catch (error) {
      logger.error('Failed to reload schedule with config', { channelId, error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * 获取调度器状态
   */
  getStatus() {
    const scheduledChannels = Array.from(this.cronTasks.keys());
    
    return {
      isRunning: this.isRunning,
      scheduledChannels: scheduledChannels,
      totalScheduled: scheduledChannels.length,
      workersApiUrl: this.workersApiUrl
    };
  }
  
  /**
   * 停止调度器
   */
  async stop() {
    logger.info('Stopping RecordScheduler...');
    // 先关闭恢复入口，再清理定时任务，禁止旧巡检在关停期间继续启动录制。
    this.isRunning = false;
    this.isStarting = false;
    this.operationVersion++;

    // 停止所有定时任务
    for (const channelId of this.cronTasks.keys()) {
      this.unscheduleChannel(channelId);
    }
    
    this.stopHealthCheck();
    this.channelConfigs.clear();
    this.recoveryLocks.clear();
    logger.info('RecordScheduler stopped');
  }
}

module.exports = RecordScheduler;
