#!/bin/bash
# 启用代理流媒体功能的完整配置脚本
# 用于配置视频流通过代理返回到前台页面

set -e

echo "========================================="
echo "  YOYO平台代理流媒体功能配置"
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

# 1. 检查并安装V2Ray/Xray
echo -e "${YELLOW}[1] 检查V2Ray/Xray安装状态...${NC}"
if ! command -v v2ray &> /dev/null && ! command -v xray &> /dev/null; then
    echo -e "${YELLOW}V2Ray/Xray未安装，开始安装...${NC}"
    curl -Ls https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh | sudo bash
    echo -e "${GREEN}✓ V2Ray安装完成${NC}"
else
    echo -e "${GREEN}✓ V2Ray/Xray已安装${NC}"
fi

# 2. 创建必要的目录
echo ""
echo -e "${YELLOW}[2] 创建必要的目录...${NC}"
mkdir -p $CONFIG_DIR
mkdir -p $LOG_DIR
echo -e "${GREEN}✓ 目录创建完成${NC}"

# 3. 配置FFmpeg使用代理
echo ""
echo -e "${YELLOW}[3] 配置FFmpeg使用代理...${NC}"
cat > $CONFIG_DIR/ffmpeg-proxy.conf << 'EOF'
# FFmpeg代理配置
# 当代理启用时，FFmpeg将通过代理获取RTMP流

export http_proxy=socks5://127.0.0.1:1080
export https_proxy=socks5://127.0.0.1:1080
export ALL_PROXY=socks5://127.0.0.1:1080
EOF
echo -e "${GREEN}✓ FFmpeg代理配置完成${NC}"

# 4. 更新SimpleStreamManager以支持代理
echo ""
echo -e "${YELLOW}[4] 更新SimpleStreamManager配置...${NC}"
cat > $APP_DIR/src/services/SimpleStreamManager-proxy-patch.js << 'EOF'
// 代理支持补丁
const { exec } = require('child_process');
const fs = require('fs').promises;

class ProxyHelper {
  static async isProxyEnabled() {
    try {
      // 检查代理服务状态
      const response = await fetch('http://localhost:3000/api/proxy/status');
      const data = await response.json();
      return data.data?.connectionStatus === 'connected';
    } catch (error) {
      return false;
    }
  }

  static getProxyEnv() {
    return {
      http_proxy: 'socks5://127.0.0.1:1080',
      https_proxy: 'socks5://127.0.0.1:1080',
      ALL_PROXY: 'socks5://127.0.0.1:1080'
    };
  }

  static async spawnFFmpegWithProxy(channelId, rtmpUrl, originalSpawnFunc) {
    const isProxyEnabled = await this.isProxyEnabled();
    
    if (isProxyEnabled) {
      console.log(`[ProxyHelper] 代理已启用，FFmpeg将通过代理获取流: ${channelId}`);
      // 设置代理环境变量
      const originalEnv = process.env;
      Object.assign(process.env, this.getProxyEnv());
      
      try {
        const result = await originalSpawnFunc(channelId, rtmpUrl);
        return result;
      } finally {
        // 恢复原始环境变量
        process.env = originalEnv;
      }
    } else {
      console.log(`[ProxyHelper] 代理未启用，直接连接: ${channelId}`);
      return originalSpawnFunc(channelId, rtmpUrl);
    }
  }
}

module.exports = ProxyHelper;
EOF
echo -e "${GREEN}✓ SimpleStreamManager代理补丁创建完成${NC}"

# 5. 配置iptables规则（透明代理）
echo ""
echo -e "${YELLOW}[5] 配置iptables透明代理规则...${NC}"

# 创建iptables规则脚本
cat > $CONFIG_DIR/setup-transparent-proxy.sh << 'EOF'
#!/bin/bash
# 透明代理配置脚本

PROXY_PORT=1080

# 清理旧规则
iptables -t nat -D OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || true
iptables -t nat -D OUTPUT -p tcp --dport 80 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || true
iptables -t nat -D OUTPUT -p tcp --dport 443 -j REDIRECT --to-port $PROXY_PORT 2>/dev/null || true

