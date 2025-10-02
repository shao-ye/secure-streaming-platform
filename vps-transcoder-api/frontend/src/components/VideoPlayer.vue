<template>
  <div class="video-player">
    <div class="player-header">
      <h3 class="stream-title">{{ streamName }}</h3>
      <div class="player-controls">
        <el-button 
          :icon="Refresh"
          @click="reloadStream"
          :loading="loading"
          circle
          title="刷新"
        />
      </div>
    </div>

    <div 
      class="player-container"
      ref="containerRef"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @wheel="handleWheel"
    >
      <div 
        class="video-wrapper"
        :style="videoTransformStyle"
        @dblclick="handleDoubleClick"
      >
        <video 
          ref="videoRef"
          class="video-element"
          controls
          autoplay
          muted
          playsinline
          @loadstart="handleLoadStart"
          @loadeddata="handleLoadedData"
          @canplay="handleCanPlay"
          @ended="handleEnded"
          @error="handleError"
        >
          您的浏览器不支持视频播放
        </video>
      </div>

      <div v-if="loading" class="loading-overlay">
        <el-loading
          text="正在加载视频流..."
          background="rgba(0, 0, 0, 0.8)"
          style="border-radius: 8px;"
        />
      </div>

      <div v-if="error" class="error-overlay">
        <el-result
          icon="error"
          title="视频加载失败"
          :sub-title="error"
        >
          <template #extra>
            <el-button type="primary" @click="reloadStream">
              重新加载
            </el-button>
          </template>
        </el-result>
      </div>

      <!-- 缩放提示 -->
      <div v-if="scale > 1" class="zoom-hint">
        <div class="zoom-info">
          <span>缩放: {{ Math.round(scale * 100) }}%</span>
          <span>| 单指拖拽</span>
          <span>| 双击重置</span>
          <span v-if="isFullscreen">| 全屏缩放</span>
        </div>
      </div>
    </div>

    <!-- 状态栏 - 在缩放时向下移动 -->
    <div class="player-info" :class="{ 'zoomed-state': scale > 1 }">
      <div class="info-item">
        <span class="label">状态:</span>
        <el-tag :type="statusType" size="small">{{ status }}</el-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import Hls from 'hls.js'
import { config, debugLog, errorLog, warnLog } from '../utils/config'

