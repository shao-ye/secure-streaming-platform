#!/bin/bash
# 代理流媒体集成脚本
# 实现视频流通过代理传输的完整功能

set -e

echo "========================================="
echo "  YOYO平台代理流媒体集成部署"
echo "========================================="
echo ""

# 配置变量
PROXY_PORT=1080
APP_DIR="/opt/yoyo-transcoder"
CONFIG_DIR="$APP_DIR/config"
LOG_DIR="$APP_DIR/logs"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 检查V2Ray状态
echo -e "${YELLOW}[1] 检查V2Ray安装状态...${NC}"
if command -v v2ray &> /dev/null; then
    echo -e "${GREEN}✓ V2Ray已安装: $(which v2ray)${NC}"
else
    echo -e "${RED}✗ V2Ray未安装${NC}"
    exit 1
fi

# 2. 创建代理规则管理脚本
echo ""
echo -e "${YELLOW}[2] 创建代理规则管理脚本...${NC}"
cat > $CONFIG_DIR/proxy-rules.sh << 'EOF'
#!/bin/bash
# 代理规则管理脚本

PROXY_PORT=1080
ACTION=$1

add_rules() {
    echo "添加代理规则..."
    # 检查代理端口是否监听
    if ! netstat -tlnp | grep -q ":$PROXY_PORT"; then
        echo "警告: 代理端口$PROXY_PORT未监听"
        return 1
    fi
    
    # 添加RTMP流量重定向规则
    iptables -t nat -C OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || \
    iptables -t nat -A OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port $PROXY_PORT
    
    # 添加HTTP流量重定向规则
    iptables -t nat -C OUTPUT -p tcp --dport 80 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || \
    iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-port $PROXY_PORT
    
    # 添加HTTPS流量重定向规则
    iptables -t nat -C OUTPUT -p tcp --dport 443 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || \
    iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port $PROXY_PORT
    
    echo "代理规则已添加"
}

remove_rules() {
    echo "移除代理规则..."
    iptables -t nat -D OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || true
    iptables -t nat -D OUTPUT -p tcp --dport 80 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || true
    iptables -t nat -D OUTPUT -p tcp --dport 443 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || true
    echo "代理规则已移除"
}

check_rules() {
    echo "当前代理规则:"
    iptables -t nat -L OUTPUT -n | grep -E "(1935|80|443).*REDIRECT.*$PROXY_PORT" || echo "无代理规则"
}

case "$ACTION" in
    add)
        add_rules
        ;;
    remove)
        remove_rules
        ;;
    check)
        check_rules
        ;;
    *)
        echo "用法: $0 {add|remove|check}"
        exit 1
        ;;
esac
EOF

chmod +x $CONFIG_DIR/proxy-rules.sh
echo -e "${GREEN}✓ 代理规则管理脚本创建完成${NC}"

# 3. 创建代理状态监控脚本
echo ""
echo -e "${YELLOW}[3] 创建代理状态监控脚本...${NC}"
cat > $CONFIG_DIR/proxy-monitor.sh << 'EOF'
#!/bin/bash
# 代理状态监控脚本
# 根据代理状态自动管理iptables规则

PROXY_RULES_SCRIPT="/opt/yoyo-transcoder/config/proxy-rules.sh"
LOG_FILE="/opt/yoyo-transcoder/logs/proxy-monitor.log"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"
}

