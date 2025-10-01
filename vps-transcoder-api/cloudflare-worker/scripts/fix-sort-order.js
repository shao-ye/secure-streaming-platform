/**
 * 批量修复现有频道的排序值
 * 运行方法：node scripts/fix-sort-order.js
 */

// 这是一个在浏览器控制台中运行的脚本
// 请在 https://yoyo.5202021.xyz/ 登录管理员账户后，在控制台中运行

const fixSortOrder = async () => {
  console.log('🔧 开始批量修复频道排序值...');
  
  try {
    // 获取当前所有频道
    const response = await fetch('/api/admin/streams', {
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`获取频道列表失败: ${response.status}`);
    }
    
    const data = await response.json();
    const streams = data.data || [];
    
    console.log(`📋 找到 ${streams.length} 个频道`);
    
    // 过滤出需要修复的频道（sortOrder为0或undefined）
    const streamsToFix = streams.filter(stream => !stream.sortOrder || stream.sortOrder === 0);
    
    if (streamsToFix.length === 0) {
      console.log('✅ 所有频道的排序值都正常，无需修复');
      return;
    }
    
    console.log(`🔨 需要修复 ${streamsToFix.length} 个频道的排序值`);
    
    // 批量更新排序值
    for (let i = 0; i < streamsToFix.length; i++) {
      const stream = streamsToFix[i];
      const newSortOrder = i + 1; // 从1开始分配排序值
      
      console.log(`📝 正在更新频道 "${stream.name}" 的排序值为 ${newSortOrder}...`);
      
      const updateResponse = await fetch(`/api/admin/streams/${stream.id}/sort`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          sortOrder: newSortOrder
        })
      });
      
      if (updateResponse.ok) {
        console.log(`✅ 频道 "${stream.name}" 排序值更新成功`);
      } else {
        console.error(`❌ 频道 "${stream.name}" 排序值更新失败:`, updateResponse.status);
      }
      
      // 添加小延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('🎉 批量修复完成！请刷新页面查看结果。');
    
  } catch (error) {
    console.error('❌ 批量修复过程中出现错误:', error);
  }
};

// 在浏览器控制台中运行此函数
console.log('💡 请在浏览器控制台中运行: fixSortOrder()');

// 如果是在浏览器环境中，自动运行
if (typeof window !== 'undefined') {
  // 将函数添加到全局作用域
  window.fixSortOrder = fixSortOrder;
  console.log('🚀 函数已准备就绪，请运行: fixSortOrder()');
}
