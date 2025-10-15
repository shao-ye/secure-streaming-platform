# 统一视频播放器系统 - 部署和使用指南

## 🎯 项目概述

统一视频播放器系统是一个完整的视频流解决方案，集成了智能路由、会话保护、RTMP源管理等高级功能，为YOYO平台提供低延迟、高可靠性的视频流服务。

## 📋 系统架构

### 后端组件
- **IntegratedStreamingService** - 集成流媒体服务（核心）
- **ChannelRouter** - 智能通道路由管理器
- **IntelligentRoutingManager** - 智能路由切换管理器
- **RTMPSourceManager** - RTMP源变更处理器
- **SessionProtectionManager** - 会话保护管理器
- **SimpleStreamManager** - 基础流管理器（向后兼容）
- **ProxyManager** - 代理管理器（向后兼容）

### 前端组件
- **UnifiedVideoPlayer.vue** - 统一视频播放器组件
- **StreamingApi.js** - 前端API服务
- **StreamingTest.vue** - 系统测试页面

### API路由
- `/api/integrated-streaming/*` - 集成流媒体API（主要）
- `/api/simple-stream/*` - 简化流管理API（兼容）
- `/api/proxy/*` - 代理管理API（兼容）

## 🚀 快速开始

### 1. 后端部署

```bash
# 进入后端目录
cd vps-transcoder-api/vps-transcoder-api

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置必要参数

# 启动服务
npm start
# 或使用 PM2
pm2 start ecosystem.config.js
```

### 2. 前端部署

```bash
# 进入前端目录
cd vps-transcoder-api/frontend

# 安装依赖
npm install

# 配置API地址
# 编辑 .env 文件，设置 VUE_APP_API_BASE_URL

# 开发模式启动
npm run serve

# 生产构建
npm run build
```

### 3. 系统验证

```bash
# 运行系统验证脚本
cd vps-transcoder-api
node system-validation.js
```

## 🔧 配置说明

### 后端配置 (.env)

```env
# 服务器配置
PORT=3000
NODE_ENV=production

# API安全配置
API_SECRET_KEY=your-secret-key-here

# FFmpeg配置
FFMPEG_PATH=/usr/bin/ffmpeg
HLS_OUTPUT_DIR=/var/www/hls
HLS_SEGMENT_TIME=2
HLS_LIST_SIZE=6

# 日志配置
LOG_LEVEL=info
LOG_DIR=./logs

# 智能路由配置
ENABLE_INTELLIGENT_ROUTING=true
ENABLE_SESSION_PROTECTION=true
ENABLE_RTMP_SOURCE_MANAGEMENT=true

# 代理配置
PROXY_TIMEOUT=30000
PROXY_RETRY_ATTEMPTS=3
```

### 前端配置 (.env)

```env
# API配置
VUE_APP_API_BASE_URL=https://your-api-domain.com

# 功能开关
VUE_APP_ENABLE_DEBUG=false
VUE_APP_ENABLE_PERFORMANCE_MONITOR=true

# HLS配置
VUE_APP_HLS_SEGMENT_DURATION=2
VUE_APP_HLS_BUFFER_SIZE=6
```

## 📖 API使用指南

### 1. 启动智能观看

```javascript
// 前端调用
import streamingApi from '@/services/streamingApi'

const result = await streamingApi.startWatching(
  'channel-001',
  'rtmp://example.com/live/stream',
  {
    autoPlay: true,
    quality: 'auto',
    userLocation: { country: 'CN', city: 'Beijing' }
  }
)

console.log('HLS URL:', result.data.hlsUrl)
```

```bash
# 直接API调用
curl -X POST http://localhost:3000/api/integrated-streaming/start-watching \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "channel-001",
    "rtmpUrl": "rtmp://example.com/live/stream",
    "options": {
      "autoPlay": true,
      "quality": "auto"
    }
  }'
```

### 2. 发送心跳

```javascript
// 前端自动心跳
const heartbeatManager = streamingApi.createHeartbeatManager('channel-001')
heartbeatManager.start(() => ({
  networkQuality: 'good',
  latency: 120,
  bufferHealth: 85
}))
```

### 3. 手动路由切换

```javascript
// 切换到代理路由
await streamingApi.switchRoute('channel-001', 'proxy')

// 切换到直连路由
await streamingApi.switchRoute('channel-001', 'direct')
```

## 🎮 前端组件使用

### UnifiedVideoPlayer 组件

