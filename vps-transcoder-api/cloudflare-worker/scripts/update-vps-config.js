#!/usr/bin/env node

/**
 * YOYO流媒体平台 - Cloudflare Workers VPS配置更新脚本
 * 用于在VPS部署完成后更新Workers环境变量
 */

const readline = require('readline');
const { execSync } = require('child_process');

// 颜色定义
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    purple: '\x1b[35m'
};

// 日志函数
const log = {
    info: (msg) => console.log(`${colors.green}[INFO]${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
    step: (msg) => console.log(`${colors.blue}[STEP]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.purple}[SUCCESS]${colors.reset} ${msg}`)
};

// 创建readline接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 提示用户输入
const question = (prompt) => {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
};

// 验证IP地址格式
const isValidIP = (ip) => {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip);
};

// 验证API密钥格式
const isValidAPIKey = (key) => {
    return key && key.length >= 32 && /^[a-f0-9]+$/i.test(key);
};

// 测试VPS连接
const testVPSConnection = async (vpsIP, apiKey) => {
    try {
        log.step('测试VPS连接...');
        
        // 测试健康检查端点
        const healthCmd = `curl -s -f --connect-timeout 10 http://${vpsIP}:3000/health`;
        const healthResult = execSync(healthCmd, { encoding: 'utf8' });
        
        // 测试API状态端点
        const statusCmd = `curl -s -f --connect-timeout 10 -H "X-API-Key: ${apiKey}" http://${vpsIP}:3000/api/status`;
        const statusResult = execSync(statusCmd, { encoding: 'utf8' });
        
        log.success('VPS连接测试通过');
        
        // 解析并显示VPS信息
        try {
            const healthData = JSON.parse(healthResult);
            const statusData = JSON.parse(statusResult);
            
            console.log('\n=== VPS服务信息 ===');
            console.log(`服务状态: ${healthData.status}`);
            console.log(`服务版本: ${healthData.version || 'N/A'}`);
            console.log(`运行时间: ${healthData.uptime || 'N/A'}`);
            console.log(`活跃流数: ${statusData.activeStreams || 0}`);
            console.log(`系统负载: ${statusData.systemLoad || 'N/A'}`);
            console.log('==================\n');
        } catch (e) {
            log.warn('无法解析VPS响应数据，但连接正常');
        }
        
        return true;
    } catch (error) {
        log.error('VPS连接测试失败');
        console.log(`错误信息: ${error.message}`);
        return false;
    }
};

// 更新Wrangler环境变量
const updateWranglerVars = async (vpsIP, apiKey, environment = 'production') => {
    try {
        log.step(`更新${environment}环境变量...`);
        
        const vars = [
            { name: 'VPS_API_URL', value: `http://yoyo-vps.5202021.xyz/api` },
            { name: 'VPS_API_KEY', value: apiKey },
            { name: 'VPS_HLS_URL', value: `http://yoyo-vps.5202021.xyz/hls` },
            { name: 'VPS_ENABLED', value: 'true' }
        ];
        
        for (const { name, value } of vars) {
            const cmd = `wrangler secret put ${name} --env ${environment}`;
            log.info(`设置 ${name}...`);
            
            // 使用echo传递值给wrangler
            execSync(`echo "${value}" | ${cmd}`, { 
                stdio: ['pipe', 'inherit', 'inherit'],
                encoding: 'utf8'
            });
        }
        
        log.success('环境变量更新完成');
        return true;
    } catch (error) {
        log.error('环境变量更新失败');
        console.log(`错误信息: ${error.message}`);
        return false;
    }
};

// 部署Workers
const deployWorkers = async (environment = 'production') => {
    try {
        log.step(`部署Workers到${environment}环境...`);
        
        const cmd = `wrangler deploy --env ${environment}`;
        execSync(cmd, { stdio: 'inherit' });
        
        log.success('Workers部署完成');
        return true;
    } catch (error) {
        log.error('Workers部署失败');
        console.log(`错误信息: ${error.message}`);
        return false;
    }
};

