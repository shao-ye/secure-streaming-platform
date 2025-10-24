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
          @click="handleVideoClick"
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
      <div class="info-item" v-if="connectionMode">
        <span class="label">连接:</span>
        <el-tag :type="connectionModeType" size="small">
          <el-icon style="margin-right: 4px;">
            <component :is="connectionModeIcon" />
          </el-icon>
          {{ connectionModeText }}
        </el-tag>
      </div>
      <div class="info-item" v-if="responseTime">
        <span class="label">延迟:</span>
        <el-tag type="info" size="small">{{ responseTime }}</el-tag>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Connection, Link } from '@element-plus/icons-vue'
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

// 连接模式状态
const connectionMode = ref('')
const responseTime = ref('')

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

// 连接模式相关计算属性
const connectionModeType = computed(() => {
  switch (connectionMode.value) {
    case 'tunnel': return 'success'
    case 'proxy': return 'success'
    case 'smart-fallback': return 'warning'
    case 'direct-fallback': return 'warning'
    case 'direct': return 'info'
    case 'unknown': return 'danger'
    case 'error': return 'danger'
    default: return 'info'
  }
})

const connectionModeIcon = computed(() => {
  switch (connectionMode.value) {
    case 'tunnel': return Connection
    case 'proxy': return Connection
    case 'smart-fallback': return Link
    case 'direct-fallback': return Link
    case 'direct': return Link
    default: return Connection
  }
})

