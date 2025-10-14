#!/bin/bash

# YOYO流媒体平台 - iptables规则诊断和修复脚本
# 解决因代理规则导致的视频播放问题

echo "🔍 开始诊断iptables规则问题..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 检查当前iptables规则
echo ""
echo -e "${YELLOW}[1] 检查当前iptables规则...${NC}"
echo "当前NAT OUTPUT规则:"
iptables -t nat -L OUTPUT -n --line-numbers

echo ""
echo "检查代理相关规则:"
PROXY_RULES=$(iptables -t nat -L OUTPUT -n | grep -E "(1935|80|443).*REDIRECT.*1080" || echo "无代理规则")
echo "$PROXY_RULES"

# 2. 检查代理服务状态
echo ""
echo -e "${YELLOW}[2] 检查代理服务状态...${NC}"
PROXY_PORT=1080
if netstat -tlnp | grep -q ":$PROXY_PORT"; then
    echo -e "${GREEN}✓ 代理端口 $PROXY_PORT 正在监听${NC}"
    PROXY_RUNNING=true
else
    echo -e "${RED}✗ 代理端口 $PROXY_PORT 未监听${NC}"
    PROXY_RUNNING=false
fi

# 3. 检查VPS API服务状态
echo ""
echo -e "${YELLOW}[3] 检查VPS API服务状态...${NC}"
API_PORT=52535
if netstat -tlnp | grep -q ":$API_PORT"; then
    echo -e "${GREEN}✓ VPS API端口 $API_PORT 正在监听${NC}"
else
    echo -e "${RED}✗ VPS API端口 $API_PORT 未监听${NC}"
fi

# 4. 检查Nginx服务状态
echo ""
echo -e "${YELLOW}[4] 检查Nginx服务状态...${NC}"
if systemctl is-active --quiet nginx; then
    echo -e "${GREEN}✓ Nginx服务正在运行${NC}"
    echo "Nginx监听端口:"
    netstat -tlnp | grep nginx || echo "未找到Nginx监听端口"
else
    echo -e "${RED}✗ Nginx服务未运行${NC}"
fi

# 5. 诊断问题并提供解决方案
echo ""
echo -e "${YELLOW}[5] 问题诊断...${NC}"

HAS_PROXY_RULES=$(iptables -t nat -L OUTPUT -n | grep -E "(1935|80|443).*REDIRECT.*1080" | wc -l)

if [ "$HAS_PROXY_RULES" -gt 0 ] && [ "$PROXY_RUNNING" = false ]; then
    echo -e "${RED}🚨 发现问题：代理规则存在但代理服务未运行${NC}"
    echo "这会导致流量被重定向到无效端口，造成连接失败"
    echo ""
    echo -e "${YELLOW}建议解决方案：${NC}"
    echo "1. 清理无效的iptables代理规则"
    echo "2. 重启相关服务"
    
    # 询问是否自动修复
    echo ""
    read -p "是否自动清理无效的代理规则？(y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${YELLOW}[6] 自动修复 - 清理无效代理规则...${NC}"
        
        # 清理代理规则
        echo "清理RTMP代理规则..."
        iptables -t nat -D OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port 1080 2>/dev/null || true
        
        echo "清理HTTP代理规则..."
        iptables -t nat -D OUTPUT -p tcp --dport 80 -j REDIRECT --to-port 1080 2>/dev/null || true
        
        echo "清理HTTPS代理规则..."
        iptables -t nat -D OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 1080 2>/dev/null || true
        
        echo -e "${GREEN}✓ 代理规则已清理${NC}"
        
        # 重启相关服务
        echo ""
        echo -e "${YELLOW}重启相关服务...${NC}"
        
        echo "重启Nginx..."
        systemctl restart nginx
        
        echo "重启VPS转码服务..."
        cd /root/vps-transcoder-api
        pm2 restart vps-transcoder-api
        
        echo -e "${GREEN}✓ 服务重启完成${NC}"
        
        # 验证修复结果
        echo ""
        echo -e "${YELLOW}[7] 验证修复结果...${NC}"
        
        echo "检查代理规则是否已清理:"
        REMAINING_RULES=$(iptables -t nat -L OUTPUT -n | grep -E "(1935|80|443).*REDIRECT.*1080" || echo "无代理规则")
        if [ "$REMAINING_RULES" = "无代理规则" ]; then
            echo -e "${GREEN}✓ 代理规则已完全清理${NC}"
        else
            echo -e "${RED}✗ 仍有残留代理规则${NC}"
            echo "$REMAINING_RULES"
        fi
        
        echo ""
        echo "检查服务状态:"
        if systemctl is-active --quiet nginx; then
            echo -e "${GREEN}✓ Nginx服务正常${NC}"
        else
            echo -e "${RED}✗ Nginx服务异常${NC}"
        fi
        
        if pm2 list | grep -q "vps-transcoder-api.*online"; then
            echo -e "${GREEN}✓ VPS转码服务正常${NC}"
        else
            echo -e "${RED}✗ VPS转码服务异常${NC}"
        fi
        
        echo ""
        echo -e "${GREEN}🎉 修复完成！${NC}"
        echo -e "${YELLOW}建议测试：${NC}"
        echo "1. 访问VPS API: curl -H 'X-API-Key: YOUR_KEY' https://yoyo-vps.5202021.xyz/api/status"
        echo "2. 测试视频播放功能"
        echo "3. 如需启用代理，请先确保代理服务正常运行"
        
    else
        echo "跳过自动修复"
    fi
    
elif [ "$HAS_PROXY_RULES" -gt 0 ] && [ "$PROXY_RUNNING" = true ]; then
    echo -e "${GREEN}✓ 代理规则和代理服务都正常${NC}"
    echo "如果仍有播放问题，可能是其他原因"
    
elif [ "$HAS_PROXY_RULES" -eq 0 ]; then
    echo -e "${GREEN}✓ 无代理规则，直连模式${NC}"
    echo "如果有播放问题，可能是FFmpeg或RTMP源问题"
    
else
    echo -e "${YELLOW}ℹ 系统状态正常${NC}"
fi

# 6. 显示当前网络配置摘要
echo ""
echo -e "${YELLOW}[摘要] 当前网络配置状态：${NC}"
echo "- 代理规则数量: $HAS_PROXY_RULES"
echo "- 代理服务状态: $([ "$PROXY_RUNNING" = true ] && echo "运行中" || echo "未运行")"
echo "- VPS API端口: $(netstat -tlnp | grep -q ":$API_PORT" && echo "正常" || echo "异常")"
echo "- Nginx服务: $(systemctl is-active --quiet nginx && echo "正常" || echo "异常")"

echo ""
echo -e "${YELLOW}💡 提示：${NC}"
echo "- 如果不使用代理功能，建议保持iptables规则清空"
echo "- 如果需要使用代理，请先启动代理服务再添加规则"
echo "- 代理规则会影响所有出站HTTP/HTTPS/RTMP连接"
