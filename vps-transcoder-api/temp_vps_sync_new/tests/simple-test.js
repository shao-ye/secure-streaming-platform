/**
 * 简化版API测试脚本
 * 使用方法: node tests/simple-test.js
 */

const axios = require('axios');

// 测试配置
const API_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const API_KEY = process.env.TEST_API_KEY || 'test-api-key-change-in-production';

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m', 
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runTests() {
  console.log('🚀 开始API接口测试');
  console.log(`测试地址: ${API_URL}`);
  console.log(`API密钥: ${API_KEY.substring(0, 8)}...`);
  console.log('');

  let passCount = 0;
  let totalCount = 0;

  // 测试1: 健康检查
  totalCount++;
  try {
    console.log('测试1: 健康检查...');
    const response = await axios.get(`${API_URL}/health`, { timeout: 5000 });

    if (response.status === 200) {
      log('green', '✅ 健康检查通过');
      passCount++;
    } else {
      log('red', '❌ 健康检查失败');
    }
  } catch (error) {
    log('red', `❌ 健康检查异常: ${error.message}`);
  }

  // 测试2: API认证
  totalCount++;
  try {
    console.log('\n测试2: API认证...');
    const response = await axios.get(`${API_URL}/api/status`, {
      headers: { 'X-API-Key': API_KEY },
      timeout: 5000
    });

    if (response.status === 200 && response.data.status === 'success') {
      log('green', '✅ API认证通过');
      passCount++;
    } else {
      log('red', '❌ API认证失败');
    }
  } catch (error) {
    log('red', `❌ API认证异常: ${error.message}`);
  }

  // 测试3: 无效认证应该被拒绝
  totalCount++;
  try {
    console.log('\n测试3: 无效认证验证...');
    await axios.get(`${API_URL}/api/status`, {
      headers: { 'X-API-Key': 'invalid-key' },
      timeout: 5000
    });
    log('red', '❌ 无效认证未被拒绝');
  } catch (error) {
    if (error.response && error.response.status === 403) {
      log('green', '✅ 无效认证正确被拒绝');
      passCount++;
    } else {
      log('red', `❌ 无效认证测试异常: ${error.message}`);
    }
  }

  // 测试4: 获取流列表
  totalCount++;
  try {
    console.log('\n测试4: 获取流列表...');
    const response = await axios.get(`${API_URL}/api/streams`, {
      headers: { 'X-API-Key': API_KEY },
      timeout: 5000
    });

    if (response.status === 200 && response.data.status === 'success') {
      log('green', `✅ 获取流列表成功 - 当前${response.data.data.count}个流`);
      passCount++;
    } else {
      log('red', '❌ 获取流列表失败');
    }
  } catch (error) {
    log('red', `❌ 获取流列表异常: ${error.message}`);
  }

  // 测试5: 参数验证
  totalCount++;
  try {
    console.log('\n测试5: 参数验证...');
    await axios.post(`${API_URL}/api/start-stream`, {}, {
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY 
      },
      timeout: 5000
    });
    log('red', '❌ 参数验证失败 - 空参数应该被拒绝');
  } catch (error) {
    if (error.response && error.response.status === 400) {
      log('green', '✅ 参数验证正常 - 空参数被正确拒绝');
      passCount++;
    } else {
      log('red', `❌ 参数验证异常: ${error.message}`);
    }
  }

  // 输出结果
  console.log('\n' + '='.repeat(40));
  console.log('测试结果总结:');
  console.log(`总测试: ${totalCount}`);
  log('green', `通过: ${passCount}`);
  log('red', `失败: ${totalCount - passCount}`);

  const passRate = ((passCount / totalCount) * 100).toFixed(1);
  console.log(`通过率: ${passRate}%`);

  if (passCount === totalCount) {
    log('green', '\n🎉 所有测试通过！API工作正常');
  } else if (passRate >= 80) {
    log('yellow', '\n⚠️ 大部分测试通过，请检查失败项');
  } else {
    log('red', '\n❌ 多个测试失败，请检查服务状态');
  }
}

// 运行测试
runTests().catch(error => {
  console.error('测试运行失败:', error.message);
  process.exit(1);
});