// 测试Workers连接
const testWorkersConnection = async (workerURL, vpsIP) => {
    try {
        log.step('测试Workers连接...');
        
        // 测试Workers健康检查
        const healthCmd = `curl -s -f --connect-timeout 10 ${workerURL}/api/admin/vps/health`;
        const healthResult = execSync(healthCmd, { encoding: 'utf8' });
        
        log.success('Workers连接测试通过');
        
        try {
            const healthData = JSON.parse(healthResult);
            console.log('\n=== Workers-VPS连接状态 ===');
            console.log(`VPS状态: ${healthData.vpsStatus || 'N/A'}`);
            console.log(`连接延迟: ${healthData.latency || 'N/A'}ms`);
            console.log(`最后检查: ${healthData.lastCheck || 'N/A'}`);
            console.log('========================\n');
        } catch (e) {
            log.warn('无法解析Workers响应数据，但连接正常');
        }
        
        return true;
    } catch (error) {
        log.error('Workers连接测试失败');
        console.log(`错误信息: ${error.message}`);
        return false;
    }
};

// 主函数
const main = async () => {
    console.log('========================================');
    console.log('  🔗 YOYO流媒体平台 - VPS配置更新');
    console.log('========================================\n');
    
    try {
        // 获取VPS信息
        console.log('请输入VPS部署信息:\n');
        
        let vpsIP;
        do {
            vpsIP = await question('VPS IP地址: ');
            if (!isValidIP(vpsIP)) {
                log.error('无效的IP地址格式，请重新输入');
            }
        } while (!isValidIP(vpsIP));
        
        let apiKey;
        do {
            apiKey = await question('API密钥 (从部署脚本输出中获取): ');
            if (!isValidAPIKey(apiKey)) {
                log.error('无效的API密钥格式，应为32位以上的十六进制字符串');
            }
        } while (!isValidAPIKey(apiKey));
        
        const environment = await question('部署环境 (production/development) [production]: ') || 'production';
        
        console.log('\n');
        
        // 测试VPS连接
        const vpsConnected = await testVPSConnection(vpsIP, apiKey);
        if (!vpsConnected) {
            const continueAnyway = await question('VPS连接失败，是否继续配置? (y/N): ');
            if (!continueAnyway.toLowerCase().startsWith('y')) {
                log.info('配置已取消');
                process.exit(0);
            }
        }
        
        // 更新环境变量
        const varsUpdated = await updateWranglerVars(vpsIP, apiKey, environment);
        if (!varsUpdated) {
            log.error('环境变量更新失败，请检查wrangler配置');
            process.exit(1);
        }
        
        // 询问是否部署
        const shouldDeploy = await question('是否立即部署Workers? (Y/n): ');
        if (!shouldDeploy.toLowerCase().startsWith('n')) {
            const deployed = await deployWorkers(environment);
            if (!deployed) {
                log.error('Workers部署失败');
                process.exit(1);
            }
            
            // 获取Workers URL进行测试
            const workerURL = await question('Workers URL (用于测试连接): ');
            if (workerURL) {
                await testWorkersConnection(workerURL, vpsIP);
            }
        }
        
        // 显示配置总结
        console.log('\n========================================');
        log.success('🎉 VPS配置更新完成！');
        console.log('========================================\n');
        
        console.log('📋 配置信息:');
        console.log(`  - VPS IP: ${vpsIP}`);
        console.log(`  - API URL: http://${vpsIP}:3000`);
        console.log(`  - HLS URL: http://${vpsIP}/hls`);
        console.log(`  - 环境: ${environment}`);
        console.log('');
        
        console.log('🔧 下一步操作:');
        console.log('  1. 在前端管理界面添加测试频道');
        console.log('  2. 使用OBS或FFmpeg推送RTMP测试流');
        console.log('  3. 验证HLS播放功能');
        console.log('');
        
        console.log('📊 监控命令:');
        console.log(`  - VPS状态: curl -H "X-API-Key: ${apiKey}" http://${vpsIP}:3000/api/status`);
        console.log(`  - HLS文件: curl http://${vpsIP}/hls/`);
        console.log('');
        
        console.log('========================================');
        
    } catch (error) {
        log.error(`配置过程中发生错误: ${error.message}`);
        process.exit(1);
    } finally {
        rl.close();
    }
};

// 处理中断信号
process.on('SIGINT', () => {
    console.log('\n');
    log.info('配置已取消');
    rl.close();
    process.exit(0);
});

// 执行主函数
main().catch((error) => {
    log.error(`未处理的错误: ${error.message}`);
    process.exit(1);
});
