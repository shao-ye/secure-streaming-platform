const cron = require('node-cron');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const WorkdayChecker = require('./WorkdayChecker');  // 🆕 引入工作日检测器

/**
 * 预加载调度器 - 精确定时任务版本
 * 
 * 核心功能：
 * 1. 服务启动时检测并启动需要预加载的频道
 * 2. 为每个频道创建精确的开始/结束定时任务
 * 3. 定时任务准点触发，自动启动/停止预加载
 * 4. 支持配置热重载（reload API）
 * 5. 完整支持跨天时间段（如23:00-01:00）
 * 6. 🆕 支持工作日限制（仅工作日预加载）
 */
class PreloadScheduler {
  constructor(streamManager) {
    this.streamManager = streamManager;
    
    // 存储每个频道的定时任务 Map<channelId, { startTask, stopTask }>
    this.cronTasks = new Map();
    
    // 🆕 初始化工作日检测器
    this.workdayChecker = new WorkdayChecker();
    
    // Workers API配置
    this.workersApiUrl = process.env.WORKERS_API_URL || 'https://yoyoapi.5202021.xyz';
    this.workersApiKey = process.env.WORKERS_API_KEY || '';
  }

  /**
   * 启动调度器
   */
  async start() {
    try {
      logger.info('Starting PreloadScheduler...');
      
      // 🆕 1. 初始化工作日检测器（预取当前月+下月数据）
      logger.info('Initializing WorkdayChecker...');
      await this.workdayChecker.initialize();
      logger.info('✅ WorkdayChecker initialized successfully');
      
      // 2. 获取所有预加载配置
      const configs = await this.fetchPreloadConfigs();
      
      if (!configs || configs.length === 0) {
        logger.info('No preload configurations found');
        return;
      }
      
      logger.info(`Found ${configs.length} preload configurations`);
      
      // 3. 检查当前时间，立即启动需要预加载的频道
      await this.initializePreloads(configs);
      
      // 4. 为每个频道创建定时任务
      for (const config of configs) {
        this.scheduleChannel(config);
      }
      
      logger.info('PreloadScheduler started successfully', {
        configuredChannels: configs.length,
        activeTasks: this.cronTasks.size
      });
    } catch (error) {
      logger.error('Failed to start PreloadScheduler', { error: error.message });
      throw error;
    }
  }

  /**
   * 从Workers API获取预加载配置
   */
  async fetchPreloadConfigs() {
    try {
      const response = await fetch(`${this.workersApiUrl}/api/preload/configs`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.status !== 'success') {
        throw new Error(result.message || 'Failed to fetch configs');
      }
      
      return result.data || [];
    } catch (error) {
      logger.error('Failed to fetch preload configs from Workers', { 
        error: error.message,
        url: this.workersApiUrl
      });
      return [];
    }
  }

  /**
   * 获取频道的RTMP URL
   */
  async fetchChannelRtmpUrl(channelId) {
    try {
      const response = await fetch(`${this.workersApiUrl}/api/admin/streams`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'success' && result.data && result.data.streams) {
        const channel = result.data.streams.find(s => s.id === channelId);
        if (channel && channel.rtmpUrl) {
          return channel.rtmpUrl;
        }
      }
      
      throw new Error('RTMP URL not found');
    } catch (error) {
      logger.error('Failed to fetch RTMP URL', { channelId, error: error.message });
      return null;
    }
  }

  /**
   * 初始化预加载（服务启动时）
   */
  async initializePreloads(configs) {
    const currentTime = this.getBeijingTime().format('HH:mm');
    
    logger.info('Initializing preloads at startup', { currentTime });
    
    for (const config of configs) {
      // 🆕 改为await异步调用（支持工作日检查）
      if (await this.shouldPreloadNow(config, currentTime)) {
        logger.info('Starting preload at startup', { 
          channelId: config.channelId,
          currentTime,
          startTime: config.startTime,
          endTime: config.endTime,
          workdaysOnly: config.workdaysOnly  // 🆕 记录工作日设置
        });
        
        await this.startPreload(config);
      }
    }
  }

  /**
   * 🆕 判断当前时间是否应该预加载（异步）
   * - 检查时间段
   * - 检查工作日（如果启用）
   */
  async shouldPreloadNow(config, currentTime) {
    const { startTime, endTime, workdaysOnly } = config;
    
    // 步骤1: 检查时间段
    const inTimeRange = this.isInTimeRange(currentTime, startTime, endTime);
    if (!inTimeRange) {
      return false;
    }
    
    // 步骤2: 🆕 检查工作日（如果启用）
    if (workdaysOnly) {
      try {
        const isWorkday = await this.workdayChecker.isWorkday();
        
        if (!isWorkday) {
          logger.info('Today is not a workday, skipping preload', { 
            channelId: config.channelId 
          });
          return false;
        }
        
        logger.info('Today is a workday, preload allowed', { 
          channelId: config.channelId 
        });
        
      } catch (error) {
        // 容错：API失败时降级为基础模式
        logger.warn('Workday check failed, falling back to basic mode', { 
          channelId: config.channelId,
          error: error.message 
        });
        // 继续执行（降级为每日预加载）
      }
    }
    
    return true;
  }

