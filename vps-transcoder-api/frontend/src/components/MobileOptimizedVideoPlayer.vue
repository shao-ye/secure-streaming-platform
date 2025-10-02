<template>
  <div class="mobile-video-player" :class="{ 'fullscreen': isFullscreen, 'mobile': isMobile }">
    <!-- 播放器头部 -->
    <div class="player-header" v-if="!isFullscreen">
      <div class="stream-info">
        <h3 class="stream-title">{{ streamName }}</h3>
        <div class="stream-status" :class="statusClass">
          <el-icon class="status-icon" :size="12">
            <VideoCamera v-if="status === 'playing'" />
            <Loading v-else-if="status === 'loading'" />
            <Warning v-else />
          </el-icon>
          <span class="status-text">{{ statusText }}</span>
        </div>
      </div>
      <div class="player-actions">
        <el-button 
          :icon="Refresh"
          @click="reloadStream"
          :loading="loading"
          circle
          size="small"
          title="刷新"
          class="action-button"
        />
        <el-button 
          :icon="FullScreen"
          @click="toggleFullscreen"
          circle
          size="small"
          title="全屏"
          class="action-button"
        />
      </div>
    </div>

    <!-- 视频容器 -->
    <div class="video-container" ref="videoContainer">
      <!-- 全屏时的顶部控制栏 -->
      <div v-if="isFullscreen" class="fullscreen-header">
        <div class="fullscreen-info">
          <h4 class="fullscreen-title">{{ streamName }}</h4>
          <span class="fullscreen-time">{{ currentTime }}</span>
        </div>
        <div class="fullscreen-actions">
          <el-button 
            :icon="Refresh"
            @click="reloadStream"
            :loading="loading"
            circle
            size="small"
            type="info"
            class="fullscreen-button"
          />
          <el-button 
            :icon="Close"
            @click="exitFullscreen"
            circle
            size="small"
            type="info"
            class="fullscreen-button"
          />
        </div>
      </div>

      <!-- 视频元素 -->
      <video 
        ref="videoRef"
        class="video-element"
        :controls="!isMobile || isFullscreen"
        autoplay
        muted
        playsinline
        webkit-playsinline
        x5-playsinline
        x5-video-player-type="h5"
        x5-video-player-fullscreen="true"
        x5-video-orientation="portraint"
        @loadstart="handleLoadStart"
        @loadeddata="handleLoadedData"
        @canplay="handleCanPlay"
        @play="handlePlay"
        @pause="handlePause"
        @ended="handleEnded"
        @error="handleError"
        @timeupdate="handleTimeUpdate"
        @click="handleVideoClick"
        @touchstart="handleTouchStart"
        @touchend="handleTouchEnd"
      >
        您的浏览器不支持视频播放
      </video>

      <!-- 移动端自定义控制层 -->
      <div v-if="isMobile && !isFullscreen" class="mobile-controls" :class="{ 'visible': showControls }">
        <div class="controls-overlay" @click="toggleControls">
          <!-- 播放/暂停按钮 -->
          <div class="center-control">
            <button 
              class="play-button" 
              @click.stop="togglePlay"
              :aria-label="isPlaying ? '暂停' : '播放'"
            >
              <el-icon :size="48">
                <VideoPause v-if="isPlaying" />
                <VideoPlay v-else />
              </el-icon>
            </button>
          </div>

          <!-- 底部控制栏 -->
          <div class="bottom-controls">
            <div class="progress-container">
              <div class="progress-bar" @click="handleProgressClick" ref="progressBar">
                <div class="progress-filled" :style="{ width: progressPercentage + '%' }"></div>
                <div class="progress-handle" :style="{ left: progressPercentage + '%' }"></div>
              </div>
            </div>
            <div class="control-buttons">
              <span class="time-display">{{ formatTime(currentTimeSeconds) }} / {{ formatTime(duration) }}</span>
              <div class="button-group">
                <button class="control-button" @click="reloadStream" :disabled="loading">
                  <el-icon :size="20">
                    <Refresh />
                  </el-icon>
                </button>
                <button class="control-button" @click="toggleFullscreen">
                  <el-icon :size="20">
                    <FullScreen />
                  </el-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="loading-overlay">
        <div class="loading-content">
          <el-icon class="loading-icon" :size="isMobile ? 32 : 48">
            <Loading />
          </el-icon>
          <p class="loading-text">正在加载视频流...</p>
        </div>
      </div>

      <!-- 错误状态 -->
      <div v-if="error" class="error-overlay">
        <div class="error-content">
          <el-icon class="error-icon" :size="isMobile ? 32 : 48" color="#f56c6c">
            <Warning />
          </el-icon>
          <h4 class="error-title">视频加载失败</h4>
          <p class="error-message">{{ error }}</p>
          <el-button type="primary" @click="reloadStream" :loading="loading">
            重新加载
          </el-button>
        </div>
      </div>

      <!-- 手势提示 -->
      <div v-if="showGestureHint" class="gesture-hint">
        <p>双击全屏 · 单击显示控制</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { 
  VideoCamera, 
  Loading, 
  Warning, 
  Refresh, 
  FullScreen, 
  Close,
  VideoPlay,
  VideoPause
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  stream: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['fullscreen-change'])

