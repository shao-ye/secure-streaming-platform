#!/bin/bash

# VPS代理服务更新脚本
echo "🚀 VPS代理服务更新脚本"
echo "================================"

# 1. 进入应用目录
cd /root/vps-transcoder-api || {
    echo "❌ 应用目录不存在，请先部署应用"
    exit 1
}

# 2. 停止现有服务
echo "🛑 停止现有服务..."
pkill -f "node.*app.js" || echo "没有运行中的服务"

# 3. 拉取最新代码
echo "📥 拉取最新代码..."
git pull origin master || {
    echo "❌ 代码拉取失败"
    exit 1
}

# 4. 安装依赖
echo "📦 安装依赖..."
npm install

# 5. 启动服务
echo "🚀 启动服务..."
nohup node src/app.js > /var/log/vps-app.log 2>&1 &

# 6. 等待服务启动
echo "⏳ 等待服务启动..."
sleep 5

# 7. 检查服务状态
echo "🔍 检查服务状态..."
if pgrep -f "node.*app.js" > /dev/null; then
    echo "✅ 服务启动成功"
    
    # 测试代理API
    if curl -s -f "http://localhost:3000/api/proxy/status" > /dev/null; then
        echo "✅ 代理API正常"
        echo "📊 代理状态:"
        curl -s "http://localhost:3000/api/proxy/status" | jq . || curl -s "http://localhost:3000/api/proxy/status"
    else
        echo "❌ 代理API异常"
    fi
else
    echo "❌ 服务启动失败"
    echo "📋 查看日志: tail -f /var/log/vps-app.log"
fi

echo ""
echo "🎯 更新完成！"
echo "================================"
