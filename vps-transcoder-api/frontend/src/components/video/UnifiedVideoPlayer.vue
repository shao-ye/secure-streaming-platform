<template>
  <div class="unified-video-player">
    <!-- 视频播放器容器 -->
    <div class="video-container" ref="videoContainer">
      <video
        ref="videoElement"
        class="video-player"
        :poster="posterUrl"
        controls
        playsinline
        webkit-playsinline
      ></video>
      
      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-overlay">
        <el-icon class="loading-spinner"><Loading /></el-icon>
        <span>{{ loadingMessage }}</span>
      </div>
      
      <!-- 错误提示 -->
      <div v-if="hasError" class="error-overlay">
        <el-icon class="error-icon"><Warning /></el-icon>
        <div class="error-content">
          <h4>{{ errorTitle }}</h4>
          <p>{{ errorMessage }}</p>
          <el-button type="primary" @click="retryPlay">重试</el-button>
        </div>
      </div>
      
      <!-- 通道切换通知 -->
      <div v-if="showChannelSwitch" class="channel-switch-overlay">
        <div class="switch-notification">
          <el-icon size="32"><Refresh /></el-icon>
          <h4>{{ switchTitle }}</h4>
          <p>{{ switchMessage }}</p>
          <el-progress v-if="switchProgress > 0" :percentage="switchProgress" />
        </div>
      </div>
      
      <!-- RTMP源更新通知 -->
      <div v-if="showSourceUpdate" class="source-update-overlay">
        <div class="update-notification">
          <el-icon size="48"><VideoCamera /></el-icon>
          <h3>视频源更新通知</h3>
          <p>{{ updateMessage }}</p>
          <div v-if="updateCountdown > 0" class="countdown">
            <el-progress type="circle" :percentage="countdownPercentage">
              <span class="countdown-text">{{ updateCountdown }}s</span>
            </el-progress>
          </div>
          <div v-else class="update-actions">
            <el-button type="primary" @click="confirmUpdate">立即更新</el-button>
            <el-button @click="delayUpdate">稍后更新</el-button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 播放器控制信息 -->
    <div class="player-info" v-if="showInfo">
      <div class="channel-info">
        <span class="channel-name">{{ currentChannel?.name }}</span>
        <span class="channel-status" :class="channelStatusClass">{{ channelStatusText }}</span>
      </div>
      <div class="network-info">
        <span class="network-type">{{ networkTypeText }}</span>
        <span class="network-quality" :class="networkQualityClass">{{ networkQualityText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, Warning, Refresh, VideoCamera } from '@element-plus/icons-vue'
import Hls from 'hls.js'
import streamingApi from '@/services/streamingApi'

// Props
const props = defineProps({
  channelId: {
    type: String,
    required: true
  },
  autoPlay: {
    type: Boolean,
    default: true
  },
  showInfo: {
    type: Boolean,
    default: true
  },
  posterUrl: {
    type: String,
    default: ''
  },
  rtmpUrl: {
    type: String,
    required: true
  }
})

// Emits
const emit = defineEmits([
  'play',
  'pause',
  'error',
  'channelSwitch',
  'sourceUpdate'
])

// Refs
const videoElement = ref(null)
const videoContainer = ref(null)

// 播放器状态
const isLoading = ref(false)
const hasError = ref(false)
const errorTitle = ref('')
const errorMessage = ref('')
const loadingMessage = ref('正在加载视频...')

// HLS播放器
let hls = null
let heartbeatManager = null
let statusMonitor = null
let currentHlsUrl = ''

// 当前频道信息
const currentChannel = ref(null)
const channelStatus = ref('disconnected')
const networkType = ref('unknown')
const networkQuality = ref('unknown')

// 通道切换状态
const showChannelSwitch = ref(false)
const switchTitle = ref('')
const switchMessage = ref('')
const switchProgress = ref(0)

// 源更新状态
const showSourceUpdate = ref(false)
const updateMessage = ref('')
const updateCountdown = ref(0)
const maxCountdown = ref(5)

// 计算属性
const channelStatusClass = computed(() => ({
  'status-connected': channelStatus.value === 'connected',
  'status-connecting': channelStatus.value === 'connecting',
  'status-disconnected': channelStatus.value === 'disconnected'
}))

const channelStatusText = computed(() => {
  switch (channelStatus.value) {
    case 'connected': return '已连接'
    case 'connecting': return '连接中'
    case 'disconnected': return '未连接'
    default: return '未知'
  }
})

const networkTypeText = computed(() => {
  switch (networkType.value) {
    case 'proxy': return '代理加速'
    case 'tunnel': return '隧道优化'
    case 'direct': return '直连'
    default: return '自动选择'
  }
})

const networkQualityClass = computed(() => ({
  'quality-excellent': networkQuality.value === 'excellent',
  'quality-good': networkQuality.value === 'good',
  'quality-fair': networkQuality.value === 'fair',
  'quality-poor': networkQuality.value === 'poor'
}))

const networkQualityText = computed(() => {
  switch (networkQuality.value) {
    case 'excellent': return '优秀'
    case 'good': return '良好'
    case 'fair': return '一般'
    case 'poor': return '较差'
    default: return '检测中'
  }
})

const countdownPercentage = computed(() => {
  return ((maxCountdown.value - updateCountdown.value) / maxCountdown.value) * 100
})

// 方法
const initializePlayer = async () => {
  try {
    isLoading.value = true
    hasError.value = false
    loadingMessage.value = '正在启动智能观看...'
    
    // 使用集成API启动观看
    const result = await streamingApi.startWatching(props.channelId, props.rtmpUrl, {
      autoPlay: props.autoPlay,
      quality: 'auto'
    })
    
    if (result.success) {
      // 初始化HLS播放器
      await setupHlsPlayer(result.data.hlsUrl)
      
      // 更新频道信息
      updateChannelInfo(result.data)
      
      // 启动心跳管理
      startHeartbeatManager()
      
      // 启动状态监控
      startStatusMonitor()
      
      isLoading.value = false
      
      ElMessage.success('视频加载成功')
    } else {
      throw new Error(result.message || '启动观看失败')
    }
    
  } catch (error) {
    console.error('播放器初始化失败:', error)
    showError('初始化失败', error.message)
  }
}

// 启动心跳管理器
const startHeartbeatManager = () => {
  if (heartbeatManager) {
    heartbeatManager.stop()
  }
  
  heartbeatManager = streamingApi.createHeartbeatManager(props.channelId, 30000)
  
  heartbeatManager.start(() => ({
    networkQuality: networkQuality.value,
    latency: getEstimatedLatency(),
    bufferHealth: getBufferHealth(),
    playbackState: getPlaybackState(),
    videoQuality: getCurrentVideoQuality(),
    timestamp: Date.now()
  }))
}

// 启动状态监控器
const startStatusMonitor = () => {
  if (statusMonitor) {
    statusMonitor.stop()
  }
  
  statusMonitor = streamingApi.createStatusMonitor(props.channelId, (channelInfo) => {
    if (channelInfo) {
      updateChannelStatus(channelInfo)
    }
  })
  
  statusMonitor.start(10000) // 每10秒检查一次
}

// 获取估算延迟
const getEstimatedLatency = () => {
  if (hls && hls.latency !== undefined) {
    return Math.round(hls.latency * 1000) // 转换为毫秒
  }
  return 0
}

// 获取缓冲区健康度
const getBufferHealth = () => {
  if (videoElement.value && hls) {
    const buffered = videoElement.value.buffered
    const currentTime = videoElement.value.currentTime
    
    if (buffered.length > 0) {
      const bufferEnd = buffered.end(buffered.length - 1)
      const bufferLength = bufferEnd - currentTime
      return Math.min(100, Math.max(0, bufferLength * 20)) // 5秒缓冲 = 100%
    }
  }
  return 0
}

// 获取播放状态
const getPlaybackState = () => {
  if (!videoElement.value) return 'unknown'
  
  if (videoElement.value.paused) return 'paused'
  if (videoElement.value.ended) return 'ended'
  if (videoElement.value.readyState < 3) return 'buffering'
  return 'playing'
}

// 获取当前视频质量
const getCurrentVideoQuality = () => {
  if (hls && hls.currentLevel >= 0) {
    const level = hls.levels[hls.currentLevel]
    return {
      width: level.width,
      height: level.height,
      bitrate: level.bitrate,
      level: hls.currentLevel
    }
  }
  return null
}

const setupHlsPlayer = async (hlsUrl) => {
  if (!Hls.isSupported()) {
    throw new Error('您的浏览器不支持HLS播放')
  }
  
  // 销毁现有播放器
  if (hls) {
    hls.destroy()
  }
  
  // 创建新的HLS播放器
  hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 90
  })
  
  // 绑定事件
  hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed)
  hls.on(Hls.Events.ERROR, onHlsError)
  hls.on(Hls.Events.FRAG_LOADED, onFragLoaded)
  
  // 加载HLS流
  hls.loadSource(hlsUrl)
  hls.attachMedia(videoElement.value)
  
  currentHlsUrl = hlsUrl
}

