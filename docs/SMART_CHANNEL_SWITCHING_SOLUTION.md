# 🎯 智能通道切换解决方案 - 平滑过渡设计

## 📋 核心理念

基于RTMP源一致性，实现用户观看视频时的**零中断智能通道切换**，当管理员调整代理配置时，用户可以无感知地在不同网络路径间平滑切换。

## 🏗️ 技术架构设计

### 1. 多通道路由管理器 (ChannelRouter)

#### 通道优先级策略
```javascript
class ChannelRouter {
  constructor() {
    this.channelSources = new Map();
    this.userPreferences = new Map(); // 用户手动选择的通道
    this.channelHealthStatus = new Map(); // 通道健康状态
  }

  // 通道优先级配置
  getChannelPriority() {
    return [
      {
        type: 'user_manual',     // 用户手动选择 (最高优先级)
        priority: 0,
        description: '用户手动指定通道'
      },
      {
        type: 'proxy_optimized', // 代理优化通道
        priority: 1,
        description: '代理加速通道 (推荐)'
      },
      {
        type: 'tunnel_optimized', // 隧道优化通道
        priority: 2,
        description: 'Cloudflare隧道优化'
      },
      {
        type: 'direct_connection', // 直连通道
        priority: 3,
        description: '直连通道 (备用)'
      }
    ];
  }

  // 获取频道的所有可用路径
  getChannelPaths(channelId) {
    return {
      channelId,
      rtmpSource: this.getRtmpSource(channelId), // 原始RTMP源
      accessPaths: [
        {
          type: 'proxy_optimized',
          priority: 1,
          url: `https://yoyoapi.your-domain.com/hls/${channelId}/playlist.m3u8`,
          healthCheck: () => this.checkProxyHealth(),
          fallbackReason: null
        },
        {
          type: 'tunnel_optimized', 
          priority: 2,
          url: `https://tunnel-hls.yoyo-vps.your-domain.com/hls/${channelId}/playlist.m3u8`,
          healthCheck: () => this.checkTunnelHealth(),
          fallbackReason: null
        },
        {
          type: 'direct_connection',
          priority: 3,
          url: `https://yoyo-vps.your-domain.com/hls/${channelId}/playlist.m3u8`,
          healthCheck: () => this.checkDirectHealth(),
          fallbackReason: null
        }
      ]
    };
  }

  // 智能选择最佳通道
  async selectBestChannel(channelId, userId) {
    const userPreference = this.userPreferences.get(userId);
    
    // 1. 用户手动选择优先
    if (userPreference && userPreference.channelId === channelId) {
      const manualPath = await this.validateChannelPath(userPreference.path);
      if (manualPath.isValid) {
        return {
          selectedPath: manualPath,
          reason: 'user_manual_selection',
          message: `使用用户指定的${manualPath.description}通道`
        };
      }
    }

    // 2. 自动选择最佳可用通道
    const channelPaths = this.getChannelPaths(channelId);
    const sortedPaths = channelPaths.accessPaths.sort((a, b) => a.priority - b.priority);

    for (const path of sortedPaths) {
      const healthStatus = await path.healthCheck();
      
      if (healthStatus.isHealthy) {
        return {
          selectedPath: path,
          reason: 'auto_selection',
          message: `自动选择${path.description || path.type}通道`,
          healthScore: healthStatus.score
        };
      } else {
        path.fallbackReason = healthStatus.reason;
      }
    }

    // 3. 所有通道都不可用时的处理
    throw new Error('所有通道都不可用，请稍后重试');
  }
}
```

### 2. 前端智能播放器 (SmartVideoPlayer)

#### HLS.js集成的智能切换
```javascript
class SmartVideoPlayer {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.hls = null;
    this.channelRouter = new ChannelRouter();
    this.currentChannel = null;
    this.switchingInProgress = false;
    this.retryAttempts = 0;
    this.maxRetries = 3;
    