while true; do
    # 检查代理状态
    PROXY_STATUS=$(curl -s http://localhost:3000/api/proxy/status 2>/dev/null | jq -r '.data.connectionStatus' 2>/dev/null || echo "error")
    
    if [ "$PROXY_STATUS" = "connected" ]; then
        # 代理已连接，确保规则生效
        if ! iptables -t nat -L OUTPUT -n | grep -q "1935.*REDIRECT.*1080"; then
            log_message "代理已连接，添加透明代理规则"
            $PROXY_RULES_SCRIPT add
        fi
    else
        # 代理未连接，清理规则
        if iptables -t nat -L OUTPUT -n | grep -q "1935.*REDIRECT.*1080"; then
            log_message "代理已断开，移除透明代理规则"
            $PROXY_RULES_SCRIPT remove
        fi
    fi
    
    # 每30秒检查一次
    sleep 30
done
EOF

chmod +x $CONFIG_DIR/proxy-monitor.sh
echo -e "${GREEN}✓ 代理状态监控脚本创建完成${NC}"

# 4. 创建SimpleStreamManager代理集成补丁
echo ""
echo -e "${YELLOW}[4] 创建SimpleStreamManager代理集成补丁...${NC}"
cat > $APP_DIR/src/services/StreamProxyIntegration.js << 'EOF'
// SimpleStreamManager代理集成模块
const ProxyManager = require('./ProxyManager');
const logger = require('../utils/logger');

class StreamProxyIntegration {
  constructor() {
    this.proxyManager = new ProxyManager();
  }

  /**
   * 获取代理环境变量
   */
  async getProxyEnvironment() {
    try {
      const proxyStatus = await this.proxyManager.getProxyStatus();
      
      if (proxyStatus.connectionStatus === 'connected') {
        logger.info('FFmpeg将使用代理传输:', proxyStatus.currentProxy);
        return {
          http_proxy: 'socks5://127.0.0.1:1080',
          https_proxy: 'socks5://127.0.0.1:1080',
          ALL_PROXY: 'socks5://127.0.0.1:1080',
          PROXY_ENABLED: 'true'
        };
      } else {
        logger.info('FFmpeg将直接连接，代理未启用');
        return {
          PROXY_ENABLED: 'false'
        };
      }
    } catch (error) {
      logger.error('获取代理环境变量失败:', error);
      return {
        PROXY_ENABLED: 'false'
      };
    }
  }

  /**
   * 为FFmpeg进程添加代理环境变量
   */
  async enhanceFFmpegEnvironment(baseEnv = {}) {
    const proxyEnv = await this.getProxyEnvironment();
    return {
      ...baseEnv,
      ...proxyEnv
    };
  }

  /**
   * 检查是否需要重启流（代理状态变化时）
   */
  async shouldRestartStream(channelId) {
    // 这里可以实现更复杂的逻辑
    // 比如检查代理状态变化历史
    return false;
  }
}

module.exports = StreamProxyIntegration;
EOF

echo -e "${GREEN}✓ SimpleStreamManager代理集成补丁创建完成${NC}"

# 5. 启动代理监控服务
echo ""
echo -e "${YELLOW}[5] 启动代理监控服务...${NC}"
# 停止旧的监控进程
pkill -f "proxy-monitor.sh" 2>/dev/null || true

# 启动新的监控进程
nohup $CONFIG_DIR/proxy-monitor.sh > $LOG_DIR/proxy-monitor.log 2>&1 &
MONITOR_PID=$!
echo $MONITOR_PID > $CONFIG_DIR/proxy-monitor.pid

echo -e "${GREEN}✓ 代理监控服务已启动 (PID: $MONITOR_PID)${NC}"

# 6. 重启PM2服务
echo ""
echo -e "${YELLOW}[6] 重启PM2服务...${NC}"
cd $APP_DIR
pm2 restart vps-transcoder-api
echo -e "${GREEN}✓ PM2服务已重启${NC}"

# 7. 验证集成结果
echo ""
echo -e "${YELLOW}[7] 验证集成结果...${NC}"
sleep 3

# 检查代理状态
PROXY_STATUS=$(curl -s http://localhost:3000/api/proxy/status | jq -r '.data.connectionStatus' 2>/dev/null || echo "error")
echo "代理状态: $PROXY_STATUS"

# 检查代理规则
echo "当前代理规则:"
iptables -t nat -L OUTPUT -n | grep -E "(1935|80|443).*REDIRECT.*1080" || echo "无代理规则"

# 检查监控进程
if ps -p $MONITOR_PID > /dev/null; then
    echo -e "${GREEN}✓ 代理监控进程运行正常${NC}"
else
    echo -e "${RED}✗ 代理监控进程启动失败${NC}"
fi

echo ""
echo "========================================="
echo -e "${GREEN}  代理流媒体集成部署完成！${NC}"
echo "========================================="
echo ""
echo "功能说明："
echo "1. 当代理连接时，所有RTMP/HTTP/HTTPS流量将通过代理"
echo "2. FFmpeg进程会自动使用代理环境变量"
echo "3. 代理状态变化时，iptables规则会自动更新"
echo "4. 监控服务会持续运行，确保规则同步"
echo ""
echo "测试步骤："
echo "1. 在管理后台开启代理功能"
echo "2. 播放视频，观察是否通过代理传输"
echo "3. 关闭代理，确认视频切换到直连"
echo ""
echo "监控命令："
echo "- 查看代理状态: curl http://localhost:3000/api/proxy/status"
echo "- 查看代理规则: $CONFIG_DIR/proxy-rules.sh check"
echo "- 查看监控日志: tail -f $LOG_DIR/proxy-monitor.log"
echo ""