const onManifestParsed = () => {
  console.log('HLS manifest 解析完成')
  channelStatus.value = 'connected'
  
  if (props.autoPlay) {
    videoElement.value.play().catch(console.error)
  }
}

const onHlsError = (event, data) => {
  console.error('HLS播放错误:', data)
  
  if (data.fatal) {
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        handleNetworkError(data)
        break
      case Hls.ErrorTypes.MEDIA_ERROR:
        handleMediaError(data)
        break
      default:
        showError('播放错误', data.details || '未知错误')
        break
    }
  }
}

const onFragLoaded = (event, data) => {
  // 更新网络质量指标
  updateNetworkQuality(data.frag.loadStats)
}

const handleNetworkError = async (errorData) => {
  console.log('处理网络错误，尝试切换通道')
  
  try {
    await performChannelSwitch('network_error')
  } catch (error) {
    showError('网络错误', '无法连接到视频服务器，请检查网络连接')
  }
}

const handleMediaError = (errorData) => {
  console.log('处理媒体错误，尝试恢复')
  
  try {
    hls.recoverMediaError()
  } catch (error) {
    showError('媒体错误', '视频解码失败，请刷新页面重试')
  }
}

const performChannelSwitch = async (reason = 'auto', targetRouteType = null) => {
  if (showChannelSwitch.value) return
  
  showChannelSwitch.value = true
  switchProgress.value = 0
  
  try {
    switchTitle.value = '正在切换通道'
    switchMessage.value = '为您寻找最佳网络路径...'
    
    // 模拟切换进度
    const progressInterval = setInterval(() => {
      switchProgress.value += 10
      if (switchProgress.value >= 100) {
        clearInterval(progressInterval)
      }
    }, 200)
    
    // 使用API切换路由
    if (targetRouteType) {
      await streamingApi.switchRoute(props.channelId, targetRouteType)
    }
    
    // 获取更新后的频道信息
    const channelInfo = await streamingApi.getChannelInfo(props.channelId)
    if (channelInfo && channelInfo.data) {
      updateChannelStatus(channelInfo.data)
    }
    
    switchMessage.value = '切换完成'
    
    setTimeout(() => {
      showChannelSwitch.value = false
      switchProgress.value = 0
    }, 1000)
    
    emit('channelSwitch', { reason, targetRouteType, channelInfo })
    
  } catch (error) {
    showChannelSwitch.value = false
    ElMessage.error(`通道切换失败: ${error.message}`)
    throw error
  }
}

