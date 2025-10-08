<template>
  <div class="proxy-config">
    <!-- 代理功能总开关 -->
    <el-card class="proxy-switch-card" shadow="hover">
      <div class="switch-header">
        <div class="switch-info">
          <h3>代理功能</h3>
          <p class="switch-desc">启用代理功能可以改善中国大陆地区的视频播放体验</p>
        </div>
        <el-switch 
          v-model="proxySettings.enabled"
          @change="handleProxyToggle"
          size="large"
          :loading="switchLoading"
        />
      </div>
      
      <!-- 代理状态指示器 -->
      <div v-if="proxySettings.enabled" class="proxy-status">
        <el-tag 
          :type="getStatusType(proxyStatus.connectionStatus)"
          size="small"
        >
          {{ getStatusText(proxyStatus.connectionStatus) }}
        </el-tag>
        <span v-if="proxyStatus.currentProxy" class="current-proxy">
          当前代理: {{ getCurrentProxyName() }}
        </span>
      </div>
    </el-card>

    <!-- 代理列表 -->
    <el-card class="proxy-list-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>代理配置列表</span>
          <el-button 
            type="primary" 
            @click="showAddDialog = true"
            :icon="Plus"
            size="small"
          >
            添加代理
          </el-button>
        </div>
      </template>
      
      <ProxyList 
        :proxies="proxies"
        :active-proxy="proxySettings.activeProxyId"
        :loading="loading"
        @edit="handleEditProxy"
        @delete="handleDeleteProxy"
        @activate="handleActivateProxy"
        @test="handleTestProxy"
      />
    </el-card>

    <!-- 代理监控面板 -->
    <el-card v-if="proxySettings.enabled" class="proxy-monitor-card" shadow="hover">
      <template #header>
        <span>代理监控</span>
      </template>
      
      <ProxyMonitor 
        :status="proxyStatus"
        :enabled="proxySettings.enabled"
        @refresh="refreshProxyStatus"
      />
    </el-card>

    <!-- 添加/编辑代理对话框 -->
    <ProxyForm
      v-model:visible="showAddDialog"
      :mode="formMode"
      :proxy-data="currentProxy"
      @submit="handleProxySubmit"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useProxyManagementStore } from '../../stores/proxyManagement'
import ProxyList from './ProxyList.vue'
import ProxyForm from './ProxyForm.vue'
import ProxyMonitor from './ProxyMonitor.vue'

const proxyManagementStore = useProxyManagementStore()

// 响应式数据
const loading = ref(false)
const switchLoading = ref(false)
const showAddDialog = ref(false)
const formMode = ref('create')
const currentProxy = ref(null)

// 计算属性
const proxies = computed(() => proxyManagementStore.proxies)
const proxySettings = computed(() => proxyManagementStore.proxySettings)
const proxyStatus = computed(() => proxyManagementStore.proxyStatus)

// 获取当前代理名称
const getCurrentProxyName = () => {
  const currentProxyId = proxyStatus.value.currentProxy
  const proxy = proxies.value.find(p => p.id === currentProxyId)
  return proxy ? proxy.name : '未知'
}

// 获取状态类型
const getStatusType = (status) => {
  const statusMap = {
    'connected': 'success',
    'connecting': 'warning',
    'disconnected': 'info',
    'error': 'danger'
  }
  return statusMap[status] || 'info'
}

// 获取状态文本
const getStatusText = (status) => {
  const statusMap = {
    'connected': '已连接',
    'connecting': '连接中',
    'disconnected': '未连接',
    'error': '连接错误'
  }
  return statusMap[status] || '未知状态'
}

