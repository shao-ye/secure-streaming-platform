// scripts/generate-data.cjs
// 使用CommonJS语法的数据生成脚本

const crypto = require('crypto');

// 生成随机盐值
function generateSalt(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

// 使用Node.js crypto模块哈希密码
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
}

async function generateInitialData() {
    try {
        console.log('=== 生成YOYO流媒体平台初始数据 ===\n');

        // 创建管理员账户
        const adminSalt = generateSalt();
        const adminPassword = 'admin123'; // 请在生产环境中更改为安全密码
        const hashedPassword = hashPassword(adminPassword, adminSalt);

        const adminUser = {
            username: 'admin',
            hashedPassword,
            salt: adminSalt,
            role: 'admin',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        console.log('📋 管理员账户数据:');
        console.log('用户名: admin');
        console.log('密码: admin123');
        console.log('角色: admin');
        console.log('\n🔑 KV存储命令 (管理员账户):');
        console.log(`wrangler kv key put "user:admin" '${JSON.stringify(adminUser)}' --binding YOYO_USER_DB --preview false`);

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

        console.log('\n📺 流配置数据:');
        console.log(`流数量: ${sampleStreams.length}`);
        sampleStreams.forEach(stream => {
            console.log(`- ${stream.name} (${stream.id}): ${stream.rtmpUrl}`);
        });

        console.log('\n🔑 KV存储命令 (流配置):');
        console.log(`wrangler kv key put "streams_config" '${JSON.stringify(sampleStreams)}' --binding YOYO_USER_DB --preview false`);

        console.log('\n=== 数据生成完成 ===');
        console.log('\n📝 执行步骤:');
        console.log('1. 复制上面的两个wrangler命令');
        console.log('2. 在终端中分别执行这两个命令');
        console.log('3. 验证数据存储: wrangler kv key list --binding YOYO_USER_DB --preview false');
        console.log('4. 启动Worker开发服务器: wrangler dev');

        // 生成批处理文件方便执行
        const batchCommands = [
            `wrangler kv key put "user:admin" '${JSON.stringify(adminUser)}' --binding YOYO_USER_DB --preview false`,
            `wrangler kv key put "streams_config" '${JSON.stringify(sampleStreams)}' --binding YOYO_USER_DB --preview false`,
            `echo "数据初始化完成！"`,
            `wrangler kv key list --binding YOYO_USER_DB --preview false`
        ];

        console.log('\n💡 或者创建批处理文件 init-kv.bat:');
        batchCommands.forEach(cmd => console.log(cmd));

        return { adminUser, sampleStreams };
    } catch (error) {
        console.error('❌ 生成数据时出错:', error);
        process.exit(1);
    }
}

// 运行数据生成
generateInitialData();
