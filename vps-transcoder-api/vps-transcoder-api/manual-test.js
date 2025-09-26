/**
 * 手工测试脚本 - 最简化版本
 */

console.log('🚀 开始手工测试VPS转码API');

const http = require('http');

// 测试配置
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_KEY = 'test-api-key-change-in-production';

// 简单的HTTP请求函数
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function runTests() {
  console.log('测试配置:');
  console.log(`- 主机: ${API_HOST}`);
  console.log(`- 端口: ${API_PORT}`);
  console.log(`- API Key: ${API_KEY.substring(0, 8)}...`);
  console.log();

  let passCount = 0;
  let totalCount = 0;

  // 测试1: 健康检查
  totalCount++;
  console.log('测试1: 健康检查...');
  try {
    const response = await makeRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/health',
      method: 'GET',
      timeout: 5000
    });

    if (response.statusCode === 200) {
      console.log('✅ 健康检查通过');
      passCount++;
    } else {
      console.log(`❌ 健康检查失败 (状态码: ${response.statusCode})`);
      console.log('响应:', response.body);
    }
  } catch (error) {
    console.log(`❌ 健康检查异常: ${error.message}`);
  }

  // 测试2: API认证
  totalCount++;
  console.log('\n测试2: API状态检查（需要认证）...');
  try {
    const response = await makeRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/status',
      method: 'GET',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    if (response.statusCode === 200) {
      console.log('✅ API认证通过');
      passCount++;

      // 尝试解析响应
      try {
        const data = JSON.parse(response.body);
        if (data.data && data.data.service) {
          console.log(`   服务名称: ${data.data.service.name}`);
          console.log(`   运行时间: ${Math.floor(data.data.service.uptime)}秒`);
          console.log(`   活跃流数: ${data.data.streams.total}`);
        }
      } catch (parseError) {
        console.log('   响应数据解析失败，但状态码正常');
      }
    } else {
      console.log(`❌ API认证失败 (状态码: ${response.statusCode})`);
      console.log('响应:', response.body);
    }
  } catch (error) {
    console.log(`❌ API认证异常: ${error.message}`);
  }

  // 测试3: 无效API Key（应该被拒绝）
  totalCount++;
  console.log('\n测试3: 无效API Key验证...');
  try {
    const response = await makeRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/status',
      method: 'GET',
      headers: {
        'X-API-Key': 'invalid-key',
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    if (response.statusCode === 403 || response.statusCode === 401) {
      console.log('✅ 无效API Key被正确拒绝');
      passCount++;
    } else {
      console.log(`❌ 无效API Key未被拒绝 (状态码: ${response.statusCode})`);
    }
  } catch (error) {
    console.log(`❌ 无效API Key测试异常: ${error.message}`);
  }

  // 输出结果
  console.log('\n' + '='.repeat(40));
  console.log('测试结果总结:');
  console.log(`总测试: ${totalCount}`);
  console.log(`通过: ${passCount}`);
  console.log(`失败: ${totalCount - passCount}`);

  const passRate = ((passCount / totalCount) * 100).toFixed(1);
  console.log(`通过率: ${passRate}%`);

  if (passCount === totalCount) {
    console.log('\n🎉 所有测试通过！API工作正常');
    process.exit(0);
  } else if (passRate >= 66) {
    console.log('\n⚠️ 大部分测试通过，请检查失败项');
    process.exit(0);
  } else {
    console.log('\n❌ 多个测试失败，请检查服务状态');
    process.exit(1);
  }
}

// 运行测试
runTests().catch(error => {
  console.error('测试运行失败:', error.message);
  process.exit(1);
});