  /**
   * 🆕 辅助方法：检查时间是否在指定时段内
   */
  isInTimeRange(currentTime, startTime, endTime) {
    // 解析时间
    const [currentHour, currentMinute] = currentTime.split(':').map(Number);
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    const currentMinutes = currentHour * 60 + currentMinute;
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    
    // 处理跨天情况（如 23:00-01:00）
    if (endMinutes < startMinutes) {
      // 跨天：在开始时间之后 或 在结束时间之前
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      // 不跨天：在开始和结束时间之间
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
  }

  /**
   * 为单个频道创建定时任务
   */
  scheduleChannel(config) {
    const { channelId, startTime, endTime } = config;
    
    // 取消旧的任务（如果存在）
    this.unscheduleChannel(channelId);
    
    // 解析时间
    const [startHour, startMinute] = startTime.split(':');
    const [endHour, endMinute] = endTime.split(':');
    
    // 创建开始任务：每天指定时间执行
    const startCron = `${startMinute} ${startHour} * * *`;
    const startTask = cron.schedule(startCron, async () => {
      logger.info('Cron triggered: Starting preload', { 
        channelId, 
        time: startTime,
        workdaysOnly: config.workdaysOnly,  // 🆕 记录设置
        cronExpression: startCron
      });
      
      // 🆕 实时检查是否应该启动（包含工作日检查）
      const currentTime = this.getBeijingTime().format('HH:mm');
      const shouldStart = await this.shouldPreloadNow(config, currentTime);
      
      if (shouldStart) {
        await this.startPreload(config);
      } else {
        logger.info('Preload skipped by shouldPreloadNow check', { 
          channelId,
          reason: config.workdaysOnly ? 'Not a workday' : 'Out of time range'
        });
      }
    }, {
      timezone: 'Asia/Shanghai'
    });
    
    // 创建停止任务：每天指定时间执行
    const stopCron = `${endMinute} ${endHour} * * *`;
    const stopTask = cron.schedule(stopCron, async () => {
      logger.info('Cron triggered: Stopping preload', { 
        channelId, 
        time: endTime,
        cronExpression: stopCron
      });
      
      await this.stopPreload(channelId);
    }, {
      timezone: 'Asia/Shanghai'
    });
    
    // 保存任务引用
    this.cronTasks.set(channelId, { startTask, stopTask });
    
    logger.info('Scheduled preload tasks', { 
      channelId, 
      startCron, 
      stopCron,
      startTime,
      endTime
    });
  }

  /**
   * 取消频道的定时任务
   */
  unscheduleChannel(channelId) {
    const tasks = this.cronTasks.get(channelId);
    if (tasks) {
      tasks.startTask.stop();
      tasks.stopTask.stop();
      this.cronTasks.delete(channelId);
      logger.info('Unscheduled preload tasks', { channelId });
    }
  }

  /**
   * 启动预加载
   */
  async startPreload(config) {
    try {
      const { channelId } = config;
      
      // 获取RTMP URL
      const rtmpUrl = await this.fetchChannelRtmpUrl(channelId);
      
      if (!rtmpUrl) {
        logger.error('Cannot start preload: RTMP URL not found', { channelId });
        return;
      }
      
      // 调用SimpleStreamManager启动预加载
      await this.streamManager.startPreload(channelId, rtmpUrl);
      
      logger.info('Preload started successfully', { channelId, rtmpUrl });
    } catch (error) {
      logger.error('Failed to start preload', { 
        channelId: config.channelId, 
        error: error.message 
      });
    }
  }

  /**
   * 停止预加载
   */
  async stopPreload(channelId) {
    try {
      await this.streamManager.stopPreload(channelId);
      logger.info('Preload stopped successfully', { channelId });
    } catch (error) {
      logger.error('Failed to stop preload', { 
        channelId, 
        error: error.message 
      });
    }
  }

  /**
   * 重新加载配置（热更新）
   */
  async reload() {
    try {
      logger.info('Reloading PreloadScheduler...');
      
      // 1. 停止所有现有任务
      this.stopAllTasks();
      
      // 2. 重新初始化
      await this.start();
      
      logger.info('PreloadScheduler reloaded successfully');
    } catch (error) {
      logger.error('Failed to reload PreloadScheduler', { error: error.message });
      throw error;
    }
  }

  /**
   * 停止所有定时任务
   */
  stopAllTasks() {
    for (const channelId of this.cronTasks.keys()) {
      this.unscheduleChannel(channelId);
    }
    
    logger.info('All preload tasks stopped');
  }

  /**
   * 获取北京时间
   */
  getBeijingTime() {
    return moment().tz('Asia/Shanghai');
  }

  /**
   * 获取调度器状态
   */
  getStatus() {
    const tasks = [];
    
    for (const [channelId, taskInfo] of this.cronTasks) {
      tasks.push({
        channelId,
        hasStartTask: !!taskInfo.startTask,
        hasStopTask: !!taskInfo.stopTask
      });
    }
    
    return {
      isRunning: true,
      totalScheduledChannels: this.cronTasks.size,
      currentTime: this.getBeijingTime().format('YYYY-MM-DD HH:mm:ss'),
      tasks
    };
  }

  /**
   * 停止调度器
   */
  stop() {
    this.stopAllTasks();
    logger.info('PreloadScheduler stopped');
  }
}

module.exports = PreloadScheduler;
