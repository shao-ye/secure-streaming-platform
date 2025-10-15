/**
 * 统一视频流系统验证脚本
 * 测试集成流媒体服务的各个组件
 */

const axios = require('axios');
const chalk = require('chalk');

// 配置
const API_BASE_URL = 'https://yoyo-vps.5202021.xyz/api';
const TEST_CHANNEL_ID = 'test-channel-001';
const TEST_RTMP_URL = 'rtmp://example.com/live/test';

class SystemValidator {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const colors = {
      info: chalk.blue,
      success: chalk.green,
      error: chalk.red,
      warning: chalk.yellow
    };
    
    console.log(`[${timestamp}] ${colors[type](message)}`);
  }

  async addResult(testName, success, message, data = null) {
    this.results.push({
      testName,
      success,
      message,
      data,
      timestamp: Date.now()
    });
    
    if (success) {
      this.log(`✅ ${testName}: ${message}`, 'success');
    } else {
      this.log(`❌ ${testName}: ${message}`, 'error');
    }
  }

  /**
   * 测试系统健康状态
   */
  async testSystemHealth() {
    try {
      const response = await axios.get(`${API_BASE_URL}/integrated-streaming/health`);
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '系统健康检查',
          true,
          '集成流媒体服务运行正常',
          response.data.data
        );
        return true;
      } else {
        await this.addResult(
          '系统健康检查',
          false,
          '服务状态异常',
          response.data
        );
        return false;
      }
    } catch (error) {
      await this.addResult(
        '系统健康检查',
        false,
        `连接失败: ${error.message}`
      );
      return false;
    }
  }

  /**
   * 测试系统状态获取
   */
  async testSystemStatus() {
    try {
      const response = await axios.get(`${API_BASE_URL}/integrated-streaming/system/status`);
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '系统状态获取',
          true,
          '成功获取系统状态',
          response.data.data
        );
        return response.data.data;
      } else {
        await this.addResult(
          '系统状态获取',
          false,
          '获取系统状态失败',
          response.data
        );
        return null;
      }
    } catch (error) {
      await this.addResult(
        '系统状态获取',
        false,
        `请求失败: ${error.message}`
      );
      return null;
    }
  }

  /**
   * 测试启动观看功能
   */
  async testStartWatching() {
    try {
      const requestData = {
        channelId: TEST_CHANNEL_ID,
        rtmpUrl: TEST_RTMP_URL,
        options: {
          autoPlay: true,
          quality: 'auto',
          userLocation: { country: 'CN', city: 'Test' },
          networkType: 'wifi'
        }
      };

      const response = await axios.post(
        `${API_BASE_URL}/integrated-streaming/start-watching`,
        requestData
      );
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '启动观看功能',
          true,
          '成功启动智能观看',
          response.data.data
        );
        return response.data.data;
      } else {
        await this.addResult(
          '启动观看功能',
          false,
          response.data.message || '启动观看失败',
          response.data
        );
        return null;
      }
    } catch (error) {
      await this.addResult(
        '启动观看功能',
        false,
        `请求失败: ${error.response?.data?.message || error.message}`
      );
      return null;
    }
  }

  /**
   * 测试心跳功能
   */
  async testHeartbeat() {
    try {
      const requestData = {
        channelId: TEST_CHANNEL_ID,
        clientInfo: {
          networkQuality: 'good',
          latency: 120,
          bufferHealth: 85,
          playbackState: 'playing',
          timestamp: Date.now()
        }
      };

      const response = await axios.post(
        `${API_BASE_URL}/integrated-streaming/heartbeat`,
        requestData
      );
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '心跳功能',
          true,
          '心跳发送成功',
          response.data.data
        );
        return true;
      } else {
        await this.addResult(
          '心跳功能',
          false,
          response.data.message || '心跳发送失败',
          response.data
        );
        return false;
      }
    } catch (error) {
      await this.addResult(
        '心跳功能',
        false,
        `请求失败: ${error.response?.data?.message || error.message}`
      );
      return false;
    }
  }

  /**
   * 测试频道信息获取
   */
  async testGetChannelInfo() {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/integrated-streaming/channel/${TEST_CHANNEL_ID}`
      );
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '频道信息获取',
          true,
          '成功获取频道信息',
          response.data.data
        );
        return response.data.data;
      } else {
        await this.addResult(
          '频道信息获取',
          false,
          response.data.message || '获取频道信息失败',
          response.data
        );
        return null;
      }
    } catch (error) {
      if (error.response?.status === 404) {
        await this.addResult(
          '频道信息获取',
          true,
          '频道未激活（预期行为）'
        );
        return null;
      }
      
      await this.addResult(
        '频道信息获取',
        false,
        `请求失败: ${error.response?.data?.message || error.message}`
      );
      return null;
    }
  }

  /**
   * 测试路由切换功能
   */
  async testRouteSwitching() {
    try {
      const requestData = {
        channelId: TEST_CHANNEL_ID,
        routeType: 'proxy',
        routeConfig: {
          priority: 1,
          manual: true
        }
      };

      const response = await axios.post(
        `${API_BASE_URL}/integrated-streaming/switch-route`,
        requestData
      );
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '路由切换功能',
          true,
          '路由切换成功',
          response.data.data
        );
        return true;
      } else {
        await this.addResult(
          '路由切换功能',
          false,
          response.data.message || '路由切换失败',
          response.data
        );
        return false;
      }
    } catch (error) {
      await this.addResult(
        '路由切换功能',
        false,
        `请求失败: ${error.response?.data?.message || error.message}`
      );
      return false;
    }
  }

  /**
   * 测试可用路由获取
   */
  async testGetAvailableRoutes() {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/integrated-streaming/routes/available?channelId=${TEST_CHANNEL_ID}`
      );
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '可用路由获取',
          true,
          `获取到 ${response.data.data.availableRoutes?.length || 0} 个可用路由`,
          response.data.data
        );
        return response.data.data;
      } else {
        await this.addResult(
          '可用路由获取',
          false,
          response.data.message || '获取可用路由失败',
          response.data
        );
        return null;
      }
    } catch (error) {
      await this.addResult(
        '可用路由获取',
        false,
        `请求失败: ${error.response?.data?.message || error.message}`
      );
      return null;
    }
  }

  /**
   * 测试停止观看功能
   */
  async testStopWatching() {
    try {
      const requestData = {
        channelId: TEST_CHANNEL_ID
      };

      const response = await axios.post(
        `${API_BASE_URL}/integrated-streaming/stop-watching`,
        requestData
      );
      
      if (response.status === 200 && response.data.status === 'success') {
        await this.addResult(
          '停止观看功能',
          true,
          '成功停止观看',
          response.data.data
        );
        return true;
      } else {
        await this.addResult(
          '停止观看功能',
          false,
          response.data.message || '停止观看失败',
          response.data
        );
        return false;
      }
    } catch (error) {
      await this.addResult(
        '停止观看功能',
        false,
        `请求失败: ${error.response?.data?.message || error.message}`
      );
      return false;
    }
  }

  /**
   * 测试向后兼容性
   */
  async testBackwardCompatibility() {
    try {
      // 测试简化流管理API
      const response = await axios.get(`${API_BASE_URL}/simple-stream/health`);
      
      if (response.status === 200) {
        await this.addResult(
          '向后兼容性',
          true,
          '简化流管理API正常工作',
          response.data
        );
        return true;
      } else {
        await this.addResult(
          '向后兼容性',
          false,
          '简化流管理API异常'
        );
        return false;
      }
    } catch (error) {
      await this.addResult(
        '向后兼容性',
        false,
        `向后兼容性测试失败: ${error.message}`
      );
      return false;
    }
  }

  /**
   * 运行完整的系统验证
   */
  async runFullValidation() {
    this.log('🚀 开始统一视频流系统验证...', 'info');
    this.log(`📍 API基础地址: ${API_BASE_URL}`, 'info');
    this.log(`🎯 测试频道ID: ${TEST_CHANNEL_ID}`, 'info');
    
    console.log('\n' + '='.repeat(60));
    
    // 1. 系统健康检查
    const isHealthy = await this.testSystemHealth();
    if (!isHealthy) {
      this.log('⚠️  系统不健康，继续进行其他测试...', 'warning');
    }
    
    // 2. 系统状态获取
    await this.testSystemStatus();
    
    // 3. 可用路由获取
    await this.testGetAvailableRoutes();
    
    // 4. 启动观看功能
    const watchingStarted = await this.testStartWatching();
    
    // 5. 如果启动成功，测试相关功能
    if (watchingStarted) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      
      // 心跳功能
      await this.testHeartbeat();
      
      // 频道信息获取
      await this.testGetChannelInfo();
      
      // 路由切换功能
      await this.testRouteSwitching();
      
      // 停止观看功能
      await this.testStopWatching();
    }
    
    // 6. 向后兼容性测试
    await this.testBackwardCompatibility();
    
    // 生成测试报告
    this.generateReport();
  }

  /**
   * 生成测试报告
   */
  generateReport() {
    console.log('\n' + '='.repeat(60));
    this.log('📊 测试报告生成中...', 'info');
    
    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    const duration = Date.now() - this.startTime;
    
    console.log('\n' + chalk.bold('📋 测试结果汇总:'));
    console.log(`   总测试数: ${totalTests}`);
    console.log(`   通过数: ${chalk.green(passedTests)}`);
    console.log(`   失败数: ${chalk.red(failedTests)}`);
    console.log(`   成功率: ${chalk.blue(((passedTests / totalTests) * 100).toFixed(1))}%`);
    console.log(`   耗时: ${duration}ms`);
    
    console.log('\n' + chalk.bold('📝 详细结果:'));
    this.results.forEach((result, index) => {
      const status = result.success ? chalk.green('✅') : chalk.red('❌');
      console.log(`   ${index + 1}. ${status} ${result.testName}: ${result.message}`);
    });
    
    // 建议
    console.log('\n' + chalk.bold('💡 建议:'));
    if (failedTests === 0) {
      console.log('   🎉 所有测试通过！系统运行正常。');
    } else if (failedTests <= 2) {
      console.log('   ⚠️  少数测试失败，请检查相关组件配置。');
    } else {
      console.log('   🚨 多个测试失败，建议检查系统配置和依赖服务。');
    }
    
    console.log('\n' + '='.repeat(60));
    
    // 保存详细报告到文件
    const reportData = {
      summary: {
        totalTests,
        passedTests,
        failedTests,
        successRate: ((passedTests / totalTests) * 100).toFixed(1),
        duration
      },
      results: this.results,
      timestamp: new Date().toISOString()
    };
    
    require('fs').writeFileSync(
      'validation-report.json',
      JSON.stringify(reportData, null, 2)
    );
    
    this.log('📄 详细报告已保存到 validation-report.json', 'info');
  }
}

// 运行验证
async function main() {
  const validator = new SystemValidator();
  
  try {
    await validator.runFullValidation();
  } catch (error) {
    console.error(chalk.red('❌ 验证过程中发生错误:'), error.message);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = SystemValidator;