    // 切换配置
    this.switchConfig = {
      seamlessSwitch: true,        // 启用无缝切换
      preservePosition: true,      // 保持播放位置
      autoFallback: true,         // 自动故障转移
      switchDelay: 2000,          // 切换延迟 (2秒)
      healthCheckInterval: 30000   // 健康检查间隔 (30秒)
    };
  }

  // 启动播放并选择最佳通道
  async startPlayback(channelId, userId) {
    try {
      // 1. 选择最佳通道
      const channelSelection = await this.channelRouter.selectBestChannel(channelId, userId);
      
      // 2. 初始化播放器
      await this.initializePlayer(channelSelection);
      
      // 3. 启动健康监控
      this.startHealthMonitoring(channelId, userId);
      
      // 4. 监听管理员配置变更
      this.listenForConfigChanges(channelId, userId);
      
      return channelSelection;
      
    } catch (error) {
      console.error('播放启动失败:', error);
      throw error;
    }
  }

  // 无缝通道切换
  async switchChannel(newChannelPath, reason = 'auto') {
    if (this.switchingInProgress) {
      console.log('通道切换正在进行中，跳过本次切换');
      return;
    }

    this.switchingInProgress = true;
    const currentTime = this.video.currentTime;
    
    try {
      console.log(`🔄 开始通道切换: ${reason}`, {
        from: this.currentChannel?.type,
        to: newChannelPath.type,
        currentTime: currentTime
      });

      // 1. 显示切换提示
      this.showSwitchingIndicator(newChannelPath, reason);
      
      // 2. 预加载新通道
      const newHls = await this.preloadChannel(newChannelPath);
      
      // 3. 无缝切换
      if (this.switchConfig.seamlessSwitch) {
        await this.performSeamlessSwitch(newHls, currentTime);
      } else {
        await this.performDirectSwitch(newHls);
      }
      
      // 4. 更新当前通道信息
      this.currentChannel = newChannelPath;
      
      // 5. 隐藏切换提示
      this.hideSwitchingIndicator();
      
      console.log('✅ 通道切换完成');
      
    } catch (error) {
      console.error('❌ 通道切换失败:', error);
      await this.handleSwitchFailure(error);
    } finally {
      this.switchingInProgress = false;
    }
  }

  // 无缝切换实现
  async performSeamlessSwitch(newHls, preserveTime) {
    return new Promise((resolve, reject) => {
      let switchCompleted = false;
      
      // 监听新播放器准备就绪
      newHls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (switchCompleted) return;
        
        // 设置播放位置
        if (this.switchConfig.preservePosition && preserveTime > 0) {
          this.video.currentTime = preserveTime;
        }
        
        // 替换旧播放器
        if (this.hls) {
          this.hls.destroy();
        }
        this.hls = newHls;
        
        // 继续播放
        if (!this.video.paused) {
          this.video.play().catch(console.error);
        }
        
        switchCompleted = true;
        resolve();
      });

      // 错误处理
      newHls.on(Hls.Events.ERROR, (event, data) => {
        if (switchCompleted) return;
        
        console.error('新通道加载失败:', data);
        switchCompleted = true;
        reject(new Error(`通道切换失败: ${data.details}`));
      });

      // 超时保护
      setTimeout(() => {
        if (!switchCompleted) {
          switchCompleted = true;
          reject(new Error('通道切换超时'));
        }
      }, 10000);
    });
  }

  // 监听管理员配置变更
  listenForConfigChanges(channelId, userId) {
    // 通过WebSocket或轮询监听配置变更
    this.configWatcher = setInterval(async () => {
      try {
        const currentConfig = await this.fetchCurrentConfig();
        
        // 检查代理状态变更
        if (this.hasConfigChanged(currentConfig)) {
          console.log('🔧 检测到管理员配置变更');
          
          // 重新选择最佳通道
          const newSelection = await this.channelRouter.selectBestChannel(channelId, userId);
          
          // 如果需要切换通道
          if (newSelection.selectedPath.url !== this.currentChannel?.url) {
            await this.switchChannel(newSelection.selectedPath, 'admin_config_change');
          }
        }
      } catch (error) {
        console.warn('配置检查失败:', error);
      }
    }, 10000); // 每10秒检查一次
  }

  // 健康监控和自动故障转移
  startHealthMonitoring(channelId, userId) {
    this.healthMonitor = setInterval(async () => {
      if (this.switchingInProgress) return;
      
      try {
        // 检查当前通道健康状态
        const healthStatus = await this.checkCurrentChannelHealth();
        
        if (!healthStatus.isHealthy) {
          console.warn('⚠️ 当前通道健康状态不佳:', healthStatus);
          
          // 尝试切换到更好的通道
          const betterChannel = await this.findBetterChannel(channelId, userId);
          if (betterChannel) {
            await this.switchChannel(betterChannel, 'health_optimization');
          }
        }
      } catch (error) {
        console.warn('健康检查失败:', error);
      }
    }, this.switchConfig.healthCheckInterval);
  }
}
```

### 3. 用户界面增强

#### 通道选择和状态显示
```vue
<template>
  <div class="smart-video-player">
    <!-- 视频播放器 -->
    <video ref="videoElement" class="video-player" controls></video>
    
    <!-- 通道状态指示器 -->
    <div class="channel-status-bar">
      <div class="current-channel">
        <el-tag :type="channelStatusColor" size="small">
          {{ currentChannelName }}
        </el-tag>
        <span class="response-time" v-if="responseTime">
          {{ responseTime }}ms
        </span>
      </div>
      
      <!-- 切换进度指示器 -->
      <div v-if="switchingInProgress" class="switching-indicator">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>{{ switchingMessage }}</span>
      </div>
    </div>
    
    <!-- 通道选择面板 -->
    <div class="channel-selector" v-if="showChannelSelector">
      <el-card class="channel-options">
        <template #header>
          <div class="card-header">
            <span>选择播放通道</span>
            <el-button text @click="showChannelSelector = false">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </template>
        
        <div class="channel-list">
          <div 
            v-for="channel in availableChannels" 
            :key="channel.type"
            class="channel-option"
            :class="{ 
              active: channel.type === currentChannel?.type,
              disabled: !channel.isHealthy 
            }"
            @click="selectChannel(channel)"
          >
            <div class="channel-info">
              <div class="channel-name">{{ channel.name }}</div>
              <div class="channel-description">{{ channel.description }}</div>
            </div>
            <div class="channel-status">
              <el-tag 
                :type="channel.isHealthy ? 'success' : 'danger'" 
                size="small"
              >
                {{ channel.isHealthy ? '正常' : '异常' }}
              </el-tag>
              <span v-if="channel.responseTime" class="response-time">
                {{ channel.responseTime }}ms
              </span>
            </div>
          </div>
        </div>
        
        <div class="channel-actions">
          <el-button @click="resetToAuto">恢复自动选择</el-button>
          <el-button type="primary" @click="refreshChannelStatus">刷新状态</el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { SmartVideoPlayer } from '@/utils/SmartVideoPlayer';