// 处理代理开关切换
const handleProxyToggle = async (enabled) => {
  switchLoading.value = true
  try {
    await proxyManagementStore.updateProxySettings({ enabled })
    ElMessage.success(enabled ? '代理功能已启用' : '代理功能已禁用')
    
    if (enabled) {
      // 启用代理时刷新状态
      await refreshProxyStatus()
    }
  } catch (error) {
    ElMessage.error('代理设置更新失败: ' + error.message)
    // 恢复开关状态
    proxyManagementStore.proxySettings.enabled = !enabled
  } finally {
    switchLoading.value = false
  }
}

// 处理编辑代理
const handleEditProxy = (proxy) => {
  currentProxy.value = { ...proxy }
  formMode.value = 'edit'
  showAddDialog.value = true
}

// 处理删除代理
const handleDeleteProxy = async (proxy) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除代理 "${proxy.name}" 吗？此操作不可恢复。`,
      '删除代理',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )

    await proxyManagementStore.deleteProxy(proxy.id)
    ElMessage.success('代理删除成功')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除代理失败: ' + error.message)
    }
  }
}

// 处理激活代理
const handleActivateProxy = async (proxy) => {
  try {
    await proxyManagementStore.updateProxySettings({ 
      activeProxyId: proxy.id 
    })
    ElMessage.success(`已切换到代理: ${proxy.name}`)
    await refreshProxyStatus()
  } catch (error) {
    ElMessage.error('切换代理失败: ' + error.message)
  }
}

// 处理测试代理
const handleTestProxy = async (proxy) => {
  try {
    const result = await proxyManagementStore.testProxy(proxy.id)
    if (result.success) {
      ElMessage.success(`代理测试成功，延迟: ${result.latency}ms`)
    } else {
      ElMessage.error(`代理测试失败: ${result.error}`)
    }
  } catch (error) {
    ElMessage.error('代理测试失败: ' + error.message)
  }
}

// 处理代理表单提交
const handleProxySubmit = async (proxyData) => {
  try {
    if (formMode.value === 'create') {
      await proxyManagementStore.addProxy(proxyData)
      ElMessage.success('代理添加成功')
    } else {
      await proxyManagementStore.updateProxy(currentProxy.value.id, proxyData)
      ElMessage.success('代理更新成功')
    }
    
    showAddDialog.value = false
    currentProxy.value = null
    formMode.value = 'create'
  } catch (error) {
    ElMessage.error('操作失败: ' + error.message)
  }
}

// 刷新代理状态
const refreshProxyStatus = async () => {
  try {
    await proxyManagementStore.fetchProxyStatus()
  } catch (error) {
    console.warn('刷新代理状态失败:', error)
  }
}

// 初始化数据
const initializeData = async () => {
  loading.value = true
  try {
    await proxyManagementStore.fetchProxyConfig()
    if (proxySettings.value.enabled) {
      await refreshProxyStatus()
    }
  } catch (error) {
    ElMessage.error('加载代理配置失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 组件挂载时初始化
onMounted(() => {
  initializeData()
  
  // 定期刷新代理状态
  const statusInterval = setInterval(() => {
    if (proxySettings.value.enabled) {
      refreshProxyStatus()
    }
  }, 30000) // 每30秒刷新一次
  
  // 组件卸载时清理定时器
  onBeforeUnmount(() => {
    clearInterval(statusInterval)
  })
})
</script>

<style scoped>
.proxy-config {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.proxy-switch-card {
  margin-bottom: 20px;
}

.switch-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.switch-info h3 {
  margin: 0 0 8px 0;
  color: #303133;
  font-size: 18px;
  font-weight: 600;
}

.switch-desc {
  margin: 0;
  color: #606266;
  font-size: 14px;
  line-height: 1.4;
}

.proxy-status {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  gap: 12px;
}

.current-proxy {
  color: #606266;
  font-size: 14px;
}

.proxy-list-card,
.proxy-monitor-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

:deep(.el-card__body) {
  padding: 20px;
}

:deep(.el-switch__core) {
  width: 50px;
  height: 24px;
}

:deep(.el-switch.is-checked .el-switch__core) {
  background-color: #67c23a;
}
</style>
