<template>
  <div class="mobile-stream-list" :class="{ 'mobile': isMobile }">
    <!-- 加载状态 -->
    <div v-if="streamsStore.loading" class="loading-container">
      <div class="loading-content">
        <el-skeleton :rows="isMobile ? 3 : 5" animated />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="streamsStore.streams.length === 0" class="empty-container">
      <el-empty 
        :description="isMobile ? '暂无频道' : '暂无可用频道'"
        :image-size="isMobile ? 100 : 150"
      >
        <template #image>
          <el-icon :size="isMobile ? 50 : 75" color="#C0C4CC">
            <VideoCamera />
          </el-icon>
        </template>
        <template #extra v-if="userStore.isAdmin">
          <el-button type="primary" size="small" @click="refreshStreams">
            刷新频道
          </el-button>
        </template>
      </el-empty>
    </div>

    <!-- 频道列表 -->
    <div 
      v-else 
      class="streams-container"
      ref="streamsContainer"
      @scroll="handleScroll"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <div 
        v-for="(stream, index) in streamsStore.streams" 
        :key="stream.id"
        class="stream-item"
        :class="{ 
          'active': selectedStreamId === stream.id,
          'mobile-item': isMobile 
        }"
        @click="selectStream(stream)"
        @touchstart="handleItemTouchStart($event, stream)"
        @touchend="handleItemTouchEnd($event, stream)"
        :style="{ animationDelay: `${index * 50}ms` }"
      >
        <!-- 频道图标 -->
        <div class="stream-icon">
          <div class="icon-wrapper" :class="{ 'active': selectedStreamId === stream.id }">
            <el-icon :size="isMobile ? 20 : 24">
              <VideoCamera />
            </el-icon>
          </div>
        </div>

        <!-- 频道信息 -->
        <div class="stream-info">
          <h4 class="stream-name">{{ stream.name }}</h4>
          <p class="stream-id">ID: {{ stream.id }}</p>
          <div v-if="stream.status" class="stream-status" :class="`status-${stream.status}`">
            <el-icon class="status-dot" :size="8">
              <CircleFilled />
            </el-icon>
            <span class="status-text">{{ getStatusText(stream.status) }}</span>
          </div>
        </div>

        <!-- 频道操作 -->
        <div class="stream-action">
          <!-- 播放状态指示器 -->
          <div v-if="selectedStreamId === stream.id" class="playing-indicator">
            <el-icon class="playing-icon" color="#67c23a" :size="isMobile ? 16 : 20">
              <CaretRight />
            </el-icon>
          </div>

          <!-- 移动端快捷操作 -->
          <div v-if="isMobile" class="mobile-actions">
            <el-button 
              v-if="userStore.isAdmin" 
              type="text" 
              size="small" 
              @click.stop="editStream(stream)"
              class="action-btn"
            >
              <el-icon :size="16">
                <Edit />
              </el-icon>
            </el-button>
          </div>

          <!-- 右箭头 -->
          <el-icon class="arrow-icon" :size="isMobile ? 14 : 16" color="#C0C4CC">
            <ArrowRight />
          </el-icon>
        </div>

        <!-- 触摸反馈波纹效果 -->
        <div class="ripple-effect" ref="rippleRef"></div>
      </div>

      <!-- 下拉刷新指示器 -->
      <div v-if="showPullRefresh" class="pull-refresh-indicator">
        <el-icon class="refresh-icon" :size="20">
          <Refresh />
        </el-icon>
        <span class="refresh-text">松开刷新</span>
      </div>
    </div>

    <!-- 移动端浮动刷新按钮 -->
    <div v-if="isMobile && userStore.isAdmin" class="floating-refresh">
      <el-button 
        type="primary" 
        :icon="Refresh"
        circle
        size="large"
        @click="refreshStreams"
        :loading="streamsStore.loading"
        class="refresh-fab"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { 
  VideoCamera, 
  CaretRight, 
  ArrowRight, 
  CircleFilled,
  Edit,
  Refresh
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useStreamsStore } from '../stores/streams'
import { useUserStore } from '../stores/user'

const emit = defineEmits(['stream-select'])

const streamsStore = useStreamsStore()
const userStore = useUserStore()

// 响应式数据
const selectedStreamId = ref('')
const windowWidth = ref(window.innerWidth)
const streamsContainer = ref(null)
const rippleRef = ref(null)

// 触摸相关
const touchStartY = ref(0)
const touchCurrentY = ref(0)
const showPullRefresh = ref(false)
const isPulling = ref(false)
const pullThreshold = 80

// 触摸反馈
const itemTouchStart = ref(0)

// 计算属性
const isMobile = computed(() => windowWidth.value < 768)