const handleSourceUpdate = (notification) => {
  showSourceUpdate.value = true
  updateMessage.value = notification.message
  updateCountdown.value = notification.countdown
  maxCountdown.value = notification.countdown
  
  const timer = setInterval(() => {
    updateCountdown.value--
    if (updateCountdown.value <= 0) {
      clearInterval(timer)
      confirmUpdate()
    }
  }, 1000)
}

const confirmUpdate = async () => {
  showSourceUpdate.value = false
  
  try {
    await reloadWithNewSource()
    ElMessage.success('视频源已更新')
  } catch (error) {
    ElMessage.error('视频源更新失败')
  }
}

const delayUpdate = () => {
  showSourceUpdate.value = false
  ElMessage.info('已延迟更新，您可以继续观看')
}

const reloadWithNewSource = async () => {
  isLoading.value = true
  loadingMessage.value = '正在加载新的视频源...'
  
  try {
    // 停止当前播放
    if (hls) {
      hls.destroy()
      hls = null
    }
    
    // 重新初始化
    await initializePlayer()
    
  } catch (error) {
    showError('重新加载失败', error.message)
  } finally {
    isLoading.value = false
  }
}

const updateChannelInfo = (streamingData) => {
  currentChannel.value = {
    id: props.channelId,
    name: `频道 ${props.channelId}`,
    type: streamingData.routingPath?.type || 'auto'
  }
  
  if (streamingData.routingPath) {
    networkType.value = streamingData.routingPath.type
  }
  
  channelStatus.value = 'connected'
}

