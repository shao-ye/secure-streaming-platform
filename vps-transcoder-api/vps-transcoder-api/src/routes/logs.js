const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

// VPS实际使用PM2管理日志
const PM2_LOG_DIR = '/var/log/transcoder';
const WINSTON_LOG_DIR = '/var/log/vps-transcoder';
const MAX_LINES = 100; // 默认返回最近100行

/**
 * 使用tail命令读取日志文件的最后N行（避免读取大文件）
 * @param {string} filePath - 日志文件路径
 * @param {number} lines - 读取的行数
 * @returns {Promise<Array>} 日志行数组
 */
async function readLastLines(filePath, lines = MAX_LINES) {
  try {
    // 使用tail命令高效读取大文件的最后几行
    const { stdout } = await execAsync(`tail -n ${lines} "${filePath}" 2>/dev/null || echo ""`);
    const allLines = stdout.split('\n').filter(line => line.trim());
    return allLines;
  } catch (error) {
    logger.warn(`读取日志文件失败: ${filePath}`, error.message);
    return [];
  }
}

/**
 * 解析PM2 JSON格式的日志行
 * @param {string} line - 日志行
 * @returns {Object|null} 解析后的日志对象，如果解析失败返回null
 */
function parsePM2LogLine(line) {
  try {
    const parsed = JSON.parse(line);
    
    // PM2日志格式: {"message":"...", "timestamp":"...", "type":"out/err", ...}
    if (parsed.message) {
      // 提取message中的实际日志内容（去除ANSI颜色代码）
      let cleanMessage = parsed.message.replace(/\u001b\[\d+m/g, '');
      
      // 尝试从message中提取时间戳和级别
      const logMatch = cleanMessage.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\]: (.+)$/);
      
      if (logMatch) {
        return {
          timestamp: logMatch[1],
          level: logMatch[2],
          message: logMatch[3].trim()
        };
      }
      
      // 如果没有匹配到Winston格式，使用PM2的timestamp
      return {
        timestamp: parsed.timestamp || new Date().toISOString(),
        level: parsed.type === 'err' ? 'error' : 'info',
        message: cleanMessage.trim()
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * GET /api/logs/combined
 * 获取综合日志（PM2输出日志）
 */
router.get('/combined', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || MAX_LINES;
    const logFile = path.join(PM2_LOG_DIR, 'pm2-out.log');
    
    const rawLines = await readLastLines(logFile, lines);
    const logs = rawLines.map(parsePM2LogLine).filter(log => log !== null).reverse();
    
    res.json({
      status: 'success',
      data: {
        logs: logs,
        total: logs.length,
        file: 'pm2-out.log'
      }
    });
  } catch (error) {
    logger.error('读取综合日志失败:', error);
    res.status(500).json({
      status: 'error',
      message: '读取日志失败: ' + error.message
    });
  }
});

/**
 * GET /api/logs/error
 * 获取错误日志（PM2错误日志）
 */
router.get('/error', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || MAX_LINES;
    const logFile = path.join(PM2_LOG_DIR, 'pm2-error.log');
    
    const rawLines = await readLastLines(logFile, lines);
    const logs = rawLines.map(parsePM2LogLine).filter(log => log !== null).reverse();
    
    res.json({
      status: 'success',
      data: {
        logs: logs,
        total: logs.length,
        file: 'pm2-error.log'
      }
    });
  } catch (error) {
    logger.error('读取错误日志失败:', error);
    res.status(500).json({
      status: 'error',
      message: '读取日志失败: ' + error.message
    });
  }
});

/**
 * GET /api/logs/recent
 * 获取最近的日志（PM2输出日志，过滤FFmpeg噪音）
 */
router.get('/recent', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 50;
    const logFile = path.join(PM2_LOG_DIR, 'pm2-out.log');
    
    const rawLines = await readLastLines(logFile, lines * 3); // 读取更多行以便过滤
    let logs = rawLines.map(parsePM2LogLine).filter(log => log !== null);
    
    // 过滤掉FFmpeg的进度输出（噪音日志）
    logs = logs.filter(log => {
      return !log.message.includes('FFmpeg stderr') && 
             !log.message.startsWith('frame=') &&
             !log.message.includes('bitrate=');
    });
    
    // 倒序并限制数量
    logs = logs.reverse().slice(0, lines);
    
    // 只返回必要字段，简化前端显示
    const simplifiedLogs = logs.map(log => ({
      timestamp: log.timestamp,
      level: log.level,
      message: log.message
    }));
    
    res.json({
      status: 'success',
      data: {
        logs: simplifiedLogs,
        total: simplifiedLogs.length
      }
    });
  } catch (error) {
    logger.error('读取最近日志失败:', error);
    res.status(500).json({
      status: 'error',
      message: '读取日志失败: ' + error.message
    });
  }
});

/**
 * DELETE /api/logs/clear
 * 清空PM2日志文件（需要认证）
 */
router.delete('/clear', async (req, res) => {
  try {
    const logFiles = ['pm2-out.log', 'pm2-error.log'];
    
    for (const file of logFiles) {
      const filePath = path.join(PM2_LOG_DIR, file);
      try {
        await fs.writeFile(filePath, '');
        logger.info(`PM2日志文件已清空: ${file}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn(`清空PM2日志文件失败: ${file}`, error);
        }
      }
    }
    
    res.json({
      status: 'success',
      message: 'PM2日志已清空',
      data: {
        clearedFiles: logFiles
      }
    });
  } catch (error) {
    logger.error('清空PM2日志失败:', error);
    res.status(500).json({
      status: 'error',
      message: '清空日志失败: ' + error.message
    });
  }
});

module.exports = router;
