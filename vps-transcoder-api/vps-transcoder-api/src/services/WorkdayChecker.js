const cron = require('node-cron');
const logger = require('../utils/logger');

/**
 * 工作日检测服务
 * 使用Timor API获取中国法定节假日数据
 * 
 * 核心功能：
 * 1. 检查指定日期是否为工作日
 * 2. 预取月度数据（启动时+每月25号）
 * 3. 失败自动重试机制
 * 4. 内存缓存优化性能
 */
class WorkdayChecker {
  constructor() {
    // Timor API配置
    this.apiUrl = 'https://timor.tech/api/holiday/info';  // 🆕 修正为info端点
    
    // 内存缓存 Map<'YYYY-MM-DD', {isWorkday: boolean, cachedAt: timestamp}>
    this.cache = new Map();
    
    // 🆕 失败月份跟踪 Set<'YYYY-MM'>
    this.failedMonths = new Set();
    
    // 缓存有效期（24小时）
    this.cacheExpiry = 24 * 60 * 60 * 1000;
  }

  /**
   * 初始化工作日检测器
   * - 预取当前月和下个月数据
   * - 设置每天凌晨1点定时任务
   */
  async initialize() {
    try {
      logger.info('Initializing WorkdayChecker...');
      
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      
      // 预取当前月
      await this.prefetchMonthData(currentYear, currentMonth);
      
      // 预取下个月
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      await this.prefetchMonthData(nextYear, nextMonth);
      
      // 🆕 设置定时任务：每天凌晨1点执行
      cron.schedule('0 1 * * *', async () => {
        const today = new Date();
        
        // 步骤1: 如果是25号，预取下月数据
        if (today.getDate() === 25) {
          const next = this.getNextMonth();
          logger.info('Scheduled task: Prefetching next month data', next);
          await this.prefetchMonthData(next.year, next.month);
        }
        
        // 步骤2: 🆕 重试失败的月份
        if (this.failedMonths.size > 0) {
          logger.info(`Retrying failed months: ${Array.from(this.failedMonths).join(', ')}`);
          
          for (const monthKey of Array.from(this.failedMonths)) {
            const [year, month] = monthKey.split('-').map(Number);
            await this.prefetchMonthData(year, month);
            // 成功会自动从failedMonths移除
          }
        }
      }, {
        timezone: 'Asia/Shanghai'
      });
      
      logger.info('✅ WorkdayChecker initialized successfully', {
        cachedDays: this.cache.size,
        failedMonths: Array.from(this.failedMonths)
      });
      
    } catch (error) {
      logger.error('Failed to initialize WorkdayChecker', { error: error.message });
      throw error;
    }
  }

  /**
   * 检查指定日期是否为工作日
   * @param {Date} date - 要检查的日期（默认今天）
   * @returns {Promise<boolean>} - true=工作日, false=非工作日
   */
  async isWorkday(date = new Date()) {
    const dateStr = this.formatDate(date);
    
    // 1. 检查缓存
    if (this.cache.has(dateStr)) {
      const cached = this.cache.get(dateStr);
      
      // 检查缓存是否过期
      if (Date.now() - cached.cachedAt < this.cacheExpiry) {
        logger.debug('Workday check from cache', { date: dateStr, isWorkday: cached.isWorkday });
        return cached.isWorkday;
      }
    }
    
    // 2. 调用API获取
    try {
      // 🆕 添加User-Agent避免Cloudflare Bot防护
      const response = await fetch(`${this.apiUrl}/${dateStr}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // 解析工作日状态
      // type: 0=工作日, 1=周末, 2=节假日, 3=调休工作日
      const isWorkday = (data.type.type === 0 || data.type.type === 3);
      
      // 3. 写入缓存
      this.cache.set(dateStr, {
        isWorkday,
        cachedAt: Date.now()
      });
      
      logger.info('Workday check from API', { 
        date: dateStr, 
        isWorkday,
        type: data.type.name 
      });
      
      return isWorkday;
      
    } catch (error) {
      // 4. 容错：降级为基础模式
      logger.warn('⚠️ Workday API failed, falling back to basic mode', { 
        date: dateStr,
        error: error.message 
      });
      
      // 降级为基础模式：周一至周五视为工作日
      // 注意：此模式无法识别法定节假日和调休
      const dayOfWeek = date.getDay();
      const isWorkday = dayOfWeek >= 1 && dayOfWeek <= 5;
      
      // 🆕 基础模式结果也要缓存（避免重复判断）
      this.cache.set(dateStr, {
        isWorkday,
        cachedAt: Date.now()
      });
      
      return isWorkday;
    }
  }

  /**
   * 预取月度数据
   * @param {number} year - 年份
   * @param {number} month - 月份（1-12）
   */
  async prefetchMonthData(year, month) {
    const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
    
    try {
      logger.info(`Prefetching workday data for ${monthKey}...`);
      
      // 获取该月的天数
      const daysInMonth = new Date(year, month, 0).getDate();
      
      // 并发获取所有日期（限制并发数为10）
      const batchSize = 10;
      for (let i = 1; i <= daysInMonth; i += batchSize) {
        const promises = [];
        
        for (let day = i; day < Math.min(i + batchSize, daysInMonth + 1); day++) {
          const date = new Date(year, month - 1, day);
          promises.push(this.isWorkday(date));
        }
        
        await Promise.allSettled(promises);
      }
      
      logger.info(`✅ ${monthKey} workday data prefetched successfully`);
      
      // 🆕 成功后从失败列表移除
      this.failedMonths.delete(monthKey);
      
    } catch (error) {
      logger.error(`❌ Failed to prefetch ${monthKey} workday data`, { 
        error: error.message 
      });
      
      // 🆕 失败时添加到待重试列表
      this.failedMonths.add(monthKey);
    }
  }

  /**
   * 获取下个月的年份和月份
   * @returns {{year: number, month: number}}
   */
  getNextMonth() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    if (currentMonth === 12) {
      return { year: currentYear + 1, month: 1 };
    } else {
      return { year: currentYear, month: currentMonth + 1 };
    }
  }

  /**
   * 获取下个月的key（用于failedMonths）
   * @returns {string} 'YYYY-MM'
   */
  getNextMonthKey() {
    const next = this.getNextMonth();
    return `${next.year}-${next.month.toString().padStart(2, '0')}`;
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   * @param {Date} date
   * @returns {string}
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

module.exports = WorkdayChecker;
