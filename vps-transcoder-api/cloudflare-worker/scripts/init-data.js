// scripts/init-data.js
import { UserManager, StreamsManager } from '../src/utils/kv.js';

// 模拟环境对象
const mockEnv = {
    USER_DB: {
        async put(key, value, options = {}) {
            console.log(`KV PUT: ${key} = ${value}`);
            // 这里需要实际调用wrangler kv:key put命令
            return Promise.resolve();
        },
        async get(key, type = 'text') {
            console.log(`KV GET: ${key}`);
            return null; // 初始化时返回null
        }
    }
};

async function initializeData() {
    const userManager = new UserManager(mockEnv.USER_DB);
    const streamsManager = new StreamsManager(mockEnv.USER_DB);

    try {
        // 创建管理员账户
        const adminSalt = userManager.generateSalt();
        const adminPassword = 'admin123'; // 请更改为安全密码
        const hashedPassword = await userManager.hashPassword(adminPassword, adminSalt);

        const adminUser = {
            username: 'admin',
            hashedPassword,
            salt: adminSalt,
            role: 'admin'
        };

        console.log('Admin user data:', JSON.stringify(adminUser, null, 2));

        // 创建示例流配置
        const sampleStreams = [
            {
                id: 'cam1',
                name: '大厅监控',
                rtmpUrl: 'rtmp://demo.server/live/hall',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'cam2',
                name: '入口监控',
                rtmpUrl: 'rtmp://demo.server/live/entrance',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ];

        console.log('Sample streams:', JSON.stringify(sampleStreams, null, 2));

        return { adminUser, sampleStreams };
    } catch (error) {
        console.error('Error initializing data:', error);
    }
}

initializeData();