// 调试Workers到VPS连接的专用脚本
const https = require('https');

// 忽略SSL证书错误（仅用于测试）
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

const WORKERS_API = 'https://yoyoapi.5202021.xyz';
const VPS_API = 'https://yoyo-vps.5202021.xyz';

// 简单的HTTP请求函数
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : require('http');
        
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'YOYO-Debug-Client/1.0',
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
                    resolve({ status: res.statusCode, data: jsonData, headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, headers: res.headers });
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

async function debugVpsConnection() {
    console.log('=== VPS连接调试 ===\n');

    // 1. 直接测试VPS健康检查
    console.log('1. 直接测试VPS健康检查...');
    try {
        const vpsResponse = await makeRequest(`${VPS_API}/health`);
        console.log(`✅ VPS直接访问成功 (状态码: ${vpsResponse.status})`);
        console.log(`   响应: ${JSON.stringify(vpsResponse.data)}`);
    } catch (error) {
        console.log(`❌ VPS直接访问失败: ${error.message}`);
        return;
    }

    console.log('');

    // 2. 测试VPS API密钥认证
    console.log('2. 测试VPS API密钥认证...');
    try {
        const vpsAuthResponse = await makeRequest(`${VPS_API}/health`, {
            headers: {
                'X-API-Key': '85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938'
            }
        });
        console.log(`✅ VPS API密钥认证成功 (状态码: ${vpsAuthResponse.status})`);
        console.log(`   响应: ${JSON.stringify(vpsAuthResponse.data)}`);
    } catch (error) {
        console.log(`❌ VPS API密钥认证失败: ${error.message}`);
    }

    console.log('');

    // 3. 测试Workers管理员诊断API
    console.log('3. 测试Workers管理员诊断API...');
    
    // 先登录获取会话
    try {
        const loginResponse = await makeRequest(`${WORKERS_API}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                username: 'admin',
                password: 'admin123'
            }
        });

        if (loginResponse.status === 200 && loginResponse.data.status === 'success') {
            const sessionId = loginResponse.data.data.session.sessionId;
            console.log(`✅ 管理员登录成功，会话ID: ${sessionId}`);

            // 测试诊断API
            try {
                const diagnosticsResponse = await makeRequest(`${WORKERS_API}/api/admin/diagnostics`, {
                    headers: {
                        'Cookie': `sessionId=${sessionId}`
                    }
                });

                console.log(`📊 诊断API响应 (状态码: ${diagnosticsResponse.status}):`);
                console.log(JSON.stringify(diagnosticsResponse.data, null, 2));

                // 特别检查VPS连接状态
                if (diagnosticsResponse.data && diagnosticsResponse.data.data) {
                    const vpsStatus = diagnosticsResponse.data.data.vps;
                    if (vpsStatus) {
                        console.log('\n🔍 VPS连接详情:');
                        console.log(`   连接状态: ${vpsStatus.connected ? '✅ 已连接' : '❌ 未连接'}`);
                        console.log(`   API URL: ${vpsStatus.apiUrl || '未配置'}`);
                        console.log(`   错误信息: ${vpsStatus.error || '无'}`);
                    }
                }

            } catch (error) {
                console.log(`❌ 诊断API请求失败: ${error.message}`);
            }

            // 测试VPS健康检查API
            console.log('\n4. 测试Workers VPS健康检查API...');
            try {
                const vpsHealthResponse = await makeRequest(`${WORKERS_API}/api/admin/vps/health`, {
                    headers: {
                        'Cookie': `sessionId=${sessionId}`
                    }
                });

                console.log(`🏥 VPS健康检查API响应 (状态码: ${vpsHealthResponse.status}):`);
                console.log(JSON.stringify(vpsHealthResponse.data, null, 2));

            } catch (error) {
                console.log(`❌ VPS健康检查API请求失败: ${error.message}`);
            }

        } else {
            console.log(`❌ 管理员登录失败: ${JSON.stringify(loginResponse.data)}`);
        }
    } catch (error) {
        console.log(`❌ 管理员登录请求失败: ${error.message}`);
    }

    console.log('\n=== 调试完成 ===');
    console.log('\n💡 调试建议:');
    console.log('1. 检查Workers环境变量是否正确配置');
    console.log('2. 验证VPS API URL和API Key的正确性');
    console.log('3. 确认Workers代码中的VPS连接逻辑');
    console.log('4. 检查网络连接和防火墙设置');
}

// 运行调试
debugVpsConnection().catch(console.error);
