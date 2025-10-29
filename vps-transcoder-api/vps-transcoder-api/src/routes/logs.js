const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const LOG_DIR = '/var/log/vps-transcoder';
const MAX_LINES = 100; // 默认返回最近100行

/**
 * 读取日志文件的最后N行
 * @param {string} filePath - 日志文件路径
 * @param {number} lines - 读取的行数
 * @returns {Promise<Array>} 日志行数组
 */
async function readLastLines(filePath, lines = MAX_LINES) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const allLines = content.split('\n').filter(line => line.trim());
    return allLines.slice(-lines);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * 解析JSON格式的日志行
 * @param {string} line - 日志行
 * @returns {Object} 解析后的日志对象
 */
function parseLogLine(line) {
  try {
    const parsed = JSON.parse(line);
    return {
      timestamp: parsed.timestamp,
      level: parsed.level,
      message: parsed.message,
      service: parsed.service,
      meta: parsed
    };
  } catch (error) {
    // 如果不是JSON格式，尝试解析普通文本格式
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\]: (.+)$/);
    if (match) {
      return {
        timestamp: match[1],
        level: match[2],
        message: match[3]
      };
    }
    
    // 如果都解析失败，返回原始行
    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: line
    };
  }
}

/**
 * GET /api/logs/combined
 * 获取综合日志
 */
router.get('/combined', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || MAX_LINES;
    const logFile = path.join(LOG_DIR, 'combined.log');
    
    const rawLines = await readLastLines(logFile, lines);
    const logs = rawLines.map(parseLogLine).reverse(); // 倒序，最新的在前
    
    res.json({
      status: 'success',
      data: {
        logs: logs,
        total: logs.length,
        file: 'combined.log'
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
 * 获取错误日志
 */
router.get('/error', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || MAX_LINES;
    const logFile = path.join(LOG_DIR, 'error.log');
    
    const rawLines = await readLastLines(logFile, lines);
    const logs = rawLines.map(parseLogLine).reverse();
    
    res.json({
      status: 'success',
      data: {
        logs: logs,
        total: logs.length,
        file: 'error.log'
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
 * 获取最近的日志（混合所有级别）
 */
router.get('/recent', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 50;
    const logFile = path.join(LOG_DIR, 'combined.log');
    
    const rawLines = await readLastLines(logFile, lines);
    const logs = rawLines.map(parseLogLine).reverse();
    
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
 * 清空日志文件（需要认证）
 */
router.delete('/clear', async (req, res) => {
  try {
    const logFiles = ['combined.log', 'error.log', 'exceptions.log', 'rejections.log'];
    
    for (const file of logFiles) {
      const filePath = path.join(LOG_DIR, file);
      try {
        await fs.writeFile(filePath, '');
        logger.info(`日志文件已清空: ${file}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn(`清空日志文件失败: ${file}`, error);
        }
      }
    }
    
    res.json({
      status: 'success',
      message: '日志已清空',
      data: {
        clearedFiles: logFiles
      }
    });
  } catch (error) {
    logger.error('清空日志失败:', error);
    res.status(500).json({
      status: 'error',
      message: '清空日志失败: ' + error.message
    });
  }
});

module.exports = router;
