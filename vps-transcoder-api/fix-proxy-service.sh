#!/bin/bash

# VPS代理服务修复脚本
echo "🔧 VPS代理服务修复脚本"
echo "================================"

# 检查是否以root权限运行
if [ "$EUID" -ne 0 ]; then
  echo "❌ 请以root权限运行此脚本"
  echo "使用: sudo ./fix-proxy-service.sh"
  exit 1
fi

# 1. 检查并安装V2Ray
echo "📦 检查V2Ray安装状态..."
if command -v v2ray &> /dev/null; then
    echo "✅ V2Ray已安装: $(v2ray version | head -n 1)"
else
    echo "❌ V2Ray未安装，开始安装..."
    
    # 下载并安装V2Ray
    bash <(curl -L https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh)
    
    if [ $? -eq 0 ]; then
        echo "✅ V2Ray安装成功"
    else
        echo "❌ V2Ray安装失败，尝试备用方案..."
        
        # 备用安装方案 - 使用Xray
        bash <(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh) install
        
        if [ $? -eq 0 ]; then
            echo "✅ Xray安装成功（V2Ray兼容）"
            # 创建v2ray软链接指向xray
            ln -sf /usr/local/bin/xray /usr/local/bin/v2ray
        else
            echo "❌ 代理客户端安装失败，请手动安装"
            exit 1
        fi
    fi
fi

# 2. 创建必要的目录
echo "📁 创建代理配置目录..."
mkdir -p /etc/v2ray-proxy
mkdir -p /var/log/v2ray-proxy
chmod 755 /etc/v2ray-proxy
chmod 755 /var/log/v2ray-proxy

echo "✅ 目录创建完成"

# 3. 检查Node.js应用状态
echo "🔍 检查Node.js应用状态..."
if pgrep -f "node.*app.js" > /dev/null; then
    echo "✅ Node.js应用正在运行"
    
    # 重启应用以加载代理服务
    echo "🔄 重启Node.js应用以加载代理服务..."
    pkill -f "node.*app.js"
    sleep 2
    
    # 假设应用在/root/vps-transcoder-api目录
    cd /root/vps-transcoder-api
    nohup node src/app.js > /var/log/vps-app.log 2>&1 &
    
    sleep 3
    
    if pgrep -f "node.*app.js" > /dev/null; then
        echo "✅ Node.js应用重启成功"
    else
        echo "❌ Node.js应用重启失败"
    fi
else
    echo "❌ Node.js应用未运行"
fi

# 4. 测试代理API端点
echo "🧪 测试代理API端点..."
sleep 2

# 测试代理状态端点
if curl -s -f "http://localhost:3000/api/proxy/status" > /dev/null; then
    echo "✅ 代理状态API正常"
else
    echo "❌ 代理状态API异常"
fi

# 5. 检查防火墙设置
echo "🔥 检查防火墙设置..."
if command -v ufw &> /dev/null; then
    # 确保必要端口开放
    ufw allow 3000/tcp
    echo "✅ 防火墙规则已更新"
elif command -v firewall-cmd &> /dev/null; then
    # CentOS/RHEL
    firewall-cmd --permanent --add-port=3000/tcp
    firewall-cmd --reload
    echo "✅ 防火墙规则已更新"
fi

# 6. 创建代理服务监控脚本
echo "📊 创建代理服务监控脚本..."
cat > /usr/local/bin/check-proxy-service.sh << 'EOF'
#!/bin/bash
# 代理服务健康检查脚本

echo "🔍 代理服务健康检查"
echo "===================="

# 检查V2Ray
if command -v v2ray &> /dev/null; then
    echo "✅ V2Ray可用: $(v2ray version | head -n 1)"
else
    echo "❌ V2Ray不可用"
fi

# 检查Node.js应用
if pgrep -f "node.*app.js" > /dev/null; then
    echo "✅ Node.js应用运行中"
else
    echo "❌ Node.js应用未运行"
fi

# 检查代理API
if curl -s -f "http://localhost:3000/api/proxy/status" > /dev/null; then
    echo "✅ 代理API正常"
    curl -s "http://localhost:3000/api/proxy/status" | jq .
else
    echo "❌ 代理API异常"
fi

echo "===================="
EOF

chmod +x /usr/local/bin/check-proxy-service.sh

echo "✅ 监控脚本已创建: /usr/local/bin/check-proxy-service.sh"

# 7. 最终状态检查
echo ""
echo "🎯 最终状态检查"
echo "================================"

# 运行健康检查
/usr/local/bin/check-proxy-service.sh

echo ""
echo "🔧 修复完成！"
echo "================================"
echo "📋 后续步骤:"
echo "1. 在前端测试代理连接功能"
echo "2. 检查代理配置是否正确同步"
echo "3. 监控代理连接状态"
echo ""
echo "🔍 如需调试，请查看日志:"
echo "- 应用日志: /var/log/vps-app.log"
echo "- 代理日志: /var/log/v2ray-proxy/"
echo ""
echo "💡 运行健康检查: /usr/local/bin/check-proxy-service.sh"