# 添加新规则（仅在代理启用时）
if netstat -tlnp | grep -q ":$PROXY_PORT"; then
    echo "添加透明代理规则..."
    # RTMP流量
    iptables -t nat -A OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port $PROXY_PORT
    # HTTP流量
    iptables -t nat -A OUTPUT -p tcp --dport 80 -j REDIRECT --to-port $PROXY_PORT
    # HTTPS流量
    iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port $PROXY_PORT
    echo "透明代理规则已添加"
else
    echo "代理端口未监听，跳过规则配置"
fi
EOF

chmod +x $CONFIG_DIR/setup-transparent-proxy.sh
echo -e "${GREEN}✓ 透明代理脚本创建完成${NC}"

# 6. 创建代理状态监控脚本
echo ""
echo -e "${YELLOW}[6] 创建代理状态监控脚本...${NC}"
cat > $CONFIG_DIR/monitor-proxy.sh << 'EOF'
#!/bin/bash
# 代理状态监控脚本

while true; do
    # 检查代理状态
    PROXY_STATUS=$(curl -s http://localhost:3000/api/proxy/status | jq -r '.data.connectionStatus' 2>/dev/null || echo "error")
    
    if [ "$PROXY_STATUS" = "connected" ]; then
        # 代理已连接，确保透明代理规则生效
        /opt/yoyo-transcoder/config/setup-transparent-proxy.sh > /dev/null 2>&1
    else
        # 代理未连接，清理透明代理规则
        iptables -t nat -D OUTPUT -p tcp --dport 1935 -j REDIRECT --to-port 1080 2>/dev/null || true
        iptables -t nat -D OUTPUT -p tcp --dport 80 -j REDIRECT --to-port 1080 2>/dev/null || true
        iptables -t nat -D OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 1080 2>/dev/null || true
    fi
    
    # 每30秒检查一次
    sleep 30
done
EOF

chmod +x $CONFIG_DIR/monitor-proxy.sh
echo -e "${GREEN}✓ 监控脚本创建完成${NC}"

# 7. 重启PM2服务
echo ""
echo -e "${YELLOW}[7] 重启PM2服务...${NC}"
cd $APP_DIR
pm2 restart vps-transcoder-api
echo -e "${GREEN}✓ PM2服务已重启${NC}"

# 8. 启动代理监控（后台运行）
echo ""
echo -e "${YELLOW}[8] 启动代理监控服务...${NC}"
nohup $CONFIG_DIR/monitor-proxy.sh > $LOG_DIR/proxy-monitor.log 2>&1 &
echo $! > $CONFIG_DIR/monitor-proxy.pid
echo -e "${GREEN}✓ 代理监控服务已启动（PID: $(cat $CONFIG_DIR/monitor-proxy.pid)）${NC}"

# 9. 验证配置
echo ""
echo -e "${YELLOW}[9] 验证配置...${NC}"
sleep 3

# 检查代理状态
PROXY_STATUS=$(curl -s http://localhost:3000/api/proxy/status | jq -r '.data.connectionStatus' 2>/dev/null || echo "error")
if [ "$PROXY_STATUS" = "connected" ]; then
    echo -e "${GREEN}✓ 代理已连接${NC}"
    echo -e "${GREEN}✓ 视频流将通过代理传输${NC}"
else
    echo -e "${YELLOW}⚠ 代理未连接${NC}"
    echo -e "${YELLOW}  请在管理后台配置并激活代理${NC}"
fi

# 检查iptables规则
if iptables -t nat -L OUTPUT -n | grep -q "REDIRECT.*1080"; then
    echo -e "${GREEN}✓ 透明代理规则已生效${NC}"
else
    echo -e "${YELLOW}⚠ 透明代理规则未生效${NC}"
fi

echo ""
echo "========================================="
echo -e "${GREEN}  配置完成！${NC}"
echo "========================================="
echo ""
echo "重要说明："
echo "1. 代理功能已配置完成"
echo "2. 当代理连接时，所有RTMP流将通过代理获取"
echo "3. 代理监控服务会自动管理透明代理规则"
echo "4. 请在管理后台激活代理以启用功能"
echo ""
echo "测试步骤："
echo "1. 在管理后台开启代理功能"
echo "2. 选择并激活一个代理节点"
echo "3. 播放视频，检查是否通过代理传输"
echo ""
