#!/bin/bash

# VPS可靠部署脚本 - 一键更新项目文件
# 解决所有交互确认和文件替换问题

echo "🚀 VPS可靠部署 - $(date)"

# 配置路径
GIT_DIR="/tmp/github/secure-streaming-platform"
VPS_SERVER_DIR="$GIT_DIR/vps-server"  # vps-server根目录
TARGET_DIR="/opt/yoyo-transcoder"  # 运行目录根目录

# 1. 检查Git目录是否存在
echo "📁 检查Git目录..."
if [ ! -d "$GIT_DIR" ]; then
    echo "❌ Git目录不存在，需要重新克隆"
    GIT_CORRUPTED=1
else
    cd "$GIT_DIR" || { echo "❌ 无法进入Git目录"; GIT_CORRUPTED=1; }
fi

# 2. 强制拉取最新代码（放弃本地修改）
if [ -z "$GIT_CORRUPTED" ]; then
    echo "📥 强制拉取最新代码..."
    echo "⚠️ 检查本地修改和冲突..."
    
    # 强制重置所有本地修改（捕获错误输出）
    echo "🔄 强制重置本地状态..."
    RESET_OUTPUT=$(git reset --hard HEAD 2>&1)
    RESET_STATUS=$?
    
    # 检查是否出现Git仓库损坏错误
    if [ $RESET_STATUS -ne 0 ] || echo "$RESET_OUTPUT" | grep -qi "unable to read\|Could not reset index\|fatal.*sha1"; then
        echo "⚠️ 检测到Git仓库损坏："
        echo "$RESET_OUTPUT" | head -3
        GIT_CORRUPTED=1
    else
        git clean -fd
        
        # 检查是否有未提交的更改
        if ! git diff --quiet || ! git diff --cached --quiet; then
            echo "🔄 仍有本地修改，再次强制重置..."
            git reset --hard HEAD
            git clean -fd
        fi
        
        # 强制拉取最新代码
        echo "📥 强制拉取master分支..."
        FETCH_OUTPUT=$(git fetch origin master 2>&1)
        FETCH_STATUS=$?
        
        # 检查fetch是否也出错
        if [ $FETCH_STATUS -ne 0 ] || echo "$FETCH_OUTPUT" | grep -qi "unable to read\|Could not reset\|fatal.*sha1"; then
            echo "⚠️ 检测到Git仓库损坏（fetch阶段）"
            GIT_CORRUPTED=1
        else
            # 检查是否需要合并
            LOCAL=$(git rev-parse HEAD 2>/dev/null)
            REMOTE=$(git rev-parse origin/master 2>/dev/null)
            
            if [ "$LOCAL" != "$REMOTE" ]; then
                echo "🔄 检测到版本差异，强制同步到最新版本..."
                RESET_REMOTE_OUTPUT=$(git reset --hard origin/master 2>&1)
                if [ $? -ne 0 ] || echo "$RESET_REMOTE_OUTPUT" | grep -qi "unable to read\|Could not reset\|fatal.*sha1"; then
                    echo "⚠️ 检测到Git仓库损坏（reset阶段）"
                    GIT_CORRUPTED=1
                else
                    echo "✅ 已强制同步到最新版本: $(git rev-parse --short HEAD)"
                fi
            else
                echo "✅ 已是最新版本: $(git rev-parse --short HEAD)"
            fi
        fi
    fi
fi

# 3. 如果检测到Git仓库损坏，自动修复（重新克隆）
if [ ! -z "$GIT_CORRUPTED" ]; then
    echo ""
    echo "🔧 开始修复Git仓库..."
    echo "📍 删除损坏的Git仓库..."
    
    # 返回上级目录
    cd /tmp/github || cd /tmp
    
    # 删除损坏的仓库
    rm -rf secure-streaming-platform
    
    echo "📥 重新克隆Git仓库..."
    # 优先使用SSH，失败则使用HTTPS
    if git clone git@github.com:shao-ye/secure-streaming-platform.git; then
        echo "✅ Git仓库重新克隆成功（SSH）"
    elif git clone https://github.com/shao-ye/secure-streaming-platform.git; then
        echo "✅ Git仓库重新克隆成功（HTTPS）"
    else
        echo "❌ Git仓库克隆失败，请检查网络连接"
        exit 1
    fi
    
    # 进入新克隆的目录
    cd "$GIT_DIR" || { echo "❌ 克隆后无法进入目录"; exit 1; }
    echo "✅ Git仓库已修复，当前版本: $(git rev-parse --short HEAD)"
    echo ""
