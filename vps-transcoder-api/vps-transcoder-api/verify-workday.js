/**
 * 临时测试脚本：验证WorkdayChecker功能
 * 测试完成后删除
 */

const WorkdayChecker = require('./src/services/WorkdayChecker');

async function testWorkdayChecker() {
  console.log('=== WorkdayChecker 快速测试 ===\n');
  
  const checker = new WorkdayChecker();
  
  try {
    // 测试1: 不初始化，直接测试单个日期（懒加载）
    console.log('1. 测试单个日期（无预取）...');
    
    const today = new Date();
    const todayStr = checker.formatDate(today);
    console.log(`   检查今天: ${todayStr}`);
    
    const isTodayWorkday = await checker.isWorkday(today);
    console.log(`   结果: ${isTodayWorkday ? '✅ 工作日' : '❌ 非工作日'}`);
    
    // 测试2: 测试缓存
    console.log('\n2. 测试缓存（第二次查询）...');
    const isTodayWorkday2 = await checker.isWorkday(today);
    console.log(`   结果: ${isTodayWorkday2 ? '✅ 工作日' : '❌ 非工作日'} (应从缓存读取)`);
    
    // 测试3: 测试已知工作日（使用本地时间避免时区问题）
    console.log('\n3. 测试周一 (2025-10-27)...');
    const monday = new Date(2025, 9, 27); // 月份从0开始，9=10月
    const mondayStr = checker.formatDate(monday);
    console.log(`   实际检查日期: ${mondayStr}`);
    const isMondayWorkday = await checker.isWorkday(monday);
    console.log(`   结果: ${isMondayWorkday ? '✅ 工作日' : '❌ 非工作日'} (期望: 工作日)`);
    
    // 测试4: 测试已知周末
    console.log('\n4. 测试周日 (2025-10-26)...');
    const sunday = new Date(2025, 9, 26); // 月份从0开始，9=10月
    const sundayStr = checker.formatDate(sunday);
    console.log(`   实际检查日期: ${sundayStr}`);
    const isSundayWorkday = await checker.isWorkday(sunday);
    console.log(`   结果: ${isSundayWorkday ? '❌ 工作日' : '✅ 非工作日'} (期望: 非工作日)`);
    
    // 显示统计
    console.log('\n5. 缓存统计:');
    console.log(`   已缓存天数: ${checker.cache.size}`);
    console.log(`   失败月份: ${Array.from(checker.failedMonths).join(', ') || '无'}`);
    
    // 验证结果
    console.log('\n=== 测试结果 ===');
    const allPassed = isMondayWorkday === true && isSundayWorkday === false;
    if (allPassed) {
      console.log('✅ 所有测试通过！');
    } else {
      console.log('❌ 部分测试失败');
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 设置5秒超时
const timeout = setTimeout(() => {
  console.error('\n❌ 测试超时（5秒）');
  process.exit(1);
}, 5000);

testWorkdayChecker()
  .then(() => {
    clearTimeout(timeout);
    console.log('\n=== 测试完成 ===');
    process.exit(0);
  })
  .catch(error => {
    clearTimeout(timeout);
    console.error('❌ 未捕获的错误:', error);
    process.exit(1);
  });