const videoElement = ref(null);
const smartPlayer = ref(null);
const currentChannel = ref(null);
const switchingInProgress = ref(false);
const switchingMessage = ref('');
const showChannelSelector = ref(false);
const availableChannels = ref([]);
const responseTime = ref(null);

// 通道状态颜色
const channelStatusColor = computed(() => {
  if (switchingInProgress.value) return 'warning';
  if (!currentChannel.value?.isHealthy) return 'danger';
  
  switch (currentChannel.value?.type) {
    case 'proxy_optimized': return 'success';
    case 'tunnel_optimized': return 'primary';
    case 'direct_connection': return 'info';
    default: return 'info';
  }
});

// 当前通道名称
const currentChannelName = computed(() => {
  if (switchingInProgress.value) return '切换中...';
  
  const channelNames = {
    'proxy_optimized': '代理加速',
    'tunnel_optimized': '隧道优化', 
    'direct_connection': '直连模式',
    'user_manual': '手动选择'
  };
  
  return channelNames[currentChannel.value?.type] || '未知通道';
});

// 初始化播放器
onMounted(async () => {
  try {
    smartPlayer.value = new SmartVideoPlayer(videoElement.value, {
      onChannelSwitch: (newChannel, reason) => {
        currentChannel.value = newChannel;
        switchingMessage.value = `切换到${newChannel.name} (${reason})`;
      },
      onSwitchStart: (message) => {
        switchingInProgress.value = true;
        switchingMessage.value = message;
      },
      onSwitchComplete: () => {
        switchingInProgress.value = false;
        switchingMessage.value = '';
      }
    });
    
    // 开始播放
    const channelId = props.channelId;
    const userId = getCurrentUserId();
    
    const selection = await smartPlayer.value.startPlayback(channelId, userId);
    currentChannel.value = selection.selectedPath;
    
    // 加载可用通道列表
    await loadAvailableChannels();
    
  } catch (error) {
    console.error('播放器初始化失败:', error);
  }
});

