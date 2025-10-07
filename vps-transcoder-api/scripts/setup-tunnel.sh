#!/bin/bash
# Cloudflare Tunnel设置脚本

echo "🚀 开始配置Cloudflare Tunnel..."

# 检查cloudflared是否已安装
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared未安装，请先安装"
    exit 1
fi

echo "✅ cloudflared已安装: $(cloudflared --version)"

# 检查配置文件
if [ ! -f "/root/.cloudflared/config.yml" ]; then
    echo "❌ 配置文件不存在: /root/.cloudflared/config.yml"
    exit 1
fi

echo "✅ 配置文件存在"

# 显示下一步操作
echo ""
echo "📋 请手动执行以下步骤："
echo ""
echo "1. 登录Cloudflare并授权:"
echo "   cloudflared tunnel login"
echo ""
echo "2. 创建隧道:"
echo "   cloudflared tunnel create yoyo-streaming"
echo ""
echo "3. 在Cloudflare Dashboard中添加DNS记录:"
echo "   tunnel-api.yoyo-vps.5202021.xyz    → CNAME → yoyo-streaming.cfargotunnel.com"
echo "   tunnel-hls.yoyo-vps.5202021.xyz    → CNAME → yoyo-streaming.cfargotunnel.com"
echo "   tunnel-health.yoyo-vps.5202021.xyz → CNAME → yoyo-streaming.cfargotunnel.com"
echo ""
echo "4. 测试隧道连接:"
echo "   cloudflared tunnel --config /root/.cloudflared/config.yml run yoyo-streaming"
echo ""
echo "5. 启动PM2服务:"
echo "   cd /opt/yoyo-transcoder"
echo "   pm2 start ecosystem.config.js --env production"
echo ""
echo "6. 验证服务:"
echo "   pm2 status"
echo "   curl https://tunnel-health.yoyo-vps.5202021.xyz/health"
echo ""

# 检查当前服务状态
echo "📊 当前服务状态:"
pm2 status

echo ""
echo "🎯 Phase 1 VPS端配置准备完成!"
echo "请按照上述步骤手动完成隧道设置。"
