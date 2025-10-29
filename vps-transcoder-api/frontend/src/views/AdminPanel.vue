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
        <el-tabs v-model="activeTab" class="admin-tabs" @tab-change="handleTabChange">
          <el-tab-pane label="频道管理" name="streams">
            <StreamManager v-if="loadedTabs.has('streams')" />
          </el-tab-pane>

          <el-tab-pane label="用户管理" name="users">
            <UserManager v-if="loadedTabs.has('users')" />
          </el-tab-pane>

          <el-tab-pane label="系统诊断" name="diagnostics">
            <SystemDiagnostics v-if="loadedTabs.has('diagnostics')" />
          </el-tab-pane>

          <el-tab-pane label="隧道优化" name="tunnel">
            <TunnelConfig v-if="loadedTabs.has('tunnel')" />
          </el-tab-pane>

          <el-tab-pane label="代理配置" name="proxy">
            <ProxyConfig v-if="loadedTabs.has('proxy')" />
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
import UserManager from '../components/UserManager.vue'
import SystemDiagnostics from '../components/SystemDiagnostics.vue'
import TunnelConfig from '../components/admin/TunnelConfig.vue'
import ProxyConfig from '../components/admin/ProxyConfig.vue'

const router = useRouter()
const userStore = useUserStore()
const streamsStore = useStreamsStore()

const activeTab = ref('streams')
const loadedTabs = ref(new Set(['streams'])) // 默认加载频道管理标签页

const handleTabChange = (tabName) => {
  // 当切换到新标签页时，将其添加到已加载的标签页集合中
  if (!loadedTabs.value.has(tabName)) {
    loadedTabs.value.add(tabName)
    console.log(`懒加载标签页: ${tabName}`)
  }
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

@media (max-width: 768px) {
  .header {
    padding: 0 15px;
    flex-direction: column;
    gap: 10px;
    height: auto;
    min-height: 60px;
  }
  
  .header-left h2 {
    font-size: 18px;
    margin: 10px 0 5px 0;
  }
  
  .header-right {
    gap: 8px;
    width: 100%;
    justify-content: center;
  }
  
  .header-right .el-button {
    flex: 1;
    max-width: 120px;
  }

  .el-main {
    padding: 10px;
  }

  .admin-tabs {
    padding: 10px;
  }
  
  .admin-tabs :deep(.el-tabs__content) {
    height: calc(100vh - 180px);
  }
  
  /* 移动端标签页优化 */
  .admin-tabs :deep(.el-tabs__header) {
    margin: 0 0 15px 0;
  }
  
  .admin-tabs :deep(.el-tabs__item) {
    padding: 0 15px;
    font-size: 14px;
  }
}
</style>
