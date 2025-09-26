<template>
  <div class="dashboard">
    <el-container>
      <!-- 顶部导航 -->
      <el-header class="header">
        <div class="header-left">
          <h2>YOYO流媒体平台</h2>
        </div>
        <div class="header-right">
          <span class="welcome-text">欢迎, {{ userStore.user?.username }}</span>
          <el-button 
            v-if="userStore.isAdmin" 
            type="primary" 
            :icon="Setting"
            @click="$router.push('/admin')"
          >
            管理后台
          </el-button>
          <el-button 
            type="danger" 
            :icon="SwitchButton"
            @click="handleLogout"
          >
            退出登录
          </el-button>
        </div>
      </el-header>

      <el-container>
        <!-- 侧边栏 -->
        <el-aside width="300px" class="aside">
          <div class="stream-list-container">
            <div class="stream-list-header">
              <h3>频道列表</h3>
              <el-button 
                :icon="Refresh"
                @click="refreshStreams"
                :loading="streamsStore.loading"
                circle
              />
            </div>
            <StreamList @stream-select="handleStreamSelect" />
          </div>
        </el-aside>

        <!-- 主内容区 -->
        <el-main class="main">
          <div class="player-container">
            <VideoPlayer 
              v-if="currentHlsUrl"
              :hls-url="currentHlsUrl"
              :stream-name="currentStreamName"
              @error="handlePlayerError"
            />
            <div v-else class="empty-player">
              <el-empty 
                description="请从左侧选择一个频道开始观看"
                :image-size="200"
              />
            </div>
          </div>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting, SwitchButton, Refresh } from '@element-plus/icons-vue'
import { useUserStore } from '../stores/user'
import { useStreamsStore } from '../stores/streams'
import StreamList from '../components/StreamList.vue'
import VideoPlayer from '../components/VideoPlayer.vue'

const router = useRouter()
const userStore = useUserStore()
const streamsStore = useStreamsStore()

const currentHlsUrl = ref('')
const currentStreamName = ref('')

const handleStreamSelect = async (stream) => {
  try {
    const hlsUrl = await streamsStore.playStream(stream.id)
    currentHlsUrl.value = hlsUrl
    currentStreamName.value = stream.name
    ElMessage.success(`正在播放: ${stream.name}`)
  } catch (error) {
    ElMessage.error(error.message || '播放失败')
  }
}

const handlePlayerError = (error) => {
  ElMessage.error('视频播放出错: ' + error.message)
  currentHlsUrl.value = ''
  currentStreamName.value = ''
}

const refreshStreams = () => {
  streamsStore.fetchStreams()
}

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await userStore.logout()
    ElMessage.success('已退出登录')
    router.push('/login')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('退出登录失败')
    }
  }
}

onMounted(() => {
  streamsStore.fetchStreams()
})
</script>

<style scoped>
.dashboard {
  height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 20px;
}

.header-left h2 {
  margin: 0;
  color: #303133;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.welcome-text {
  color: #606266;
  font-size: 14px;
}

.aside {
  background-color: #f5f5f5;
  border-right: 1px solid #e4e7ed;
  padding: 0;
}

.stream-list-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.stream-list-header {
  padding: 20px;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #fff;
}

.stream-list-header h3 {
  margin: 0;
  color: #303133;
}

.main {
  padding: 0;
}

.player-container {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-player {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #fafafa;
}

@media (max-width: 768px) {
  .aside {
    width: 250px !important;
  }

  .header-right {
    gap: 10px;
  }

  .welcome-text {
    display: none;
  }
}
</style>