// 手动选择通道
const selectChannel = async (channel) => {
  if (!channel.isHealthy) return;
  
  try {
    await smartPlayer.value.switchToChannel(channel, 'user_manual');
    showChannelSelector.value = false;
  } catch (error) {
    console.error('手动切换通道失败:', error);
  }
};

// 恢复自动选择
const resetToAuto = async () => {
  try {
    await smartPlayer.value.resetToAutoSelection();
    showChannelSelector.value = false;
  } catch (error) {
    console.error('恢复自动选择失败:', error);
  }
};
</script>
```

## 🎯 平滑过渡的关键特性

### 1. 零中断切换
- **相同内容源**: 所有通道指向同一个HLS流
- **时间轴连续**: 保持播放位置和时间戳
- **预加载机制**: 新通道预先加载，减少切换延迟

### 2. 智能优先级管理
```javascript
const switchingPriority = {
  // 用户手动选择 > 自动优化 > 故障转移
  userManual: 0,      // 用户指定通道，不受管理员配置影响
  proxyOptimized: 1,  // 代理加速通道 (管理员开启时优先)
  tunnelOptimized: 2, // 隧道优化通道
  directConnection: 3 // 直连备用通道
};
```

### 3. 配置变更响应
- **实时监听**: 检测管理员的代理配置变更
- **智能切换**: 自动选择新的最佳通道
- **用户保护**: 手动选择的通道不受自动切换影响

### 4. 故障转移机制
- **健康监控**: 持续监控通道健康状态
- **自动降级**: 通道异常时自动切换到备用通道
- **快速恢复**: 通道恢复后自动切换回优先通道

## 📊 用户体验改善

### 改善前 (原方案)
```
管理员关闭代理 → 用户播放中断 → 需要手动刷新 → 重新开始播放
```

### 改善后 (智能切换)
```
管理员关闭代理 → 系统检测变更 → 自动切换直连 → 用户无感知继续观看
```

## 🚀 实施优势

### 1. 技术优势
- ✅ **RTMP源一致**: 确保内容完全相同
- ✅ **HLS特性**: 支持无缝切换的流媒体协议
- ✅ **多路径冗余**: 提供多个访问路径保证可用性

### 2. 用户体验优势
- ✅ **零中断观看**: 管理员操作不影响用户观看
- ✅ **智能优化**: 自动选择最佳网络路径
- ✅ **手动控制**: 用户可以手动选择偏好通道

### 3. 管理优势
- ✅ **灵活配置**: 管理员可以随时调整网络策略
- ✅ **实时生效**: 配置变更立即对新用户生效
- ✅ **平滑过渡**: 现有用户无感知切换

## 🚨 RTMP源变更场景处理

### 问题场景
当用户正在观看频道1时，管理员修改了频道1的RTMP源地址，这种情况下无法实现无缝切换，因为：

#### 技术限制分析
```javascript
// 场景：用户观看频道1，管理员修改RTMP源
const scenario = {
  before: {
    channelId: 'stream_ensxma2g',
    rtmpUrl: '<RTMP_URL>',  // 原摄像头源
    content: '二楼教室1的实时画面'
  },
  after: {
    channelId: 'stream_ensxma2g', 
    rtmpUrl: '<RTMP_URL>',  // 新摄像头源
    content: '完全不同的画面内容'
  }
};

// 问题：内容本身发生变化，无法无缝切换
const technicalIssues = {
  contentDiscontinuity: '视频内容完全不同',
  timelineBreak: '时间轴无法连续',
  hlsIncompatibility: 'HLS分片内容根本性变化'
};
```

### 处理策略

#### 策略1: 强制重新加载 (推荐)
```javascript
class RTMPSourceChangeHandler {
  async handleSourceChange(channelId, newRtmpUrl) {
    const affectedUsers = this.getChannelViewers(channelId);
    
    if (affectedUsers.length > 0) {
      // 1. 通知用户即将更新
      await this.notifyUsersOfSourceChange(affectedUsers, {
        channelId,
        message: '管理员正在更新视频源，即将刷新画面',
        countdown: 5 // 5秒倒计时
      });
      
      // 2. 等待通知时间
      await this.delay(5000);
      
      // 3. 停止旧的转码进程
      await this.stopChannelStream(channelId);
      
      // 4. 更新频道配置
      await this.updateChannelConfig(channelId, newRtmpUrl);
      
      // 5. 通知前端强制重新加载
      await this.triggerChannelReload(affectedUsers, channelId);
      
      return {
        strategy: 'force_reload',
        affectedUsers: affectedUsers.length,
        message: '已通知用户重新加载新的视频源'
      };
    } else {
      // 没有用户观看，直接更新配置
      await this.updateChannelConfig(channelId, newRtmpUrl);
      return {
        strategy: 'direct_update',
        message: '无用户观看，直接更新配置'
      };
    }
  }
  
