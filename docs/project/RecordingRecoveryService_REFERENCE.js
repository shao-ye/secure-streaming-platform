/**
 * 录制文件恢复服务 - 完整参考实现
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
const logger = require('../utils/logger')('RecordingRecoveryService');

class RecordingRecoveryService {
  constructor(streamManager, systemConfig = {}) {
    this.streamManager = streamManager;
    this.isRunning = false;
    this.config = {
      enabled: true,
      delayStart: 5000,
      // 从系统配置读取扫描时长，默认48小时，范围12-168小时
      scanRecentHours: systemConfig.recoveryScanHours || 48,
      timeoutPerFile: 300000
    };
    
    logger.info('RecordingRecoveryService initialized', {
      scanRecentHours: this.config.scanRecentHours
    });
  }

  // ==================== 启动入口 ====================
  
  async startup() {
    if (!this.config.enabled || this.isRunning) return;
    
    setTimeout(() => {
      this.runRecovery().catch(err => 
        logger.error('Recovery failed', { error: err.message })
      );
    }, this.config.delayStart);
    
    logger.info('Recovery service scheduled', { delayStart: this.config.delayStart });
  }

  // ==================== 主执行流程 ====================
  
  async runRecovery() {
    this.isRunning = true;
    const startTime = Date.now();
    logger.info('🔧 Starting recording file recovery...');

    try {
      const filesToFix = await this.findFilesNeedingRecovery();
      
      if (filesToFix.length === 0) {
        logger.info('No files need recovery');
        return;
      }

      logger.info(`Found ${filesToFix.length} files to process`);
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
              files.push({ path: filePath, type: 'temp', channel });
            } else {
              // 识别错误结束时间文件
              const match = fileName.match(/_(\d{6})_to_(\d{6})\.mp4$/);
              if (match && channel.recordConfig && 
                  this.isPresetEndTime(match[2], channel.recordConfig.endTime)) {
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
    for (const [channelId, config] of this.streamManager.recordingConfigs.entries()) {
      channels.push({
        id: channelId,
        name: config.channelName,
        storagePath: config.storagePath || '/var/www/recordings',
        recordConfig: config
      });
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
      const match = path.basename(file.path).match(/(.+)_(.+)_(\d{8})_temp_(\d{3})\.mp4$/);
      if (!match) return;
      
      const [, channelName, channelId, date] = match;
      const duration = await this.getVideoDuration(file.path);
      const stat = fs.statSync(file.path);
      const fileEndTime = new Date(stat.mtimeMs);
      const fileStartTime = new Date(fileEndTime.getTime() - duration * 1000);
      
      const newFileName = `${channelName}_${channelId}_${date}_${this.formatTime(fileStartTime)}_to_${this.formatTime(fileEndTime)}.mp4`;
      const newPath = path.join(path.dirname(file.path), newFileName);
      
      if (!fs.existsSync(newPath)) {
        fs.renameSync(file.path, newPath);
        logger.info('Temp file renamed', { from: path.basename(file.path), to: newFileName });
      }
    } catch (error) {
      logger.error('Rename temp failed', { file: file.path, error: error.message });
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