const props = defineProps({
  hlsUrl: {
    type: String,
    required: true
  },
  streamName: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['error', 'ready', 'playing', 'ended'])

const videoRef = ref(null)
const containerRef = ref(null)
const hls = ref(null)
const loading = ref(true)
const error = ref('')
const status = ref('准备中')
const retryCount = ref(0)
const retryTimer = ref(null)

// 缩放相关状态
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const lastTouchDistance = ref(0)
const lastTouchCenter = ref({ x: 0, y: 0 })
const touches = ref([])
const isDragging = ref(false)
const lastPanPoint = ref({ x: 0, y: 0 })
const isFullscreen = ref(false)

const statusType = computed(() => {
  switch (status.value) {
    case '播放中': return 'success'
    case '加载中': return 'warning'
    case '错误': return 'danger'
    case '重试中': return 'warning'
    default: return 'info'
  }
})

// 视频变换样式
const videoTransformStyle = computed(() => {
  return {
    transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
    transformOrigin: 'center center',
    transition: isDragging.value ? 'none' : 'transform 0.3s ease-out'
  }
})

const initHls = () => {
  if (!videoRef.value || !props.hlsUrl) return

  debugLog('初始化HLS播放器:', props.hlsUrl)

  // 清理现有的HLS实例
  destroyHls()

  loading.value = true
  error.value = ''
  status.value = '加载中'
  retryCount.value = 0

  if (Hls.isSupported()) {
    hls.value = new Hls({
      enableWorker: config.hls.enableWorker,
      lowLatencyMode: config.hls.lowLatencyMode,
      backBufferLength: config.hls.backBufferLength,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 3,
      maxFragLookUpTolerance: 0.25,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
      liveDurationInfinity: false,
      liveBackBufferLength: 0,
      maxLiveSyncPlaybackRate: 1.5,
      liveSyncDuration: undefined,
      liveMaxLatencyDuration: undefined,
      maxStarvationDelay: 4,
      maxLoadingDelay: 4,
      minAutoBitrate: 0,
      emeEnabled: false,
      widevineLicenseUrl: undefined,
      drmSystemOptions: {},
      requestMediaKeySystemAccessFunc: undefined,
    })

    hls.value.loadSource(props.hlsUrl)
    hls.value.attachMedia(videoRef.value)

    // 监听HLS事件
    setupHlsEventListeners()

  } else if (videoRef.value.canPlayType('application/vnd.apple.mpegurl')) {
    // 原生HLS支持 (Safari)
    debugLog('使用原生HLS支持')
    videoRef.value.src = props.hlsUrl
    status.value = '就绪'
    emit('ready')
  } else {
    const errorMsg = '您的浏览器不支持HLS视频播放'
    error.value = errorMsg
    status.value = '错误'
    errorLog(errorMsg)
    emit('error', new Error(errorMsg))
  }
}

const setupHlsEventListeners = () => {
  if (!hls.value) return

  // 清单解析完成
  hls.value.on(Hls.Events.MANIFEST_PARSED, () => {
    debugLog('HLS清单解析完成')
    status.value = '就绪'
    emit('ready')

    // 尝试自动播放
    if (config.player.autoplay) {
      videoRef.value.play().catch(e => {
        warnLog('自动播放失败:', e)
        ElMessage.warning('自动播放失败，请手动点击播放按钮')
      })
    }
  })

  // 媒体附加完成
  hls.value.on(Hls.Events.MEDIA_ATTACHED, () => {
    debugLog('媒体附加完成')
  })

  // 片段加载开始
  hls.value.on(Hls.Events.FRAG_LOADING, () => {
    debugLog('片段加载中...')
  })

  // 片段加载完成
  hls.value.on(Hls.Events.FRAG_LOADED, () => {
    debugLog('片段加载完成')
  })

  // 错误处理
  hls.value.on(Hls.Events.ERROR, (event, data) => {
    errorLog('HLS错误:', data)
    handleHlsError(data)
  })

  // 缓冲区状态变化
  hls.value.on(Hls.Events.BUFFER_APPENDING, () => {
    debugLog('缓冲区追加中...')
  })

  hls.value.on(Hls.Events.BUFFER_APPENDED, () => {
    debugLog('缓冲区追加完成')
  })
}

const handleHlsError = (data) => {
  if (data.fatal) {
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        handleNetworkError(data)
        break
      case Hls.ErrorTypes.MEDIA_ERROR:
        handleMediaError(data)
        break
      default:
        handleFatalError(data)
        break
    }
  } else {
    // 非致命错误，记录但不中断播放
    warnLog('HLS非致命错误:', data.details)
  }
}

const handleNetworkError = (data) => {
  const errorMsg = '网络错误，无法加载视频流'
  error.value = errorMsg
  status.value = '错误'

  // 尝试重试
  if (retryCount.value < config.player.maxRetries) {
    retryPlayback()
  } else {
    errorLog('网络错误重试次数已达上限')
    emit('error', new Error(errorMsg))
  }
}

const handleMediaError = (data) => {
  const errorMsg = '媒体错误，视频格式可能不支持'
  warnLog(errorMsg, data.details)

  // 尝试恢复媒体错误
  if (hls.value && retryCount.value < config.player.maxRetries) {
    try {
      hls.value.recoverMediaError()
      retryCount.value++
      status.value = '重试中'
    } catch (e) {
      error.value = errorMsg
      status.value = '错误'
      emit('error', new Error(errorMsg))
    }
  } else {
    error.value = errorMsg
    status.value = '错误'
    emit('error', new Error(errorMsg))
  }
}

const handleFatalError = (data) => {
  const errorMsg = `播放器错误：${data.details}`
  error.value = errorMsg
  status.value = '错误'
  errorLog('HLS致命错误:', data)
  emit('error', new Error(errorMsg))
}

const retryPlayback = () => {
  if (retryCount.value >= config.player.maxRetries) {
    errorLog('重试次数已达上限')
    return
  }

  retryCount.value++
  status.value = '重试中'

  debugLog(`开始第${retryCount.value}次重试...`)

  // 清除之前的重试定时器
  if (retryTimer.value) {
    clearTimeout(retryTimer.value)
  }

  retryTimer.value = setTimeout(() => {
    initHls()
  }, config.player.retryDelay)
}

const destroyHls = () => {
  if (hls.value) {
    debugLog('销毁HLS实例')
    hls.value.destroy()
    hls.value = null
  }

  if (retryTimer.value) {
    clearTimeout(retryTimer.value)
    retryTimer.value = null
  }
}

const reloadStream = () => {
  debugLog('手动重新加载流')
  retryCount.value = 0
  initHls()
}

// 视频元素事件处理
const handleLoadStart = () => {
  loading.value = true
  status.value = '加载中'
  debugLog('视频开始加载')
}

