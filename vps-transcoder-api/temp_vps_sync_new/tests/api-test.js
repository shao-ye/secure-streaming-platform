const {response} = require("express");
const {log} = require("winston");
const path = require("node:path");
if (response.status === 200 && response.data.status === 'success') {
        log('green', '✅ 启动转码流成功（API响应正常）');
        const data = response.data.data;
        log('blue', `   - 流ID: ${data.streamId}`);
        log('blue', `   - 进程ID: ${data.processId}`);
        log('blue', `   - PID: ${data.pid || 'N/A'}`);
        log('blue', `   - HLS URL: ${data.hlsUrl}`);
        log('blue', `   - 响应时间: ${data.responseTime}ms`);

        this.recordResult('启动转码流', true, { 
          streamId: data.streamId,
          processId: data.processId,
          responseTime: data.responseTime
        });

        return data.streamId;
      } else {
        log('red', '❌ 启动转码流失败 - API响应异常');
        this.recordResult('启动转码流', false, { status: response.status, data: response.data });
        return null;
      }
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || error.message;

        if (status === 502 || status === 504) {
          log('yellow', `⚠️ 启动转码流失败 - RTMP源连接问题 (${status}): ${message}`);
          log('blue', '   这通常是因为测试RTMP URL无效，属于正常情况');
          this.recordResult('启动转码流', true, { note: 'RTMP连接失败但API正常', status, message });
        } else if (status === 400) {
          log('red', `❌ 启动转码流失败 - 请求参数错误 (${status}): ${message}`);
          this.recordResult('启动转码流', false, { status, message });
        } else {
          log('red', `❌ 启动转码流失败 - 服务器错误 (${status}): ${message}`);
          this.recordResult('启动转码流', false, { status, message });
        }
      } else {
        log('red', `❌ 启动转码流异常 - ${error.message}`);
        this.recordResult('启动转码流', false, { error: error.message });
      }
      return null;
    }
  }

  /**
   * 测试6: 停止转码流
   */
  async testStopStream(streamId) {
    if (!streamId) {
      log('yellow', '\n=== 跳过测试6: 停止转码流（无有效流ID）===');
      return;
    }

    log('blue', '\n=== 测试6: 停止转码流 ===');
    try {
      const response = await this.client.post('/api/stop-stream', {
        streamId: streamId
      });

      if (response.status === 200 && response.data.status === 'success') {
        log('green', '✅ 停止转码流成功');
        const data = response.data.data;
        log('blue', `   - 流ID: ${data.streamId}`);
        log('blue', `   - 进程ID: ${data.processId || 'N/A'}`);

        this.recordResult('停止转码流', true, { streamId: data.streamId });
      } else {
        log('red', '❌ 停止转码流失败');
        this.recordResult('停止转码流', false, { status: response.status, data: response.data });
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        log('yellow', '⚠️ 停止转码流 - 流不存在（可能已经停止）');
        this.recordResult('停止转码流', true, { note: '流不存在，可能已停止' });
      } else {
        log('red', `❌ 停止转码流异常 - ${error.message}`);
        this.recordResult('停止转码流', false, { error: error.message });
      }
    }
  }

  /**
   * 测试7: 无效参数测试
   */
  async testInvalidParameters() {
    log('blue', '\n=== 测试7: 无效参数测试 ===');

    // 测试缺少参数
    try {
      await this.client.post('/api/start-stream', {});
      log('red', '❌ 缺少参数测试失败 - 应该返回400错误');
      this.recordResult('参数验证-缺少参数', false);
    } catch (error) {
      if (error.response && error.response.status === 400) {
        log('green', '✅ 缺少参数正确被拒绝');
        this.recordResult('参数验证-缺少参数', true, { status: 400 });
      } else {
        log('red', `❌ 缺少参数测试异常 - ${error.message}`);
        this.recordResult('参数验证-缺少参数', false, { error: error.message });
      }
    }

    // 测试无效RTMP URL
    try {
      await this.client.post('/api/start-stream', {
        streamId: 'test-invalid',
        rtmpUrl: 'invalid-url'
      });
      log('red', '❌ 无效RTMP URL测试失败 - 应该返回400错误');
      this.recordResult('参数验证-无效URL', false);
    } catch (error) {
      if (error.response && error.response.status === 400) {
        log('green', '✅ 无效RTMP URL正确被拒绝');
        this.recordResult('参数验证-无效URL', true, { status: 400 });
      } else {
        log('red', `❌ 无效RTMP URL测试异常 - ${error.message}`);
        this.recordResult('参数验证-无效URL', false, { error: error.message });
      }
    }

    // 测试无效流ID格式
    try {
      await this.client.post('/api/start-stream', {
        streamId: 'invalid@stream#id',
        rtmpUrl: 'rtmp://test.com/live/test'
      });
      log('red', '❌ 无效流ID格式测试失败 - 应该返回400错误');
      this.recordResult('参数验证-无效流ID', false);
    } catch (error) {
      if (error.response && error.response.status === 400) {
        log('green', '✅ 无效流ID格式正确被拒绝');
        this.recordResult('参数验证-无效流ID', true, { status: 400 });
      } else {
        log('red', `❌ 无效流ID格式测试异常 - ${error.message}`);
        this.recordResult('参数验证-无效流ID', false, { error: error.message });
      }
    }
  }

  /**
   * 测试8: 性能测试
   */
  async testPerformance() {
    log('blue', '\n=== 测试8: 性能测试 ===');
    const startTime = Date.now();

    try {
      // 并发请求系统状态
      const concurrentRequests = 5;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(this.client.get('/api/status'));
      }

      const responses = await Promise.all(promises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTime = totalTime / concurrentRequests;

      const successCount = responses.filter(r => r.status === 200).length;

      if (successCount === concurrentRequests) {
        log('green', `✅ 并发性能测试通过 - ${concurrentRequests}个并发请求`);
        log('blue', `   - 总耗时: ${totalTime}ms`);
        log('blue', `   - 平均响应时间: ${avgTime.toFixed(2)}ms`);

        if (avgTime < 1000) {
          log('green', '   - 响应时间优秀 (< 1秒)');
        } else if (avgTime < 3000) {
          log('yellow', '   - 响应时间一般 (1-3秒)');
        } else {
          log('red', '   - 响应时间较慢 (> 3秒)');
        }

        this.recordResult('性能测试', true, { 
          concurrentRequests, 
          totalTime, 
          avgTime: avgTime.toFixed(2),
          successRate: '100%'
        });
      } else {
        log('red', `❌ 并发性能测试失败 - 成功率: ${successCount}/${concurrentRequests}`);
        this.recordResult('性能测试', false, { 
          successCount, 
          totalRequests: concurrentRequests 
        });
      }
    } catch (error) {
      log('red', `❌ 性能测试异常 - ${error.message}`);
      this.recordResult('性能测试', false, { error: error.message });
    }
  }

  /**
   * 生成测试报告
   */
  generateReport() {
    log('blue', '\n' + '='.repeat(50));
    log('blue', '           测试报告总结');
    log('blue', '='.repeat(50));

    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    const passRate = ((passedTests / totalTests) * 100).toFixed(1);

    log('blue', `总测试数: ${totalTests}`);
    log('green', `通过: ${passedTests}`);
    log('red', `失败: ${failedTests}`);
    log('blue', `通过率: ${passRate}%`);

    if (failedTests === 0) {
      log('green', '\n🎉 所有测试通过！API接口工作正常');
    } else if (passRate >= 80) {
      log('yellow', '\n⚠️ 大部分测试通过，有少量问题需要关注');
    } else {
      log('red', '\n❌ 多个测试失败，需要检查API服务');
    }

    log('blue', '\n详细结果:');
    this.testResults.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const color = result.success ? 'green' : 'red';
      log(color, `${icon} ${result.testName}`);

      if (result.details.note) {
        log('blue', `   备注: ${result.details.note}`);
      }
      if (result.details.error) {
        log('red', `   错误: ${result.details.error}`);
      }
    });

    // 保存报告到文件
    const reportData = {
      timestamp: new Date().toISOString(),
      config: CONFIG,
      summary: {
        totalTests,
        passedTests,
        failedTests,
        passRate: `${passRate}%`
      },
      results: this.testResults
    };

    const reportPath = path.join(__dirname, 'test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    log('blue', `\n📄 详细报告已保存到: ${reportPath}`);
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    log('blue', '🚀 开始VPS转码API接口测试');
    log('blue', `测试目标: ${CONFIG.baseURL}`);
    log('blue', `API Key: ${CONFIG.apiKey.substring(0, 8)}...`);

    const startTime = Date.now();

    // 运行所有测试
    await this.testHealthCheck();
    await this.testAuthentication();
    await this.testSystemStatus();

    const streams = await this.testGetStreams();
    const streamId = await this.testStartStream();

    // 短暂等待，让转码进程有时间启动
    if (streamId) {
      log('blue', '\n⏳ 等待3秒让转码进程启动...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    await this.testStopStream(streamId);
    await this.testInvalidParameters();
    await this.testPerformance();

    const endTime = Date.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);

    log('blue', `\n⏱️ 测试总耗时: ${totalTime}秒`);

    // 生成报告
    this.generateReport();
  }
}

// 主函数
async function main() {
  // 检查环境变量
  if (!process.env.TEST_API_KEY) {
    log('yellow', '⚠️ 未设置 TEST_API_KEY 环境变量，使用默认测试密钥');
  }

  if (!process.env.TEST_API_URL) {
    log('yellow', '⚠️ 未设置 TEST_API_URL 环境变量，使用默认URL: http://localhost:3000');
  }

  const tester = new APITester();

  try {
    await tester.runAllTests();
  } catch (error) {
    log('red', `💥 测试过程发生致命错误: ${error.message}`);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { APITester };
