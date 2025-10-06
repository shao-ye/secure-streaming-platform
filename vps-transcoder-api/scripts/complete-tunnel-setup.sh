#!/bin/bash

# 🚀 Cloudflare Tunnel 一键安装脚本
# 复制整个脚本到VPS执行即可

echo "🚀 开始Cloudflare Tunnel完整安装..."

# 检查cloudflared是否已安装
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared未安装，请先安装"
    exit 1
fi

# 设置变量
TUNNEL_NAME="yoyo-streaming"
TUNNEL_ID="071aeb49-a619-4543-aee4-c9a13b4e84e4"
CONFIG_DIR="/root/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/config.yml"

echo "📋 隧道信息:"
echo "- 名称: $TUNNEL_NAME"
echo "- ID: $TUNNEL_ID"
echo "- 配置目录: $CONFIG_DIR"

# 确保配置目录存在
mkdir -p $CONFIG_DIR

# 创建配置文件
echo "📝 创建配置文件..."
cat > $CONFIG_FILE << EOF
tunnel: $TUNNEL_ID
credentials-file: $CONFIG_DIR/$TUNNEL_ID.json

ingress:
  - hostname: tunnel-api.yoyo-vps.5202021.xyz
    service: http://localhost:3000
  - hostname: tunnel-hls.yoyo-vps.5202021.xyz
    service: http://localhost:8080
  - hostname: tunnel-health.yoyo-vps.5202021.xyz
    service: http://localhost:3000
  - service: http_status:404

loglevel: info
logfile: /var/log/cloudflared.log
EOF

echo "✅ 配置文件已创建"

# 验证凭证文件是否存在
CRED_FILE="$CONFIG_DIR/$TUNNEL_ID.json"
if [ ! -f "$CRED_FILE" ]; then
    echo "❌ 隧道凭证文件不存在: $CRED_FILE"
    echo "请确保已执行: cloudflared tunnel create $TUNNEL_NAME"
    exit 1
fi

echo "✅ 隧道凭证文件存在"

# 测试隧道配置
echo "🔍 测试隧道配置..."
timeout 10 cloudflared --config $CONFIG_FILE tunnel run &
TEST_PID=$!
sleep 5

if kill -0 $TEST_PID 2>/dev/null; then
    echo "✅ 隧道配置测试成功"
    kill $TEST_PID
    wait $TEST_PID 2>/dev/null
else
    echo "⚠️ 隧道配置可能有问题，继续安装..."
fi

# 方法1: 尝试自动安装服务
echo "📦 尝试自动安装服务..."
if cloudflared --config $CONFIG_FILE service install 2>/dev/null; then
    echo "✅ 服务自动安装成功"
    SERVICE_INSTALLED=true
else
    echo "⚠️ 自动安装失败，创建手动服务..."
    SERVICE_INSTALLED=false
fi

# 方法2: 手动创建服务文件
if [ "$SERVICE_INSTALLED" = false ]; then
    echo "📝 创建systemd服务文件..."
    cat > /etc/systemd/system/cloudflared.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
TimeoutStartSec=0
Type=simple
User=root
ExecStart=/usr/local/bin/cloudflared --config /root/.cloudflared/config.yml tunnel run
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # 重新加载systemd
    systemctl daemon-reload
    echo "✅ 手动服务文件已创建"
fi

# 启动服务
echo "🚀 启动隧道服务..."
systemctl enable cloudflared
systemctl start cloudflared

# 等待服务启动
sleep 5

# 检查服务状态
echo "🔍 检查服务状态..."
if systemctl is-active --quiet cloudflared; then
    echo "✅ 隧道服务运行正常"
    systemctl status cloudflared --no-pager -l
else
    echo "⚠️ 服务启动失败，尝试手动运行..."
    
    # 手动后台运行
    nohup cloudflared --config $CONFIG_FILE tunnel run > /var/log/cloudflared-manual.log 2>&1 &
    MANUAL_PID=$!
    echo "手动启动PID: $MANUAL_PID"
    
    # 保存PID
    echo $MANUAL_PID > /var/run/cloudflared-manual.pid
    
    sleep 3
    if kill -0 $MANUAL_PID 2>/dev/null; then
        echo "✅ 隧道手动启动成功"
        echo "日志: tail -f /var/log/cloudflared-manual.log"
    else
        echo "❌ 隧道启动失败"
        echo "检查日志: cat /var/log/cloudflared-manual.log"
    fi
fi

# 检查隧道信息
echo ""
echo "🔍 隧道信息:"
cloudflared tunnel info $TUNNEL_NAME 2>/dev/null || echo "无法获取隧道信息"

# 等待DNS传播
echo ""
echo "⏳ 等待DNS传播和服务完全启动..."
sleep 15

# 测试连接
echo ""
echo "🌐 测试隧道连接..."

echo "测试 tunnel-health.yoyo-vps.5202021.xyz/health:"
if curl -s -I https://tunnel-health.yoyo-vps.5202021.xyz/health 2>/dev/null | head -1; then
    echo "✅ tunnel-health 连接成功"
else
    echo "⚠️ tunnel-health 连接失败或还在启动中"
fi

echo ""
echo "测试 tunnel-api.yoyo-vps.5202021.xyz/health:"
if curl -s -I https://tunnel-api.yoyo-vps.5202021.xyz/health 2>/dev/null | head -1; then
    echo "✅ tunnel-api 连接成功"
else
    echo "⚠️ tunnel-api 连接失败或还在启动中"
fi

# 显示最终状态
echo ""
echo "🎉 隧道安装完成！"
echo ""
echo "📊 隧道端点:"
echo "- API服务: https://tunnel-api.yoyo-vps.5202021.xyz"
echo "- HLS文件: https://tunnel-hls.yoyo-vps.5202021.xyz"
echo "- 健康检查: https://tunnel-health.yoyo-vps.5202021.xyz"
echo ""
echo "📋 管理命令:"
echo "- 查看状态: systemctl status cloudflared"
echo "- 查看日志: journalctl -u cloudflared -f"
echo "- 重启服务: systemctl restart cloudflared"
echo "- 停止服务: systemctl stop cloudflared"
echo ""
echo "🔗 下一步:"
echo "1. 访问 https://yoyo.5202021.xyz/admin"
echo "2. 进入'隧道优化'选项卡"
echo "3. 启用隧道优化功能"
echo ""
echo "📊 当前进程:"
ps aux | grep cloudflared | grep -v grep || echo "未找到cloudflared进程"

echo ""
echo "✅ 安装脚本执行完成！"
