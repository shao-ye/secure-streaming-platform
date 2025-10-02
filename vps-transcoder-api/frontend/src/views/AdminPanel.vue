<template>
  <div class="admin-panel">
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <h2>管理后台</h2>
        </div>
        <div class="header-right">
          <el-button @click="$router.push('/')">
            <el-icon><Back /></el-icon>
            返回主页
          </el-button>
          <el-button type="danger" @click="handleLogout">
            <el-icon><SwitchButton /></el-icon>
            退出登录
          </el-button>
        </div>
      </el-header>

      <el-main>
        <el-tabs v-model="activeTab" class="admin-tabs">
          <el-tab-pane label="频道管理" name="streams">
            <StreamManager />
          </el-tab-pane>

          <el-tab-pane label="系统状态" name="system">
            <div class="system-status">
              <el-alert
                title="系统运行正常"
                type="success"
                :closable="false"
                show-icon
              />
              <div class="status-cards">
                <el-card class="status-card">
                  <div class="status-item">
                    <div class="status-value">{{ streamsStore.streams.length }}</div>
                    <div class="status-label">频道总数</div>
                  </div>
                </el-card>

                <el-card class="status-card">
                  <div class="status-item">
                    <div class="status-value">1</div>
                    <div class="status-label">在线用户</div>
                  </div>
                </el-card>

                <el-card class="status-card">
                  <div class="status-item">
                    <div class="status-value">{{ streamsStore.currentStream ? 1 : 0 }}</div>
                    <div class="status-label">活跃播放</div>
                  </div>
                </el-card>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="系统诊断" name="diagnostics">
            <SystemDiagnostics />
          </el-tab-pane>
        </el-tabs>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Back, SwitchButton } from '@element-plus/icons-vue'
import { useUserStore } from '../stores/user'
import { useStreamsStore } from '../stores/streams'
import StreamManager from '../components/StreamManager.vue'
import SystemDiagnostics from '../components/SystemDiagnostics.vue'

const router = useRouter()
const userStore = useUserStore()
const streamsStore = useStreamsStore()

const activeTab = ref('streams')

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
  // 检查管理员权限
  if (!userStore.isAdmin) {
    ElMessage.error('没有管理员权限')
    router.push('/')
    return
  }

  streamsStore.fetchAdminStreams()
})
</script>

<style scoped>
.admin-panel {
  height: 100vh;
  background-color: #f0f2f5;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 20px;
  flex-shrink: 0;
}

.header-left h2 {
  margin: 0;
  color: #303133;
}

.header-right {
  display: flex;
  gap: 10px;
}

.el-main {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.admin-tabs {
  background-color: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  height: 100%;
}

.admin-tabs :deep(.el-tabs__content) {
  height: calc(100vh - 200px);
  overflow-y: auto;
}

.system-status {
  padding: 20px 0;
}

.status-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.status-card {
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.status-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.status-item {
  padding: 20px;
}

.status-value {
  font-size: 36px;
  font-weight: bold;
  color: #409eff;
  margin-bottom: 8px;
}

.status-label {
  font-size: 14px;
  color: #666;
}

@media (max-width: 768px) {
  .header-right {
    gap: 8px;
  }

  .status-cards {
    grid-template-columns: 1fr;
  }

  .admin-tabs {
    padding: 15px;
  }
}
</style>