// 响应式数据
const videoRef = ref(null)
const videoContainer = ref(null)
const progressBar = ref(null)
const loading = ref(false)
const error = ref('')
const isFullscreen = ref(false)
const isPlaying = ref(false)
const showControls = ref(true)
const showGestureHint = ref(false)
const currentTimeSeconds = ref(0)
const duration = ref(0)
const windowWidth = ref(window.innerWidth)

// 触摸相关
const lastTouchTime = ref(0)
const controlsTimeout = ref(null)
const hintTimeout = ref(null)

// 计算属性
const isMobile = computed(() => windowWidth.value < 768)
const streamName = computed(() => props.stream?.name || '未知频道')
const currentTime = computed(() => {
  const now = new Date()
  return now.toLocaleTimeString('zh-CN', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  })
})

const status = computed(() => {
  if (loading.value) return 'loading'
  if (error.value) return 'error'
  if (isPlaying.value) return 'playing'
  return 'paused'
})

const statusClass = computed(() => ({
  'status-playing': status.value === 'playing',
  'status-loading': status.value === 'loading',
  'status-error': status.value === 'error'
}))

const statusText = computed(() => {
  switch (status.value) {
    case 'playing': return '正在播放'
    case 'loading': return '加载中...'
    case 'error': return '播放错误'
    default: return '已暂停'
  }
})

const progressPercentage = computed(() => {
  if (duration.value === 0) return 0
  return (currentTimeSeconds.value / duration.value) * 100
})

// 方法
const handleResize = () => {
  windowWidth.value = window.innerWidth
}

const loadStream = async () => {
  if (!videoRef.value || !props.stream) return

  loading.value = true
  error.value = ''

  try {
    // 这里应该调用实际的流媒体API
    const streamUrl = `/api/streams/${props.stream.id}/hls/playlist.m3u8`
    
    if (videoRef.value.canPlayType('application/vnd.apple.mpegurl')) {
      // 原生支持HLS
      videoRef.value.src = streamUrl
    } else {
      // 使用hls.js
      const { default: Hls } = await import('hls.js')
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90
        })
        hls.loadSource(streamUrl)
        hls.attachMedia(videoRef.value)
      } else {
        throw new Error('您的浏览器不支持HLS视频播放')
      }
    }
  } catch (err) {
    error.value = err.message || '加载视频流失败'
    ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
}

const reloadStream = () => {
  if (videoRef.value) {
    videoRef.value.load()
    loadStream()
  }
}

const togglePlay = () => {
  if (!videoRef.value) return
  
  if (videoRef.value.paused) {
    videoRef.value.play()
  } else {
    videoRef.value.pause()
  }
}

