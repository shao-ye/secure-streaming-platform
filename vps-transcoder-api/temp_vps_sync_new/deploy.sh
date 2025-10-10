#!/bin/bash
echo "🚀 VPS代理服务完整部署"
echo "===================="

# 停止现有服务
echo "停止现有服务..."
pkill -f "node.*app.js" || echo "没有运行中的服务"
sleep 2

# 备份现有代码
if [ -d "/opt/yoyo-transcoder" ]; then
    echo "备份现有代码..."
    mv /opt/yoyo-transcoder /opt/yoyo-transcoder.backup.$(date +%Y%m%d_%H%M%S)
fi

# 部署新代码
echo "部署新代码..."
mkdir -p /opt/yoyo-transcoder
cp -r * /opt/yoyo-transcoder/
cd /opt/yoyo-transcoder

# 验证关键文件
echo "验证关键文件..."
if [ -f "src/routes/proxy.js" ]; then
    echo "✅ 代理路由文件存在"
else
    echo "❌ 代理路由文件缺失"
    exit 1
fi

if [ -f "src/services/ProxyManager.js" ]; then
    echo "✅ 代理管理器文件存在"
else
    echo "❌ 代理管理器文件缺失"
    exit 1
fi

# 安装依赖
echo "安装依赖..."
npm install

# 创建必要目录
echo "创建目录..."
mkdir -p config logs
chmod 755 config logs

# 检查V2Ray软链接
echo "检查V2Ray..."
if command -v xray >/dev/null && ! command -v v2ray >/dev/null; then
    ln -sf /usr/local/bin/xray /usr/local/bin/v2ray
    echo "✅ 已创建v2ray软链接"
fi

# 启动服务
echo "启动服务..."
nohup node src/app.js > logs/app.log 2>&1 &
sleep 5

# 检查服务状态
echo "检查服务状态..."
if pgrep -f "node.*app.js" >/dev/null; then
    echo "✅ 服务启动成功"
    
    # 测试基础API
    if curl -s -f "http://localhost:3000/health" >/dev/null; then
        echo "✅ 基础API正常"
    fi
    
    # 测试代理API
    if curl -s -f "http://localhost:3000/api/proxy/status" >/dev/null; then
        echo "✅ 代理API正常"
        echo "代理状态:"
        curl -s "http://localhost:3000/api/proxy/status"
    else
        echo "❌ 代理API异常"
        echo "检查应用日志:"
        tail -10 logs/app.log
    fi
else
    echo "❌ 服务启动失败"
    echo "查看启动日志:"
    tail -20 logs/app.log
fi

echo "===================="
echo "✅ 部署完成！"
