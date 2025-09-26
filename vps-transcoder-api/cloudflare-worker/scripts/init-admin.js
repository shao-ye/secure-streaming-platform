/**
 * 管理员用户初始化脚本
 * 使用方法: node scripts/init-admin.js
 */
#!/usr/bin/env node

/**
 * 管理员账户和初始数据初始化脚本
 * 使用方法：node init-admin.js
 */

import { UserManager, StreamsManager } from '../src/utils/kv.js';

// 模拟KV存储，实际使用时需要通过wrangler运行
class MockKV {
  constructor() {
    this.data = new Map();
  }

  async get(key) {
    return this.data.get(key) || null;
  }

  async put(key, value, options = {}) {
    this.data.set(key, value);
    console.log(`✓ 已保存: ${key}`);
  }

  async delete(key) {
    this.data.delete(key);
    console.log(`✓ 已删除: ${key}`);
  }

  // 获取所有数据，用于显示
  getAll() {
    const result = {};
    for (const [key, value] of this.data.entries()) {
      result[key] = value;
    }
    return result;
  }
}

async function initializeData() {
  console.log('🚀 开始初始化YOYO流媒体平台数据...\n');

  const mockKV = new MockKV();
  const userManager = new UserManager(mockKV);
  const streamsManager = new StreamsManager(mockKV);

  try {
    // 1. 创建管理员账户
    console.log('1. 创建管理员账户...');
    const adminUsername = 'admin';
    const adminPassword = 'admin123456'; // 建议在生产环境中修改
    const adminSalt = userManager.generateSalt();
    const adminHashedPassword = await userManager.hashPassword(adminPassword, adminSalt);

    await userManager.createUser(adminUsername, adminHashedPassword, adminSalt, 'admin');
    console.log(`✓ 管理员账户创建成功: ${adminUsername} / ${adminPassword}`);

    // 2. 创建普通用户账户
    console.log('\n2. 创建普通用户账户...');
    const userUsername = 'user';
    const userPassword = 'user123456';
    const userSalt = userManager.generateSalt();
    const userHashedPassword = await userManager.hashPassword(userPassword, userSalt);

    await userManager.createUser(userUsername, userHashedPassword, userSalt, 'user');
    console.log(`✓ 普通用户账户创建成功: ${userUsername} / ${userPassword}`);

    // 3. 创建示例流配置
    console.log('\n3. 创建示例流配置...');
    const sampleStreams = [
      {
        id: 'cam1',
        name: '大厅监控',
        rtmpUrl: 'rtmp://example.com/live/hall'
      },
      {
        id: 'cam2',
        name: '前门监控',
        rtmpUrl: 'rtmp://example.com/live/frontdoor'
      },
      {
        id: 'cam3',
        name: '后院监控',
        rtmpUrl: 'rtmp://example.com/live/backyard'
      }
    ];

    for (const stream of sampleStreams) {
      await streamsManager.addStream(stream);
      console.log(`✓ 频道创建成功: ${stream.name} (${stream.id})`);
    }

    // 4. 显示初始化结果
    console.log('\n📊 初始化完成！以下是生成的数据：');
    console.log('=====================================');

    const allData = mockKV.getAll();
    for (const [key, value] of Object.entries(allData)) {
      console.log(`${key}:`);
      console.log(JSON.stringify(JSON.parse(value), null, 2));
      console.log('-------------------------------------');
    }

    // 5. 生成wrangler命令
    console.log('\n🔧 使用以下wrangler命令将数据上传到Cloudflare KV：');
    console.log('=====================================');

    for (const [key, value] of Object.entries(allData)) {
      console.log(`wrangler kv:key put --binding=USER_DB "${key}" '${value}'`);
    }

    console.log('\n✅ 初始化完成！');
    console.log('📝 请将上述wrangler命令复制并执行，将数据上传到Cloudflare KV。');
    console.log('\n🔐 默认账户信息：');
    console.log('管理员: admin / admin123456');
    console.log('普通用户: user / user123456');
    console.log('\n⚠️  请在生产环境中修改默认密码！');

  } catch (error) {
    console.error('❌ 初始化失败:', error);
    process.exit(1);
  }
}

// 执行初始化
initializeData();
import { generateSalt, hashPassword } from '../src/utils/crypto.js';

/**
 * 模拟KV操作的本地版本
 * 实际部署时需要手动在Cloudflare Dashboard中添加
 */
