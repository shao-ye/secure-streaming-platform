/**
 * 初始化管理员用户数据到KV数据库
 * 解决登录页面持续刷新问题
 */

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      // 只允许POST请求到/init-admin路径
      if (request.method !== 'POST' || url.pathname !== '/init-admin') {
        return new Response('Not Found', { status: 404 });
      }

      // 检查是否已存在管理员用户
      const existingUser = await env.YOYO_USER_DB.get('user:admin');
      if (existingUser) {
        return new Response(JSON.stringify({
          status: 'info',
          message: 'Admin user already exists',
          data: { username: 'admin', role: 'admin' }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 创建管理员用户数据
      const adminUser = {
        username: 'admin',
        role: 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 存储到KV数据库
      await env.YOYO_USER_DB.put('user:admin', JSON.stringify(adminUser));

      // 初始化空的流配置
      const initialStreams = [];
      await env.YOYO_USER_DB.put('streams:config', JSON.stringify(initialStreams));

      console.log('Admin user initialized successfully');

      return new Response(JSON.stringify({
        status: 'success',
        message: 'Admin user initialized successfully',
        data: {
          username: adminUser.username,
          role: adminUser.role,
          createdAt: adminUser.createdAt
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Init admin user error:', error);
      return new Response(JSON.stringify({
        status: 'error',
        message: 'Failed to initialize admin user',
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