  // 通知用户源变更
  async notifyUsersOfSourceChange(users, notification) {
    const message = {
      type: 'rtmp_source_change',
      channelId: notification.channelId,
      title: '视频源更新通知',
      message: notification.message,
      countdown: notification.countdown,
      action: 'prepare_reload'
    };
    
    // 通过WebSocket或轮询通知所有用户
    for (const user of users) {
      await this.sendUserNotification(user.sessionId, message);
    }
  }
  
  // 触发前端重新加载
  async triggerChannelReload(users, channelId) {
    const reloadMessage = {
      type: 'channel_reload_required',
      channelId: channelId,
      action: 'reload_player',
      reason: 'rtmp_source_changed'
    };
    
    for (const user of users) {
      await this.sendUserNotification(user.sessionId, reloadMessage);
    }
  }
}
```

#### 策略2: 优雅过渡显示
```javascript
// 前端处理RTMP源变更
class SmartVideoPlayer {
  handleRTMPSourceChange(notification) {
    // 1. 显示更新通知
    this.showSourceChangeNotification(notification);
    
    // 2. 倒计时显示
    this.startUpdateCountdown(notification.countdown);
    
    // 3. 准备重新加载
    this.prepareForReload(notification.channelId);
  }
  
  showSourceChangeNotification(notification) {
    // 显示覆盖层通知
    const overlay = {
      type: 'source-update',
      title: '视频源更新',
      message: notification.message,
      countdown: notification.countdown,
      style: {
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        padding: '20px',
        borderRadius: '8px',
        textAlign: 'center'
      }
    };
    
    this.displayOverlay(overlay);
  }
  
  async reloadWithNewSource(channelId) {
    try {
      // 1. 停止当前播放
      if (this.hls) {
        this.hls.destroy();
      }
      
      // 2. 清除旧的播放状态
      this.video.src = '';
      
      // 3. 重新初始化播放器
      await this.initializePlayer(channelId);
      
      // 4. 隐藏通知覆盖层
      this.hideOverlay();
      
      // 5. 显示成功消息
      this.showMessage('视频源已更新，正在加载新内容...', 'success');
      
    } catch (error) {
      console.error('重新加载失败:', error);
      this.showMessage('视频源更新失败，请手动刷新页面', 'error');
    }
  }
}
```

#### 策略3: 智能检测和处理
```javascript
// VPS端检测RTMP源变更
class SimpleStreamManager {
  async updateChannelRTMP(channelId, newRtmpUrl) {
    const existingStream = this.activeStreams.get(channelId);
    
    if (existingStream) {
      // 有用户正在观看
      const viewers = this.getChannelViewers(channelId);
      
      if (viewers.length > 0) {
        console.log(`⚠️ 频道 ${channelId} 有 ${viewers.length} 个用户观看，准备更新RTMP源`);
        
        // 1. 记录当前状态
        const currentState = {
          channelId,
          oldRtmpUrl: existingStream.rtmpUrl,
          newRtmpUrl: newRtmpUrl,
          affectedViewers: viewers.length,
          updateTime: Date.now()
        };
        
        // 2. 通知前端准备更新
        await this.notifyFrontendOfSourceChange(currentState);
        
        // 3. 等待前端准备完成
        await this.waitForFrontendReady(channelId);
        
        // 4. 执行源切换
        await this.executeSourceSwitch(channelId, newRtmpUrl);
        
        return {
          success: true,
          strategy: 'graceful_update',
          affectedUsers: viewers.length
        };
      }
    }
    
    // 没有用户观看，直接更新
    await this.directUpdateRTMP(channelId, newRtmpUrl);
    return {
      success: true,
      strategy: 'direct_update',
      affectedUsers: 0
    };
  }
  