// 方法
const handleResize = () => {
  windowWidth.value = window.innerWidth
}

const selectStream = (stream) => {
  selectedStreamId.value = stream.id
  emit('stream-select', stream)
  
  // 移动端触觉反馈
  if (isMobile.value && 'vibrate' in navigator) {
    navigator.vibrate(50)
  }
}

const getStatusText = (status) => {
  const statusMap = {
    'online': '在线',
    'offline': '离线',
    'loading': '加载中',
    'error': '错误'
  }
  return statusMap[status] || '未知'
}

const refreshStreams = async () => {
  try {
    await streamsStore.fetchStreams()
    ElMessage.success('频道列表已刷新')
  } catch (error) {
    ElMessage.error('刷新失败')
  }
}

const editStream = (stream) => {
  // 编辑频道逻辑
  ElMessage.info(`编辑频道: ${stream.name}`)
}

// 滚动处理
const handleScroll = (e) => {
  const container = e.target
  const scrollTop = container.scrollTop
  
  // 下拉刷新逻辑
  if (scrollTop === 0 && isPulling.value) {
    showPullRefresh.value = true
  } else {
    showPullRefresh.value = false
  }
}

// 触摸事件处理
const handleTouchStart = (e) => {
  if (!isMobile.value) return
  
  touchStartY.value = e.touches[0].clientY
  isPulling.value = false
}

const handleTouchMove = (e) => {
  if (!isMobile.value) return
  
  touchCurrentY.value = e.touches[0].clientY
  const deltaY = touchCurrentY.value - touchStartY.value
  
  // 检查是否在顶部且向下拉
  if (streamsContainer.value && streamsContainer.value.scrollTop === 0 && deltaY > 0) {
    isPulling.value = true
    
    if (deltaY > pullThreshold) {
      showPullRefresh.value = true
    }
    
    // 阻止默认滚动
    if (deltaY > 10) {
      e.preventDefault()
    }
  }
}

const handleTouchEnd = () => {
  if (!isMobile.value) return
  
  const deltaY = touchCurrentY.value - touchStartY.value
  
  if (isPulling.value && deltaY > pullThreshold && userStore.isAdmin) {
    refreshStreams()
  }
  
  isPulling.value = false
  showPullRefresh.value = false
}

// 单个项目触摸处理
const handleItemTouchStart = (e, stream) => {
  if (!isMobile.value) return
  
  itemTouchStart.value = Date.now()
  
  // 创建波纹效果
  createRippleEffect(e.currentTarget, e.touches[0])
}

const handleItemTouchEnd = (e, stream) => {
  if (!isMobile.value) return
  
  const touchDuration = Date.now() - itemTouchStart.value
  
  // 短按选择，长按显示菜单
  if (touchDuration < 500) {
    selectStream(stream)
  } else if (touchDuration > 800 && userStore.isAdmin) {
    // 长按菜单
    showContextMenu(stream, e)
  }
}

// 波纹效果
const createRippleEffect = (element, touch) => {
  const rect = element.getBoundingClientRect()
  const x = touch.clientX - rect.left
  const y = touch.clientY - rect.top
  
  const ripple = document.createElement('div')
  ripple.className = 'ripple'
  ripple.style.left = `${x}px`
  ripple.style.top = `${y}px`
  
  const rippleContainer = element.querySelector('.ripple-effect')
  if (rippleContainer) {
    rippleContainer.appendChild(ripple)
    
    // 动画结束后移除
    setTimeout(() => {
      if (ripple.parentNode) {
        ripple.parentNode.removeChild(ripple)
      }
    }, 600)
  }
}

// 上下文菜单
const showContextMenu = (stream, e) => {
  // 触觉反馈
  if ('vibrate' in navigator) {
    navigator.vibrate(100)
  }
  
  ElMessage.info(`长按菜单: ${stream.name}`)
}

// 生命周期
onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
/* 基础样式 */
.mobile-stream-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.loading-container {
  padding: 20px;
}

.loading-content {
  animation: slideInDown 0.3s ease;
}

.empty-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  animation: fadeIn 0.5s ease;
}

/* 频道列表容器 */
.streams-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
}

/* 频道项目 */
.stream-item {
  position: relative;
  display: flex;
  align-items: center;
  padding: 16px 20px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-bottom: 1px solid #f0f0f0;
  background-color: #fff;
  animation: slideInUp 0.3s ease forwards;
  opacity: 0;
  transform: translateY(20px);
  overflow: hidden;
}

.stream-item:hover {
  background-color: #f5f7fa;
  transform: translateX(2px);
}

