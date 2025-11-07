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
      :class="{ 'custom-fullscreen': isCustomFullscreen }"
      class="player-container"
      ref="containerRef"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @wheel="handleWheel"
    >
      <!-- 不参与transform的UI层，确保按钮点击优先级 -->
      <div class="ui-layer">
        <!-- 保留，当前按钮都在容器根上渲染 -->
      </div>

      <div 
        class="video-wrapper"
        :style="videoTransformStyle"
        @click="handleWrapperClick"
        @dblclick="handleDoubleClick"
      >
        <video 
          ref="videoRef"
          class="video-element"
          :data-rotated="videoRotation !== 0"
          :controls="!isCustomFullscreen"
          autoplay
          muted
          playsinline
          webkit-playsinline
          x5-playsinline
          x5-video-player-type="h5"
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

      <!-- 增强的加载提示 -->
      <div v-if="loading || isSwitching" class="loading-overlay">
        <div class="loading-content">
          <div class="loading-spinner">
            <el-icon class="is-loading" :size="60">
              <Loading />
            </el-icon>
          </div>
          <div class="loading-text">
            <div class="loading-title">{{ isSwitching ? `正在切换到: ${nextStreamName}` : loadingMessage }}</div>
            <div class="loading-subtitle">{{ isSwitching ? '准备新频道...' : loadingSubMessage }}</div>
            <div class="loading-timer" v-if="!isSwitching">已等待 {{ loadingTime }} 秒</div>
          </div>
          <div class="loading-tips">
            <el-text type="info" size="small">
              💡 首次加载需要启动转码服务，预计需要 20-30 秒
            </el-text>
          </div>
        </div>
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
      <transition name="fade">
        <div v-if="(scale > 1 || videoRotation !== 0) && (videoRotation === 0 || showControls)" class="zoom-hint">
          <div class="zoom-info">
            <span>缩放: {{ Math.round(scale * 100) }}%</span>
            <span v-if="videoRotation !== 0">| 旋转: {{ videoRotation }}°</span>
            <span>| 单指拖拽</span>
            <span>| 双击重置</span>
            <span v-if="isCustomFullscreen">| 全屏缩放</span>
          </div>
        </div>
      </transition>
      
      <!-- 自定义全屏按钮 -->
      <button 
        v-if="!isCustomFullscreen"
        class="custom-fullscreen-btn"
        @touchstart.stop
        @touchend.stop.prevent="toggleCustomFullscreen"
        @click.stop="toggleCustomFullscreen"
        title="全屏"
      >
        <svg viewBox="0 0 1024 1024" width="24" height="24" fill="currentColor">
          <path d="M290.133333 405.333333V213.333333c0-46.933333 38.4-85.333333 85.333334-85.333333h192v85.333333H375.466667v192H290.133333z m443.733334 0V213.333333h-192V128h192c46.933333 0 85.333333 38.4 85.333333 85.333333v192h-85.333333z m0 213.333334v192c0 46.933333-38.4 85.333333-85.333334 85.333333h-192v-85.333333h192v-192h85.333334z m-443.733334 0v192h192v85.333333H375.466667c-46.933333 0-85.333334-38.4-85.333334-85.333333v-192h85.333334z"/>
        </svg>
      </button>
      
      <!-- 视口层固定的退出按钮（始终在最顶层） -->
      <teleport to="body">
        <transition name="fade">
          <button 
            v-if="isCustomFullscreen && (videoRotation === 0 || showControls)"
            class="exit-fullscreen-fixed"
            @touchstart.stop
            @touchend.stop.prevent="toggleCustomFullscreen"
            @click.stop="toggleCustomFullscreen"
            title="退出全屏"
          >
            <svg viewBox="0 0 1024 1024" width="24" height="24" fill="currentColor" aria-hidden="true">
              <path d="M563.2 512L844.8 230.4 793.6 179.2 512 460.8 230.4 179.2 179.2 230.4 460.8 512 179.2 793.6 230.4 844.8 512 563.2 793.6 844.8 844.8 793.6z"/>
            </svg>
          </button>
        </transition>
        
        <!-- 画面旋转按钮 -->
        <transition name="fade">
          <button 
            v-if="isCustomFullscreen && (videoRotation === 0 || showControls)"
            class="rotate-btn-fixed"
            @touchstart.stop
            @touchend.stop.prevent="toggleRotation"
            @click.stop="toggleRotation"
            :title="videoRotation === 0 ? '旋转90度' : '恢复方向'"
          >
            <svg viewBox="0 0 1024 1024" width="24" height="24" fill="currentColor" aria-hidden="true">
              <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z"/>
              <path d="M512 140c-205.4 0-372 166.6-372 372s166.6 372 372 372 372-166.6 372-372-366.6-372-372-372zm0 684c-172.3 0-312-139.7-312-312s139.7-312 312-312 312 139.7 312 312-139.7 312-312 312z"/>
              <path d="M512 354L387 479l48 48 77-77v170h68V450l77 77 48-48z"/>
            </svg>
          </button>
        </transition>
      </teleport>
    </div>

    <!-- 状态栏 - 在缩放时向下移动 -->
    <div class="player-info" :class="{ 'zoomed-state': scale > 1 }">
      <div class="info-item">
        <span class="label">状态:</span>
        <el-tag :type="statusType" size="small">{{ status }}</el-tag>
      </div>
      <!-- 前端路径 -->
      <div class="info-item" v-if="frontendPath">
        <span class="label">前端:</span>
        <el-tag :type="frontendPathType" size="small">
          <el-icon style="margin-right: 4px;">
            <component :is="frontendPathIcon" />
          </el-icon>
          {{ frontendPathText }}
        </el-tag>
      </div>
      
      <!-- 后端路径 -->
      <div class="info-item" v-if="backendPath">
        <span class="label">后端:</span>
        <el-tag :type="backendPathType" size="small">
          <el-icon style="margin-right: 4px;">
            <component :is="backendPathIcon" />
          </el-icon>
          {{ backendPathText }}
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
import { Refresh, Connection, Link, Loading } from '@element-plus/icons-vue'
import Hls from 'hls.js'
import { config, debugLog, errorLog, warnLog } from '../utils/config'
import { useStreamsStore } from '../stores/streams'

