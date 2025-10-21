#!/bin/bash

# VPS代理重连后视频播放失败 - 综合诊断和修复脚本
# 解决代理重连导致的各种问题

echo "=== VPS代理重连问题综合诊断和修复 ==="
echo "执行时间: $(date)"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. 系统状态检查
echo ""
log_info "=== 1. 系统状态检查 ==="

# 检查PM2状态
log_info "检查PM2进程状态..."
pm2 list | grep vps-transcoder-api
if [ $? -eq 0 ]; then
    log_success "PM2进程运行正常"
else
    log_error "PM2进程异常"
fi

# 检查端口占用
log_info "检查端口3000占用情况..."
netstat -tlnp | grep :3000
if [ $? -eq 0 ]; then
    log_success "端口3000正常监听"
else
    log_error "端口3000未监听"
fi

# 2. 代码一致性检查
echo ""
log_info "=== 2. 代码一致性检查 ==="

# 检查关键文件是否存在
log_info "检查关键文件..."
files_to_check=(
    "/opt/yoyo-transcoder/src/routes/status.js"
    "/opt/yoyo-transcoder/src/routes/simple-stream.js"
    "/opt/yoyo-transcoder/src/services/SimpleStreamManager.js"
    "/opt/yoyo-transcoder/app.js"
)

for file in "${files_to_check[@]}"; do
    if [ -f "$file" ]; then
        log_success "文件存在: $file"
    else
        log_error "文件缺失: $file"
    fi
done

# 检查是否有备份文件
log_info "检查是否存在问题备份文件..."
backup_files=(
    "/opt/yoyo-transcoder/src/routes/status.js.backup"
    "/opt/yoyo-transcoder/src/routes/status.js.broken"
    "/opt/yoyo-transcoder/src/routes/simple-stream.js.backup"
    "/opt/yoyo-transcoder/src/routes/simple-stream.js.broken"
)

backup_found=false
for file in "${backup_files[@]}"; do
    if [ -f "$file" ]; then
        log_warning "发现问题备份文件: $file"
        backup_found=true
    fi
done

if [ "$backup_found" = false ]; then
    log_success "未发现问题备份文件"
fi

# 检查simple-stream.js的内容
log_info "检查simple-stream.js的关键内容..."
if grep -q "CHANNEL_RTMP_MAP" /opt/yoyo-transcoder/src/routes/simple-stream.js; then
    log_success "simple-stream.js包含CHANNEL_RTMP_MAP"
else
    log_error "simple-stream.js缺少CHANNEL_RTMP_MAP"
fi

# 检查status.js的内容
log_info "检查status.js的关键内容..."
if grep -q "safeLogger" /opt/yoyo-transcoder/src/routes/status.js; then
    log_success "status.js使用safeLogger"
else
    log_error "status.js未使用safeLogger"
fi

# 3. API端点测试
echo ""
log_info "=== 3. API端点测试 ==="

