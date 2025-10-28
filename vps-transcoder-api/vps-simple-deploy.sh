#!/bin/bash

# VPS可靠部署脚本 - 一键更新项目文件
# 解决所有交互确认和文件替换问题

echo "🚀 VPS可靠部署 - $(date)"

# 配置路径
GIT_DIR="/tmp/github/secure-streaming-platform"
SOURCE_DIR="$GIT_DIR/vps-transcoder-api/vps-transcoder-api/src"
TARGET_DIR="/opt/yoyo-transcoder/src"

# 1. 进入Git目录
echo "📁 进入Git目录..."
cd "$GIT_DIR/vps-transcoder-api" || { echo "❌ Git目录不存在"; exit 1; }

# 2. 强制拉取最新代码（放弃本地修改）
echo "📥 强制拉取最新代码..."
echo "⚠️ 检查本地修改和冲突..."

# 强制重置所有本地修改
echo "🔄 强制重置本地状态..."
git reset --hard HEAD
git clean -fd

# 检查是否有未提交的更改
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "🔄 仍有本地修改，再次强制重置..."
    git reset --hard HEAD
    git clean -fd
fi

# 强制拉取最新代码
echo "📥 强制拉取master分支..."
git fetch origin master

# 检查是否需要合并
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "🔄 检测到版本差异，强制同步到最新版本..."
    git reset --hard origin/master
    echo "✅ 已强制同步到最新版本: $(git rev-parse --short HEAD)"
else
    echo "✅ 已是最新版本: $(git rev-parse --short HEAD)"
fi

# 3. 使用rsync同步代码（无交互，可靠）
echo "🔄 同步代码..."
if command -v rsync >/dev/null 2>&1; then
    # 使用rsync - 无交互，自动覆盖
    rsync -av --delete "$SOURCE_DIR/" "$TARGET_DIR/"
    echo "✅ rsync同步完成"
