/**
 * 配置测试脚本
 * 用于验证.env配置是否完整
 */

// 加载环境变量
require('dotenv').config();

console.log('\n=== VPS配置验证工具 ===\n');

try {
  // 尝试加载配置模块
  const config = require('./config');
  
  console.log('✅ 配置模块加载成功！\n');
  console.log('📋 配置摘要：');
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - VPS Base URL: ${config.vpsBaseUrl}`);
  console.log(`  - Workers API URL: ${config.workersApiUrl}`);
  console.log(`  - HLS Output Dir: ${config.hlsOutputDir}`);
  console.log(`  - Log Dir: ${config.logDir}`);
  console.log('\n✅ 所有必需配置项已就绪！');
  console.log('🚀 可以正常启动服务\n');
  
  process.exit(0);
  
} catch (error) {
  console.error('❌ 配置验证失败：\n');
  console.error(error.message);
  console.error('\n💡 解决方案：');
  console.error('  1. 运行更新脚本：powershell .\\update-env.ps1');
  console.error('  2. 或手动检查.env文件配置');
  console.error('  3. 参考.env.example文件\n');
  
  process.exit(1);
}