const handleLoadedData = () => {
  loading.value = false
  status.value = '已加载'
  debugLog('视频数据加载完成')
}

const handleCanPlay = () => {
  loading.value = false
  status.value = '播放中'
  debugLog('视频可以播放')
  emit('playing')
}

const handleError = (event) => {
  loading.value = false
  const errorMsg = '视频加载失败'
  error.value = errorMsg
  status.value = '错误'
  errorLog('视频元素错误:', event)
  emit('error', new Error(errorMsg))
}

const handleEnded = () => {
  debugLog('视频播放结束')
  status.value = '已结束'
  emit('ended')
}

// 监听URL变化
watch(() => props.hlsUrl, (newUrl) => {
  if (newUrl) {
    debugLog('HLS URL变化:', newUrl)
    initHls()
  }
}, { immediate: true })

// 全屏状态检测 - 修复移动端全屏检测
const checkFullscreenState = () => {
  const wasFullscreen = isFullscreen.value
  
  const isDocumentFullscreen = !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  )
  
  const isVideoFullscreen = videoRef.value && (
    videoRef.value.webkitDisplayingFullscreen ||
    videoRef.value.displayingFullscreen ||
    document.webkitIsFullScreen ||
    document.mozFullScreen ||
    document.msFullscreenElement
  )
  
  const isLandscape = window.screen && window.screen.orientation && 
    (window.screen.orientation.angle === 90 || window.screen.orientation.angle === -90)
  
  isFullscreen.value = isDocumentFullscreen || isVideoFullscreen || 
    (isLandscape && window.innerHeight < window.innerWidth)
  
  debugLog('全屏状态检测:', {
    isDocumentFullscreen,
    isVideoFullscreen,
    isLandscape,
    finalState: isFullscreen.value,
    screenSize: `${window.innerWidth}x${window.innerHeight}`
  })
  
  // 退出全屏时重置缩放
  if (wasFullscreen && !isFullscreen.value) {
    resetZoom()
  }
}

onMounted(() => {
  debugLog('VideoPlayer组件挂载')
  if (props.hlsUrl) {
    initHls()
  }
  
  // 监听全屏状态变化
  document.addEventListener('fullscreenchange', checkFullscreenState)
  document.addEventListener('webkitfullscreenchange', checkFullscreenState)
  document.addEventListener('mozfullscreenchange', checkFullscreenState)
  document.addEventListener('MSFullscreenChange', checkFullscreenState)
  
  // 监听屏幕方向变化（移动端全屏检测）
  window.addEventListener('orientationchange', () => {
    setTimeout(checkFullscreenState, 100)
  })
  window.addEventListener('resize', checkFullscreenState)
  
  // 监听视频元素的全屏事件（移动端Safari等）
  if (videoRef.value) {
    videoRef.value.addEventListener('webkitbeginfullscreen', checkFullscreenState)
    videoRef.value.addEventListener('webkitendfullscreen', checkFullscreenState)
  }
})

// 触摸事件处理 - 双指缩放功能
const getTouchDistance = (touch1, touch2) => {
  const dx = touch1.clientX - touch2.clientX
  const dy = touch1.clientY - touch2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

const getTouchCenter = (touch1, touch2) => {
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2
  }
}

const handleTouchStart = (event) => {
  debugLog('触摸开始:', {
    touchCount: event.touches.length,
    isFullscreen: isFullscreen.value,
    scale: scale.value,
    target: event.target.tagName
  })
  
  touches.value = Array.from(event.touches)
  
  // 双指缩放 - 始终启用，不管是否全屏
  if (touches.value.length === 2) {
    event.preventDefault() // 只对双指缩放阻止默认行为
    isDragging.value = false
    lastTouchDistance.value = getTouchDistance(touches.value[0], touches.value[1])
    lastTouchCenter.value = getTouchCenter(touches.value[0], touches.value[1])
    debugLog('双指缩放开始')
  } else if (touches.value.length === 1 && scale.value > 1) {
    // 单指拖拽 - 只在已缩放状态下启用（包括全屏状态）
    event.preventDefault()
    isDragging.value = true
    lastPanPoint.value = {
      x: touches.value[0].clientX,
      y: touches.value[0].clientY
    }
    debugLog('单指拖拽开始 - 缩放状态:', { scale: scale.value, isFullscreen: isFullscreen.value })
  } else {
    // 单指点击 - 不阻止默认行为，让视频控件正常工作
    isDragging.value = false
    debugLog('单指点击 - 允许默认行为')
  }
}

