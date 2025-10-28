const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * 视频文件定时清理调度器
 * 
 * 核心功能：
 * 1. 定时清理：每天凌晨1点（北京时间）
 * 2. 清理规则：删除N天前的视频文件
 * 3. 安全机制：只删除严格匹配YYYYMMDD格式的文件夹
 */
class VideoCleanupScheduler {
  constructor() {
    this.cronTask = null;
    this.workersApiUrl = process.env.WORKERS_API_URL || 'https://yoyoapi.5202021.xyz';
    this.workersApiKey = process.env.WORKERS_API_KEY;
    this.isRunning = false;
  }
  
  /**
   * 启动定时任务
   */
  async start() {
    if (this.isRunning) {
      logger.warn('VideoCleanupScheduler already running');
      return;
    }
    
    try {
      // 获取配置
      const config = await this.fetchCleanupConfig();
      
      if (!config.enabled) {
        logger.info('Video cleanup is disabled');
        return;
      }
      
      // 定时任务：每天凌晨1点执行
      this.cronTask = cron.schedule('0 1 * * *', async () => {
        logger.info('Video cleanup task triggered by schedule');
        await this.executeCleanup();
      }, {
        scheduled: true,
        timezone: 'Asia/Shanghai'
      });
      
      this.isRunning = true;
      
      logger.info('VideoCleanupScheduler started', {
        timezone: 'Asia/Shanghai',
        schedule: '0 1 * * *',
        enabled: config.enabled,
        retentionDays: config.retentionDays
      });
    } catch (error) {
      logger.error('Failed to start VideoCleanupScheduler', {
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * 停止定时任务
   */
  async stop() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    this.isRunning = false;
    logger.info('VideoCleanupScheduler stopped');
  }
  
  /**
   * 执行清理任务
   */
  async executeCleanup() {
    const startTime = Date.now();
    const result = {
      success: true,
      totalChannels: 0,
      processedChannels: 0,
      deletedFolders: 0,
      errors: []
    };
    
    try {
      // 1. 获取清理配置
      const config = await this.fetchCleanupConfig();
      
      if (!config.enabled) {
        logger.info('Cleanup skipped: disabled in config');
        return result;
      }
      
      // 2. 计算清理日期（今天 - 保留天数）
      const cutoffDate = moment().tz('Asia/Shanghai')
        .subtract(config.retentionDays, 'days')
        .format('YYYYMMDD');
      
      logger.info('Starting video cleanup', {
        cutoffDate,
        retentionDays: config.retentionDays
      });
      
      // 3. 获取所有频道配置
      const channels = await this.fetchChannelConfigs();
      result.totalChannels = channels.length;
      
      // 4. 遍历每个频道进行清理
      for (const channel of channels) {
        try {
          if (channel.recordConfig && channel.recordConfig.enabled) {
            // 存储路径需要加上频道ID
            const baseStoragePath = channel.recordConfig.storagePath || `/var/www/recordings`;
            const storagePath = path.join(baseStoragePath, channel.id);
            
            const channelResult = await this.cleanupChannelVideos(
              channel.id,
              storagePath,
              cutoffDate
            );
            
            result.processedChannels++;
            result.deletedFolders += channelResult.deletedFolders;
          }
        } catch (error) {
          result.errors.push({
            channelId: channel.id,
            error: error.message
          });
          logger.error('Failed to cleanup channel', {
            channelId: channel.id,
            error: error.message
          });
        }
      }
      
      // 5. 记录清理结果
      const duration = Date.now() - startTime;
      logger.info('Video cleanup completed', {
        ...result,
        duration: `${duration}ms`
      });
      
      return result;
    } catch (error) {
      logger.error('Video cleanup failed', {
        error: error.message
      });
      result.success = false;
      result.errors.push({ error: error.message });
      throw error;
    }
  }
  
  /**
   * 清理单个频道的视频文件
   */
  async cleanupChannelVideos(channelId, storagePath, cutoffDate) {
    const result = {
      deletedFolders: 0
    };
    
    // 1. 检查存储路径是否存在
    if (!fs.existsSync(storagePath)) {
      logger.warn('Storage path not found', { channelId, storagePath });
      return result;
    }
    
    // 2. 读取目录内容
    const items = fs.readdirSync(storagePath);
    
    // 3. 遍历所有项
    for (const item of items) {
      try {
        // 4. 验证是否为日期格式的文件夹
        if (!this.isValidDateFolder(item)) {
          continue; // 跳过非日期格式的文件夹
        }
        
        // 5. 比较日期
        if (item <= cutoffDate) {
          const folderPath = path.join(storagePath, item);
          
          // 确认是目录
          const stats = fs.statSync(folderPath);
          if (!stats.isDirectory()) {
            continue;
          }
          
          // 6. 删除文件夹
          fs.rmSync(folderPath, { recursive: true, force: true });
          
          result.deletedFolders++;
          
          logger.info('Deleted date folder', {
            channelId,
            folder: item,
            path: folderPath
          });
        }
      } catch (error) {
        logger.error('Failed to delete folder', {
          channelId,
          folder: item,
          error: error.message
        });
      }
    }
    
    return result;
  }
  
  /**
   * 验证是否为有效的日期文件夹
   * 格式：YYYYMMDD
   * 年份：19xx 或 20xx
   * 月份：01-12
   * 日期：01-31
   */
  isValidDateFolder(folderName) {
    return /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(folderName);
  }
  
  /**
   * 获取清理配置
   */
  async fetchCleanupConfig() {
    try {
      const response = await axios.get(
        `${this.workersApiUrl}/api/admin/cleanup/config`,
        {
          headers: {
            'X-API-Key': this.workersApiKey
          },
          timeout: 10000
        }
      );
      
      if (response.data && response.data.status === 'success') {
        return response.data.data;
      }
      
      // 如果API失败，返回默认配置
      logger.warn('Failed to fetch cleanup config, using defaults');
      return {
        enabled: true,
        retentionDays: 2
      };
    } catch (error) {
      logger.error('Failed to fetch cleanup config', {
        error: error.message
      });
      // 返回默认配置
      return {
        enabled: true,
        retentionDays: 2
      };
    }
  }
  
  /**
   * 获取所有频道配置
   */
  async fetchChannelConfigs() {
    try {
      const response = await axios.get(
        `${this.workersApiUrl}/api/admin/streams`,
        {
          headers: {
            'X-API-Key': this.workersApiKey
          },
          timeout: 10000
        }
      );
      
      if (response.data && response.data.status === 'success') {
        return response.data.data.streams || [];
      }
      
      throw new Error('Failed to fetch channel configs');
    } catch (error) {
      logger.error('Failed to fetch channel configs', {
        error: error.message
      });
      return [];
    }
  }
}

module.exports = VideoCleanupScheduler;
