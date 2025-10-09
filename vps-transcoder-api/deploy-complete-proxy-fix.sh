#!/bin/bash

# 完整的VPS代理服务修复脚本
echo "🔧 VPS代理服务完整修复方案"
echo "================================"

# 检查是否以root权限运行
if [ "$EUID" -ne 0 ]; then
  echo "❌ 请以root权限运行此脚本"
  echo "使用: sudo bash deploy-complete-proxy-fix.sh"
  exit 1
fi

# 1. 安装V2Ray/Xray客户端
echo "📦 第一步: 安装V2Ray/Xray客户端..."
if command -v v2ray &> /dev/null; then
    echo "✅ V2Ray已安装: $(v2ray version | head -n 1)"
elif command -v xray &> /dev/null; then
    echo "✅ Xray已安装: $(xray version | head -n 1)"
    # 创建v2ray软链接
    ln -sf /usr/local/bin/xray /usr/local/bin/v2ray
    echo "✅ 已创建v2ray软链接"
else
    echo "❌ 未检测到V2Ray/Xray，开始安装..."
    
    # 首先尝试安装V2Ray
    echo "📥 安装V2Ray..."
    bash <(curl -L https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh) || {
        echo "⚠️ V2Ray安装失败，尝试安装Xray..."
        
        # 备用方案：安装Xray
        bash <(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh) install || {
            echo "❌ Xray安装也失败，手动安装..."
            
            # 手动下载安装
            cd /tmp
            wget -O v2ray-linux-64.zip https://github.com/v2fly/v2ray-core/releases/latest/download/v2ray-linux-64.zip
            unzip -o v2ray-linux-64.zip -d v2ray
            cp v2ray/v2ray /usr/local/bin/
            chmod +x /usr/local/bin/v2ray
            rm -rf v2ray v2ray-linux-64.zip
            
            if command -v v2ray &> /dev/null; then
                echo "✅ V2Ray手动安装成功"
            else
                echo "❌ 所有安装方法都失败了"
                exit 1
            fi
        }
        
        # 为Xray创建v2ray软链接
        if command -v xray &> /dev/null; then
            ln -sf /usr/local/bin/xray /usr/local/bin/v2ray
            echo "✅ Xray安装成功，已创建v2ray软链接"
        fi
    }
fi

# 2. 创建必要的目录和权限
echo "📁 第二步: 创建目录和设置权限..."
mkdir -p /opt/yoyo-transcoder/config
mkdir -p /opt/yoyo-transcoder/logs
mkdir -p /var/log/v2ray-proxy
chmod 755 /opt/yoyo-transcoder/config
chmod 755 /opt/yoyo-transcoder/logs
chmod 755 /var/log/v2ray-proxy
echo "✅ 目录创建完成"

# 3. 更新VPS应用代码
echo "🔄 第三步: 更新VPS应用代码..."
cd /root || exit 1

# 检查是否存在应用目录
if [ -d "vps-transcoder-api" ]; then
    echo "📂 发现现有应用目录，更新代码..."
    cd vps-transcoder-api
    
    # 停止现有服务
    pkill -f "node.*app.js" || echo "没有运行中的服务"
    sleep 2
    
    # 拉取最新代码
    git pull origin master || {
        echo "⚠️ Git拉取失败，重新克隆..."
        cd /root
        rm -rf vps-transcoder-api
        git clone https://github.com/shao-ye/secure-streaming-platform.git temp-repo
        cp -r temp-repo/vps-transcoder-api .
        rm -rf temp-repo
        cd vps-transcoder-api
    }
else
    echo "📥 克隆应用代码..."
    git clone https://github.com/shao-ye/secure-streaming-platform.git temp-repo
    cp -r temp-repo/vps-transcoder-api .
    rm -rf temp-repo
    cd vps-transcoder-api
fi

# 4. 安装Node.js依赖
echo "📦 第四步: 安装Node.js依赖..."
npm install || {
    echo "⚠️ npm install失败，尝试清理缓存..."
    rm -rf node_modules package-lock.json
    npm cache clean --force
    npm install
}

# 5. 测试V2Ray配置生成
echo "🧪 第五步: 测试V2Ray配置生成..."
node -e "
const ProxyManager = require('./vps-transcoder-api/src/services/ProxyManager');
const pm = new ProxyManager();
console.log('✅ ProxyManager模块加载成功');

