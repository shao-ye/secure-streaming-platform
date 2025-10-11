const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);
const router = express.Router();
const logger = require('../utils/logger');

/**
 * 部署API路由
 * 支持通过HTTP接口拉取Git代码、授权并执行脚本
 */

// 配置常量
const CONFIG = {
  GIT_DIR: '/tmp/github/secure-streaming-platform/vps-transcoder-api',
  APP_DIR: '/opt/yoyo-transcoder',
  SCRIPTS_DIR: '/opt/yoyo-transcoder/scripts',
  LOGS_DIR: '/opt/yoyo-transcoder/logs'
};

/**
 * 执行系统命令并返回结果
 */
async function executeCommand(command, options = {}) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: options.timeout || 30000,
      cwd: options.cwd || CONFIG.APP_DIR,
      ...options
    });
    
    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      command: command
    };
  } catch (error) {
    logger.error('命令执行失败:', { command, error: error.message });
    return {
      success: false,
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      command: command
    };
  }
}

/**
 * 检查Git仓库状态
 */
router.get('/git/status', async (req, res) => {
  try {
    logger.info('检查Git仓库状态');
    
    // 检查Git目录是否存在
    const gitDirExists = await fs.access(CONFIG.GIT_DIR).then(() => true).catch(() => false);
    
    if (!gitDirExists) {
      return res.json({
        success: false,
        message: 'Git目录不存在',
        data: {
          gitDir: CONFIG.GIT_DIR,
          exists: false
        }
      });
    }
    
    // 获取Git状态
    const gitStatus = await executeCommand('git status --porcelain', { cwd: CONFIG.GIT_DIR });
    const gitBranch = await executeCommand('git branch --show-current', { cwd: CONFIG.GIT_DIR });
    const gitCommit = await executeCommand('git rev-parse HEAD', { cwd: CONFIG.GIT_DIR });
    const gitRemote = await executeCommand('git remote -v', { cwd: CONFIG.GIT_DIR });
    
    res.json({
      success: true,
      message: 'Git状态获取成功',
      data: {
        gitDir: CONFIG.GIT_DIR,
        exists: true,
        status: gitStatus.stdout || 'clean',
        branch: gitBranch.stdout || 'unknown',
        commit: gitCommit.stdout ? gitCommit.stdout.substring(0, 8) : 'unknown',
        remote: gitRemote.stdout || 'unknown',
        lastCheck: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('获取Git状态失败:', error);
    res.status(500).json({
      success: false,
      message: '获取Git状态失败',
      error: error.message
    });
  }
});

/**
 * 拉取最新代码
 */
router.post('/git/pull', async (req, res) => {
  try {
    logger.info('开始拉取最新代码');
    
    const results = [];
    
    // 1. 检查Git目录
    const gitDirExists = await fs.access(CONFIG.GIT_DIR).then(() => true).catch(() => false);
    if (!gitDirExists) {
      return res.status(400).json({
        success: false,
        message: 'Git目录不存在，请先克隆仓库',
        data: { gitDir: CONFIG.GIT_DIR }
      });
    }
    
    // 2. 获取当前状态
    const beforeStatus = await executeCommand('git rev-parse HEAD', { cwd: CONFIG.GIT_DIR });
    results.push({ step: 'before_status', ...beforeStatus });
    
    // 3. 拉取最新代码
    const pullResult = await executeCommand('git pull origin master', { 
      cwd: CONFIG.GIT_DIR,
      timeout: 60000 
    });
    results.push({ step: 'git_pull', ...pullResult });
    
    if (!pullResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Git拉取失败',
        data: { results }
      });
    }
    
    // 4. 获取更新后状态
    const afterStatus = await executeCommand('git rev-parse HEAD', { cwd: CONFIG.GIT_DIR });
    results.push({ step: 'after_status', ...afterStatus });
    
    // 5. 检查是否有更新
    const hasUpdates = beforeStatus.stdout !== afterStatus.stdout;
    
    res.json({
      success: true,
      message: hasUpdates ? '代码已更新' : '代码已是最新版本',
      data: {
        hasUpdates,
        beforeCommit: beforeStatus.stdout ? beforeStatus.stdout.substring(0, 8) : 'unknown',
        afterCommit: afterStatus.stdout ? afterStatus.stdout.substring(0, 8) : 'unknown',
        results,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('拉取代码失败:', error);
    res.status(500).json({
      success: false,
      message: '拉取代码失败',
      error: error.message
    });
  }
});

/**
 * 同步代码到运行目录
 */
router.post('/sync/code', async (req, res) => {
  try {
    logger.info('开始同步代码到运行目录');
    
    const results = [];
    
    // 1. 创建必要目录
    const mkdirResult = await executeCommand(`mkdir -p ${CONFIG.APP_DIR}/src/services ${CONFIG.APP_DIR}/src/routes ${CONFIG.SCRIPTS_DIR}`);
    results.push({ step: 'create_dirs', ...mkdirResult });
    
    // 2. 同步服务文件
    const syncServices = await executeCommand(`cp -r ${CONFIG.GIT_DIR}/src/services/* ${CONFIG.APP_DIR}/src/services/`);
    results.push({ step: 'sync_services', ...syncServices });
    
    // 3. 同步路由文件
    const syncRoutes = await executeCommand(`cp -r ${CONFIG.GIT_DIR}/src/routes/* ${CONFIG.APP_DIR}/src/routes/`);
    results.push({ step: 'sync_routes', ...syncRoutes });
    
    // 4. 同步脚本文件
    const syncScripts = await executeCommand(`cp ${CONFIG.GIT_DIR}/*.sh ${CONFIG.SCRIPTS_DIR}/ 2>/dev/null || true`);
    results.push({ step: 'sync_scripts', ...syncScripts });
    
    // 5. 设置脚本权限
    const chmodResult = await executeCommand(`chmod +x ${CONFIG.SCRIPTS_DIR}/*.sh`);
    results.push({ step: 'chmod_scripts', ...chmodResult });
    
    // 6. 验证同步结果
    const verifyServices = await executeCommand(`ls -la ${CONFIG.APP_DIR}/src/services/`);
    const verifyRoutes = await executeCommand(`ls -la ${CONFIG.APP_DIR}/src/routes/`);
    const verifyScripts = await executeCommand(`ls -la ${CONFIG.SCRIPTS_DIR}/`);
    
    results.push({ step: 'verify_services', ...verifyServices });
    results.push({ step: 'verify_routes', ...verifyRoutes });
    results.push({ step: 'verify_scripts', ...verifyScripts });
    
    res.json({
      success: true,
      message: '代码同步完成',
      data: {
        results,
        syncPaths: {
          services: `${CONFIG.GIT_DIR}/src/services -> ${CONFIG.APP_DIR}/src/services`,
          routes: `${CONFIG.GIT_DIR}/src/routes -> ${CONFIG.APP_DIR}/src/routes`,
          scripts: `${CONFIG.GIT_DIR}/*.sh -> ${CONFIG.SCRIPTS_DIR}/`
        },
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('同步代码失败:', error);
    res.status(500).json({
      success: false,
      message: '同步代码失败',
      error: error.message
    });
  }
});

/**
 * 执行指定脚本
 */
router.post('/execute/script', async (req, res) => {
  try {
    const { scriptName, args = [], timeout = 300000 } = req.body; // 默认5分钟超时
    
    if (!scriptName) {
      return res.status(400).json({
        success: false,
        message: '脚本名称不能为空'
      });
    }
    
    // 安全检查：只允许执行指定的脚本
    const allowedScripts = [
      'integrate-proxy-streaming.sh',
      'enable-proxy-streaming.sh',
      'deploy-proxy-service.sh',
      'setup-proxy-rules.sh'
    ];
    
    if (!allowedScripts.includes(scriptName)) {
      return res.status(400).json({
        success: false,
        message: '不允许执行的脚本',
        allowedScripts
      });
    }
    
    const scriptPath = path.join(CONFIG.SCRIPTS_DIR, scriptName);
    
    // 检查脚本是否存在
    const scriptExists = await fs.access(scriptPath).then(() => true).catch(() => false);
    if (!scriptExists) {
      return res.status(404).json({
        success: false,
        message: '脚本文件不存在',
        scriptPath
      });
    }
    
    logger.info('开始执行脚本:', { scriptName, args, timeout });
    
    // 执行脚本
    const command = `${scriptPath} ${args.join(' ')}`.trim();
    const result = await executeCommand(command, { 
      timeout,
      cwd: CONFIG.APP_DIR 
    });
    
    // 记录执行日志
    const logFile = path.join(CONFIG.LOGS_DIR, `script-${scriptName}-${Date.now()}.log`);
    const logContent = `
=== 脚本执行日志 ===
时间: ${new Date().toISOString()}
脚本: ${scriptName}
参数: ${args.join(' ')}
命令: ${command}
工作目录: ${CONFIG.APP_DIR}
超时设置: ${timeout}ms

=== 执行结果 ===
成功: ${result.success}
标准输出:
${result.stdout}

标准错误:
${result.stderr}

错误信息:
${result.error || '无'}
`;
    
    await fs.writeFile(logFile, logContent).catch(err => 
      logger.warn('写入日志文件失败:', err)
    );
    
    res.json({
      success: result.success,
      message: result.success ? '脚本执行成功' : '脚本执行失败',
      data: {
        scriptName,
        args,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
        logFile,
        executionTime: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('执行脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '执行脚本失败',
      error: error.message
    });
  }
});

/**
 * 重启PM2服务
 */
router.post('/pm2/restart', async (req, res) => {
  try {
    const { serviceName = 'vps-transcoder-api' } = req.body;
    
    logger.info('重启PM2服务:', serviceName);
    
    const results = [];
    
    // 1. 获取当前PM2状态
    const pm2List = await executeCommand('pm2 list');
    results.push({ step: 'pm2_list_before', ...pm2List });
    
    // 2. 重启服务
    const pm2Restart = await executeCommand(`pm2 restart ${serviceName}`);
    results.push({ step: 'pm2_restart', ...pm2Restart });
    
    // 3. 等待服务启动
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 4. 验证服务状态
    const pm2ListAfter = await executeCommand('pm2 list');
    results.push({ step: 'pm2_list_after', ...pm2ListAfter });
    
    // 5. 检查服务健康状态
    const healthCheck = await executeCommand('curl -s http://localhost:3000/health || echo "health_check_failed"');
    results.push({ step: 'health_check', ...healthCheck });
    
    res.json({
      success: pm2Restart.success,
      message: pm2Restart.success ? 'PM2服务重启成功' : 'PM2服务重启失败',
      data: {
        serviceName,
        results,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('重启PM2服务失败:', error);
    res.status(500).json({
      success: false,
      message: '重启PM2服务失败',
      error: error.message
    });
  }
});

/**
 * 一键部署流程
 */
router.post('/deploy/complete', async (req, res) => {
  try {
    const { scriptName = 'integrate-proxy-streaming.sh' } = req.body;
    
    logger.info('开始一键部署流程');
    
    const deploymentSteps = [];
    let overallSuccess = true;
    
    // 步骤1: 拉取最新代码
    try {
      const pullResult = await executeCommand('git pull origin master', { 
        cwd: CONFIG.GIT_DIR,
        timeout: 60000 
      });
      deploymentSteps.push({ step: 'git_pull', ...pullResult });
      if (!pullResult.success) overallSuccess = false;
    } catch (error) {
      deploymentSteps.push({ step: 'git_pull', success: false, error: error.message });
      overallSuccess = false;
    }
    
    // 步骤2: 同步代码
    if (overallSuccess) {
      try {
        await executeCommand(`cp -r ${CONFIG.GIT_DIR}/src/services/* ${CONFIG.APP_DIR}/src/services/`);
        await executeCommand(`cp -r ${CONFIG.GIT_DIR}/src/routes/* ${CONFIG.APP_DIR}/src/routes/`);
        await executeCommand(`cp ${CONFIG.GIT_DIR}/*.sh ${CONFIG.SCRIPTS_DIR}/ 2>/dev/null || true`);
        await executeCommand(`chmod +x ${CONFIG.SCRIPTS_DIR}/*.sh`);
        deploymentSteps.push({ step: 'sync_code', success: true });
      } catch (error) {
        deploymentSteps.push({ step: 'sync_code', success: false, error: error.message });
        overallSuccess = false;
      }
    }
    
    // 步骤3: 执行部署脚本
    if (overallSuccess) {
      try {
        const scriptPath = path.join(CONFIG.SCRIPTS_DIR, scriptName);
        const scriptResult = await executeCommand(scriptPath, { 
          timeout: 300000, // 5分钟
          cwd: CONFIG.APP_DIR 
        });
        deploymentSteps.push({ step: 'execute_script', ...scriptResult });
        if (!scriptResult.success) overallSuccess = false;
      } catch (error) {
        deploymentSteps.push({ step: 'execute_script', success: false, error: error.message });
        overallSuccess = false;
      }
    }
    
    // 步骤4: 重启服务
    if (overallSuccess) {
      try {
        const restartResult = await executeCommand('pm2 restart vps-transcoder-api');
        deploymentSteps.push({ step: 'pm2_restart', ...restartResult });
        if (!restartResult.success) overallSuccess = false;
        
        // 等待服务启动
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        deploymentSteps.push({ step: 'pm2_restart', success: false, error: error.message });
        overallSuccess = false;
      }
    }
    
    // 步骤5: 验证部署结果
    try {
      const healthCheck = await executeCommand('curl -s http://localhost:3000/health');
      const proxyStatus = await executeCommand('curl -s http://localhost:3000/api/proxy/status');
      
      deploymentSteps.push({ 
        step: 'verification', 
        success: true,
        health: healthCheck.stdout,
        proxyStatus: proxyStatus.stdout
      });
    } catch (error) {
      deploymentSteps.push({ step: 'verification', success: false, error: error.message });
    }
    
    res.json({
      success: overallSuccess,
      message: overallSuccess ? '一键部署完成' : '部署过程中出现错误',
      data: {
        scriptName,
        deploymentSteps,
        totalSteps: deploymentSteps.length,
        successSteps: deploymentSteps.filter(s => s.success).length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('一键部署失败:', error);
    res.status(500).json({
      success: false,
      message: '一键部署失败',
      error: error.message
    });
  }
});

/**
 * 获取部署状态和日志
 */
router.get('/status', async (req, res) => {
  try {
    const results = [];
    
    // Git状态
    const gitStatus = await executeCommand('git status --porcelain', { cwd: CONFIG.GIT_DIR });
    const gitCommit = await executeCommand('git rev-parse HEAD', { cwd: CONFIG.GIT_DIR });
    results.push({ 
      category: 'git',
      status: gitStatus.stdout || 'clean',
      commit: gitCommit.stdout ? gitCommit.stdout.substring(0, 8) : 'unknown'
    });
    
    // PM2状态
    const pm2Status = await executeCommand('pm2 list');
    results.push({ category: 'pm2', ...pm2Status });
    
    // 服务健康状态
    const healthCheck = await executeCommand('curl -s http://localhost:3000/health');
    results.push({ category: 'health', ...healthCheck });
    
    // 代理服务状态
    const proxyStatus = await executeCommand('curl -s http://localhost:3000/api/proxy/status');
    results.push({ category: 'proxy', ...proxyStatus });
    
    // 磁盘空间
    const diskSpace = await executeCommand('df -h /opt');
    results.push({ category: 'disk', ...diskSpace });
    
    res.json({
      success: true,
      message: '状态获取成功',
      data: {
        results,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      }
    });
    
  } catch (error) {
    logger.error('获取状态失败:', error);
    res.status(500).json({
      success: false,
      message: '获取状态失败',
      error: error.message
    });
  }
});

module.exports = router;