const toggleFullscreen = async () => {
  if (!videoContainer.value) return

  try {
    if (!isFullscreen.value) {
      // 进入全屏
      if (videoContainer.value.requestFullscreen) {
        await videoContainer.value.requestFullscreen()
      } else if (videoContainer.value.webkitRequestFullscreen) {
        await videoContainer.value.webkitRequestFullscreen()
      } else if (videoContainer.value.mozRequestFullScreen) {
        await videoContainer.value.mozRequestFullScreen()
      } else if (videoContainer.value.msRequestFullscreen) {
        await videoContainer.value.msRequestFullscreen()
      }
    } else {
      // 退出全屏
      if (document.exitFullscreen) {
        await document.exitFullscreen()
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen()
      } else if (document.mozCancelFullScreen) {
        await document.mozCancelFullScreen()
      } else if (document.msExitFullscreen) {
        await document.msExitFullscreen()
      }
    }
  } catch (err) {
    console.error('全屏切换失败:', err)
  }
}

const exitFullscreen = () => {
  if (isFullscreen.value) {
    toggleFullscreen()
  }
}

const handleFullscreenChange = () => {
  const fullscreenElement = document.fullscreenElement || 
                           document.webkitFullscreenElement || 
                           document.mozFullScreenElement || 
                           document.msFullscreenElement

  isFullscreen.value = !!fullscreenElement
  emit('fullscreen-change', isFullscreen.value)
}

const toggleControls = () => {
  if (isMobile.value && !isFullscreen.value) {
    showControls.value = !showControls.value
    
    if (showControls.value) {
      // 3秒后自动隐藏控制栏
      clearTimeout(controlsTimeout.value)
      controlsTimeout.value = setTimeout(() => {
        showControls.value = false
      }, 3000)
    }
  }
}

const handleVideoClick = () => {
  if (isMobile.value) {
    toggleControls()
  }
}

const handleTouchStart = () => {
  if (isMobile.value) {
    showGestureHint.value = true
    clearTimeout(hintTimeout.value)
    hintTimeout.value = setTimeout(() => {
      showGestureHint.value = false
    }, 2000)
  }
}

const handleTouchEnd = (e) => {
  if (!isMobile.value) return

  const now = Date.now()
  const timeDiff = now - lastTouchTime.value
  lastTouchTime.value = now

  // 双击检测 (300ms内)
  if (timeDiff < 300) {
    e.preventDefault()
    toggleFullscreen()
  }
}

const handleProgressClick = (e) => {
  if (!progressBar.value || !videoRef.value) return

  const rect = progressBar.value.getBoundingClientRect()
  const clickX = e.clientX - rect.left
  const percentage = clickX / rect.width
  const newTime = percentage * duration.value

  videoRef.value.currentTime = newTime
}

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00'
  
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// 视频事件处理
const handleLoadStart = () => {
  loading.value = true
  error.value = ''
}

const handleLoadedData = () => {
  loading.value = false
  duration.value = videoRef.value?.duration || 0
}

const handleCanPlay = () => {
  loading.value = false
}

const handlePlay = () => {
  isPlaying.value = true
}

const handlePause = () => {
  isPlaying.value = false
}

const handleEnded = () => {
  isPlaying.value = false
}

const handleError = (e) => {
  loading.value = false
  error.value = '视频播放出错，请稍后重试'
  ElMessage.error(error.value)
}

const handleTimeUpdate = () => {
  if (videoRef.value) {
    currentTimeSeconds.value = videoRef.value.currentTime
  }
}

// 监听器
watch(() => props.stream, (newStream) => {
  if (newStream) {
    loadStream()
  }
}, { immediate: true })

// 生命周期
onMounted(() => {
  window.addEventListener('resize', handleResize)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.addEventListener('mozfullscreenchange', handleFullscreenChange)
  document.addEventListener('MSFullscreenChange', handleFullscreenChange)
  
  // 初始化显示手势提示
  if (isMobile.value) {
    setTimeout(() => {
      showGestureHint.value = true
      setTimeout(() => {
        showGestureHint.value = false
      }, 3000)
    }, 1000)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
  document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
  
  clearTimeout(controlsTimeout.value)
  clearTimeout(hintTimeout.value)
})
</script>

<style scoped>
/* 基础样式 */
.mobile-video-player {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #000;
  border-radius: 8px;
  overflow: hidden;
}

.mobile-video-player.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9999;
  border-radius: 0;
}

