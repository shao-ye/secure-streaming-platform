#!/bin/bash

# VPS代理服务部署脚本
# 根据PROXY_CONFIG_DESIGN.md和YOYO_PLATFORM_ARCHITECTURE.md设计

echo "🚀 开始部署VPS代理服务..."

# 1. 检查当前目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 请在vps-transcoder-api目录下运行此脚本"
    exit 1
fi

# 2. 停止现有服务
echo "📋 停止现有服务..."
pm2 stop vps-transcoder-api 2>/dev/null || true

# 3. 安装V2Ray/Xray客户端（如果未安装）
echo "📦 检查V2Ray/Xray安装状态..."
if ! command -v v2ray &> /dev/null && ! command -v xray &> /dev/null; then
    echo "📥 安装V2Ray客户端..."
    curl -Ls https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh | sudo bash
    
    if [ $? -eq 0 ]; then
        echo "✅ V2Ray安装成功"
    else
        echo "⚠️  V2Ray安装失败，但继续部署（代理测试可能受限）"
    fi
else
    echo "✅ V2Ray/Xray已安装"
fi

# 4. 创建必要的目录
echo "📁 创建代理配置目录..."
sudo mkdir -p /opt/yoyo-transcoder/config
sudo mkdir -p /opt/yoyo-transcoder/logs
sudo chown -R $USER:$USER /opt/yoyo-transcoder

# 5. 安装依赖
echo "📦 安装Node.js依赖..."
npm install

# 6. 检查代理服务文件
echo "🔍 检查代理服务文件..."
REQUIRED_FILES=(
    "src/services/ProxyManager.js"
    "src/routes/proxy.js"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file 存在"
    else
        echo "❌ $file 缺失"
        exit 1
    fi
done

# 7. 验证app.js中的代理路由集成
echo "🔍 验证代理路由集成..."
if grep -q "proxy" src/app.js; then
    echo "✅ 代理路由已集成到app.js"
else
    echo "❌ 代理路由未集成到app.js"
    exit 1
fi

# 8. 启动服务
echo "🚀 启动VPS转码和代理服务..."
pm2 start ecosystem.config.js

# 9. 等待服务启动
echo "⏳ 等待服务启动..."
sleep 5

# 10. 验证服务状态
echo "🔍 验证服务状态..."
pm2 status vps-transcoder-api

# 11. 测试API端点
echo "🧪 测试代理API端点..."
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

# 测试基础健康检查
echo "测试 /health 端点..."
curl -s http://localhost:3000/health | jq . || echo "健康检查端点测试失败"

# 测试代理状态端点
echo "测试 /api/proxy/status 端点..."
curl -s -H "X-API-Key: $API_KEY" http://localhost:3000/api/proxy/status | jq . || echo "代理状态端点测试失败"

# 测试代理健康检查端点
echo "测试 /api/proxy/health 端点..."
curl -s -H "X-API-Key: $API_KEY" http://localhost:3000/api/proxy/health | jq . || echo "代理健康检查端点测试失败"

# 12. 显示部署结果
echo ""
echo "🎉 VPS代理服务部署完成！"
echo ""
echo "📊 服务信息:"
echo "  - 服务名称: vps-transcoder-api"
echo "  - 监听端口: 3000"
echo "  - 代理API: /api/proxy/*"
echo "  - 配置目录: /opt/yoyo-transcoder/config"
echo "  - 日志目录: /opt/yoyo-transcoder/logs"
echo ""
echo "🔗 可用的代理API端点:"
echo "  - GET  /api/proxy/status  - 获取代理状态"
echo "  - POST /api/proxy/test    - 测试代理连接"
echo "  - POST /api/proxy/config  - 更新代理配置"
echo "  - POST /api/proxy/control - 代理控制操作"
echo "  - GET  /api/proxy/health  - 代理健康检查"
echo "  - GET  /api/proxy/stats   - 代理统计信息"
echo ""
echo "📝 查看日志: pm2 logs vps-transcoder-api"
echo "🔄 重启服务: pm2 restart vps-transcoder-api"
echo "⏹️  停止服务: pm2 stop vps-transcoder-api"