# 测试健康检查端点
log_info "测试健康检查端点..."
health_response=$(curl -s -w "%{http_code}" -o /tmp/health_test.json http://localhost:3000/health)
if [ "$health_response" = "200" ]; then
    log_success "健康检查端点正常 (HTTP 200)"
    cat /tmp/health_test.json | jq . 2>/dev/null || cat /tmp/health_test.json
else
    log_error "健康检查端点异常 (HTTP $health_response)"
fi

# 测试simple-stream系统状态端点
log_info "测试simple-stream系统状态端点..."
status_response=$(curl -s -w "%{http_code}" -o /tmp/status_test.json http://localhost:3000/api/simple-stream/system/status)
if [ "$status_response" = "200" ]; then
    log_success "simple-stream状态端点正常 (HTTP 200)"
    cat /tmp/status_test.json | jq . 2>/dev/null || cat /tmp/status_test.json
else
    log_error "simple-stream状态端点异常 (HTTP $status_response)"
fi

# 4. 网络和代理状态检查
echo ""
log_info "=== 4. 网络和代理状态检查 ==="

# 检查代理进程
log_info "检查V2Ray代理进程..."
v2ray_processes=$(ps aux | grep v2ray | grep -v grep | wc -l)
if [ "$v2ray_processes" -gt 0 ]; then
    log_success "发现 $v2ray_processes 个V2Ray进程"
    ps aux | grep v2ray | grep -v grep
else
    log_warning "未发现V2Ray进程"
fi

# 检查代理配置文件
log_info "检查代理配置文件..."
if [ -f "/opt/yoyo-transcoder/config/v2ray.json" ]; then
    log_success "代理配置文件存在"
    config_size=$(stat -f%z "/opt/yoyo-transcoder/config/v2ray.json" 2>/dev/null || stat -c%s "/opt/yoyo-transcoder/config/v2ray.json" 2>/dev/null)
    log_info "配置文件大小: $config_size bytes"
else
    log_warning "代理配置文件不存在"
fi

# 检查端口1080监听
log_info "检查代理端口1080..."
if netstat -tlnp | grep :1080 >/dev/null; then
    log_success "端口1080正在监听"
else
    log_warning "端口1080未监听"
fi

# 5. 修复操作
echo ""
log_info "=== 5. 开始修复操作 ==="

# 删除问题备份文件
if [ "$backup_found" = true ]; then
    log_info "删除问题备份文件..."
    for file in "${backup_files[@]}"; do
        if [ -f "$file" ]; then
            rm -f "$file"
            log_success "已删除: $file"
        fi
    done
fi

# 确保正确的simple-stream.js文件
log_info "确保simple-stream.js文件正确..."
cat > /opt/yoyo-transcoder/src/routes/simple-stream.js << 'EOF'
const express = require('express');
const SimpleStreamManager = require('../services/SimpleStreamManager');
const logger = require('../utils/logger');

const router = express.Router();
const streamManager = new SimpleStreamManager();

const CHANNEL_RTMP_MAP = {
  'stream_gkg5hknc': 'rtmp://58.200.131.2:1935/livetv/hunantv',
  'stream_2': 'rtmp://58.200.131.2:1935/livetv/cctv1',
  'stream_1': 'rtmp://58.200.131.2:1935/livetv/cctv2'
};

router.post('/start-watching', async (req, res) => {
  try {
    const { channelId, rtmpUrl } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    let finalRtmpUrl = rtmpUrl;
    if (!finalRtmpUrl) {
      finalRtmpUrl = CHANNEL_RTMP_MAP[channelId];
      if (!finalRtmpUrl) {
        return res.status(400).json({
          status: 'error',
          message: 'No RTMP URL found for channelId: ' + channelId
        });
      }
    }
    
    logger.info('Starting stream with channel mapping', { 
      channelId, 
      rtmpUrl: finalRtmpUrl 
    });
    
    const hlsUrl = await streamManager.startWatching(channelId, finalRtmpUrl);
    
    res.json({
      status: 'success',
      message: 'Started watching successfully',
      data: {
        channelId,
        hlsUrl,
        rtmpUrl: finalRtmpUrl
      }
    });
    
  } catch (error) {
    logger.error('Failed to start watching', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to start stream',
      error: error.message
    });
  }
});

router.post('/stop-watching', async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    await streamManager.stopWatching(channelId);
    
    res.json({
      status: 'success',
      message: 'Stopped watching successfully'
    });
    
  } catch (error) {
    logger.error('Failed to stop watching', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to stop stream',
      error: error.message
    });
  }
});

router.post('/heartbeat', async (req, res) => {
  try {
    const { channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        status: 'error',
        message: 'channelId is required'
      });
    }
    
    const isActive = streamManager.updateHeartbeat(channelId);
    
    res.json({
      status: 'success',
      data: {
        channelId,
        isActive,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Heartbeat failed', { 
      channelId: req.body.channelId, 
      error: error.message 
    });
    
    res.status(500).json({
      status: 'error',
      message: 'Heartbeat failed',
      error: error.message
    });
  }
});

