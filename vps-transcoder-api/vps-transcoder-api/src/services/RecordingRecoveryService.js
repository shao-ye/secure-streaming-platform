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
    this.config = {
      enabled: true,
      delayStart: 5000,
      // 从系统配置读取扫描时长，默认48小时，范围12-168小时
      scanRecentHours: systemConfig.recoveryScanHours || 48,
      timeoutPerFile: 300000,
      // 录制目录根路径（从环境变量或默认值）
      recordingsPath: process.env.RECORDINGS_PATH || '/srv/filebrowser/yoyo-k'
    };
    
    logger.info('RecordingRecoveryService initialized', {
      scanRecentHours: this.config.scanRecentHours,
      recordingsPath: this.config.recordingsPath
    });
  }

  // ==================== 启动入口 ====================
  
  async startup() {
    if (!this.config.enabled) {
      logger.warn('⚠️ Recovery service disabled');
      return;
    }
    if (this.isRunning) {
      logger.warn('⚠️ Recovery service already running');
      return;
    }
    
    logger.info('🕒 Recovery service scheduled with smart size detection', { 
      delayStart: this.config.delayStart,
      checkInterval: 30000,  // 30秒后检查大小
      scanRecentHours: this.config.scanRecentHours,
      recordingsPath: this.config.recordingsPath
    });
    
    setTimeout(() => {
      logger.info('🚀 Starting recovery service...');
      this.runRecoveryWithSizeCheck().catch(err => {
        logger.error('Recovery failed', { error: err.message, stack: err.stack });
      });
    }, this.config.delayStart);
  }

  // ==================== 主执行流程 ====================
  
  /**
   * 🔥 新逻辑：基于文件大小增长检测
   * 1. 扫描temp文件并记录初始大小
   * 2. 等待30秒
   * 3. 再次检查大小，未增长的文件进行修复
   */
  async runRecoveryWithSizeCheck() {
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
      await new Promise(resolve => setTimeout(resolve, 30000));

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
            filesToFix.push(file);
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

      // Step 4: 修复停止增长的文件
      logger.info(`🔧 Step 3: Fixing ${filesToFix.length} stopped file(s)...`);
      let renamed = 0, repaired = 0, failed = 0;

      for (const file of filesToFix) {
        await new Promise(resolve => setImmediate(resolve));
        
        try {
          const isPlayable = await this.checkFilePlayable(file.path);
          if (!isPlayable) {
            await this.repairFileFormat(file.path);
            repaired++;
          }
          await this.fixFileName(file);
          renamed++;
        } catch (error) {
          logger.error('Processing failed', { file: file.path, error: error.message });
          failed++;
        }
      }

      logger.info('Recovery completed', {
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        scanned: tempFiles.length,
        fixed: filesToFix.length,
        renamed,
        repaired,
        failed
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 旧方法：保留用于手动触发API（不等待30秒）
   */
  async runRecovery() {
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

      let renamed = 0, repaired = 0, failed = 0;

      for (const file of filesToFix) {
        await new Promise(resolve => setImmediate(resolve));
        
        try {
          const isPlayable = await this.checkFilePlayable(file.path);
          if (!isPlayable) {
            await this.repairFileFormat(file.path);
            repaired++;
          }
          await this.fixFileName(file);
          renamed++;
        } catch (error) {
          logger.error('Processing failed', { file: file.path, error: error.message });
          failed++;
        }
      }

      logger.info('Recovery completed', {
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        total: filesToFix.length,
        renamed,
        repaired,
        failed
      });
    } finally {
      this.isRunning = false;
    }
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
  
  async fixFileName(file) {
    if (file.type === 'temp') {
      await this.renameTempFile(file);
    } else if (file.type === 'wrongEndTime') {
      await this.fixEndTime(file);
    }
  }

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
          return;
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
          fs.renameSync(file.path, newPath);
          logger.info('✅ Temp file renamed (old format)', { from: path.basename(file.path), to: newFileName });
        } else {
          logger.warn(`⚠️ Target file already exists: ${newFileName}`);
        }
        return;
      }
      
      logger.info('✅ Matched new format');
      // 新格式处理：使用文件名中的开始时间
      const [, channelName, channelId, date, startTime] = match;
      const duration = await this.getVideoDuration(file.path);
      const stat = fs.statSync(file.path);
      const fileEndTime = new Date(stat.mtimeMs);
      
      // 使用文件名中的开始时间（更准确）
      const newFileName = `${channelName}_${channelId}_${date}_${startTime}_to_${this.formatTime(fileEndTime)}.mp4`;
      const newPath = path.join(path.dirname(file.path), newFileName);
      
      logger.info(`🎯 Target name: ${newFileName}`);
      
      if (!fs.existsSync(newPath)) {
        fs.renameSync(file.path, newPath);
        logger.info('✅ Temp file renamed', { from: path.basename(file.path), to: newFileName });
      } else {
        logger.warn(`⚠️ Target file already exists: ${newFileName}`);
      }
    } catch (error) {
      logger.error('❌ Rename temp failed', { file: file.path, error: error.message, stack: error.stack });
    }
  }

  async fixEndTime(file) {
    try {
      const match = path.basename(file.path).match(/_(\d{6})_to_(\d{6})\.mp4$/);
      if (!match) return;
      
      const stat = fs.statSync(file.path);
      const endTimeStr = this.formatTime(new Date(stat.mtimeMs));
      const newFileName = path.basename(file.path).replace(/_to_\d{6}\.mp4$/, `_to_${endTimeStr}.mp4`);
      
      if (newFileName === path.basename(file.path)) return;
      
      const newPath = path.join(path.dirname(file.path), newFileName);
      if (!fs.existsSync(newPath)) {
        fs.renameSync(file.path, newPath);
        logger.info('End time fixed', { from: path.basename(file.path), to: newFileName });
      }
    } catch (error) {
      logger.error('Fix end time failed', { file: file.path, error: error.message });
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
      const ffmpeg = spawn('ffmpeg', [
        '-i', filePath,
        '-c', 'copy',
        '-movflags', 'faststart',
        '-y',
        tempPath
      ]);

      ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, filePath);
          logger.info('File format repaired', { filePath });
          resolve();
        } else {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
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
