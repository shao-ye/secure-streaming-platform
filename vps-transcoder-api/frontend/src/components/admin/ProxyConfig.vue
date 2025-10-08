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
          v-model="proxyEnabled"
          @change="handleProxyToggle"
          size="large"
          :loading="switchLoading"
        />
      </div>
      
      <!-- 代理状态指示器 -->
      <div v-if="proxyEnabled" class="proxy-status">
        <el-tag 
          :type="getStatusType(connectionStatus)"
          size="small"
        >
          {{ getStatusText(connectionStatus) }}
        </el-tag>
        <span v-if="currentProxy" class="current-proxy">
          当前代理: {{ currentProxy }}
        </span>
      </div>
    </el-card>

    <!-- 代理配置说明 -->
    <el-card class="proxy-info-card" shadow="hover">
      <template #header>
        <span>代理配置说明</span>
      </template>
      
      <div class="proxy-info">
        <p>代理配置功能正在开发中，敬请期待...</p>
        <ul>
          <li>支持 VLESS/XHTTP 协议</li>
          <li>支持 VMess 协议</li>
          <li>支持 Shadowsocks 协议</li>
          <li>智能故障转移</li>
          <li>实时性能监控</li>
        </ul>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

// 响应式数据
const proxyEnabled = ref(false)
const switchLoading = ref(false)
const connectionStatus = ref('disconnected')
const currentProxy = ref(null)

// 获取状态类型
const getStatusType = (status) => {
  switch (status) {
    case 'connected': return 'success'
    case 'connecting': return 'warning'
    case 'disconnected': return 'info'
    case 'error': return 'danger'
    default: return 'info'
  }
}

// 获取状态文本
const getStatusText = (status) => {
  switch (status) {
    case 'connected': return '已连接'
    case 'connecting': return '连接中'
    case 'disconnected': return '未连接'
    case 'error': return '连接错误'
    default: return '未知'
  }
}

// 处理代理开关切换
const handleProxyToggle = async (enabled) => {
  switchLoading.value = true
  try {
    if (enabled) {
      connectionStatus.value = 'connecting'
      // 模拟连接过程
      setTimeout(() => {
        connectionStatus.value = 'connected'
        currentProxy.value = '示例代理节点'
        ElMessage.success('代理已启用')
      }, 2000)
    } else {
      connectionStatus.value = 'disconnected'
      currentProxy.value = null
      ElMessage.info('代理已禁用')
    }
  } catch (error) {
    ElMessage.error('代理切换失败')
    proxyEnabled.value = !enabled
  } finally {
    setTimeout(() => {
      switchLoading.value = false
    }, 2000)
  }
}

// 组件挂载时初始化
onMounted(() => {
  // 初始化数据
})
</script>

<style scoped>
.proxy-config {
  padding: 20px;
}

.proxy-switch-card,
.proxy-info-card {
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
}

.switch-desc {
  margin: 0;
  color: #606266;
  font-size: 14px;
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

.proxy-info p {
  margin-bottom: 16px;
  color: #606266;
}

.proxy-info ul {
  margin: 0;
  padding-left: 20px;
}

.proxy-info li {
  margin-bottom: 8px;
  color: #303133;
}
</style>
