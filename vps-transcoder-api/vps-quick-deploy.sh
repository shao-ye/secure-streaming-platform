#!/bin/bash

# VPS快速部署脚本
# 用于同步GitHub最新代码到VPS运行环境

echo "🚀 开始VPS快速部署..."
echo "时间: $(date)"
echo ""

# 配置路径
GIT_DIR="/tmp/github/secure-streaming-platform/vps-transcoder-api"
APP_DIR="/opt/yoyo-transcoder"
SOURCE_DIR="$GIT_DIR/vps-transcoder-api/src"
TARGET_DIR="$APP_DIR/src"

# 步骤1: 检查Git目录
echo "📁 检查Git目录..."
if [ ! -d "$GIT_DIR" ]; then
    echo "❌ Git目录不存在: $GIT_DIR"
    exit 1
fi
cd "$GIT_DIR"
echo "✅ 当前目录: $(pwd)"

# 步骤2: 拉取最新代码
echo ""
echo "📥 拉取GitHub最新代码..."
git pull origin master
if [ $? -eq 0 ]; then
    echo "✅ Git拉取成功"
else
    echo "❌ Git拉取失败"
    exit 1
fi

# 步骤3: 显示最新提交信息
echo ""
echo "📋 最新提交信息:"
git log --oneline -n 3
echo ""

# 步骤4: 同步代码（强制覆盖，无需确认）
echo "🔄 同步代码到运行目录..."
echo "源目录: $SOURCE_DIR"
echo "目标目录: $TARGET_DIR"

# 使用rsync进行同步，避免cp的交互式确认
if command -v rsync >/dev/null 2>&1; then
    # 使用rsync（推荐）
    rsync -av --delete "$SOURCE_DIR/" "$TARGET_DIR/"
    echo "✅ 使用rsync同步完成"
else
    # 备用方案：使用cp强制覆盖
    cp -rf "$SOURCE_DIR"/* "$TARGET_DIR/"
    echo "✅ 使用cp同步完成"
fi

# 步骤5: 检查关键文件是否存在
echo ""
echo "🔍 检查关键文件..."
KEY_FILES=(
    "$TARGET_DIR/app.js"
    "$TARGET_DIR/routes/proxy.js"
    "$TARGET_DIR/services/ProxyManager_v2.js"
)

for file in "${KEY_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $(basename "$file")"
    else
        echo "❌ $(basename "$file") - 文件不存在"
    fi
done

# 步骤6: 重启PM2服务
echo ""
echo "🔄 重启PM2服务..."
pm2 reload vps-transcoder-api
if [ $? -eq 0 ]; then
    echo "✅ PM2服务重启成功"
else
    echo "❌ PM2服务重启失败"
    exit 1
fi

# 步骤7: 等待服务启动
echo ""
echo "⏳ 等待服务启动..."
sleep 3

# 步骤8: 验证服务状态
echo "🔍 验证服务状态..."
pm2 list | grep vps-transcoder-api

# 步骤9: 测试API端点
echo ""
echo "📡 测试API端点..."
curl -s http://localhost:3000/health | head -c 100
echo ""

echo ""
echo "🎉 VPS部署完成!"
echo "时间: $(date)"
echo ""
echo "下一步:"
echo "1. 测试新功能是否正常工作"
echo "2. 检查日志: pm2 logs vps-transcoder-api"
echo "3. 如有问题，查看: pm2 monit"