```vue
<template>
  <div class="video-container">
    <UnifiedVideoPlayer
      :channel-id="channelId"
      :rtmp-url="rtmpUrl"
      :auto-play="true"
      :show-info="true"
      @play="onVideoPlay"
      @error="onVideoError"
      @channelSwitch="onChannelSwitch"
    />
  </div>
</template>

<script setup>
import UnifiedVideoPlayer from '@/components/video/UnifiedVideoPlayer.vue'

const channelId = 'my-channel'
const rtmpUrl = 'rtmp://example.com/live/stream'

const onVideoPlay = () => {
  console.log('视频开始播放')
}

const onVideoError = (error) => {
  console.error('视频播放错误:', error)
}

const onChannelSwitch = (data) => {
  console.log('频道切换:', data)
}
</script>
```

### 组件属性

| 属性 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| channelId | String | ✅ | - | 频道ID |
| rtmpUrl | String | ✅ | - | RTMP源地址 |
| autoPlay | Boolean | ❌ | true | 自动播放 |
| showInfo | Boolean | ❌ | true | 显示播放器信息 |
| posterUrl | String | ❌ | '' | 封面图片URL |

### 组件事件

| 事件 | 参数 | 描述 |
|------|------|------|
| play | - | 视频开始播放 |
| pause | - | 视频暂停 |
| error | error | 播放错误 |
| channelSwitch | data | 频道切换 |
| sourceUpdate | data | 源更新通知 |

## 🔍 系统监控

### 1. 健康检查

```bash
# 检查系统健康状态
curl http://localhost:3000/api/integrated-streaming/health

# 获取系统状态
curl http://localhost:3000/api/integrated-streaming/system/status
```

### 2. 频道监控

```bash
# 获取频道信息
curl http://localhost:3000/api/integrated-streaming/channel/channel-001

# 获取可用路由
curl http://localhost:3000/api/integrated-streaming/routes/available?channelId=channel-001
```

### 3. 日志监控

```bash
# 查看应用日志
tail -f logs/app.log

# 查看错误日志
tail -f logs/error.log

# 使用PM2监控
pm2 logs vps-transcoder-api
pm2 monit
```

## 🛠️ 故障排除

### 常见问题

#### 1. 视频无法播放
- 检查RTMP源是否可访问
- 验证FFmpeg是否正确安装
- 查看HLS文件是否生成

```bash
# 检查FFmpeg
which ffmpeg
ffmpeg -version

# 检查HLS文件
ls -la /var/www/hls/channel-001/
```

#### 2. 路由切换失败
- 检查代理配置是否正确
- 验证网络连接状态
- 查看代理管理器日志

```bash
# 检查代理状态
curl http://localhost:3000/api/proxy/status

# 测试代理连接
curl -x socks5://127.0.0.1:1080 http://www.google.com
```

#### 3. 心跳超时
- 检查网络连接稳定性
- 调整心跳间隔设置
- 查看会话保护管理器状态

### 性能优化

#### 1. HLS优化
```env
# 减少延迟
HLS_SEGMENT_TIME=1
HLS_LIST_SIZE=3

# 提高质量
HLS_SEGMENT_TIME=4
HLS_LIST_SIZE=10
```

#### 2. 网络优化
- 启用CDN加速
- 配置多路由负载均衡
- 优化代理服务器选择

#### 3. 服务器优化
- 增加FFmpeg进程数限制
- 优化内存使用
- 配置SSD存储HLS文件

## 🔐 安全配置

### 1. API安全
```env
# 启用API密钥验证
API_SECRET_KEY=your-strong-secret-key

# 限制访问来源
ALLOWED_ORIGINS=https://your-frontend-domain.com

# 启用IP白名单
ENABLE_IP_WHITELIST=true
```

### 2. 代理安全
- 使用加密代理协议（VLESS/VMess）
- 定期更新代理配置
- 监控代理连接状态

### 3. 文件安全
- 限制HLS文件访问权限
- 定期清理临时文件
- 配置防盗链保护

## 📊 性能指标

### 关键指标
- **延迟**: < 3秒（目标 < 1秒）
- **成功率**: > 99%
- **路由切换时间**: < 5秒
- **心跳响应时间**: < 500ms

### 监控工具
- Prometheus + Grafana
- ELK Stack (日志分析)
- PM2 Monitor (进程监控)

## 🔄 版本更新

### 更新流程
1. 备份当前配置和数据
2. 停止服务
3. 更新代码
4. 运行数据库迁移（如需要）
5. 重启服务
6. 验证功能正常

### 回滚计划
- 保留前一版本的完整备份
- 准备快速回滚脚本
- 监控关键指标

## 📞 技术支持

如遇到问题，请提供以下信息：
1. 错误日志和堆栈跟踪
2. 系统配置信息
3. 复现步骤
4. 预期行为和实际行为

---

**版本**: 2.0.0  
**更新时间**: 2024-10-15  
**维护团队**: YOYO开发团队
