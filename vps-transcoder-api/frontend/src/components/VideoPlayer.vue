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

    <div class="player-container">
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
    </div>

    <div class="player-info">
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
const hls = ref(null)
const loading = ref(true)
const error = ref('')
const status = ref('准备中')
const retryCount = ref(0)
const retryTimer = ref(null)

const statusType = computed(() => {
  switch (status.value) {
    case '播放中': return 'success'
    case '加载中': return 'warning'
    case '错误': return 'danger'
    case '重试中': return 'warning'
    default: return 'info'
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

onMounted(() => {
  debugLog('VideoPlayer组件挂载')
  if (props.hlsUrl) {
    initHls()
  }
})

onUnmounted(() => {
  debugLog('VideoPlayer组件卸载')
  destroyHls()
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

  .value {
    max-width: 200px;
  }
}
</style>
