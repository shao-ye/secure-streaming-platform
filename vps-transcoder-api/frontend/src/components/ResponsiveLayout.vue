<template>
  <div class="responsive-layout" :class="{ 'mobile-view': isMobile, 'sidebar-open': sidebarOpen }">
    <!-- 移动端顶部导航栏 -->
    <header class="mobile-header" v-if="isMobile">
      <div class="header-content">
        <button class="menu-button" @click="toggleSidebar" :aria-label="sidebarOpen ? '关闭菜单' : '打开菜单'">
          <el-icon size="24">
            <Menu v-if="!sidebarOpen" />
            <Close v-else />
          </el-icon>
        </button>
        <h1 class="app-title">YOYO流媒体平台</h1>
        <div class="header-actions">
          <el-dropdown trigger="click" @command="handleUserAction">
            <button class="user-button" :aria-label="userStore.isLoggedIn ? '用户菜单' : '登录'">
              <el-icon size="20">
                <User />
              </el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="!userStore.isLoggedIn" command="login">登录</el-dropdown-item>
                <el-dropdown-item v-if="userStore.isLoggedIn && userStore.isAdmin" command="admin">管理后台</el-dropdown-item>
                <el-dropdown-item v-if="userStore.isLoggedIn" command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <!-- 侧边栏遮罩层 (移动端) -->
    <div 
      v-if="isMobile && sidebarOpen" 
      class="sidebar-overlay" 
      @click="closeSidebar"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    ></div>

    <!-- 主要内容区域 -->
    <div class="main-container">
      <!-- 侧边栏 -->
      <aside 
        class="sidebar" 
        :class="{ 
          'sidebar-hidden': isMobile && !sidebarOpen,
          'sidebar-collapsed': !isMobile && !sidebarOpen
        }"
        ref="sidebarRef"
      >
        <div class="sidebar-content">
          <!-- 桌面端标题 -->
          <div v-if="!isMobile" class="desktop-header">
            <div class="header-top">
              <h1 class="app-title">YOYO流媒体平台</h1>
              <button class="collapse-button" @click="toggleSidebar" :aria-label="sidebarOpen ? '收起侧边栏' : '展开侧边栏'">
                <el-icon size="18">
                  <DArrowLeft v-if="sidebarOpen" />
                  <DArrowRight v-else />
                </el-icon>
              </button>
            </div>
            <div class="user-info" v-if="userStore.isLoggedIn">
              <span class="welcome-text">欢迎, {{ userStore.isAdmin ? 'admin' : '用户' }}</span>
              <el-button-group size="small">
                <el-button v-if="userStore.isAdmin" type="primary" @click="goToAdmin">管理后台</el-button>
                <el-button type="danger" @click="logout">退出登录</el-button>
              </el-button-group>
            </div>
          </div>

          <!-- 频道列表标题 -->
          <div class="section-header">
            <h2 class="section-title">
              <el-icon class="section-icon">
                <VideoCamera />
              </el-icon>
              频道列表
            </h2>
            <el-button 
              v-if="userStore.isAdmin" 
              type="text" 
              size="small" 
              @click="refreshStreams"
              :loading="streamsStore.loading"
              class="refresh-button"
            >
              <el-icon><Refresh /></el-icon>
            </el-button>
          </div>

          <!-- 流列表组件 -->
          <div class="stream-list-container">
            <StreamList @stream-select="handleStreamSelect" />
          </div>
        </div>
      </aside>

      <!-- PC端折叠时的浮动展开按钮 -->
      <div v-if="!isMobile && !sidebarOpen" class="floating-expand-button" @click="toggleSidebar">
        <el-icon size="20">
          <DArrowRight />
        </el-icon>
      </div>

      <!-- 主内容区域 -->
      <main class="content-area">
        <!-- 视频播放器区域 -->
        <div class="video-section" v-if="selectedStream">
          <VideoPlayer 
            :hls-url="selectedStream.hlsUrl" 
            :stream-name="selectedStream.name"
            :key="selectedStream.id"
            @error="handlePlayerError"
          />
        </div>

        <!-- 空状态显示 -->
        <div v-else class="empty-state">
          <el-empty 
            description="请选择一个频道开始观看"
            :image-size="isMobile ? 120 : 200"
          >
            <template #image>
              <el-icon :size="isMobile ? 60 : 100" color="#C0C4CC">
                <VideoCamera />
              </el-icon>
            </template>
          </el-empty>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { 
  Menu, 
  Close, 
  User, 
  VideoCamera, 
  Refresh,
  DArrowLeft,
  DArrowRight
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import StreamList from './StreamList.vue'
import VideoPlayer from './VideoPlayer.vue'
import { useUserStore } from '../stores/user'
import { useStreamsStore } from '../stores/streams'

const router = useRouter()
const userStore = useUserStore()
const streamsStore = useStreamsStore()

// 响应式状态
const sidebarOpen = ref(false)
const selectedStream = ref(null)
const windowWidth = ref(window.innerWidth)
const sidebarRef = ref(null)

// 触摸手势相关
const touchStartX = ref(0)
const touchStartY = ref(0)
const touchCurrentX = ref(0)

// 计算属性
const isMobile = computed(() => windowWidth.value < 768)

// 窗口大小监听
const handleResize = () => {
  windowWidth.value = window.innerWidth
  // 桌面端自动打开侧边栏，移动端自动关闭
  if (!isMobile.value) {
    sidebarOpen.value = true
  } else {
    sidebarOpen.value = false
  }
}

// 侧边栏控制
const toggleSidebar = () => {
  sidebarOpen.value = !sidebarOpen.value
}

const closeSidebar = () => {
  if (isMobile.value) {
    sidebarOpen.value = false
  }
}

// 触摸手势处理
const handleTouchStart = (e) => {
  touchStartX.value = e.touches[0].clientX
  touchStartY.value = e.touches[0].clientY
}

const handleTouchMove = (e) => {
  touchCurrentX.value = e.touches[0].clientX
}

const handleTouchEnd = () => {
  const deltaX = touchCurrentX.value - touchStartX.value
  const deltaY = Math.abs(e.touches[0].clientY - touchStartY.value)
  
  // 水平滑动距离大于50px且垂直滑动小于100px时触发
  if (Math.abs(deltaX) > 50 && deltaY < 100) {
    if (deltaX > 0 && touchStartX.value < 50) {
      // 从左边缘向右滑动，打开侧边栏
      sidebarOpen.value = true
    } else if (deltaX < 0 && sidebarOpen.value) {
      // 向左滑动，关闭侧边栏
      sidebarOpen.value = false
    }
  }
}

// 流选择处理
const handleStreamSelect = async (stream) => {
  try {
    // 调用播放流API获取HLS URL
    const hlsUrl = await streamsStore.playStream(stream.id)
    selectedStream.value = {
      ...stream,
      hlsUrl: hlsUrl
    }
    ElMessage.success(`正在播放: ${stream.name}`)
    
    // 移动端选择流后自动关闭侧边栏
    if (isMobile.value) {
      closeSidebar()
    }
  } catch (error) {
    ElMessage.error(error.message || '播放失败')
    console.error('播放流失败:', error)
  }
}

// 播放器错误处理
const handlePlayerError = (error) => {
  ElMessage.error('视频播放出错: ' + error.message)
  console.error('视频播放错误:', error)
}

// 全屏处理
const handleFullscreenChange = (isFullscreen) => {
  // 全屏时隐藏侧边栏
  if (isFullscreen && isMobile.value) {
    sidebarOpen.value = false
  }
}

// 用户操作处理
const handleUserAction = (command) => {
  switch (command) {
    case 'login':
      router.push('/login')
      break
    case 'admin':
      goToAdmin()
      break
    case 'logout':
      logout()
      break
  }
}

const goToAdmin = () => {
  router.push('/admin')
}

const logout = async () => {
  try {
    await userStore.logout()
    ElMessage.success('退出登录成功')
    router.push('/login')
  } catch (error) {
    ElMessage.error('退出登录失败')
  }
}

const refreshStreams = async () => {
  try {
    await streamsStore.fetchStreams()
    ElMessage.success('频道列表已刷新')
  } catch (error) {
    ElMessage.error('刷新失败')
  }
}

// 生命周期
onMounted(() => {
  window.addEventListener('resize', handleResize)
  // 初始化侧边栏状态
  if (isMobile.value) {
    // 手机端首次加载时默认展开播放列表
    sidebarOpen.value = true
  } else {
    sidebarOpen.value = true
  }
  // 加载流列表
  streamsStore.fetchStreams()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
/* 基础布局 */
.responsive-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background-color: #f5f7fa;
}

/* 移动端顶部导航栏 */
.mobile-header {
  display: none;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  z-index: 1001;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  height: 56px;
}

.menu-button,
.user-button {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-button:hover,
.user-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.menu-button:active,
.user-button:active {
  background-color: rgba(255, 255, 255, 0.2);
}

.app-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  flex: 1;
  text-align: center;
  letter-spacing: 0.5px;
}

.header-actions {
  width: 40px;
  display: flex;
  justify-content: flex-end;
}

/* 主容器 */
.main-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 侧边栏 */
.sidebar {
  width: 300px;
  background: white;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  z-index: 1000;
  height: 100vh;
  overflow: hidden;
}

/* PC端侧边栏折叠状态 */
.sidebar-collapsed {
  width: 0;
  min-width: 0;
  border-right: none;
}

.sidebar-collapsed .sidebar-content {
  opacity: 0;
  pointer-events: none;
}

.sidebar-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* 桌面端标题区域 */
.desktop-header {
  padding: 20px;
  border-bottom: 1px solid #e4e7ed;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.desktop-header .app-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  letter-spacing: 1px;
  flex: 1;
}

.collapse-button {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 8px;
  border-radius: 6px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.8;
}

.collapse-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  opacity: 1;
}

.collapse-button:active {
  background-color: rgba(255, 255, 255, 0.2);
}

/* PC端浮动展开按钮 */
.floating-expand-button {
  position: fixed;
  top: 20px;
  left: 20px;
  width: 44px;
  height: 44px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  z-index: 1001;
}

.floating-expand-button:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.floating-expand-button:active {
  transform: scale(0.95);
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.welcome-text {
  font-size: 14px;
  opacity: 0.9;
}

/* 频道列表区域 */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.section-title {
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.section-icon {
  margin-right: 8px;
  color: #409eff;
}

.refresh-button {
  padding: 4px 8px;
}

.stream-list-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  /* 完全隐藏滚动条 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.stream-list-container::-webkit-scrollbar {
  display: none;
}

/* 主内容区域 */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: #f5f7fa;
}

.video-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  height: 100vh;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

/* 移动端样式 */
@media (max-width: 767px) {
  .responsive-layout.mobile-view {
    flex-direction: column;
  }

  .mobile-header {
    display: block;
  }

  .main-container {
    position: relative;
    flex: 1;
  }

  .sidebar {
    position: fixed;
    top: 56px;
    left: 0;
    height: calc(100vh - 56px);
    z-index: 1000;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.15);
    transform: translateX(-100%);
  }

  .sidebar-hidden {
    transform: translateX(-100%);
  }

  .responsive-layout.sidebar-open .sidebar {
    transform: translateX(0);
  }

  .sidebar-overlay {
    position: fixed;
    top: 56px;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 999;
    backdrop-filter: blur(2px);
  }

  .desktop-header {
    display: none;
  }

  .content-area {
    margin-top: 0;
    height: calc(100vh - 56px);
  }

  .section-header {
    padding: 12px 16px 8px;
  }

  .section-title {
    font-size: 15px;
  }

  .empty-state {
    padding: 20px;
  }
}

/* 平板端样式 */
@media (min-width: 768px) and (max-width: 1024px) {
  .sidebar {
    width: 280px;
  }

  .desktop-header .app-title {
    font-size: 20px;
  }
}

/* 大屏幕优化 */
@media (min-width: 1200px) {
  .sidebar {
    width: 320px;
  }
}

/* PC端专用样式优化 */
@media (min-width: 768px) {
  .video-section {
    padding: 0;
    height: 100vh;
  }
  
  .content-area {
    padding: 0;
  }
  
  .stream-list-container {
    max-height: calc(100vh - 120px);
    padding-bottom: 16px;
  }
  
  /* 确保侧边栏完整显示 */
  .sidebar-content {
    min-height: 100vh;
  }
}

/* 触摸优化 */
@media (hover: none) and (pointer: coarse) {
  .menu-button,
  .user-button {
    min-height: 44px;
    min-width: 44px;
  }

  .stream-item {
    min-height: 60px;
    padding: 16px 20px;
  }
}

/* 暗色模式支持 */
@media (prefers-color-scheme: dark) {
  .responsive-layout {
    background-color: #1a1a1a;
  }

  .sidebar {
    background-color: #2d2d2d;
    border-right-color: #404040;
  }

  .content-area {
    background-color: #1a1a1a;
  }

  .section-header {
    border-bottom-color: #404040;
  }

  .section-title {
    color: #e4e7ed;
  }
}

/* 动画和过渡 */
.sidebar {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar-overlay {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 无障碍访问 */
@media (prefers-reduced-motion: reduce) {
  .sidebar,
  .sidebar-overlay {
    transition: none;
    animation: none;
  }
}

/* 高对比度模式 */
@media (prefers-contrast: high) {
  .sidebar {
    border-right: 2px solid;
  }

  .menu-button,
  .user-button {
    border: 1px solid;
  }
}
</style>