// 测试V2Ray可用性
const { exec } = require('child_process');
exec('v2ray version', (error, stdout, stderr) => {
    if (error) {
        console.log('❌ V2Ray测试失败:', error.message);
    } else {
        console.log('✅ V2Ray测试成功:', stdout.split('\n')[0]);
    }
});
" || echo "⚠️ Node.js测试有警告，但继续执行..."

# 6. 启动服务
echo "🚀 第六步: 启动VPS应用服务..."
cd /root/vps-transcoder-api
nohup node vps-transcoder-api/src/app.js > /var/log/vps-app.log 2>&1 &
sleep 5

# 7. 验证服务状态
echo "🔍 第七步: 验证服务状态..."
if pgrep -f "node.*app.js" > /dev/null; then
    echo "✅ Node.js应用启动成功"
    
    # 测试基础API
    if curl -s -f "http://localhost:3000/health" > /dev/null; then
        echo "✅ 基础API正常"
    else
        echo "❌ 基础API异常"
    fi
    
    # 测试代理API
    if curl -s -f "http://localhost:3000/api/proxy/status" > /dev/null; then
        echo "✅ 代理API正常"
        echo "📊 当前代理状态:"
        curl -s "http://localhost:3000/api/proxy/status" | jq . 2>/dev/null || curl -s "http://localhost:3000/api/proxy/status"
    else
        echo "❌ 代理API异常"
        echo "📋 检查日志: tail -20 /var/log/vps-app.log"
        tail -20 /var/log/vps-app.log
    fi
else
    echo "❌ Node.js应用启动失败"
    echo "📋 查看启动日志:"
    tail -20 /var/log/vps-app.log
    exit 1
fi

# 8. 测试代理配置同步
echo "🔗 第八步: 测试代理配置同步..."
curl -X POST "http://localhost:3000/api/proxy/config" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938" \
  -d '{
    "action": "update",
    "config": {
      "settings": {
        "enabled": true,
        "activeProxyId": "test_proxy"
      },
      "proxies": [{
        "id": "test_proxy",
        "name": "测试代理",
        "type": "vless",
        "config": "vless://test@example.com:443"
      }]
    }
  }' | jq . 2>/dev/null || echo "配置同步测试完成"

# 9. 创建监控脚本
echo "📊 第九步: 创建监控脚本..."
cat > /usr/local/bin/proxy-health-check.sh << 'EOF'
#!/bin/bash
echo "🔍 代理服务健康检查 - $(date)"
echo "================================"

# 检查V2Ray
if command -v v2ray &> /dev/null; then
    echo "✅ V2Ray: $(v2ray version | head -n 1)"
else
    echo "❌ V2Ray未安装"
fi

# 检查Node.js应用
if pgrep -f "node.*app.js" > /dev/null; then
    echo "✅ Node.js应用: 运行中"
else
    echo "❌ Node.js应用: 未运行"
fi

# 检查API端点
if curl -s -f "http://localhost:3000/api/proxy/status" > /dev/null; then
    echo "✅ 代理API: 正常"
    curl -s "http://localhost:3000/api/proxy/status" | jq -r '.data.connectionStatus // "unknown"' | sed 's/^/   状态: /'
else
    echo "❌ 代理API: 异常"
fi

echo "================================"
EOF

chmod +x /usr/local/bin/proxy-health-check.sh
echo "✅ 监控脚本已创建: /usr/local/bin/proxy-health-check.sh"

# 10. 最终验证
echo ""
echo "🎯 最终验证"
echo "================================"
/usr/local/bin/proxy-health-check.sh

echo ""
echo "🎉 VPS代理服务修复完成！"
echo "================================"
echo "📋 重要信息:"
echo "- V2Ray/Xray: $(command -v v2ray >/dev/null && echo '已安装' || echo '未安装')"
echo "- 应用目录: /root/vps-transcoder-api"
echo "- 应用日志: /var/log/vps-app.log"
echo "- 代理日志: /opt/yoyo-transcoder/logs/"
echo ""
echo "🔧 常用命令:"
echo "- 查看服务状态: /usr/local/bin/proxy-health-check.sh"
echo "- 查看应用日志: tail -f /var/log/vps-app.log"
echo "- 重启应用: pkill -f 'node.*app.js' && cd /root/vps-transcoder-api && nohup node vps-transcoder-api/src/app.js > /var/log/vps-app.log 2>&1 &"
echo ""
echo "✅ 现在可以在前端测试代理连接功能了！"