/* 播放器头部 */
.player-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.stream-info {
  flex: 1;
  min-width: 0;
}

.stream-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stream-status {
  display: flex;
  align-items: center;
  font-size: 12px;
  opacity: 0.9;
}

.status-icon {
  margin-right: 4px;
}

.status-playing .status-icon {
  color: #67c23a;
}

.status-loading .status-icon {
  animation: spin 1s linear infinite;
}

.status-error .status-icon {
  color: #f56c6c;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.player-actions {
  display: flex;
  gap: 8px;
}

.action-button {
  background-color: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
  color: white;
}

.action-button:hover {
  background-color: rgba(255, 255, 255, 0.3);
}

/* 视频容器 */
.video-container {
  position: relative;
  flex: 1;
  background-color: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* 全屏头部 */
.fullscreen-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.8), transparent);
  color: white;
  z-index: 10;
}

.fullscreen-info {
  flex: 1;
}

.fullscreen-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
}

.fullscreen-time {
  font-size: 12px;
  opacity: 0.8;
}

.fullscreen-actions {
  display: flex;
  gap: 8px;
}

.fullscreen-button {
  background-color: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}

/* 移动端控制层 */
.mobile-controls {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(to bottom, transparent 0%, transparent 60%, rgba(0, 0, 0, 0.8) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 5;
}

.mobile-controls.visible {
  opacity: 1;
}

.controls-overlay {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.center-control {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.play-button {
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: 50%;
  color: white;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(10px);
}

.play-button:active {
  transform: scale(0.95);
  background: rgba(0, 0, 0, 0.8);
}

.bottom-controls {
  padding: 16px 20px 20px;
}

.progress-container {
  margin-bottom: 12px;
}

.progress-bar {
  position: relative;
  height: 4px;
  background-color: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  cursor: pointer;
}

.progress-filled {
  height: 100%;
  background-color: #409eff;
  border-radius: 2px;
  transition: width 0.1s ease;
}

.progress-handle {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background-color: #409eff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: left 0.1s ease;
}

.control-buttons {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.time-display {
  color: white;
  font-size: 12px;
  font-family: monospace;
}

.button-group {
  display: flex;
  gap: 12px;
}

.control-button {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
  transition: background-color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.control-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 加载和错误状态 */
.loading-overlay,
.error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.8);
  z-index: 10;
}

.loading-content,
.error-content {
  text-align: center;
  color: white;
  padding: 20px;
}

.loading-icon {
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

.loading-text {
  font-size: 14px;
  margin: 0;
  opacity: 0.9;
}

.error-icon {
  margin-bottom: 12px;
}

.error-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.error-message {
  font-size: 14px;
  margin: 0 0 16px 0;
  opacity: 0.9;
}

/* 手势提示 */
.gesture-hint {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 12px;
  z-index: 15;
  animation: fadeInOut 2s ease-in-out;
}

@keyframes fadeInOut {
  0%, 100% { opacity: 0; }
  20%, 80% { opacity: 1; }
}

/* 移动端特定样式 */
@media (max-width: 767px) {
  .mobile-video-player.mobile .player-header {
    padding: 12px 16px;
  }

  .stream-title {
    font-size: 16px;
  }

  .video-container {
    min-height: 200px;
  }

  .play-button {
    width: 60px;
    height: 60px;
  }

  .bottom-controls {
    padding: 12px 16px 16px;
  }
}

/* 横屏模式优化 */
@media (orientation: landscape) and (max-height: 500px) {
  .mobile-video-player:not(.fullscreen) .player-header {
    padding: 8px 16px;
  }

  .stream-title {
    font-size: 14px;
  }
}

/* 触摸设备优化 */
@media (hover: none) and (pointer: coarse) {
  .action-button,
  .control-button {
    min-height: 44px;
    min-width: 44px;
  }

  .progress-bar {
    height: 6px;
    padding: 8px 0;
  }

  .progress-handle {
    width: 16px;
    height: 16px;
  }
}
</style>