async function createAdminUser() {
  console.log('🔧 Creating admin user data...\n');

  // 默认管理员信息
  const adminUsername = 'admin';
  const adminPassword = 'Admin123!@#'; // 生产环境中请修改此密码

  try {
    // 生成盐值
    console.log('1️⃣ Generating salt...');
    const salt = await generateSalt();
    console.log(`   Salt: ${salt}\n`);

    // 哈希密码
    console.log('2️⃣ Hashing password...');
    const hashedPassword = await hashPassword(adminPassword, salt);
    console.log(`   Hashed password: ${hashedPassword}\n`);

    // 创建管理员用户数据
    const adminUser = {
      username: adminUsername,
      hashedPassword: hashedPassword,
      salt: salt,
      role: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log('3️⃣ Admin user data generated:');
    console.log(JSON.stringify(adminUser, null, 2));

    console.log('\n📝 Manual KV Setup Instructions:');
    console.log('================================');
    console.log('1. Go to Cloudflare Dashboard → Workers → KV');
    console.log('2. Open your USER_DB namespace');
    console.log('3. Add a new key-value pair:');
    console.log(`   Key: user:${adminUsername}`);
    console.log(`   Value: ${JSON.stringify(adminUser)}`);

    console.log('\n🔐 Login Credentials:');
    console.log('====================');
    console.log(`Username: ${adminUsername}`);
    console.log(`Password: ${adminPassword}`);
    console.log('\n⚠️  IMPORTANT: Change the password after first login!');

    // 创建初始流配置示例
    const initialStreams = [
      {
        id: "demo1",
        name: "演示频道 1",
        rtmpUrl: "rtmp://example.com/live/stream1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: "demo2", 
        name: "演示频道 2",
        rtmpUrl: "rtmp://example.com/live/stream2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    console.log('\n📺 Initial Streams Configuration:');
    console.log('=================================');
    console.log('4. Add another key-value pair for streams:');
    console.log('   Key: streams_config');
    console.log(`   Value: ${JSON.stringify(initialStreams, null, 2)}`);

    // 创建普通用户示例
    const regularUserPassword = 'User123!@#';
    const regularUserSalt = await generateSalt();
    const regularUserHash = await hashPassword(regularUserPassword, regularUserSalt);

    const regularUser = {
      username: 'user1',
      hashedPassword: regularUserHash,
      salt: regularUserSalt,
      role: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    console.log('\n👤 Regular User (Optional):');
    console.log('===========================');
    console.log('5. Add another key-value pair for regular user:');
    console.log('   Key: user:user1');
    console.log(`   Value: ${JSON.stringify(regularUser)}`);
    console.log(`\n   Login: user1 / ${regularUserPassword}`);

    console.log('\n✅ Setup Complete!');
    console.log('\nNext steps:');
    console.log('- Deploy your Worker with: wrangler deploy');
    console.log('- Configure your VPS_API_URL and VPS_API_KEY secrets');
    console.log('- Test login at: https://your-worker.your-subdomain.workers.dev/login');

  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  }
}

/**
 * 创建Wrangler secrets设置命令
 */
function generateSecretsCommands() {
  console.log('\n🔑 Wrangler Secrets Setup Commands:');
  console.log('===================================');
  console.log('Run these commands to set up your secrets:');
  console.log('');
  console.log('# Set VPS API configuration');
  console.log('wrangler secret put VPS_IP');
  console.log('wrangler secret put VPS_API_KEY');
  console.log('wrangler secret put VPS_API_URL');
  console.log('wrangler secret put VPS_HLS_URL');
  console.log('');
  console.log('# Optional: Set custom session timeout (milliseconds)');
  console.log('wrangler secret put SESSION_TIMEOUT');
  console.log('');
  console.log('Example values:');
  console.log('VPS_IP=192.168.1.100');
  console.log('VPS_API_KEY=your-super-secret-api-key-from-vps-config');
  console.log('VPS_API_URL=http://192.168.1.100:3000');
  console.log('VPS_HLS_URL=http://192.168.1.100:8080');
  console.log('SESSION_TIMEOUT=86400000');
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 YOYO Streaming Platform - Admin Setup');
  console.log('=========================================\n');

  await createAdminUser();
  generateSecretsCommands();

  console.log('\n📖 For more information, check the README.md file.');
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { createAdminUser };
