/**
 * Cloudflare R2登录日志存储服务
 * 按日期分层存储，支持高效查询和统计分析
 */

import { generateRandomString } from './crypto.js';

export class R2LoginLogger {
  constructor(bucket) {
    this.bucket = bucket;
  }

  /**
   * 记录登录日志到R2存储
   * @param {Object} logEntry - 日志条目
   */
  async recordLogin(logEntry) {
    try {
      const date = new Date(logEntry.timestamp);
      const filePath = this.getLogFilePath(date);
      
      // 获取当日日志文件
      let dailyLogs = await this.getDailyLogs(filePath);
      
      // 添加新日志
      dailyLogs.logs.push(logEntry);
      dailyLogs.stats = this.calculateStats(dailyLogs.logs);
      dailyLogs.date = date.toISOString().split('T')[0];
      
      // 保存到R2
      await this.saveDailyLogs(filePath, dailyLogs);
      await this.updateMetadata(date, dailyLogs);
      
      console.log('Login log recorded to R2:', { 
        username: logEntry.username, 
        status: logEntry.status,
        filePath 
      });
    } catch (error) {
      console.error('Failed to record login log to R2:', error);
      throw error;
    }
  }

  /**
   * 获取指定日期范围的登录日志
   * @param {Date} startDate - 开始日期
   * @param {Date} endDate - 结束日期
   * @param {number} limit - 限制条数
   * @param {number} offset - 偏移量
   */
  async getLoginLogs(startDate, endDate, limit = 100, offset = 0) {
    try {
      const logs = [];
      const dateRange = this.getDateRange(startDate, endDate);
      
      // 按日期倒序处理，优先获取最新日志
      dateRange.reverse();
      
      for (const date of dateRange) {
        const filePath = this.getLogFilePath(date);
        const dailyLogs = await this.getDailyLogs(filePath);
        
        if (dailyLogs.logs && dailyLogs.logs.length > 0) {
          logs.push(...dailyLogs.logs);
        }
        
        // 如果已经获取足够的日志，可以提前退出
        if (logs.length >= offset + limit) {
          break;
        }
      }
      
      // 按时间倒序排列
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return {
        logs: logs.slice(offset, offset + limit),
        total: logs.length,
        hasMore: logs.length > offset + limit,
        dateRange: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0]
        }
      };
    } catch (error) {
      console.error('Failed to get login logs from R2:', error);
      throw error;
    }
  }

  /**
   * 获取日志文件路径
   * @param {Date} date - 日期
   */
  getLogFilePath(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}/login-logs.json`;
  }

  /**
   * 获取元数据文件路径
   * @param {Date} date - 日期
   */
  getMetadataPath(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}/metadata.json`;
  }

  /**
   * 获取当日日志数据
   * @param {string} filePath - 文件路径
   */
  async getDailyLogs(filePath) {
    try {
      const object = await this.bucket.get(filePath);
      if (!object) {
        // 文件不存在，返回空的日志结构
        return {
          date: '',
          logs: [],
          stats: {
            total: 0,
            success: 0,
            failed: 0,
            uniqueUsers: 0,
            uniqueIPs: 0
          }
        };
      }
      
      const text = await object.text();
      return JSON.parse(text);
    } catch (error) {
      console.warn('Failed to get daily logs, creating new:', { filePath, error: error.message });
      return {
        date: '',
        logs: [],
        stats: {
          total: 0,
          success: 0,
          failed: 0,
          uniqueUsers: 0,
          uniqueIPs: 0
        }
      };
    }
  }

  /**
   * 保存当日日志数据
   * @param {string} filePath - 文件路径
   * @param {Object} dailyLogs - 日志数据
   */
  async saveDailyLogs(filePath, dailyLogs) {
    try {
      const content = JSON.stringify(dailyLogs, null, 2);
      await this.bucket.put(filePath, content, {
        httpMetadata: {
          contentType: 'application/json',
        },
      });
    } catch (error) {
      console.error('Failed to save daily logs:', { filePath, error: error.message });
      throw error;
    }
  }

  /**
   * 更新元数据
   * @param {Date} date - 日期
   * @param {Object} dailyLogs - 日志数据
   */
  async updateMetadata(date, dailyLogs) {
    try {
      const metadataPath = this.getMetadataPath(date);
      const metadata = {
        date: date.toISOString().split('T')[0],
        totalLogs: dailyLogs.stats.total,
        successCount: dailyLogs.stats.success,
        failedCount: dailyLogs.stats.failed,
        uniqueUsers: dailyLogs.stats.uniqueUsers,
        uniqueIPs: dailyLogs.stats.uniqueIPs,
        firstLogTime: dailyLogs.logs.length > 0 ? dailyLogs.logs[0].timestamp : null,
        lastLogTime: dailyLogs.logs.length > 0 ? dailyLogs.logs[dailyLogs.logs.length - 1].timestamp : null,
        fileSize: JSON.stringify(dailyLogs).length,
        lastUpdated: new Date().toISOString()
      };
      
      const content = JSON.stringify(metadata, null, 2);
      await this.bucket.put(metadataPath, content, {
        httpMetadata: {
          contentType: 'application/json',
        },
      });
    } catch (error) {
      console.warn('Failed to update metadata:', { date, error: error.message });
      // 元数据更新失败不应该影响主要功能
    }
  }

  /**
   * 计算统计数据
   * @param {Array} logs - 日志数组
   */
  calculateStats(logs) {
    const stats = {
      total: logs.length,
      success: 0,
      failed: 0,
      uniqueUsers: new Set(),
      uniqueIPs: new Set()
    };

    logs.forEach(log => {
      if (log.status === 'success') {
        stats.success++;
      } else {
        stats.failed++;
      }
      
      if (log.username) {
        stats.uniqueUsers.add(log.username);
      }
      
      if (log.ip) {
        stats.uniqueIPs.add(log.ip);
      }
    });

    return {
      total: stats.total,
      success: stats.success,
      failed: stats.failed,
      uniqueUsers: stats.uniqueUsers.size,
      uniqueIPs: stats.uniqueIPs.size
    };
  }

  /**
   * 获取日期范围数组
   * @param {Date} startDate - 开始日期
   * @param {Date} endDate - 结束日期
   */
  getDateRange(startDate, endDate) {
    const dates = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
  }

  /**
   * 创建日志条目
   * @param {string} username - 用户名
   * @param {Object} request - 请求对象
   * @param {boolean} success - 是否成功
   * @param {Object} details - 详细信息
   */
  static createLogEntry(username, request, success, details = {}) {
    const timestamp = new Date().toISOString();
    const clientIP = request.headers.get('CF-Connecting-IP') || 
                     request.headers.get('X-Forwarded-For') || 
                     request.headers.get('X-Real-IP') || 
                     '未知';
    
    const userAgent = request.headers.get('User-Agent') || '未知';
    const country = request.cf?.country || '未知';
    const city = request.cf?.city || '未知';
    
    return {
      id: `log_${Date.now()}_${generateRandomString(8)}`,
      username: username || '未知',
      ip: clientIP,
      userAgent: userAgent,
      timestamp: timestamp,
      status: success ? 'success' : 'failed',
      location: `${country} ${city}`,
      details: details
    };
  }
}
