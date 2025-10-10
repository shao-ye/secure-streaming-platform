#!/bin/bash
# VPS代理服务安全部署脚本
# 遵守开发规则，避免会导致对话卡住的命令

echo "🚀 VPS代理服务部署开始"
echo "======================"

# 检查GitHub代码目录
if [ ! -d "/tmp/github/vps-transcoder-api" ]; then
    echo "❌ GitHub代码目录不存在: /tmp/github/vps-transcoder-api"
    exit 1
fi

cd /tmp/github/vps-transcoder-api/vps-transcoder-api

# 验证关键文件存在
echo "验证关键文件..."
if [ ! -f "src/routes/proxy.js" ]; then
    echo "❌ 代理路由文件缺失: src/routes/proxy.js"
    exit 1
fi

if [ ! -f "src/services/ProxyManager.js" ]; then
    echo "❌ 代理管理器文件缺失: src/services/ProxyManager.js"
    exit 1
fi

if [ ! -f "src/app.js" ]; then
    echo "❌ 主应用文件缺失: src/app.js"
    exit 1
fi

echo "✅ 关键文件验证通过"
echo "   - 代理路由: $(wc -l < src/routes/proxy.js) 行"
echo "   - 代理管理器: $(wc -l < src/services/ProxyManager.js) 行"
echo "   - 主应用: $(wc -l < src/app.js) 行"

# 停止现有服务（避免使用可能卡住的命令）
echo "停止现有服务..."
pkill -f "node.*app.js" 2>/dev/null || true
sleep 3

# 备份现有代码
if [ -d "/opt/yoyo-transcoder" ]; then
    echo "备份现有代码..."
    mv /opt/yoyo-transcoder "/opt/yoyo-transcoder.backup.$(date +%Y%m%d_%H%M%S)"
fi

# 部署新代码
echo "部署新代码..."
mkdir -p /opt/yoyo-transcoder
cp -r * /opt/yoyo-transcoder/
cd /opt/yoyo-transcoder

# 安装依赖
echo "安装依赖..."
npm install --production

# 创建必要目录
echo "创建目录..."
mkdir -p config logs
chmod 755 config logs

# 检查V2Ray软链接
echo "检查V2Ray..."
if command -v xray >/dev/null 2>&1 && ! command -v v2ray >/dev/null 2>&1; then
    ln -sf /usr/local/bin/xray /usr/local/bin/v2ray
    echo "✅ 已创建v2ray软链接"
fi

# 启动服务（避免使用nohup等可能卡住的命令）
echo "启动服务..."
node src/app.js > logs/app.log 2>&1 &
APP_PID=$!
echo "服务PID: $APP_PID"

# 等待服务启动
echo "等待服务启动..."
sleep 5

# 检查服务状态
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ 服务启动成功 (PID: $APP_PID)"
    
    # 测试基础API
    if curl -s -f "http://localhost:3000/health" >/dev/null 2>&1; then
        echo "✅ 基础API正常"
    else
        echo "⚠️ 基础API异常"
    fi
    
    # 测试代理API
    if curl -s -f "http://localhost:3000/api/proxy/status" >/dev/null 2>&1; then
        echo "✅ 代理API正常"
        echo "代理状态:"
        curl -s "http://localhost:3000/api/proxy/status" 2>/dev/null || echo "获取状态失败"
    else
        echo "❌ 代理API异常"
        echo "应用日志 (最后10行):"
        tail -10 logs/app.log 2>/dev/null || echo "无法读取日志"
    fi
else
    echo "❌ 服务启动失败"
    echo "启动日志 (最后20行):"
    tail -20 logs/app.log 2>/dev/null || echo "无法读取日志"
    exit 1
fi

echo "======================"
echo "✅ 部署完成！"
echo "服务PID: $APP_PID"
echo "日志文件: /opt/yoyo-transcoder/logs/app.log"