const connectionModeText = computed(() => {
  switch (connectionMode.value) {
    case 'tunnel': return '隧道优化'
    case 'proxy': return '代理模式'
    case 'smart-fallback': return '智能切换'
    case 'direct-fallback': return '故障切换'
    case 'direct': return '直连模式'
    case 'detecting': return '检测中'
    case 'unknown': return '未知模式'
    case 'error': return '检测错误'
    default: return '检测中'
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

  // 清单加载完成 - 检测连接模式
  hls.value.on(Hls.Events.MANIFEST_LOADED, (event, data) => {
    debugLog('HLS清单加载完成，检测连接模式', data)
    
    // 检测响应头中的路由信息
    if (data && data.networkDetails) {
      debugLog('网络详情:', data.networkDetails)
      const response = data.networkDetails.response || data.networkDetails
      
      // 尝试多种方式获取响应头
      let routeVia = null
      let responseTimeHeader = null
      
      if (response.headers) {
        if (typeof response.headers.get === 'function') {
          routeVia = response.headers.get('x-route-via')
          responseTimeHeader = response.headers.get('x-response-time')
        } else if (typeof response.headers === 'object') {
          routeVia = response.headers['x-route-via'] || response.headers['X-Route-Via']
          responseTimeHeader = response.headers['x-response-time'] || response.headers['X-Response-Time']
        }
      }
      
      if (routeVia) {
        connectionMode.value = routeVia
        debugLog('检测到连接模式:', routeVia)
      }
      
      if (responseTimeHeader) {
        responseTime.value = responseTimeHeader
        debugLog('检测到响应时间:', responseTimeHeader)
      }
    }
    
    // 如果没有检测到，尝试手动获取
    if (!connectionMode.value) {
      debugLog('未检测到连接模式，尝试手动获取')
      // 手动发起请求获取连接模式信息
      fetchConnectionMode()
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
  debugLog('开始销毁HLS实例')
  
  if (hls.value) {
    try {
      // 🔥 关键修复：移除所有事件监听器
      hls.value.off(Hls.Events.MANIFEST_PARSED)
      hls.value.off(Hls.Events.MEDIA_ATTACHED)
      hls.value.off(Hls.Events.FRAG_LOADING)
      hls.value.off(Hls.Events.FRAG_LOADED)
      hls.value.off(Hls.Events.ERROR)
      hls.value.off(Hls.Events.BUFFER_APPENDING)
      hls.value.off(Hls.Events.BUFFER_APPENDED)
      
      // 🔥 关键修复：强制停止所有网络请求
      hls.value.stopLoad()
      hls.value.detachMedia()
      
      // 销毁HLS实例
      hls.value.destroy()
    } catch (error) {
      debugLog('销毁HLS实例时出错:', error)
    }
    hls.value = null
  }

  // 🔥 关键修复：强制重置视频元素
  if (videoRef.value) {
    try {
      videoRef.value.pause()
      videoRef.value.removeAttribute('src')
      videoRef.value.load()
      
      // 清除所有缓冲区
      if (videoRef.value.buffered && videoRef.value.buffered.length > 0) {
        debugLog('清除视频缓冲区')
      }
    } catch (error) {
      debugLog('重置视频元素时出错:', error)
    }
  }
  
  // 清除重试定时器
  if (retryTimer.value) {
    clearTimeout(retryTimer.value)
    retryTimer.value = null
  }
  
  // 重置状态
  loading.value = false
  error.value = ''
  status.value = '等待'
  retryCount.value = 0
}

const reloadStream = () => {
  debugLog('手动重新加载流')
  retryCount.value = 0
  initHls()
}

// 🔥 URL推断连接模式函数
const detectConnectionModeFromUrl = (url, previousMode = null) => {
  if (!url) {
    return { type: 'unknown', reason: 'URL为空' }
  }
  
  debugLog('URL推断连接模式:', url)
  
  // 根据URL域名判断连接模式
  if (url.includes('tunnel-hls.yoyo-vps.5202021.xyz')) {
    return { 
      type: 'tunnel', 
      reason: '隧道优化端点',
      description: '使用Cloudflare Tunnel加速'
    }
  } else if (url.includes('yoyoapi.5202021.xyz')) {
    // 检查是否是代理路径
    if (url.includes('/tunnel-proxy/')) {
      return { 
        type: 'proxy', 
        reason: 'Workers代理模式',
        description: '通过代理服务器优化连接'
      }
    } else {
      // 普通Workers路径，实际是直连模式
      return { 
        type: 'direct', 
        reason: 'Workers直连模式',
        description: '通过Workers直接连接VPS'
      }
    }
  } else if (url.includes('yoyo-vps.5202021.xyz')) {
    // 如果之前是代理模式，现在变成直连，说明是故障切换
    if (previousMode === 'proxy' || previousMode === 'tunnel') {
      return { 
        type: 'direct-fallback', 
        reason: '故障切换到直连模式',
        description: '代理或隧道故障，自动切换到直连'
      }
    } else {
      return { 
        type: 'direct', 
        reason: 'VPS直连模式',
        description: '直接连接到VPS服务器'
      }
    }
  }
  
  return { 
    type: 'unknown', 
    reason: '无法识别的端点',
    description: '未知的视频源地址'
  }
}

// 获取连接模式信息 (作为URL推断的兜底方案)
const fetchConnectionMode = async () => {
  try {
    debugLog('手动获取连接模式信息 (响应头检测)')
    const response = await fetch(props.hlsUrl, { 
      method: 'HEAD',  // 只获取头信息，不下载内容
      cache: 'no-cache'
    })
    
    const routeVia = response.headers.get('x-route-via')
    const responseTimeHeader = response.headers.get('x-response-time')
    const country = response.headers.get('x-country')
    const routeReason = response.headers.get('x-route-reason')
    
    // 优先使用响应头信息
    if (routeVia) {
      connectionMode.value = routeVia
      debugLog('✅ 响应头检测到连接模式:', routeVia)
    } else {
      // 响应头检测失败，使用URL推断作为兜底
      const modeInfo = detectConnectionModeFromUrl(props.hlsUrl)
      connectionMode.value = modeInfo.type
      debugLog('⚠️ 响应头检测失败，使用URL推断:', modeInfo.type)
    }
    
    if (responseTimeHeader) {
      responseTime.value = responseTimeHeader
      debugLog('检测到响应时间:', responseTimeHeader)
    }
    
    if (country) {
      debugLog('检测到用户地区:', country)
    }
    
    if (routeReason) {
      debugLog('路由原因:', routeReason)
    }
    
  } catch (error) {
    debugLog('响应头检测失败，使用URL推断兜底:', error)
    // 网络请求失败，使用URL推断作为兜底方案
    const modeInfo = detectConnectionModeFromUrl(props.hlsUrl)
    connectionMode.value = modeInfo.type
    debugLog('🔄 兜底方案 - URL推断结果:', modeInfo.type)
  }
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
watch(() => props.hlsUrl, (newUrl, oldUrl) => {
  if (newUrl !== oldUrl) {
    debugLog('HLS URL变化:', { old: oldUrl, new: newUrl })
    
    // 🔥 URL推断：立即更新连接模式
    if (newUrl) {
      const previousMode = connectionMode.value
      const modeInfo = detectConnectionModeFromUrl(newUrl, previousMode)
      
      connectionMode.value = modeInfo.type
      debugLog('🎯 URL推断连接模式:', {
        url: newUrl,
        previousMode,
        newMode: modeInfo.type,
        reason: modeInfo.reason
      })
      
      // 如果是故障切换，显示提示信息
      if (modeInfo.type === 'direct-fallback') {
        debugLog('🚨 检测到故障切换:', modeInfo.description)
      }
    }
    
    // 🔥 关键修复：URL变化时立即销毁旧实例
    if (oldUrl && newUrl !== oldUrl) {
      destroyHls()
      // 短暂延迟确保清理完成
      setTimeout(() => {
        if (newUrl) {
          initHls()
        }
      }, 100)
    } else if (newUrl) {
      initHls()
    }
  }
}, { immediate: true })

// 检测设备类型和浏览器
const getDeviceInfo = () => {
  const userAgent = navigator.userAgent.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(userAgent)
  const isAndroid = /android/.test(userAgent)
  const isSafari = /safari/.test(userAgent) && !/chrome/.test(userAgent)
  const isChrome = /chrome/.test(userAgent)
  const isMobile = /mobile|android|iphone|ipad|ipod/.test(userAgent)
  
  return { isIOS, isAndroid, isSafari, isChrome, isMobile }
}

// 全屏状态检测 - 跨平台兼容
const checkFullscreenState = () => {
  const wasFullscreen = isFullscreen.value
  const deviceInfo = getDeviceInfo()
  
  // 标准全屏检测
  const isDocumentFullscreen = !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  )
  
  // iOS Safari 特殊处理
  const isVideoFullscreen = videoRef.value && (
    videoRef.value.webkitDisplayingFullscreen ||
    videoRef.value.displayingFullscreen
  )
  
  // 移动端横屏检测（作为辅助判断）
  const isLandscapeFullscreen = deviceInfo.isMobile && 
    window.innerHeight < window.innerWidth && 
    window.innerHeight < 500 // 避免平板误判
  
  // 综合判断全屏状态
  if (deviceInfo.isIOS) {
    // iOS: 主要依赖视频元素全屏状态
    isFullscreen.value = isVideoFullscreen || isDocumentFullscreen
  } else {
    // Android/PC: 主要依赖文档全屏状态
    isFullscreen.value = isDocumentFullscreen || isLandscapeFullscreen
  }
  
  debugLog('全屏状态检测:', {
    deviceInfo,
    isDocumentFullscreen,
    isVideoFullscreen,
    isLandscapeFullscreen,
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
  
  // 确保事件监听器正确绑定 - 修复拖动无法移动问题
  nextTick(() => {
    if (containerRef.value) {
      debugLog('手动确保触摸事件监听器绑定')
      
      // 验证事件监听器是否正确绑定
      const container = containerRef.value
      
      // 添加调试日志来验证事件绑定
      const originalHandlers = {
        touchstart: handleTouchStart,
        touchmove: handleTouchMove,
        touchend: handleTouchEnd,
        wheel: handleWheel
      }
      
      // 确保事件监听器正确绑定
      Object.entries(originalHandlers).forEach(([event, handler]) => {
        container.removeEventListener(event, handler)
        container.addEventListener(event, handler, { passive: false })
        debugLog(`重新绑定事件监听器: ${event}`)
      })
    }
  })
  
  // 跨平台全屏状态监听
  const deviceInfo = getDeviceInfo()
  
  // 标准全屏事件监听
  document.addEventListener('fullscreenchange', checkFullscreenState)
  document.addEventListener('webkitfullscreenchange', checkFullscreenState)
  document.addEventListener('mozfullscreenchange', checkFullscreenState)
  document.addEventListener('MSFullscreenChange', checkFullscreenState)
  
  // 移动端特殊处理
  if (deviceInfo.isMobile) {
    // 屏幕方向变化监听
    window.addEventListener('orientationchange', () => {
      setTimeout(checkFullscreenState, 200) // 增加延迟确保状态稳定
    })
    window.addEventListener('resize', () => {
      setTimeout(checkFullscreenState, 100)
    })
    
    // iOS Safari 视频全屏事件
    if (deviceInfo.isIOS && videoRef.value) {
      videoRef.value.addEventListener('webkitbeginfullscreen', checkFullscreenState)
      videoRef.value.addEventListener('webkitendfullscreen', checkFullscreenState)
      videoRef.value.addEventListener('webkitfullscreenchange', checkFullscreenState)
    }
  }
  
  // PC端额外监听
  if (!deviceInfo.isMobile) {
    window.addEventListener('resize', checkFullscreenState)
  }
  
  debugLog('事件监听器设置完成:', deviceInfo)
  
  // 设置禁用播放暂停按钮的多层防护机制
  setupPauseDisabling()
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
  const deviceInfo = getDeviceInfo()
  
  debugLog('触摸开始:', {
    touchCount: event.touches.length,
    isFullscreen: isFullscreen.value,
    scale: scale.value,
    target: event.target.tagName,
    deviceInfo
  })
  
  touches.value = Array.from(event.touches)
  
  // 双指缩放 - 跨平台兼容处理
  if (touches.value.length === 2) {
    // 在所有平台上都支持双指缩放
    event.preventDefault()
    isDragging.value = false
    lastTouchDistance.value = getTouchDistance(touches.value[0], touches.value[1])
    lastTouchCenter.value = getTouchCenter(touches.value[0], touches.value[1])
    debugLog('双指缩放开始 - 平台:', deviceInfo.isIOS ? 'iOS' : deviceInfo.isAndroid ? 'Android' : 'PC')
  } else if (touches.value.length === 1) {
    // 单指处理 - 根据平台和状态决定行为
    if (scale.value > 1) {
      // 已缩放状态下允许拖拽
      if (deviceInfo.isIOS) {
        // iOS: 在全屏状态下需要特殊处理
        if (isFullscreen.value) {
          event.preventDefault()
          isDragging.value = true
        } else {
          // 非全屏状态下正常拖拽
          event.preventDefault()
          isDragging.value = true
        }
      } else {
        // Android/PC: 正常拖拽处理
        event.preventDefault()
        isDragging.value = true
      }
      
      lastPanPoint.value = {
        x: touches.value[0].clientX,
        y: touches.value[0].clientY
      }
      debugLog('单指拖拽开始:', { 
        scale: scale.value, 
        isFullscreen: isFullscreen.value,
        platform: deviceInfo.isIOS ? 'iOS' : deviceInfo.isAndroid ? 'Android' : 'PC'
      })
    } else {
      // 未缩放状态下不阻止默认行为，让视频控件正常工作
      isDragging.value = false
      debugLog('单指点击 - 允许默认行为')
    }
  }
}

const handleTouchMove = (event) => {
  const deviceInfo = getDeviceInfo()
  touches.value = Array.from(event.touches)
  
  if (touches.value.length === 1 && isDragging.value && scale.value > 1) {
    // 单指拖拽 - 跨平台兼容处理
    event.preventDefault()
    
    const deltaX = touches.value[0].clientX - lastPanPoint.value.x
    const deltaY = touches.value[0].clientY - lastPanPoint.value.y
    
    // 根据平台调整拖拽敏感度
    let sensitivity = 1
    if (deviceInfo.isIOS && isFullscreen.value) {
      // iOS全屏状态下可能需要调整敏感度
      sensitivity = 1.2
    }
    
    translateX.value += deltaX * sensitivity
    translateY.value += deltaY * sensitivity
    
    lastPanPoint.value = {
      x: touches.value[0].clientX,
      y: touches.value[0].clientY
    }
    
    debugLog('单指拖拽中:', { 
      deltaX: deltaX * sensitivity, 
      deltaY: deltaY * sensitivity, 
      translateX: translateX.value, 
      translateY: translateY.value,
      isFullscreen: isFullscreen.value,
      scale: scale.value,
      platform: deviceInfo.isIOS ? 'iOS' : deviceInfo.isAndroid ? 'Android' : 'PC',
      sensitivity
    })
  } else if (touches.value.length === 2) {
    // 双指缩放
    event.preventDefault()
    const currentDistance = getTouchDistance(touches.value[0], touches.value[1])
    const currentCenter = getTouchCenter(touches.value[0], touches.value[1])
    
    if (lastTouchDistance.value > 0) {
      const scaleChange = currentDistance / lastTouchDistance.value
      let newScale = Math.max(0.5, Math.min(3, scale.value * scaleChange))
      
      // 根据平台调整缩放敏感度
      const deviceInfo = getDeviceInfo()
      let scaleSensitivity = 1
      
      if (deviceInfo.isIOS) {
        // iOS: 在全屏状态下调整缩放敏感度
        scaleSensitivity = isFullscreen.value ? 0.8 : 1
      } else if (deviceInfo.isAndroid) {
        // Android: 标准敏感度
        scaleSensitivity = 1
      } else {
        // PC: 可能需要更高敏感度
        scaleSensitivity = 1.1
      }
      
      // 应用敏感度调整
      const adjustedScaleChange = 1 + (scaleChange - 1) * scaleSensitivity
      newScale = Math.max(0.5, Math.min(3, scale.value * adjustedScaleChange))
      
      // 以触摸中心点为缩放中心
      const containerRect = containerRef.value.getBoundingClientRect()
      const centerX = currentCenter.x - containerRect.left - containerRect.width / 2
      const centerY = currentCenter.y - containerRect.top - containerRect.height / 2
      
      // 调整平移以保持缩放中心点不变
      const scaleDiff = newScale - scale.value
      if (scale.value > 0) {
        translateX.value -= centerX * scaleDiff / scale.value
        translateY.value -= centerY * scaleDiff / scale.value
      }
      
      scale.value = newScale
      debugLog('双指缩放中:', { 
        scale: newScale, 
        platform: deviceInfo.isIOS ? 'iOS' : deviceInfo.isAndroid ? 'Android' : 'PC',
        scaleSensitivity,
        isFullscreen: isFullscreen.value
      })
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

// 组件卸载时清理事件监听器（合并到下面的onUnmounted中）

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

// 处理视频点击事件 - 禁用暂停功能
const handleVideoClick = (event) => {
  // 强制阻止默认的点击暂停行为
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  
  // 确保视频继续播放
  if (videoRef.value && videoRef.value.paused) {
    videoRef.value.play()
  }
  
  debugLog('视频点击事件被拦截，已禁用暂停功能')
  
  return false
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

// 设置禁用播放暂停按钮的多层防护机制
const setupPauseDisabling = () => {
  debugLog('开始设置禁用播放暂停按钮的多层防护机制')
  
  if (!videoRef.value) {
    debugLog('视频元素未找到，延迟设置防护机制')
    setTimeout(setupPauseDisabling, 100)
    return
  }
  
  const video = videoRef.value
  
  // 第1层防护：重写video.pause()方法
  const originalPause = video.pause.bind(video)
  video.pause = function() {
    debugLog('拦截video.pause()调用，强制继续播放')
    // 不执行暂停，而是确保播放
    if (video.paused) {
      video.play().catch(err => {
        debugLog('强制播放失败:', err)
      })
    }
    return Promise.resolve()
  }
  
  // 第2层防护：重写HTMLMediaElement原型的pause方法
  const originalPrototypePause = HTMLMediaElement.prototype.pause
  HTMLMediaElement.prototype.pause = function() {
    if (this === video) {
      debugLog('拦截HTMLMediaElement.prototype.pause调用')
      // 对目标视频元素不执行暂停
      if (this.paused) {
        this.play().catch(err => {
          debugLog('原型方法强制播放失败:', err)
        })
      }
      return
    }
    // 对其他视频元素正常执行
    return originalPrototypePause.call(this)
  }
  
  // 第3层防护：事件监听器拦截暂停事件
  const pauseEventHandler = (event) => {
    debugLog('拦截pause事件，阻止暂停')
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    
    // 强制恢复播放
    setTimeout(() => {
      if (video.paused) {
        video.play().catch(err => {
          debugLog('事件拦截后强制播放失败:', err)
        })
      }
    }, 10)
  }
  
  const suspendEventHandler = (event) => {
    debugLog('拦截suspend事件')
    event.preventDefault()
    event.stopPropagation()
  }
  
  const waitingEventHandler = (event) => {
    debugLog('拦截waiting事件')
    // 不阻止waiting事件，但确保最终恢复播放
    setTimeout(() => {
      if (video.paused) {
        video.play().catch(err => {
          debugLog('waiting事件后强制播放失败:', err)
        })
      }
    }, 50)
  }
  
  // 绑定事件监听器
  video.addEventListener('pause', pauseEventHandler, { capture: true })
  video.addEventListener('suspend', suspendEventHandler, { capture: true })
  video.addEventListener('waiting', waitingEventHandler, { capture: true })
  
  // 第4层防护：禁用视频控件的播放/暂停按钮
  video.addEventListener('click', (event) => {
    debugLog('拦截视频控件点击事件')
    // 检查是否点击了控件区域
    const rect = video.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const controlsHeight = 40 // 估计控件高度
    
    if (clickY > rect.height - controlsHeight) {
      debugLog('检测到控件区域点击，可能是暂停按钮')
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      
      // 确保视频继续播放
      setTimeout(() => {
        if (video.paused) {
          video.play().catch(err => {
            debugLog('控件点击后强制播放失败:', err)
          })
        }
      }, 10)
    }
  }, { capture: true })
  
  // 第5层防护：键盘事件拦截（空格键暂停）
  const keyboardHandler = (event) => {
    if (event.code === 'Space' || event.key === ' ') {
      debugLog('拦截空格键暂停操作')
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      
      // 确保视频继续播放
      if (video.paused) {
        video.play().catch(err => {
          debugLog('空格键拦截后强制播放失败:', err)
        })
      }
    }
  }
  
  document.addEventListener('keydown', keyboardHandler, { capture: true })
  
  // 第6层防护：定期检查播放状态
  const playbackChecker = setInterval(() => {
    if (video.paused && !video.ended) {
      debugLog('定期检查发现视频暂停，强制恢复播放')
      video.play().catch(err => {
        debugLog('定期检查强制播放失败:', err)
      })
    }
  }, 500)
  
  // 第7层防护：监听播放状态变化
  const playHandler = () => {
    debugLog('视频开始播放')
  }
  
  const pausedHandler = () => {
    debugLog('检测到视频暂停，立即恢复播放')
    setTimeout(() => {
      if (video.paused && !video.ended) {
        video.play().catch(err => {
          debugLog('暂停检测后强制播放失败:', err)
        })
      }
    }, 10)
  }
  
  video.addEventListener('play', playHandler)
  video.addEventListener('pause', pausedHandler)
  
  // 存储清理函数，用于组件卸载时清理
  const cleanupPauseDisabling = () => {
    debugLog('清理禁用暂停功能的事件监听器')
    
    // 恢复原始方法
    video.pause = originalPause
    HTMLMediaElement.prototype.pause = originalPrototypePause
    
    // 移除事件监听器
    video.removeEventListener('pause', pauseEventHandler, { capture: true })
    video.removeEventListener('suspend', suspendEventHandler, { capture: true })
    video.removeEventListener('waiting', waitingEventHandler, { capture: true })
    video.removeEventListener('play', playHandler)
    video.removeEventListener('pause', pausedHandler)
    document.removeEventListener('keydown', keyboardHandler, { capture: true })
    
    // 清理定时器
    clearInterval(playbackChecker)
  }
  
  // 将清理函数添加到组件的清理列表中
  if (!window.videoPlayerCleanupFunctions) {
    window.videoPlayerCleanupFunctions = []
  }
  window.videoPlayerCleanupFunctions.push(cleanupPauseDisabling)
  
  debugLog('禁用播放暂停按钮的多层防护机制设置完成')
}

onUnmounted(() => {
  debugLog('VideoPlayer组件卸载，清理所有事件监听器')
  destroyHls()
  
  // 清理禁用暂停功能的事件监听器
  if (window.videoPlayerCleanupFunctions) {
    window.videoPlayerCleanupFunctions.forEach(cleanup => {
      try {
        cleanup()
      } catch (err) {
        debugLog('清理函数执行失败:', err)
      }
    })
    window.videoPlayerCleanupFunctions = []
  }
  
  const deviceInfo = getDeviceInfo()
  
  // 清理标准全屏状态监听器
  document.removeEventListener('fullscreenchange', checkFullscreenState)
  document.removeEventListener('webkitfullscreenchange', checkFullscreenState)
  document.removeEventListener('mozfullscreenchange', checkFullscreenState)
  document.removeEventListener('MSFullscreenChange', checkFullscreenState)
  
  // 清理移动端特殊监听器
  if (deviceInfo.isMobile) {
    // 注意：orientationchange 的清理需要使用相同的函数引用
    // 这里我们清理所有可能的监听器
    window.removeEventListener('orientationchange', checkFullscreenState)
    window.removeEventListener('resize', checkFullscreenState)
    
    // 清理iOS Safari视频全屏事件
    if (deviceInfo.isIOS && videoRef.value) {
      videoRef.value.removeEventListener('webkitbeginfullscreen', checkFullscreenState)
      videoRef.value.removeEventListener('webkitendfullscreen', checkFullscreenState)
      videoRef.value.removeEventListener('webkitfullscreenchange', checkFullscreenState)
    }
  }
  
  // 清理PC端监听器
  if (!deviceInfo.isMobile) {
    window.removeEventListener('resize', checkFullscreenState)
  }
  
  // 清理HLS实例
  if (hls.value) {
    hls.value.destroy()
  }
  
  debugLog('所有事件监听器已清理完成')
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