fi

# 4. 同步代码和配置文件（无交互，可靠）
echo "🔄 同步代码和配置文件..."

# 4.1 同步src目录
echo "  📂 同步 src/ 目录..."
if command -v rsync >/dev/null 2>&1; then
    rsync -av --delete "$VPS_SERVER_DIR/src/" "$TARGET_DIR/src/"
    echo "  ✅ src/ 同步完成"
else
    rm -rf "$TARGET_DIR/src.backup" 2>/dev/null
    mv "$TARGET_DIR/src" "$TARGET_DIR/src.backup" 2>/dev/null
    mkdir -p "$TARGET_DIR/src"
    cp -r "$VPS_SERVER_DIR/src"/* "$TARGET_DIR/src/"
    echo "  ✅ src/ 备用同步完成"
fi

# 4.2 同步config目录（新增）
echo "  📂 同步 config/ 目录..."
if [ -d "$VPS_SERVER_DIR/config" ]; then
    mkdir -p "$TARGET_DIR/config"
    cp -r "$VPS_SERVER_DIR/config"/* "$TARGET_DIR/config/" 2>/dev/null || true
    # 保留原有的nginx配置等文件
    echo "  ✅ config/ 同步完成"
else
    echo "  ⚠️ config/ 目录不存在"
fi

# 4.3 同步scripts目录
echo "  📂 同步 scripts/ 目录..."
if [ -d "$VPS_SERVER_DIR/scripts" ]; then
    mkdir -p "$TARGET_DIR/scripts"
    cp -r "$VPS_SERVER_DIR/scripts"/* "$TARGET_DIR/scripts/"
    chmod +x "$TARGET_DIR/scripts"/*.sh 2>/dev/null || true
    echo "  ✅ scripts/ 同步完成"
fi

# 4.4 同步工具脚本（新增）
echo "  📂 同步工具文件..."
if [ -f "$VPS_SERVER_DIR/test-config.js" ]; then
    cp "$VPS_SERVER_DIR/test-config.js" "$TARGET_DIR/"
    echo "  ✅ test-config.js 已同步"
fi

if [ -f "$VPS_SERVER_DIR/update-env.ps1" ]; then
    cp "$VPS_SERVER_DIR/update-env.ps1" "$TARGET_DIR/"
    echo "  ✅ update-env.ps1 已同步"
fi

# 4.5 同步package.json（如果有更新）
if [ -f "$VPS_SERVER_DIR/package.json" ]; then
    cp "$VPS_SERVER_DIR/package.json" "$TARGET_DIR/"
    echo "  ✅ package.json 已同步"
fi

# 4.6 同步.env.example
if [ -f "$VPS_SERVER_DIR/.env.example" ]; then
    cp "$VPS_SERVER_DIR/.env.example" "$TARGET_DIR/"
    echo "  ✅ .env.example 已同步"
fi

echo "✅ 所有文件同步完成"

# 5. 检查关键文件是否存在
echo "🔍 检查关键文件..."
KEY_FILES=(
    "$TARGET_DIR/src/routes/proxy.js"
    "$TARGET_DIR/src/services/ProxyManager.js"
    "$TARGET_DIR/src/services/VideoCleanupScheduler.js"
    "$TARGET_DIR/src/app.js"
    "$TARGET_DIR/config/index.js"
)

for file in "${KEY_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $(basename "$file")"
    else
        echo "❌ $(basename "$file") - 文件缺失"
        exit 1
    fi
done

# 6. 验证代码版本同步
echo "🔍 验证代码版本同步..."
PROXY_MANAGER_FILE="$TARGET_DIR/src/services/ProxyManager.js"
APP_FILE="$TARGET_DIR/src/app.js"

# 检查是否包含最新的调试日志
if grep -q "进程监控" "$PROXY_MANAGER_FILE" && grep -q "自动重启" "$PROXY_MANAGER_FILE"; then
    echo "✅ 代码版本验证通过 - 包含最新调试功能"
else
    echo "⚠️ 代码版本可能不是最新 - 缺少调试日志"
    echo "🔄 尝试强制重新同步..."
    
    # 再次强制同步
    rm -rf "$TARGET_DIR/src"
    mkdir -p "$TARGET_DIR/src"
    cp -r "$VPS_SERVER_DIR/src"/* "$TARGET_DIR/src/"
    
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

# 7. 检查和安装系统依赖
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

# 8. 验证proxy.js包含新路由
echo "🔍 验证代理路由..."
if grep -q "router.post('/connect'" "$TARGET_DIR/src/routes/proxy.js"; then
    echo "✅ connect路由存在"
else
    echo "❌ connect路由缺失"
    exit 1
fi

if grep -q "router.post('/disconnect'" "$TARGET_DIR/src/routes/proxy.js"; then
    echo "✅ disconnect路由存在"
else
    echo "❌ disconnect路由缺失"
    exit 1
fi

# 9. 检查ProxyManager引用是否正确
echo "🔍 检查ProxyManager引用..."
if grep -q "require('../services/ProxyManager')" "$TARGET_DIR/src/routes/proxy.js"; then
    echo "✅ ProxyManager引用正确"
else
    echo "⚠️ 修复ProxyManager引用..."
    # 🔧 修复：确保使用正确的ProxyManager（不是_v2版本）
    sed -i "s|require('../services/ProxyManager_v2')|require('../services/ProxyManager')|g" "$TARGET_DIR/src/routes/proxy.js"
    
    # 验证修复结果
    if grep -q "require('../services/ProxyManager')" "$TARGET_DIR/src/routes/proxy.js"; then
        echo "✅ ProxyManager引用已修复"
    else
        echo "❌ ProxyManager引用修复失败"
        exit 1
    fi
fi

# 10. 同步ecosystem.config.js到VPS
echo "📄 同步PM2配置文件..."
if [ -f "$VPS_SERVER_DIR/ecosystem.config.js" ]; then
    # vps-server目录下有配置文件，优先使用
    cp "$VPS_SERVER_DIR/ecosystem.config.js" "$TARGET_DIR/"
    echo "✅ ecosystem.config.js已同步（从vps-server目录）"
elif [ -f "$GIT_DIR/ecosystem.config.js" ]; then
    # 使用项目根目录的配置文件
    cp "$GIT_DIR/ecosystem.config.js" "$TARGET_DIR/"
    echo "✅ ecosystem.config.js已同步（从项目根目录）"
else
    echo "⚠️ ecosystem.config.js不存在于任何预期位置"
    echo "   查找路径1: $VPS_SERVER_DIR/ecosystem.config.js"
    echo "   查找路径2: $GIT_DIR/ecosystem.config.js"
    echo "   将使用目标目录现有配置（如果存在）"
fi

# 验证目标目录是否有配置文件
if [ -f "$TARGET_DIR/ecosystem.config.js" ]; then
    echo "✅ 目标目录已有ecosystem.config.js"
    # 检查是否包含env_file配置
    if grep -q "env_file" "$TARGET_DIR/ecosystem.config.js"; then
        echo "✅ 配置文件包含env_file设置"
    else
        echo "⚠️ 配置文件缺少env_file设置，可能导致环境变量加载失败"
    fi
else
    echo "❌ 目标目录缺少ecosystem.config.js，PM2启动可能失败"
fi

# 11. 重启PM2服务（使用配置文件）
echo "🔄 重启PM2服务..."
cd /opt/yoyo-transcoder

# 尝试使用配置文件重启
if [ -f "ecosystem.config.js" ]; then
    echo "📄 使用ecosystem.config.js重启..."
    
    # 检查进程是否已存在
    if pm2 describe vps-transcoder-api >/dev/null 2>&1; then
        echo "🔄 进程已存在，执行reload..."
        pm2 reload ecosystem.config.js --env production --update-env
    else
        echo "🆕 进程不存在，执行start..."
        pm2 start ecosystem.config.js --env production
    fi
    
    if [ $? -eq 0 ]; then
        echo "✅ PM2启动成功（使用配置文件）"
    else
        echo "❌ PM2启动失败"
        exit 1
    fi
else
    echo "⚠️ 配置文件不存在，使用传统方式重启..."
    
    # 检查进程是否已存在
    if pm2 describe vps-transcoder-api >/dev/null 2>&1; then
        pm2 reload vps-transcoder-api --update-env
    else
        pm2 start src/app.js --name vps-transcoder-api
    fi
    
    if [ $? -eq 0 ]; then
        echo "✅ PM2启动成功"
    else
        echo "❌ PM2启动失败"
        exit 1
    fi
fi

# 12. 等待服务启动
echo "⏳ 等待服务启动..."
sleep 3

# 13. 检查服务状态
echo "🔍 检查服务状态..."
pm2 list | grep vps-transcoder-api

# 14. 测试健康检查
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