.stream-item.active {
  background-color: #ecf5ff;
  border-left: 4px solid #409eff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.stream-item.mobile-item {
  padding: 20px 16px;
  min-height: 80px;
}

/* 频道图标 */
.stream-icon {
  margin-right: 16px;
  flex-shrink: 0;
}

.icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background-color: #f5f7fa;
  color: #606266;
  transition: all 0.3s ease;
}

.icon-wrapper.active {
  background-color: #409eff;
  color: white;
  transform: scale(1.1);
}

/* 频道信息 */
.stream-info {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

.stream-name {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.stream-id {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}

.stream-status {
  display: flex;
  align-items: center;
  font-size: 11px;
  margin-top: 2px;
}

.status-dot {
  margin-right: 4px;
}

.status-online .status-dot {
  color: #67c23a;
}

.status-offline .status-dot {
  color: #909399;
}

.status-loading .status-dot {
  color: #e6a23c;
  animation: pulse 1.5s infinite;
}

.status-error .status-dot {
  color: #f56c6c;
}

.status-text {
  color: inherit;
}

/* 频道操作 */
.stream-action {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.playing-indicator {
  display: flex;
  align-items: center;
}

.playing-icon {
  animation: pulse 1.5s infinite;
}

.mobile-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  padding: 4px;
  min-height: 32px;
  min-width: 32px;
}

.arrow-icon {
  opacity: 0.5;
  transition: all 0.2s ease;
}

.stream-item:hover .arrow-icon {
  opacity: 1;
  transform: translateX(2px);
}

/* 波纹效果 */
.ripple-effect {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: hidden;
}

.ripple {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: rgba(64, 158, 255, 0.3);
  transform: translate(-50%, -50%) scale(0);
  animation: rippleAnimation 0.6s ease-out;
}

@keyframes rippleAnimation {
  to {
    transform: translate(-50%, -50%) scale(4);
    opacity: 0;
  }
}

/* 下拉刷新 */
.pull-refresh-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: #409eff;
  font-size: 14px;
  animation: slideInDown 0.3s ease;
}

.refresh-icon {
  margin-right: 8px;
  animation: spin 1s linear infinite;
}

.refresh-text {
  font-weight: 500;
}

/* 浮动刷新按钮 */
.floating-refresh {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 100;
}

.refresh-fab {
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
  backdrop-filter: blur(10px);
}

/* 移动端样式 */
@media (max-width: 767px) {
  .mobile-stream-list.mobile .streams-container {
    padding-bottom: 80px; /* 为浮动按钮留出空间 */
  }

  .stream-item.mobile-item:active {
    background-color: #e6f7ff;
    transform: scale(0.98);
  }

  .stream-name {
    font-size: 15px;
  }

  .stream-id {
    font-size: 11px;
  }

  .stream-status {
    font-size: 10px;
  }

  .icon-wrapper {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }
}

/* 平板端样式 */
@media (min-width: 768px) and (max-width: 1024px) {
  .stream-item {
    padding: 18px 20px;
  }

  .floating-refresh {
    display: none;
  }
}

/* 触摸设备优化 */
@media (hover: none) and (pointer: coarse) {
  .stream-item {
    min-height: 72px;
    padding: 20px 16px;
  }

  .action-btn {
    min-height: 44px;
    min-width: 44px;
  }

  .icon-wrapper {
    width: 44px;
    height: 44px;
  }
}

/* 滚动条样式 */
.streams-container::-webkit-scrollbar {
  width: 4px;
}

.streams-container::-webkit-scrollbar-track {
  background-color: transparent;
}

.streams-container::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 2px;
}

.streams-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}

/* 动画 */
@keyframes slideInUp {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideInDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 暗色模式支持 */
@media (prefers-color-scheme: dark) {
  .stream-item {
    background-color: #2d2d2d;
    border-bottom-color: #404040;
    color: #e4e7ed;
  }

  .stream-item:hover {
    background-color: #363636;
  }

  .stream-item.active {
    background-color: #1e3a8a;
  }

  .stream-name {
    color: #e4e7ed;
  }

  .icon-wrapper {
    background-color: #404040;
    color: #909399;
  }

  .icon-wrapper.active {
    background-color: #409eff;
    color: white;
  }
}

/* 高对比度模式 */
@media (prefers-contrast: high) {
  .stream-item {
    border-bottom: 2px solid;
  }

  .stream-item.active {
    border-left-width: 6px;
  }

  .icon-wrapper {
    border: 2px solid;
  }
}

/* 减少动画模式 */
@media (prefers-reduced-motion: reduce) {
  .stream-item,
  .icon-wrapper,
  .playing-icon,
  .refresh-icon,
  .ripple {
    animation: none;
    transition: none;
  }
}
</style>