const handleTouchMove = (event) => {
  touches.value = Array.from(event.touches)
  
  if (touches.value.length === 1 && isDragging.value && scale.value > 1) {
    // 单指拖拽 - 在缩放时允许拖拽（包括全屏状态）
    event.preventDefault()
    const deltaX = touches.value[0].clientX - lastPanPoint.value.x
    const deltaY = touches.value[0].clientY - lastPanPoint.value.y
    
    translateX.value += deltaX
    translateY.value += deltaY
    
    lastPanPoint.value = {
      x: touches.value[0].clientX,
      y: touches.value[0].clientY
    }
    debugLog('单指拖拽中:', { 
      deltaX, 
      deltaY, 
      translateX: translateX.value, 
      translateY: translateY.value,
      isFullscreen: isFullscreen.value,
      scale: scale.value
    })
  } else if (touches.value.length === 2) {
    // 双指缩放
    event.preventDefault()
    const currentDistance = getTouchDistance(touches.value[0], touches.value[1])
    const currentCenter = getTouchCenter(touches.value[0], touches.value[1])
    
    if (lastTouchDistance.value > 0) {
      const scaleChange = currentDistance / lastTouchDistance.value
      const newScale = Math.max(0.5, Math.min(3, scale.value * scaleChange))
      
      // 以触摸中心点为缩放中心
      const containerRect = containerRef.value.getBoundingClientRect()
      const centerX = currentCenter.x - containerRect.left - containerRect.width / 2
      const centerY = currentCenter.y - containerRect.top - containerRect.height / 2
      
      // 调整平移以保持缩放中心点不变
      const scaleDiff = newScale - scale.value
      translateX.value -= centerX * scaleDiff / scale.value
      translateY.value -= centerY * scaleDiff / scale.value
      
      scale.value = newScale
      debugLog('双指缩放中:', { scale: newScale })
    }
    
    lastTouchDistance.value = currentDistance
    lastTouchCenter.value = currentCenter
  }
}

const handleTouchEnd = (event) => {
  debugLog('触摸结束:', {
    touchCount: event.touches.length,
    isDragging: isDragging.value,
    scale: scale.value,
    isFullscreen: isFullscreen.value
  })
  
  touches.value = Array.from(event.touches)
  
  if (event.touches.length === 0) {
    isDragging.value = false
    debugLog('所有触摸结束，停止拖拽')
  }
}

// 组件卸载时清理事件监听器
onUnmounted(() => {
  debugLog('VideoPlayer组件卸载，清理事件监听器')
  
  // 清理全屏状态监听器
  document.removeEventListener('fullscreenchange', checkFullscreenState)
  document.removeEventListener('webkitfullscreenchange', checkFullscreenState)
  document.removeEventListener('mozfullscreenchange', checkFullscreenState)
  document.removeEventListener('MSFullscreenChange', checkFullscreenState)
  
  // 清理屏幕方向和尺寸监听器
  window.removeEventListener('orientationchange', checkFullscreenState)
  window.removeEventListener('resize', checkFullscreenState)
  
  // 清理视频元素监听器
  if (videoRef.value) {
    videoRef.value.removeEventListener('webkitbeginfullscreen', checkFullscreenState)
    videoRef.value.removeEventListener('webkitendfullscreen', checkFullscreenState)
  }
  
  // 清理HLS实例
  if (hls.value) {
    hls.value.destroy()
  }
})

// 双击重置缩放功能
const handleDoubleClick = (event) => {
  debugLog('双击事件:', {
    remainingTouches: event.touches.length,
    wasScaling: lastTouchDistance.value > 0,
    wasDragging: isDragging.value
  })
  
  touches.value = Array.from(event.touches)
  
  if (touches.value.length === 0) {
    // 所有手指离开
    isDragging.value = false
    lastTouchDistance.value = 0
    
    // 如果缩放比例接近1，自动重置
    if (scale.value < 1.1 && scale.value > 0.9) {
      resetZoom()
    }
    debugLog('所有触摸结束')
  } else if (touches.value.length === 1 && lastTouchDistance.value > 0) {
    // 从双指变为单指，如果已缩放则开始拖拽
    if (scale.value > 1) {
      isDragging.value = true
      lastPanPoint.value = {
        x: touches.value[0].clientX,
        y: touches.value[0].clientY
      }
    }
    lastTouchDistance.value = 0
    debugLog('从双指变为单指')
  }
}