const props = defineProps({
  hlsUrl: {
    type: String,
    required: true
  },
  streamName: {
    type: String,
    default: ''
  },
  isSwitching: {
    type: Boolean,
    default: false
  },
  nextStreamName: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['error', 'ready', 'playing', 'ended'])

const streamsStore = useStreamsStore()
const videoRef = ref(null)
const containerRef = ref(null)
const hls = ref(null)
const loading = ref(true)
const error = ref('')
const status = ref('准备中')
const retryCount = ref(0)
const retryTimer = ref(null)
const loadingMessage = ref('正在连接视频流...')
const loadingSubMessage = ref('准备播放器...')
const loadingTime = ref(0)
const loadingTimerRef = ref(null)

// 双维度路由状态
const frontendPath = ref('')
const backendPath = ref('')
const vpsProxyName = ref('')
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
// 用于检测点击（不改变拖动逻辑）
const touchStartPosition = ref({ x: 0, y: 0, time: 0 })
const isCustomFullscreen = ref(false)
// 鼠标拖动状态（PC端）
const isMouseDragging = ref(false)
const lastMousePoint = ref({ x: 0, y: 0 })
// 画面旋转状态（0度或90度）
const videoRotation = ref(0)
// 旋转后自动适配标记与定时器
const autoFitting = ref(false)
let autoFitClearTimer = null
let resizeDebounceTimer = null
// 控制条显示状态
const showControls = ref(true)
let hideControlsTimer = null
// 单击延迟定时器（用于区分单击和双击）
let clickTimer = null

const statusType = computed(() => {
  switch (status.value) {
    case '播放中': return 'success'
    case '加载中': return 'warning'
    case '错误': return 'danger'
    case '重试中': return 'warning'
    default: return 'info'
  }
})

// 前端路径计算属性
const frontendPathType = computed(() => frontendPath.value === 'tunnel' ? 'success' : 'info')
const frontendPathIcon = computed(() => frontendPath.value === 'tunnel' ? Connection : Link)
const frontendPathText = computed(() => frontendPath.value === 'tunnel' ? '隧道优化' : '直连')

// 后端路径计算属性
const backendPathType = computed(() => backendPath.value === 'proxy' ? 'success' : 'info')
const backendPathIcon = computed(() => backendPath.value === 'proxy' ? Connection : Link)
const backendPathText = computed(() => {
  if (backendPath.value === 'proxy') {
    return vpsProxyName.value ? `代理(${vpsProxyName.value})` : '代理'
  }
  return '直连'
})

// 视频变换样式
const videoTransformStyle = computed(() => {
  const style = {
    transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value}) rotate(${videoRotation.value}deg)`,
    transformOrigin: 'center center',
    transition: isDragging.value ? 'none' : 'transform 0.3s ease-out'
  }
  
  // 旋转时，wrapper调整为100vh×100vw并居中（通过translateY调整偏移）
  if (videoRotation.value !== 0) {
    style.width = '100vh'
    style.height = '100vw'
    style.position = 'absolute'
    style.left = '50%'
    style.top = '50%'
    style.marginLeft = '-50vh'  // -width/2，水平居中
    style.marginTop = '-50vw'   // -height/2，垂直居中（通过transform translateY调整偏移）
  }
  
  return style
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
  loadingMessage.value = '正在连接视频流...'
  loadingSubMessage.value = '启动转码服务'
  loadingTime.value = 0
  startLoadingTimer()

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
    loadingMessage.value = '加载完成'
    loadingSubMessage.value = '准备播放...'
    stopLoadingTimer()
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
    loadingMessage.value = '正在解析视频流...'
    loadingSubMessage.value = '加载播放列表'
    
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
    if (loading.value) {
      loadingMessage.value = '正在加载视频数据...'
      loadingSubMessage.value = '下载视频分片'
    }
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
  errorLog('网络错误详情:', data)
  
  // 🔥 关键改进：检测是否是404错误（HLS文件不存在）
  const is404Error = data.response?.code === 404 || 
                     data.details === 'manifestLoadError' ||
                     data.details === 'fragLoadError'
  
  if (is404Error) {
    // 404错误：HLS文件不存在，可能是VPS清理了转码进程
    errorLog('🚨 检测到HLS文件404错误，尝试智能恢复...')
    handleVideoRecovery()
  } else {
    // 其他网络错误，尝试重试
    const errorMsg = '网络错误，无法加载视频流'
    error.value = errorMsg
    status.value = '错误'

    if (retryCount.value < config.player.maxRetries) {
      retryPlayback()
    } else {
      errorLog('网络错误重试次数已达上限')
      emit('error', new Error(errorMsg))
    }
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

// 🔥 新增：智能视频恢复函数
const handleVideoRecovery = async () => {
  console.log('🔄 开始智能视频恢复流程...')
  
  const currentStream = streamsStore.currentStream
  
  if (!currentStream) {
    console.error('❌ 无当前流信息，无法恢复')
    error.value = '无法恢复视频，请手动刷新'
    return
  }
  
  try {
    const streamId = currentStream.channelId
    
    console.log('🔄 重新请求视频流...', streamId)
    
    // 显示恢复中状态
    status.value = '恢复中'
    error.value = ''
    
    // 停止当前播放
    destroyHls()
    
    // 🔥 关键修复：强制清除currentStream，打破Vue响应式缓存
    streamsStore.currentStream = null
    
    // 等待500ms确保清理完成
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // 🔥 关键修复：使用forceReset参数重新播放
    await streamsStore.playStream(streamId, true)
    
    // 🔥 关键修复：等待Vue响应式更新DOM
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // 🔥 关键修复：手动强制重新初始化HLS（双保险）
    if (streamsStore.currentStream?.hlsUrl) {
      console.log('🎬 强制重新初始化HLS播放器')
      initHls()
    }
    
    console.log('✅ 视频自动恢复成功')
    
    ElMessage.success('视频已自动恢复')
    
  } catch (error) {
    console.error('❌ 视频自动恢复失败:', error)
    
    error.value = '视频加载失败，请点击重新加载'
    status.value = '错误'
    
    ElMessage.error('视频恢复失败，请手动刷新')
  }
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
  
  // 清除加载计时器
  stopLoadingTimer()
  
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

// 加载计时器
const startLoadingTimer = () => {
  stopLoadingTimer()
  loadingTime.value = 0
  loadingTimerRef.value = setInterval(() => {
    loadingTime.value++
    // 根据加载时间更新提示信息
    if (loadingTime.value > 30) {
      loadingSubMessage.value = '加载时间较长，请稍候...'
    } else if (loadingTime.value > 15) {
      loadingSubMessage.value = '正在建立连接...'
    }
  }, 1000)
}

const stopLoadingTimer = () => {
  if (loadingTimerRef.value) {
    clearInterval(loadingTimerRef.value)
    loadingTimerRef.value = null
  }
}

// 🔥 URL推断连接模式函数
const detectConnectionModeFromUrl = (url, previousMode = null) => {
  if (!url) {
    return { type: 'unknown', reason: 'URL为空' }
  }
  
  debugLog('URL推断连接模式:', url)
  
  // 从环境变量读取域名配置
  const TUNNEL_DOMAIN = import.meta.env.VITE_TUNNEL_HLS_DOMAIN
  const VPS_DOMAIN = import.meta.env.VITE_VPS_DIRECT_DOMAIN
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
  const API_DOMAIN = API_BASE_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  
  // 根据URL域名判断连接模式
  if (TUNNEL_DOMAIN && url.includes(TUNNEL_DOMAIN)) {
    return { 
      type: 'tunnel', 
      reason: '隧道优化端点',
      description: '使用Cloudflare Tunnel加速'
    }
  } else if (API_DOMAIN && url.includes(API_DOMAIN)) {
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
  } else if (VPS_DOMAIN && url.includes(VPS_DOMAIN)) {
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
    
    // 🔥 只有在非切换状态下才设置loading，切换状态由isSwitching prop控制
    if (!props.isSwitching && newUrl) {
      loading.value = true
      loadingMessage.value = '正在连接视频流...'
      loadingSubMessage.value = '启动转码服务'
      loadingTime.value = 0
      startLoadingTimer()
    }
    
    // 🔥 从store更新路由信息
    if (streamsStore.currentStream) {
      frontendPath.value = streamsStore.currentStream.frontendPath || 'direct'
      backendPath.value = streamsStore.currentStream.backendPath || 'direct'
      debugLog('更新路由信息:', {
        frontend: frontendPath.value,
        backend: backendPath.value
      })
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

// iOS 手势拦截（防止捏合触发原生全屏）
let gestureBlockersBound = false
const addIosGestureBlockers = () => {
  if (!containerRef.value || gestureBlockersBound) return
  const el = containerRef.value
  // 使用非被动监听，确保可以preventDefault
  el.addEventListener('gesturestart', preventGesture, { passive: false })
  el.addEventListener('gesturechange', preventGesture, { passive: false })
  el.addEventListener('gestureend', preventGesture, { passive: false })
  gestureBlockersBound = true
  debugLog('[VideoPlayer] 已绑定iOS手势拦截')
}

const removeIosGestureBlockers = () => {
  if (!containerRef.value || !gestureBlockersBound) return
  const el = containerRef.value
  el.removeEventListener('gesturestart', preventGesture)
  el.removeEventListener('gesturechange', preventGesture)
  el.removeEventListener('gestureend', preventGesture)
  gestureBlockersBound = false
  debugLog('[VideoPlayer] 已移除iOS手势拦截')
}

function preventGesture(e) {
  e.preventDefault()
}

// 自定义全屏切换函数
const toggleCustomFullscreen = () => {
  isCustomFullscreen.value = !isCustomFullscreen.value
  
  if (isCustomFullscreen.value) {
    // 进入自定义全屏
    debugLog('[VideoPlayer] 进入自定义全屏，启用缩放拖动')
    // 显示控制条并启动自动隐藏定时器
    showControls.value = true
    resetHideControlsTimer()
    // 绑定iOS手势拦截
    addIosGestureBlockers()
    
    // 尝试锁定屏幕方向为横屏（移动端）
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(e => {
        debugLog('[VideoPlayer] 屏幕方向锁定失败:', e.message)
      })
    }
  } else {
    // 退出自定义全屏
    debugLog('[VideoPlayer] 退出自定义全屏，重置缩放')
    // 清理自动隐藏定时器
    if (hideControlsTimer) {
      clearTimeout(hideControlsTimer)
      hideControlsTimer = null
    }
    showControls.value = true // 退出全屏时恢复显示
    resetZoom()
    // 重置旋转
    videoRotation.value = 0
    autoFitting.value = false
    // 解除iOS手势拦截
    removeIosGestureBlockers()
    
    // 解锁屏幕方向
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock()
    }
  }
}

// 切换画面旋转
const toggleRotation = () => {
  if (videoRotation.value === 0) {
    // 先重置缩放和平移
    scale.value = 1
    translateX.value = 0
    translateY.value = 0

    // 旋转到90度
    videoRotation.value = 90

    
    // 旋转时计算合适的scale，让画面完整填充
    nextTick(() => {
      // 延迟计算，确保DOM已更新
      setTimeout(() => {
        if (!containerRef.value || !videoRef.value) return
        
        const container = containerRef.value.getBoundingClientRect()
        const video = videoRef.value
        const videoW = video.videoWidth || 1920
        const videoH = video.videoHeight || 1080
        
        // wrapper是100vh×100vw，假设视口是430×932，则wrapper是932×430
        // 视频16:9在932×430的wrapper中，用contain模式：
        // 实际显示尺寸：932×524（保持16:9）
        // 旋转90度后包围盒：524×932
        // 要填充430×932容器，需要scale = 430/524 = 0.82
        
        // 计算视频在wrapper中contain模式下的实际尺寸
        const wrapperW = container.height  // 100vh
        const wrapperH = container.width   // 100vw
        const videoAspect = videoW / videoH
        const wrapperAspect = wrapperW / wrapperH
        
        let displayW, displayH
        if (videoAspect > wrapperAspect) {
          // 视频更宽，以wrapper宽度为准
          displayW = wrapperW
          displayH = wrapperW / videoAspect
        } else {
          // 视频更高，以wrapper高度为准
          displayH = wrapperH
          displayW = wrapperH * videoAspect
        }
        
        // 计算旋转后的黑边，并通过translateY调整位置消除顶部黑边
        // displayW×displayH是video在wrapper中contain模式的实际尺寸
        // 旋转90度后包围盒变为：displayH × displayW
        const rotatedHeight = displayW  // 旋转后的高度
        const containerHeight = container.height
        
        // 计算上下黑边总量
        const totalBlackBar = containerHeight - rotatedHeight
        
        // 如果有黑边，上移一半黑边的距离，让顶部黑边消失
        const offsetY = totalBlackBar > 0 ? -totalBlackBar / 2 : 0
        
        scale.value = 1.0
        translateX.value = 0
        translateY.value = offsetY
        
        console.log('[VideoPlayer] 旋转90度: 自动计算偏移消除黑边')
        console.log({
          videoSize: `${videoW}×${videoH}`,
          wrapperSize: `${Math.round(wrapperW)}×${Math.round(wrapperH)}`,
          displaySize: `${Math.round(displayW)}×${Math.round(displayH)}`,
          rotatedBox: `${Math.round(displayH)}×${Math.round(displayW)}`,
          containerSize: `${Math.round(container.width)}×${Math.round(containerHeight)}`,
          totalBlackBar: Math.round(totalBlackBar) + 'px',
          offsetY: Math.round(offsetY) + 'px',
          scale: '1.0 (100%)'
        })
      }, 100)
    })
  } else {
    // 恢复到0度
    videoRotation.value = 0
    // 重置缩放
    resetZoom()
  }
  
  debugLog('[VideoPlayer] 切换画面旋转:', videoRotation.value)
}

// 计算旋转90度时填充整个容器所需的scale（cover方式）
function computeAutoScaleForRotate() {
  if (!containerRef.value || !videoRef.value) return
  const container = containerRef.value.getBoundingClientRect()
  const video = videoRef.value
  
  // 使用原始视频尺寸
  let baseW = video.videoWidth
  let baseH = video.videoHeight
  
  if (!baseW || !baseH) {
    baseW = 1920
    baseH = 1080
  }
  
  if (!container.width || !container.height || !baseW || !baseH) return
  
  // 旋转90度后包围盒：(baseH*scale × baseW*scale)
  const scaleX = container.width / baseH
  const scaleY = container.height / baseW
  const autoScale = Math.max(scaleX, scaleY)
  scale.value = autoScale
  translateX.value = 0
  translateY.value = 0
  
  debugLog('[VideoPlayer] 自动适配重算:', { 
    videoW: baseW, 
    videoH: baseH, 
    containerW: container.width, 
    containerH: container.height, 
    scaleX: scaleX.toFixed(3), 
    scaleY: scaleY.toFixed(3), 
    autoScale: autoScale.toFixed(3) 
  })
}

onMounted(() => {
  debugLog('VideoPlayer组件挂载')
  
  // 从store读取路由信息
  if (streamsStore.currentStream) {
    frontendPath.value = streamsStore.currentStream.frontendPath || 'direct'
    backendPath.value = streamsStore.currentStream.backendPath || 'direct'
    debugLog('读取路由信息:', {
      frontend: frontendPath.value,
      backend: backendPath.value,
      routing: streamsStore.currentStream.routingMode
    })
  }
  
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
  
  debugLog('VideoPlayer组件挂载完成，使用自定义全屏方案')
  
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
    isCustomFullscreen: isCustomFullscreen.value,
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
    // 记录触摸起始位置（用于检测点击）
    touchStartPosition.value = {
      x: touches.value[0].clientX,
      y: touches.value[0].clientY,
      time: Date.now()
    }
    
    // 单指处理 - 根据平台和状态决定行为
    if (scale.value > 1) {
      // 已缩放状态下允许拖拽
      event.preventDefault()
      isDragging.value = true
      
      lastPanPoint.value = {
        x: touches.value[0].clientX,
        y: touches.value[0].clientY
      }
      debugLog('单指拖拽开始:', { 
        scale: scale.value, 
        isCustomFullscreen: isCustomFullscreen.value,
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
    if (deviceInfo.isIOS && isCustomFullscreen.value) {
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
      isCustomFullscreen: isCustomFullscreen.value,
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
        scaleSensitivity = isCustomFullscreen.value ? 0.8 : 1
      } else if (deviceInfo.isAndroid) {
        // Android: 标准敏感度
        scaleSensitivity = 1
      } else {
        // PC: 可能需要更高敏感度
        scaleSensitivity = 1.1
      }
      
      // 自动适配期间不处理缩放
      if (autoFitting.value) return
      // 应用敏感度调整
      const adjustedScaleChange = 1 + (scaleChange - 1) * scaleSensitivity
      const oldScale = scale.value
      newScale = Math.max(0.5, Math.min(3, oldScale * adjustedScaleChange))
      
      // 以视口中心为缩放中心：保持当前视口中心对应的图像内容位置不变
      // 平移量需要按缩放比例调整
      if (oldScale > 0) {
        const scaleRatio = newScale / oldScale
        translateX.value = translateX.value * scaleRatio
        translateY.value = translateY.value * scaleRatio
      }
      
      scale.value = newScale
      debugLog('双指缩放中:', { 
        scale: newScale, 
        platform: deviceInfo.isIOS ? 'iOS' : deviceInfo.isAndroid ? 'Android' : 'PC',
        scaleSensitivity,
        isCustomFullscreen: isCustomFullscreen.value
      })
    }
    
    lastTouchDistance.value = currentDistance
    lastTouchCenter.value = currentCenter
  }
}

const handleTouchEnd = (event) => {
  // 检测是否是点击（移动距离小且时间短）
  const isTap = event.changedTouches.length > 0 && (() => {
    const touch = event.changedTouches[0]
    const deltaX = Math.abs(touch.clientX - touchStartPosition.value.x)
    const deltaY = Math.abs(touch.clientY - touchStartPosition.value.y)
    const deltaTime = Date.now() - touchStartPosition.value.time
    const moveDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    
    // 移动距离<15px 且 时间<300ms 认为是点击
    return moveDistance < 15 && deltaTime < 300
  })()
  
  debugLog('触摸结束:', {
    touchCount: event.touches.length,
    isDragging: isDragging.value,
    scale: scale.value,
    isCustomFullscreen: isCustomFullscreen.value,
    isTap,
    videoRotation: videoRotation.value
  })
  
  touches.value = Array.from(event.touches)
  
  if (event.touches.length === 0) {
    // 如果是点击且在旋转+缩放模式，触发控制条切换
    if (isTap && isCustomFullscreen.value && videoRotation.value !== 0 && scale.value > 1) {
      debugLog('检测到点击（旋转+缩放模式），切换控制条')
      // 取消之前的定时器
      if (clickTimer) {
        clearTimeout(clickTimer)
      }
      // 延迟200ms处理，以区分双击
      clickTimer = setTimeout(() => {
        toggleControlsVisibility()
      }, 200)
    }
    
    isDragging.value = false
    debugLog('所有触摸结束，停止拖拽')
  }
}

// 组件卸载时清理事件监听器（合并到下面的onUnmounted中）

// 鼠标滚轮缩放支持 - 以视口中心为缩放中心
const handleWheel = (event) => {
  if (autoFitting.value) return
  event.preventDefault()
  
  const delta = event.deltaY > 0 ? 0.9 : 1.1
  const oldScale = scale.value
  const newScale = Math.max(0.5, Math.min(3, scale.value * delta))
  
  // 以视口中心为缩放中心：保持当前视口中心对应的图像内容位置不变
  // 平移量需要按缩放比例调整
  if (oldScale > 0) {
    const scaleRatio = newScale / oldScale
    translateX.value = translateX.value * scaleRatio
    translateY.value = translateY.value * scaleRatio
  }
  
  scale.value = newScale
  
  // 如果缩放比例接近1，自动重置
  if (scale.value < 1.1 && scale.value > 0.9) {
    resetZoom()
  }
  
  debugLog('鼠标滚轮缩放:', { 
    oldScale,
    newScale,
    translateX: translateX.value,
    translateY: translateY.value
  })
}

// 重置缩放
const resetZoom = () => {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

// 鼠标拖动处理（PC端）
const handleMouseDown = (event) => {
  // 只在缩放后才允许拖动
  if (scale.value > 1) {
    event.preventDefault()
    isMouseDragging.value = true
    lastMousePoint.value = {
      x: event.clientX,
      y: event.clientY
    }
    debugLog('鼠标拖动开始:', { scale: scale.value, x: event.clientX, y: event.clientY })
  }
}

const handleMouseMove = (event) => {
  if (isMouseDragging.value && scale.value > 1) {
    event.preventDefault()
    
    const deltaX = event.clientX - lastMousePoint.value.x
    const deltaY = event.clientY - lastMousePoint.value.y
    
    translateX.value += deltaX
    translateY.value += deltaY
    
    lastMousePoint.value = {
      x: event.clientX,
      y: event.clientY
    }
    
    debugLog('鼠标拖动中:', { deltaX, deltaY, translateX: translateX.value, translateY: translateY.value })
  }
}

const handleMouseUp = () => {
  if (isMouseDragging.value) {
    isMouseDragging.value = false
    debugLog('鼠标拖动结束')
  }
}

const handleMouseLeave = () => {
  // 鼠标离开容器时也结束拖动
  if (isMouseDragging.value) {
    isMouseDragging.value = false
    debugLog('鼠标离开容器，结束拖动')
  }
}

// 处理视频点击事件 - 切换控制条显示（仅旋转模式下）
const handleVideoClick = (event) => {
  // 强制阻止默认的点击暂停行为
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  
  // 确保视频继续播放
  if (videoRef.value && videoRef.value.paused) {
    videoRef.value.play()
  }
  
  // 在自定义全屏且旋转模式下，切换控制条显示
  if (isCustomFullscreen.value && videoRotation.value !== 0) {
    toggleControlsVisibility()
  }
  
  debugLog('视频点击事件被拦截，已禁用暂停功能')
  
  return false
}

// 切换控制条显示/隐藏
const toggleControlsVisibility = () => {
  showControls.value = !showControls.value
  
  // 如果显示了控制条，3秒后自动隐藏
  if (showControls.value) {
    resetHideControlsTimer()
  }
}

// 重置自动隐藏定时器
const resetHideControlsTimer = () => {
  if (hideControlsTimer) {
    clearTimeout(hideControlsTimer)
  }
  hideControlsTimer = setTimeout(() => {
    showControls.value = false
  }, 3000) // 3秒后自动隐藏
}

// 处理wrapper点击 - 延迟处理以区分双击（仅在旋转模式下切换控制条）
const handleWrapperClick = (event) => {
  // 如果不在全屏模式或未旋转，不处理
  if (!isCustomFullscreen.value || videoRotation.value === 0) {
    return
  }
  
  // 清除之前的单击定时器
  if (clickTimer) {
    clearTimeout(clickTimer)
  }
  
  // 延迟200ms处理单击，如果在此期间发生双击，则会被取消
  clickTimer = setTimeout(() => {
    toggleControlsVisibility()
  }, 200)
}

// 双击缩放 - 以视口中心为缩放中心
const handleDoubleClick = (event) => {
  // 取消单击处理
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  const oldScale = scale.value
  const newScale = scale.value === 1 ? 2 : 1
  
  if (newScale === 1) {
    // 重置到1倍时，直接重置平移
    resetZoom()
  } else {
    // 放大时，以视口中心为缩放中心：保持当前视口中心对应的图像内容位置不变
    // 平移量需要按缩放比例调整
    if (oldScale > 0) {
      const scaleRatio = newScale / oldScale
      translateX.value = translateX.value * scaleRatio
      translateY.value = translateY.value * scaleRatio
    }
    
    scale.value = newScale
  }
  
  debugLog('双击缩放:', { 
    oldScale, 
    newScale: scale.value,
    translateX: translateX.value,
    translateY: translateY.value
  })
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
  
  // 退出自定义全屏
  if (isCustomFullscreen.value) {
    isCustomFullscreen.value = false
    removeIosGestureBlockers()
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock()
    }
  }
  
  // 清理HLS实例
  if (hls.value) {
    hls.value.destroy()
  }
  
  // 清理控制条相关定时器
  if (hideControlsTimer) {
    clearTimeout(hideControlsTimer)
  }
  if (clickTimer) {
    clearTimeout(clickTimer)
  }
  
  debugLog('所有事件监听器已清理完成')
})
</script>

<style scoped>
/* 控制条淡入淡出动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

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

/* ✅ 自定义全屏容器（支持iOS缩放拖动） */
.custom-fullscreen {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-height: 100vh !important;
  z-index: 9999 !important;
  background: #000 !important;
}

/* 自定义全屏下禁用系统手势，确保手势由我们接管 */
.custom-fullscreen .video-element {
  touch-action: none;
  -webkit-user-select: none;
  pointer-events: auto;
}

/* 旋转时：使用contain显示完整画面，避免裁剪 */
.custom-fullscreen .video-element[data-rotated="true"] {
  object-fit: contain !important;
}



/* 自定义全屏按钮 */
.custom-fullscreen-btn,
.exit-fullscreen-btn {
  position: absolute;
  bottom: 80px;
  right: 20px;
  width: 48px;
  height: 48px;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
  z-index: 10000; /* 高于一切缩放内容 */
  backdrop-filter: blur(4px);
}

.custom-fullscreen-btn:hover,
.exit-fullscreen-btn:hover {
  background: rgba(0, 0, 0, 0.8);
  transform: scale(1.1);
  border-color: rgba(255, 255, 255, 0.4);
}

.custom-fullscreen-btn:active,
.exit-fullscreen-btn:active {
  transform: scale(0.95);
}

/* 视口层固定的退出按钮（右上角，适配安全区） */
.exit-fullscreen-fixed {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483647; /* 最高层级 */
  backdrop-filter: blur(4px);
  pointer-events: auto;
}

.exit-fullscreen-fixed:active {
  transform: scale(0.95);
}

/* 视口层固定的旋转按钮（右上角退出按钮左边） */
.rotate-btn-fixed {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(72px, calc(env(safe-area-inset-right) + 60px)); /* 在退出按钮左边 */
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483647; /* 最高层级 */
  backdrop-filter: blur(4px);
  pointer-events: auto;
  transition: all 0.3s;
}

.rotate-btn-fixed:active {
  transform: scale(0.95);
}

/* UI层不参与缩放，以免被transform遮挡 */
.ui-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 0; /* 仅占位，按钮已靠自身绝对定位 */
  z-index: 9999;
  pointer-events: none; /* 自身不接事件，按钮各自接收 */
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
  background-color: transparent;
  backdrop-filter: none;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 30px;
  /* 完全透明背景，移除黑框 */
  background: transparent;
  border-radius: 0;
  border: none;
  backdrop-filter: none;
  box-shadow: none;
}

.loading-spinner {
  color: #409EFF;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.1);
  }
}

.loading-text {
  text-align: center;
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.loading-title {
  font-size: 18px;
  font-weight: 500;
  color: #fff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8), 
               0 0 20px rgba(0, 0, 0, 0.6);
}

.loading-subtitle {
  font-size: 14px;
  color: #e0e0e0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
}

.loading-timer {
  font-size: 13px;
  color: #67C23A;
  font-family: monospace;
  margin-top: 5px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
}

.loading-tips {
  text-align: center;
  padding: 12px 20px;
  background: transparent;
  border-radius: 0;
  border: none;
}

.loading-tips .el-text {
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
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
