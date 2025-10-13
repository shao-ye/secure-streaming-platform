// 临时调试脚本 - 检查R2存储内容
export default {
  async fetch(request, env, ctx) {
    try {
      // 检查R2存储桶是否存在
      if (!env.PROXY_TEST_HISTORY) {
        return new Response('PROXY_TEST_HISTORY bucket not found', { status: 500 });
      }

      // 尝试列出所有对象
      const objects = await env.PROXY_TEST_HISTORY.list();
      
      const result = {
        bucketExists: true,
        objectCount: objects.objects.length,
        objects: objects.objects.map(obj => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded
        }))
      };

      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }
};