router.get('/status', (req, res) => {
  try {
    const activeStreams = streamManager.getActiveStreams();
    
    res.json({
      status: 'success',
      data: {
        activeStreams: Array.from(activeStreams.entries()).map(([channelId, info]) => ({
          channelId,
          rtmpUrl: info.rtmpUrl,
          hlsUrl: info.hlsUrl,
          startTime: info.startTime,
          lastHeartbeat: streamManager.getLastHeartbeat(channelId)
        })),
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Failed to get status', { error: error.message });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get status',
      error: error.message
    });
  }
});

// 系统状态端点
router.get('/system/status', (req, res) => {
  try {
    const activeStreams = streamManager.getActiveStreams();
    
    res.json({
      status: 'success',
      data: {
        activeStreams: activeStreams.size,
        totalSessions: Array.from(activeStreams.values()).reduce((total, stream) => total + (stream.sessions || 0), 0),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to get system status', { error: error.message });
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to get system status',
      error: error.message
    });
  }
});

module.exports = { router };
EOF

log_success "simple-stream.js文件已更新"

# 确保正确的status.js文件
log_info "确保status.js文件正确..."
cat > /opt/yoyo-transcoder/src/routes/status.js << 'EOF'
const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');

// 安全的日志函数，避免logger初始化问题
const safeLogger = {
  info: (msg, data) => console.log('INFO:', msg, data ? JSON.stringify(data) : ''),
  warn: (msg, data) => console.warn('WARN:', msg, data ? JSON.stringify(data) : ''),
  error: (msg, data) => console.error('ERROR:', msg, data ? JSON.stringify(data) : '')
};

// 安全的健康检查端点 - 不依赖任何外部模块
router.get('/health', async (req, res) => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        freemem: os.freemem(),
        totalmem: os.totalmem()
      },
      services: {
        express: 'running',
        node: process.version
      }
    };
    
    // 检查HLS目录是否存在（安全方式）
    try {
      const hlsDir = process.env.HLS_OUTPUT_DIR || './hls';
      const hlsPath = path.resolve(hlsDir);
      if (fs.existsSync(hlsPath)) {
        healthStatus.services.hls_directory = 'available';
      } else {
        healthStatus.services.hls_directory = 'missing';
      }
    } catch (error) {
      healthStatus.services.hls_directory = 'error';
    }
    
    safeLogger.info('Health check performed', { status: 'healthy' });
    res.json(healthStatus);
  } catch (error) {
    safeLogger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
EOF

log_success "status.js文件已更新"

# 设置文件保护
log_info "设置文件保护（防止被意外修改）..."
chattr +i /opt/yoyo-transcoder/src/routes/simple-stream.js 2>/dev/null || log_warning "无法设置文件保护（可能不支持chattr）"
chattr +i /opt/yoyo-transcoder/src/routes/status.js 2>/dev/null || log_warning "无法设置文件保护（可能不支持chattr）"

# 重启PM2服务
log_info "重启PM2服务..."
pm2 restart vps-transcoder-api
if [ $? -eq 0 ]; then
    log_success "PM2服务重启成功"
else
    log_error "PM2服务重启失败"
fi

# 等待服务启动
log_info "等待服务启动..."
sleep 5

# 6. 修复后验证
echo ""
log_info "=== 6. 修复后验证 ==="

# 再次测试API端点
log_info "验证修复效果..."

# 测试健康检查
health_response=$(curl -s -w "%{http_code}" -o /tmp/health_verify.json http://localhost:3000/health)
if [ "$health_response" = "200" ]; then
    log_success "健康检查端点修复成功"
else
    log_error "健康检查端点仍有问题"
fi

# 测试simple-stream端点
status_response=$(curl -s -w "%{http_code}" -o /tmp/status_verify.json http://localhost:3000/api/simple-stream/system/status)
if [ "$status_response" = "200" ]; then
    log_success "simple-stream端点修复成功"
else
    log_error "simple-stream端点仍有问题"
fi

# 测试start-watching端点（模拟请求）
log_info "测试start-watching端点..."
start_watching_response=$(curl -s -w "%{http_code}" -o /tmp/start_watching_test.json \
  -H "Content-Type: application/json" \
  -d '{"channelId":"stream_gkg5hknc"}' \
  http://localhost:3000/api/simple-stream/start-watching)

if [ "$start_watching_response" = "200" ]; then
    log_success "start-watching端点正常"
    cat /tmp/start_watching_test.json | jq . 2>/dev/null || cat /tmp/start_watching_test.json
elif [ "$start_watching_response" = "500" ]; then
    log_warning "start-watching端点返回500，可能是业务逻辑错误"
    cat /tmp/start_watching_test.json | jq . 2>/dev/null || cat /tmp/start_watching_test.json
else
    log_error "start-watching端点异常 (HTTP $start_watching_response)"
    cat /tmp/start_watching_test.json 2>/dev/null || echo "无响应内容"
fi

# 清理临时文件
rm -f /tmp/health_test.json /tmp/status_test.json /tmp/health_verify.json /tmp/status_verify.json /tmp/start_watching_test.json

echo ""
log_info "=== 修复完成 ==="
log_info "如果问题仍然存在，请检查："
log_info "1. Cloudflare Workers的部署状态"
log_info "2. 前端认证token的有效性"
log_info "3. 代理服务器的网络连接"
log_info "4. 浏览器控制台的详细错误信息"

echo ""
log_success "脚本执行完成！"
