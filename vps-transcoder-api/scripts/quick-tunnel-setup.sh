#!/bin/bash

# 快速隧道配置脚本 - 跳过登录等待

echo "🚀 快速隧道配置开始..."

# 方案1: 使用预设的隧道配置 (无需登录)
echo "📝 创建隧道配置文件..."

# 创建临时配置 (使用服务模式)
cat > /root/.cloudflared/config.yml << 'EOF'
# 临时配置 - 等待Dashboard配置完成
tunnel: yoyo-streaming
credentials-file: /root/.cloudflared/yoyo-streaming.json

ingress:
  - hostname: tunnel-api.yoyo-vps.5202021.xyz
    service: http://localhost:3000
  - hostname: tunnel-hls.yoyo-vps.5202021.xyz
    service: http://localhost:8080
  - hostname: tunnel-health.yoyo-vps.5202021.xyz
    service: http://localhost:3000/health
  - service: http_status:404

# 日志配置
loglevel: info
logfile: /var/log/cloudflared.log
EOF

echo "✅ 配置文件已创建"

# 方案2: 提供Dashboard配置指引
echo ""
echo "🌐 推荐使用Cloudflare Dashboard配置:"
echo "1. 访问: https://dash.cloudflare.com"
echo "2. 选择域名: 5202021.xyz"
echo "3. Zero Trust → Networks → Tunnels"
echo "4. Create tunnel → 名称: yoyo-streaming"
echo "5. 下载配置文件到 /root/.cloudflared/"
echo ""

# 方案3: 等待用户提供token
echo "🔑 或者提供隧道Token直接启动:"
echo "cloudflared service install <YOUR_TOKEN>"
echo ""

# 检查当前状态
if [ -f "/root/.cloudflared/yoyo-streaming.json" ]; then
    echo "✅ 隧道凭证文件已存在"
    
    # 测试隧道连接
    echo "🔍 测试隧道连接..."
    timeout 10 cloudflared tunnel --config /root/.cloudflared/config.yml run yoyo-streaming &
    TUNNEL_PID=$!
    
    sleep 5
    
    # 检查隧道是否运行
    if kill -0 $TUNNEL_PID 2>/dev/null; then
        echo "✅ 隧道测试成功"
        kill $TUNNEL_PID
        
        # 安装为系统服务
        echo "📦 安装隧道服务..."
        cloudflared service install --config /root/.cloudflared/config.yml
        systemctl start cloudflared
        systemctl enable cloudflared
        
        echo "🎉 隧道服务已启动!"
        systemctl status cloudflared --no-pager
    else
        echo "⚠️ 隧道测试失败，请检查配置"
    fi
else
    echo "⚠️ 隧道凭证文件不存在，请先完成Dashboard配置"
fi

echo ""
echo "📊 下一步: 在Cloudflare Dashboard中验证隧道状态"
echo "🔗 或访问: https://yoyo.5202021.xyz/admin (隧道优化选项卡)"