// 鼠标滚轮缩放支持
const handleWheel = (event) => {
  event.preventDefault()
  
  const delta = event.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.5, Math.min(3, scale.value * delta))
  
  // 以鼠标位置为缩放中心
  const containerRect = containerRef.value.getBoundingClientRect()
  const centerX = event.clientX - containerRect.left - containerRect.width / 2
  const centerY = event.clientY - containerRect.top - containerRect.height / 2
  
  const scaleDiff = newScale - scale.value
  translateX.value -= centerX * scaleDiff / scale.value
  translateY.value -= centerY * scaleDiff / scale.value
  
  scale.value = newScale
  
  // 如果缩放比例接近1，自动重置
  if (scale.value < 1.1 && scale.value > 0.9) {
    resetZoom()
  }
  
  debugLog('鼠标滚轮缩放:', { scale: newScale })
}

// 重置缩放
const resetZoom = () => {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

// 双击重置缩放
const handleDoubleClick = () => {
  if (scale.value === 1) {
    scale.value = 2
  } else {
    resetZoom()
  }
  debugLog('双击缩放:', { scale: scale.value })
}

onUnmounted(() => {
  debugLog('VideoPlayer组件卸载')
  destroyHls()
  
  // 清理全屏状态监听器
  document.removeEventListener('fullscreenchange', checkFullscreenState)
  document.removeEventListener('webkitfullscreenchange', checkFullscreenState)
  document.removeEventListener('mozfullscreenchange', checkFullscreenState)
  document.removeEventListener('MSFullscreenChange', checkFullscreenState)
})
</script>

<style scoped>
.video-player {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #000;
}

.player-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background-color: #1a1a1a;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.stream-title {
  margin: 0;
  color: #fff;
  font-size: 18px;
  font-weight: 500;
}

.player-controls {
  display: flex;
  gap: 10px;
}

.player-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 确保容器保持16:9比例 */
  width: 100%;
  aspect-ratio: 16 / 9;
  background-color: #000;
  /* 限制最大高度避免溢出 */
  max-height: calc(100vh - 200px);
  flex-shrink: 0;
  overflow: hidden;
  transition: max-height 0.3s ease;
}

/* 缩放状态下增加容器高度 */
.video-player:has(.player-info.zoomed-state) .player-container {
  max-height: calc(100vh - 160px);
}

/* 全屏状态下确保缩放功能正常工作 */
.player-container:fullscreen,
.player-container:-webkit-full-screen,
.player-container:-moz-full-screen,
.player-container:-ms-fullscreen {
  max-height: 100vh;
  width: 100vw;
  height: 100vh;
}

/* 移除全屏状态下的触摸行为限制，让视频控件正常工作 */

.video-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}

.video-wrapper:active {
  cursor: grabbing;
}

/* 全屏缩放提示样式 */
.zoom-hint {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 1000;
  pointer-events: none;
}

.zoom-info {
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.zoom-info span {
  margin-right: 8px;
}

.zoom-info span:last-child {
  margin-right: 0;
}

.video-element {
  width: 100%;
  height: 100%;
  /* 保持视频完整显示在16:9容器内 */
  object-fit: contain;
  background-color: #000;
}

.loading-overlay, .error-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.8);
}

.error-overlay {
  background-color: rgba(0, 0, 0, 0.9);
}

.player-info {
  display: flex;
  gap: 20px;
  padding: 10px 20px;
  background-color: #1a1a1a;
  border-top: 1px solid #333;
  font-size: 12px;
  flex-shrink: 0;
  transition: transform 0.3s ease, margin-top 0.3s ease;
  position: relative;
  z-index: 10;
}

/* 缩放状态下状态栏向下移动，增加播放面积 */
.player-info.zoomed-state {
  transform: translateY(20px);
  margin-top: 20px;
  background-color: rgba(26, 26, 26, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 8px 8px 0 0;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  color: #909399;
}

.value {
  color: #e4e7ed;
  font-family: monospace;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .player-header {
    padding: 10px 15px;
  }

  .stream-title {
    font-size: 16px;
  }

  .player-container {
    /* 移动设备上保持16:9比例，调整最大高度 */
    max-height: calc(100vh - 150px);
  }

  .player-info {
    flex-direction: column;
    gap: 8px;
    padding: 10px 15px;
  }

  /* 移动端缩放状态下的状态栏优化 */
  .player-info.zoomed-state {
    transform: translateY(15px);
    margin-top: 15px;
    padding: 8px 12px;
  }

  /* 移动端缩放状态下增加更多容器高度 */
  .video-player:has(.player-info.zoomed-state) .player-container {
    max-height: calc(100vh - 120px);
  }

  .value {
    max-width: 200px;
  }
}
</style>
