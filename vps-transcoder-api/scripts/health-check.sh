#!/bin/bash

# YOYO流媒体平台健康检查脚本
# 使用方法: ./health-check.sh

echo "=== YOYO流媒体平台健康检查 ==="
echo "检查时间: $(date)"
echo ""

# 1. 检查Cloudflare Workers状态
echo "1. 检查Cloudflare Workers状态..."
WORKERS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://yoyoapi.5202021.xyz/health)
if [ "$WORKERS_STATUS" = "200" ]; then
    echo "✅ Cloudflare Workers: 正常"
else
    echo "❌ Cloudflare Workers: 异常 (HTTP $WORKERS_STATUS)"
fi

# 2. 检查VPS API状态
echo "2. 检查VPS API状态..."
VPS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://yoyo-vps.5202021.xyz/health)
if [ "$VPS_STATUS" = "200" ]; then
    echo "✅ VPS API: 正常"
else
    echo "❌ VPS API: 异常 (HTTP $VPS_STATUS)"
fi

# 3. 检查前端页面
echo "3. 检查前端页面..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://yoyo.5202021.xyz)
if [ "$FRONTEND_STATUS" = "200" ]; then
    echo "✅ 前端页面: 正常"
else
    echo "❌ 前端页面: 异常 (HTTP $FRONTEND_STATUS)"
fi

# 4. 检查系统状态
echo "4. 检查系统状态..."
SYSTEM_INFO=$(curl -s https://yoyoapi.5202021.xyz/api/simple-stream/system/status | jq -r '.data | "活跃流: \(.activeStreams), 总会话: \(.totalSessions), 配置频道: \(.configuredChannels)"' 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ 系统状态: $SYSTEM_INFO"
else
    echo "❌ 系统状态: 无法获取"
fi

echo ""
echo "=== 健康检查完成 ==="