  async executeSourceSwitch(channelId, newRtmpUrl) {
    try {
      // 1. 停止旧的FFmpeg进程
      await this.stopFFmpegProcess(channelId);
      
      // 2. 清理旧的HLS文件
      await this.cleanupChannelHLS(channelId);
      
      // 3. 更新频道配置
      const channelConfig = this.channelConfigs.get(channelId);
      channelConfig.rtmpUrl = newRtmpUrl;
      
      // 4. 启动新的FFmpeg进程
      const newProcess = await this.spawnFFmpegProcess(channelId, newRtmpUrl);
      
      // 5. 更新活跃流信息
      this.activeStreams.set(channelId, {
        channelId: channelId,
        rtmpUrl: newRtmpUrl,
        hlsUrl: `https://yoyo-vps.your-domain.com/hls/${channelId}/playlist.m3u8`,
        startTime: Date.now(),
        process: newProcess
      });
      
      console.log(`✅ 频道 ${channelId} RTMP源更新完成`);
      
    } catch (error) {
      console.error(`❌ 频道 ${channelId} RTMP源更新失败:`, error);
      throw error;
    }
  }
}
```

### 用户界面处理

#### 更新通知界面
```vue
<template>
  <div class="rtmp-update-overlay" v-if="showUpdateNotification">
    <div class="update-notification">
      <div class="notification-icon">
        <el-icon size="48"><VideoCamera /></el-icon>
      </div>
      <h3>视频源更新通知</h3>
      <p>{{ updateMessage }}</p>
      <div class="countdown" v-if="countdown > 0">
        <el-progress 
          type="circle" 
          :percentage="countdownPercentage"
          :width="80"
        >
          <span class="countdown-text">{{ countdown }}s</span>
        </el-progress>
      </div>
      <div class="update-actions" v-if="countdown === 0">
        <el-button type="primary" @click="confirmReload">
          立即更新
        </el-button>
        <el-button @click="delayReload">
          稍后更新
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const showUpdateNotification = ref(false);
const updateMessage = ref('');
const countdown = ref(0);
const maxCountdown = ref(5);

const countdownPercentage = computed(() => {
  return ((maxCountdown.value - countdown.value) / maxCountdown.value) * 100;
});

// 处理RTMP源更新通知
const handleRTMPSourceUpdate = (notification) => {
  showUpdateNotification.value = true;
  updateMessage.value = notification.message;
  countdown.value = notification.countdown;
  maxCountdown.value = notification.countdown;
  
  // 开始倒计时
  const timer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      clearInterval(timer);
    }
  }, 1000);
};

// 确认重新加载
const confirmReload = async () => {
  showUpdateNotification.value = false;
  await smartPlayer.value.reloadWithNewSource(currentChannelId.value);
};

// 延迟重新加载
const delayReload = () => {
  showUpdateNotification.value = false;
  // 用户选择稍后更新，可以继续观看旧内容
  // 但需要提醒用户内容可能已过时
};
</script>
```

### 最佳实践建议

#### 1. 用户体验优先
- **提前通知**: 给用户5-10秒的准备时间
- **清晰说明**: 解释为什么需要更新
- **选择权**: 允许用户选择立即更新或稍后更新

#### 2. 技术实现要点
- **状态检测**: 准确检测有多少用户正在观看
- **优雅停止**: 给FFmpeg进程足够时间正常退出
- **快速启动**: 新源的FFmpeg进程快速启动

#### 3. 错误处理
- **回退机制**: 新源启动失败时回退到旧源
- **用户通知**: 及时通知用户更新状态
- **日志记录**: 详细记录更新过程便于排查

## 💡 总结

RTMP源变更与代理切换不同，**无法实现无缝过渡**，但可以通过：

1. **🎯 优雅通知**: 提前通知用户即将更新
2. **🔄 快速切换**: 最小化更新时间
3. **👤 用户选择**: 给用户选择更新时机的权利
4. **⚡ 智能处理**: 根据观看人数选择不同策略

这样可以将RTMP源变更对用户的影响降到最低！