// 更新频道状态
const updateChannelStatus = (channelInfo) => {
  if (channelInfo && channelInfo.isActive) {
    channelStatus.value = 'connected'
    
    // 更新路由信息
    if (channelInfo.routingPath) {
      networkType.value = channelInfo.routingPath.type
    }
    
    // 检查是否需要显示通知
    if (channelInfo.pendingSourceUpdate) {
      handleSourceUpdateNotification(channelInfo.pendingSourceUpdate)
    }
  } else {
    channelStatus.value = 'disconnected'
  }
}

// 处理源更新通知
const handleSourceUpdateNotification = (updateInfo) => {
  showSourceUpdate.value = true
  updateMessage.value = updateInfo.message || '检测到新的视频源，是否立即更新？'
  updateCountdown.value = updateInfo.countdown || 30
  maxCountdown.value = updateCountdown.value
  
  const timer = setInterval(() => {
    updateCountdown.value--
    if (updateCountdown.value <= 0) {
      clearInterval(timer)
      confirmUpdate()
    }
  }, 1000)
}

const updateNetworkQuality = (loadStats) => {
  if (!loadStats) return
  
  const loadTime = loadStats.total
  
  if (loadTime < 100) {
    networkQuality.value = 'excellent'
  } else if (loadTime < 300) {
    networkQuality.value = 'good'
  } else if (loadTime < 800) {
    networkQuality.value = 'fair'
  } else {
    networkQuality.value = 'poor'
  }
}

const showError = (title, message) => {
  hasError.value = true
  errorTitle.value = title
  errorMessage.value = message
  isLoading.value = false
  channelStatus.value = 'disconnected'
}

const retryPlay = () => {
  hasError.value = false
  initializePlayer()
}

// 监听频道变化
watch(() => props.channelId, (newChannelId) => {
  if (newChannelId) {
    initializePlayer()
  }
})

// 生命周期
onMounted(() => {
  initializePlayer()
})

onUnmounted(async () => {
  try {
    // 停止心跳管理器
    if (heartbeatManager) {
      heartbeatManager.stop()
    }
    
    // 停止状态监控器
    if (statusMonitor) {
      statusMonitor.stop()
    }
    
    // 停止观看
    await streamingApi.stopWatching(props.channelId)
    
    // 销毁HLS播放器
    if (hls) {
      hls.destroy()
    }
  } catch (error) {
    console.error('组件销毁时清理资源失败:', error)
  }
})

// 暴露方法给父组件
defineExpose({
  play: () => videoElement.value?.play(),
  pause: () => videoElement.value?.pause(),
  switchChannel: performChannelSwitch,
  handleSourceUpdate,
  retryPlay
})
</script>

<style scoped>
.unified-video-player {
  position: relative;
  width: 100%;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.video-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
}

.video-player {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.loading-overlay,
.error-overlay,
.channel-switch-overlay,
.source-update-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  z-index: 10;
}

.loading-overlay {
  flex-direction: column;
  gap: 16px;
}

.loading-spinner {
  font-size: 32px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.error-overlay .error-content {
  text-align: center;
  max-width: 400px;
}

.error-icon {
  font-size: 48px;
  color: #f56c6c;
  margin-bottom: 16px;
}

.switch-notification,
.update-notification {
  background: white;
  color: #333;
  padding: 24px;
  border-radius: 12px;
  text-align: center;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.countdown {
  margin: 16px 0;
}

.countdown-text {
  font-size: 18px;
  font-weight: bold;
}

.update-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
  justify-content: center;
}

.player-info {
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.channel-info,
.network-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.channel-name {
  font-weight: 600;
}

.status-connected {
  color: #67c23a;
}

.status-connecting {
  color: #e6a23c;
}

.status-disconnected {
  color: #f56c6c;
}

.quality-excellent {
  color: #67c23a;
}

.quality-good {
  color: #95d475;
}

.quality-fair {
  color: #e6a23c;
}

.quality-poor {
  color: #f56c6c;
}
</style>
