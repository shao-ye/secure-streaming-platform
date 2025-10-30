const cron = require('node-cron');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const WorkdayChecker = require('./WorkdayChecker');

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
    this.workdayChecker = new WorkdayChecker();
    this.workersApiUrl = process.env.WORKERS_API_URL || 'https://yoyoapi.5202021.xyz';
    this.isRunning = false;
    
    logger.info('RecordScheduler initialized', {
      workersApiUrl: this.workersApiUrl
    });
  }
  
  /**
   * 启动调度器
   */
  async start() {
    if (this.isRunning) {
      logger.warn('RecordScheduler already running');
      return;
    }
    
    try {
      logger.info('Starting RecordScheduler...');
      
      // 1. 初始化工作日检查器
      await this.workdayChecker.initialize();
      logger.info('WorkdayChecker initialized');
      
      // 2. 获取所有录制配置
      const configs = await this.fetchRecordConfigs();
      logger.info('Fetched record configs', { count: configs.length });
      
      // 3. 处理每个配置
      for (const config of configs) {
        try {
          // 检查是否应该立即开始录制
          if (await this.shouldRecordNow(config)) {
            logger.info('Starting immediate recording', { channelId: config.channelId });
            await this.startRecording(config);
          }
          
          // 设置定时任务
          this.scheduleChannel(config);
        } catch (error) {
          logger.error('Failed to process record config', { 
            channelId: config.channelId, 
            error: error.message 
          });
        }
      }
      
      this.isRunning = true;
      logger.info('RecordScheduler started successfully', {
        scheduledChannels: this.cronTasks.size
      });
    } catch (error) {
      logger.error('Failed to start RecordScheduler', { error: error.message });
      throw error;
    }
  }
  
  /**
   * 为频道设置定时任务
   * @param {Object} config - 录制配置
   */
  scheduleChannel(config) {
    const { channelId, startTime, endTime } = config;
    
    // 清除已存在的任务
    this.unscheduleChannel(channelId);
    
    const [startH, startM] = startTime.split(':');
    const [endH, endM] = endTime.split(':');
    
    // 开始录制任务
    const startCron = `${startM} ${startH} * * *`;
    const startTask = cron.schedule(startCron, async () => {
      logger.info('Record start time triggered', { channelId, startTime });
      
      if (await this.shouldRecordNow(config)) {
        await this.startRecording(config);
      } else {
        logger.info('Skipping recording (not workday or out of range)', { channelId });
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });
    
    // 停止录制任务
    const stopCron = `${endM} ${endH} * * *`;
    const stopTask = cron.schedule(stopCron, async () => {
      logger.info('Record stop time triggered', { channelId, endTime });
      await this.stopRecording(channelId);
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });
    
    this.cronTasks.set(channelId, { startTask, stopTask });
    
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
    const tasks = this.cronTasks.get(channelId);
    if (tasks) {
      tasks.startTask.stop();
      tasks.stopTask.stop();
      this.cronTasks.delete(channelId);
      logger.info('Unscheduled record tasks', { channelId });
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
        }
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
   * 启动录制
   * @param {Object} config - 录制配置
   */
  async startRecording(config) {
    try {
      logger.info('Starting recording', { 
        channelId: config.channelId,
        channelName: config.channelName
      });
      
      // 🆕 获取系统设置（分段配置）
      const systemSettings = await this.fetchSystemSettings();
      
      // 🆕 合并配置
      const fullConfig = {
        ...config,
        segmentEnabled: systemSettings.segmentEnabled,
        segmentDuration: systemSettings.segmentDuration
      };
      
      logger.info('Recording config prepared', {
        channelId: config.channelId,
        segmentEnabled: fullConfig.segmentEnabled,
        segmentDuration: fullConfig.segmentDuration
      });
      
      await this.streamManager.enableRecording(config.channelId, fullConfig);
      
      logger.info('Recording started successfully', { channelId: config.channelId });
    } catch (error) {
      logger.error('Failed to start recording', { 
        channelId: config.channelId, 
        error: error.message 
      });
    }
  }
  
  /**
   * 停止录制
   * @param {string} channelId - 频道ID
   */
  async stopRecording(channelId) {
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
        }
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
    try {
      logger.info('Reloading record schedule...');
      
      // 1. 获取新的配置
      const configs = await this.fetchRecordConfigs();
      const newEnabledChannels = new Set(configs.map(c => c.channelId));
      
      // 2. 停止不再需要录制的频道
      const recordingStatus = this.streamManager.getRecordingStatus();
      for (const channel of recordingStatus.channels) {
        if (channel.isRecording && !newEnabledChannels.has(channel.channelId)) {
          logger.info('Stopping recording for disabled channel', { 
            channelId: channel.channelId 
          });
          try {
            // 🔧 修复：使用正确的方法名 disableRecording
            await this.streamManager.disableRecording(channel.channelId);
          } catch (error) {
            logger.error('Failed to stop recording', { 
              channelId: channel.channelId, 
              error: error.message 
            });
          }
        }
      }
      
      // 3. 停止所有现有的定时任务
      for (const channelId of this.cronTasks.keys()) {
        this.unscheduleChannel(channelId);
      }
      
      // 4. 为启用的频道设置新任务
      for (const config of configs) {
        try {
          // 检查频道是否已经在录制中
          const isAlreadyRecording = recordingStatus.channels.some(
            ch => ch.channelId === config.channelId && ch.isRecording
          );
          
          // 只有在未录制且应该录制时才启动录制
          if (!isAlreadyRecording && await this.shouldRecordNow(config)) {
            logger.info('Starting recording for new config', { 
              channelId: config.channelId,
              reason: 'in time range and not recording'
            });
            await this.startRecording(config);
          } else if (isAlreadyRecording) {
            logger.info('Skipping recording start (already recording)', { 
              channelId: config.channelId 
            });
          }
          
          // 设置定时任务（无论是否在录制，都要设置定时任务）
          this.scheduleChannel(config);
        } catch (error) {
          logger.error('Failed to reload config', { 
            channelId: config.channelId, 
            error: error.message 
          });
        }
      }
      
      logger.info('Record schedule reloaded successfully', {
        scheduledChannels: this.cronTasks.size,
        stoppedChannels: recordingStatus.channels.length - newEnabledChannels.size
      });
      
      return {
        status: 'success',
        scheduledChannels: this.cronTasks.size
      };
    } catch (error) {
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
    try {
      logger.info('Reloading schedule with direct config', { 
        channelId, 
        enabled: config.enabled,
        startTime: config.startTime,
        endTime: config.endTime
      });
      
      // 1. 检查该频道当前的录制状态
      const recordingStatus = this.streamManager.getRecordingStatus();
      const isCurrentlyRecording = recordingStatus.channels.some(
        ch => ch.channelId === channelId && ch.isRecording
      );
      
      // 2. 停止该频道现有的定时任务
      this.unscheduleChannel(channelId);
      
      // 3. 根据新配置处理
      if (config.enabled) {
        // 3.1 配置启用录制
        logger.info('Config enabled, checking if should start recording now', { 
          channelId,
          isCurrentlyRecording 
        });
        
        // 只有在未录制且应该录制时才启动
        if (!isCurrentlyRecording && await this.shouldRecordNow(config)) {
          logger.info('Starting recording immediately', { 
            channelId,
            reason: 'in time range and config enabled'
          });
          await this.startRecording(config);
        } else if (isCurrentlyRecording) {
          logger.info('Already recording, keeping current state', { channelId });
        } else {
          logger.info('Not in recording time range, scheduling only', { channelId });
        }
        
        // 设置新的定时任务
        this.scheduleChannel(config);
        
      } else {
        // 3.2 配置禁用录制
        logger.info('Config disabled, stopping recording if active', { 
          channelId,
          isCurrentlyRecording 
        });
        
        if (isCurrentlyRecording) {
          try {
            await this.streamManager.disableRecording(channelId);
            logger.info('Recording stopped for disabled config', { channelId });
          } catch (error) {
            logger.error('Failed to stop recording', { 
              channelId, 
              error: error.message 
            });
          }
        }
        
        // 不设置定时任务（因为已禁用）
      }
      
      logger.info('Schedule reloaded successfully with direct config', {
        channelId,
        enabled: config.enabled,
        hasScheduledTask: this.cronTasks.has(channelId),
        isRecording: this.streamManager.getRecordingStatus().channels
          .some(ch => ch.channelId === channelId && ch.isRecording)
      });
      
      return {
        status: 'success',
        channelId,
        enabled: config.enabled
      };
    } catch (error) {
      logger.error('Failed to reload schedule with config', { 
        channelId, 
        error: error.message,
        stack: error.stack
      });
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
    
    // 停止所有定时任务
    for (const channelId of this.cronTasks.keys()) {
      this.unscheduleChannel(channelId);
    }
    
    this.isRunning = false;
    logger.info('RecordScheduler stopped');
  }
}

module.exports = RecordScheduler;
