const axios = require('axios');
const https = require('https');

// 创建自定义的axios实例，忽略SSL证书验证
const apiClient = axios.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false
  }),
  timeout: 15000
});

async function quickTest() {
  try {
    console.log('🔍 测试集成流媒体API健康检查...');
    
    const response = await apiClient.get('https://yoyo-vps.your-domain.com/api/integrated-streaming/health', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });
    
    console.log('✅ 响应状态:', response.status);
    console.log('✅ 响应数据:', JSON.stringify(response.data, null, 2));
    
    // 测试系统状态
    console.log('\n🔍 测试系统状态API...');
    const statusResponse = await axios.get('https://yoyo-vps.your-domain.com/api/integrated-streaming/system/status', {
      timeout: 10000
    });
    
    console.log('✅ 系统状态:', JSON.stringify(statusResponse.data, null, 2));
    
    // 测试可用路由
    console.log('\n🔍 测试可用路由API...');
    const routesResponse = await axios.get('https://yoyo-vps.your-domain.com/api/integrated-streaming/routes/available?channelId=test-001', {
      timeout: 10000
    });
    
    console.log('✅ 可用路由:', JSON.stringify(routesResponse.data, null, 2));
    
    console.log('\n🎉 所有API测试通过！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.response) {
      console.error('❌ 响应状态:', error.response.status);
      console.error('❌ 响应数据:', error.response.data);
    }
  }
}

quickTest();
