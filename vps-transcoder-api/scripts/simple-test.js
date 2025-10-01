// YOYO流媒体平台简单功能测试
const https = require('https');
const http = require('http');

// 配置信息
const WORKERS_API = 'https://yoyoapi.5202021.xyz';
const VPS_API = 'https://yoyo-vps.5202021.xyz';
const FRONTEND_URL = 'https://yoyo.5202021.xyz';

// 忽略SSL证书错误（仅用于测试）
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

// 简单的HTTP请求函数
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'YOYO-Test-Client/1.0',
                'Accept': 'application/json',
                ...options.headers
            }
        };

        const req = client.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ status: res.statusCode, data: jsonData });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (options.body) {
            req.write(JSON.stringify(options.body));
        }

        req.end();
    });
}

// 测试函数
async function testAPI() {
    console.log('=== YOYO流媒体平台功能测试 ===\n');

    // 1. 测试Workers API健康检查
    console.log('1. 测试Cloudflare Workers API...');
    try {
        const response = await makeRequest(`${WORKERS_API}/api/health`);
        if (response.status === 200) {
            console.log('✅ Workers API正常');
            console.log(`   响应: ${JSON.stringify(response.data)}`);
        } else {
            console.log(`❌ Workers API异常 (状态码: ${response.status})`);
        }
    } catch (error) {
        console.log(`❌ Workers API连接失败: ${error.message}`);
    }

    console.log('');

    // 2. 测试VPS API健康检查
    console.log('2. 测试VPS转码API...');
    try {
        const response = await makeRequest(`${VPS_API}/health`);
        if (response.status === 200) {
            console.log('✅ VPS API正常');
            console.log(`   响应: ${JSON.stringify(response.data)}`);
        } else {
            console.log(`❌ VPS API异常 (状态码: ${response.status})`);
        }
    } catch (error) {
        console.log(`❌ VPS API连接失败: ${error.message}`);
    }

    console.log('');

    // 3. 测试用户登录
    console.log('3. 测试用户登录...');
    try {
        const response = await makeRequest(`${WORKERS_API}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                username: 'admin',
                password: 'admin123'
            }
        });

        if (response.status === 200 && response.data.status === 'success') {
            console.log('✅ 用户登录成功');
            console.log(`   会话ID: ${response.data.data.session.sessionId}`);
            
            // 4. 测试频道列表
            console.log('\n4. 测试频道列表...');
            const sessionId = response.data.data.session.sessionId;
            
            try {
                const streamsResponse = await makeRequest(`${WORKERS_API}/api/streams`, {
                    headers: {
                        'Cookie': `sessionId=${sessionId}`
                    }
                });

                if (streamsResponse.status === 200 && streamsResponse.data.status === 'success') {
                    console.log('✅ 频道列表获取成功');
                    console.log(`   频道数量: ${streamsResponse.data.data.streams.length}`);
                    
                    streamsResponse.data.data.streams.forEach((stream, index) => {
                        console.log(`   ${index + 1}. ${stream.name} (ID: ${stream.id})`);
                    });

                    // 5. 测试播放请求（如果有频道）
                    if (streamsResponse.data.data.streams.length > 0) {
                        console.log('\n5. 测试播放请求...');
                        const testStream = streamsResponse.data.data.streams[0];
                        
                        try {
                            const playResponse = await makeRequest(`${WORKERS_API}/api/play/${testStream.id}`, {
                                method: 'POST',
                                headers: {
                                    'Cookie': `sessionId=${sessionId}`
                                }
                            });

                            if (playResponse.status === 200 && playResponse.data.status === 'success') {
                                console.log('✅ 播放请求成功');
                                console.log(`   HLS地址: ${playResponse.data.data.hlsUrl}`);
                            } else {
                                console.log(`❌ 播放请求失败: ${JSON.stringify(playResponse.data)}`);
                            }
                        } catch (error) {
                            console.log(`❌ 播放请求失败: ${error.message}`);
                        }
                    } else {
                        console.log('\n⚠️  没有配置的频道，跳过播放测试');
                    }
                } else {
                    console.log(`❌ 频道列表获取失败: ${JSON.stringify(streamsResponse.data)}`);
                }
            } catch (error) {
                console.log(`❌ 频道列表请求失败: ${error.message}`);
            }
        } else {
            console.log(`❌ 用户登录失败: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.log(`❌ 登录请求失败: ${error.message}`);
    }

    console.log('');

    // 6. 测试VPS转码状态
    console.log('6. 测试VPS转码状态...');
    try {
        const response = await makeRequest(`${VPS_API}/streams`, {
            headers: {
                'X-API-Key': '85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938'
            }
        });

        if (response.status === 200) {
            console.log('✅ VPS转码状态获取成功');
            if (response.data.streams && response.data.streams.length > 0) {
                console.log(`   运行中的转码进程: ${response.data.streams.length}`);
                response.data.streams.forEach((stream, index) => {
                    console.log(`   ${index + 1}. ${stream.streamId} (PID: ${stream.pid})`);
                });
            } else {
                console.log('   当前没有运行中的转码进程');
            }
        } else {
            console.log(`❌ VPS转码状态获取失败 (状态码: ${response.status})`);
        }
    } catch (error) {
        console.log(`❌ VPS转码状态请求失败: ${error.message}`);
    }

    console.log('\n=== 测试完成 ===');
    console.log('\n📋 下一步操作建议:');
    console.log('1. 如果所有API都正常，可以在前端页面进行播放测试');
    console.log(`2. 前端地址: ${FRONTEND_URL}`);
    console.log('3. 使用 admin/admin123 登录');
    console.log('4. 选择频道进行播放测试');
    console.log('5. 如需查看详细日志，请SSH到VPS执行: pm2 logs vps-transcoder-api');
}

// 运行测试
testAPI().catch(console.error);