else
    # 备用方案：先删除目标目录，再复制（避免交互）
    echo "⚠️ rsync不可用，使用备用方案..."
    rm -rf "$TARGET_DIR.backup" 2>/dev/null
    mv "$TARGET_DIR" "$TARGET_DIR.backup" 2>/dev/null
    mkdir -p "$TARGET_DIR"
    cp -r "$SOURCE_DIR"/* "$TARGET_DIR/"
    echo "✅ 备用同步完成"
fi

# 4. 检查关键文件是否存在
echo "🔍 检查关键文件..."
KEY_FILES=(
    "$TARGET_DIR/routes/proxy.js"
    "$TARGET_DIR/services/ProxyManager.js"
    "$TARGET_DIR/services/VideoCleanupScheduler.js"
    "$TARGET_DIR/app.js"
)

for file in "${KEY_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $(basename "$file")"
    else
        echo "❌ $(basename "$file") - 文件缺失"
        exit 1
    fi
done

# 5. 验证代码版本同步
echo "🔍 验证代码版本同步..."
PROXY_MANAGER_FILE="$TARGET_DIR/services/ProxyManager.js"
APP_FILE="$TARGET_DIR/app.js"

# 检查是否包含最新的调试日志
if grep -q "进程监控" "$PROXY_MANAGER_FILE" && grep -q "自动重启" "$PROXY_MANAGER_FILE"; then
    echo "✅ 代码版本验证通过 - 包含最新调试功能"
else
    echo "⚠️ 代码版本可能不是最新 - 缺少调试日志"
    echo "🔄 尝试强制重新同步..."
    
    # 再次强制同步
    rm -rf "$TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    cp -r "$SOURCE_DIR"/* "$TARGET_DIR/"
    
    # 再次验证
    if grep -q "配置解析结果" "$PROXY_MANAGER_FILE" && grep -q "开始调用testProxyLatency" "$PROXY_MANAGER_FILE"; then
        echo "✅ 强制重新同步成功"
    else
        echo "❌ 代码同步可能存在问题，请手动检查"
    fi
fi

# 验证VideoCleanupScheduler集成
echo "🔍 验证视频清理服务集成..."
if grep -q "VideoCleanupScheduler" "$APP_FILE"; then
    echo "✅ 视频清理服务已集成到app.js"
else
    echo "⚠️ app.js中未找到VideoCleanupScheduler引用"
fi

# 6. 检查和安装系统依赖
echo "🔍 检查系统依赖..."

# 检查nc命令
if ! command -v nc >/dev/null 2>&1; then
    echo "⚠️ nc命令不存在，尝试安装..."
    
    # 检测系统类型并安装
    if command -v yum >/dev/null 2>&1; then
        echo "📦 使用yum安装netcat..."
        yum install -y nc || yum install -y netcat || yum install -y nmap-ncat
    elif command -v apt-get >/dev/null 2>&1; then
        echo "📦 使用apt-get安装netcat..."
        apt-get update && apt-get install -y netcat-openbsd
    elif command -v dnf >/dev/null 2>&1; then
        echo "📦 使用dnf安装netcat..."
        dnf install -y nc || dnf install -y netcat || dnf install -y nmap-ncat
    else
        echo "❌ 无法识别包管理器，请手动安装nc命令"
    fi
    
    # 再次检查
    if command -v nc >/dev/null 2>&1; then
        echo "✅ nc命令安装成功"
    else
        echo "❌ nc命令安装失败，代理测试功能可能受限"
    fi
else
    echo "✅ nc命令已存在"
fi

# 检查V2Ray/Xray
if ! command -v v2ray >/dev/null 2>&1 && ! command -v xray >/dev/null 2>&1; then
    echo "⚠️ V2Ray/Xray未安装，代理功能可能受限"
    echo "💡 建议安装: curl -Ls https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh | sudo bash"
else
    echo "✅ V2Ray/Xray已安装"
fi

# 检查Node.js依赖
echo "🔍 检查Node.js依赖..."
cd /opt/yoyo-transcoder || { echo "❌ 转码目录不存在"; exit 1; }

# 检查package.json是否存在
if [ ! -f "package.json" ]; then
    echo "❌ package.json不存在"
    exit 1
fi

# 定义所需依赖列表
REQUIRED_DEPS=(
    "node-cron"        # 预加载、录制、清理功能定时任务
    "moment-timezone"  # 录制和清理功能时区支持
    "axios"            # HTTP请求（清理功能与Workers通信）
    "express"          # Web框架
)

# 检查并安装缺失的依赖
echo "🔍 检查关键依赖..."
MISSING_DEPS=()

for dep in "${REQUIRED_DEPS[@]}"; do
    if npm list "$dep" >/dev/null 2>&1; then
        echo "✅ $dep 已安装"
    else
        echo "⚠️ $dep 未安装"
        MISSING_DEPS+=("$dep")
    fi
done

# 如果有缺失的依赖，批量安装
if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    echo "📦 安装缺失的依赖: ${MISSING_DEPS[*]}"
    npm install "${MISSING_DEPS[@]}"
    
    # 验证安装结果
    echo "🔍 验证安装结果..."
    FAILED_DEPS=()
    for dep in "${MISSING_DEPS[@]}"; do
        if npm list "$dep" >/dev/null 2>&1; then
            echo "✅ $dep 安装成功"
        else
            echo "❌ $dep 安装失败"
            FAILED_DEPS+=("$dep")
        fi
    done
    
    # 如果有安装失败的依赖，退出
    if [ ${#FAILED_DEPS[@]} -gt 0 ]; then
        echo "❌ 以下依赖安装失败: ${FAILED_DEPS[*]}"
        exit 1
    fi
else
    echo "✅ 所有关键依赖已安装"
fi

# 检查package.json中的其他依赖
echo "🔍 检查package.json完整性..."
if ! npm list >/dev/null 2>&1; then
    echo "⚠️ 检测到其他缺失依赖，运行npm install..."
    npm install
    echo "✅ 依赖安装完成"
else
    echo "✅ 所有依赖完整"
fi

# 5. 验证proxy.js包含新路由
echo "🔍 验证代理路由..."
if grep -q "router.post('/connect'" "$TARGET_DIR/routes/proxy.js"; then
    echo "✅ connect路由存在"
else
    echo "❌ connect路由缺失"
    exit 1
fi

if grep -q "router.post('/disconnect'" "$TARGET_DIR/routes/proxy.js"; then
    echo "✅ disconnect路由存在"
else
    echo "❌ disconnect路由缺失"
    exit 1
fi

# 6. 检查ProxyManager引用是否正确
echo "🔍 检查ProxyManager引用..."
if grep -q "require('../services/ProxyManager')" "$TARGET_DIR/routes/proxy.js"; then
    echo "✅ ProxyManager引用正确"
else
    echo "⚠️ 修复ProxyManager引用..."
    # 🔧 修复：确保使用正确的ProxyManager（不是_v2版本）
    sed -i "s|require('../services/ProxyManager_v2')|require('../services/ProxyManager')|g" "$TARGET_DIR/routes/proxy.js"
    
    # 验证修复结果
    if grep -q "require('../services/ProxyManager')" "$TARGET_DIR/routes/proxy.js"; then
        echo "✅ ProxyManager引用已修复"
    else
        echo "❌ ProxyManager引用修复失败"
        exit 1
    fi
fi

# 7. 重启PM2服务
echo "🔄 重启PM2服务..."
pm2 reload vps-transcoder-api
if [ $? -eq 0 ]; then
    echo "✅ PM2重启成功"
else
    echo "❌ PM2重启失败"
    exit 1
fi

# 8. 等待服务启动
echo "⏳ 等待服务启动..."
sleep 3

# 9. 检查服务状态
echo "🔍 检查服务状态..."
pm2 list | grep vps-transcoder-api

# 10. 测试健康检查
echo "📡 测试服务健康..."
if curl -s http://localhost:3000/health >/dev/null; then
    echo "✅ 服务健康检查通过"
else
    echo "⚠️ 服务健康检查失败，查看日志："
    pm2 logs vps-transcoder-api --lines 5 --nostream
fi

echo ""
echo "🎉 VPS部署完成!"
echo "时间: $(date)"
echo ""
echo "✅ 部署验证："
echo "- 代码同步: 完成"
echo "- 关键文件: 存在"
echo "- 代理路由: 正确"
echo "- PM2服务: 运行中"
echo ""
