<template>
  <div class="proxy-monitor">
    <!-- 连接状态 -->
    <div class="status-section">
      <h4>连接状态</h4>
      <div class="status-grid">
        <div class="status-item">
          <span class="label">当前状态:</span>
          <el-tag :type="getStatusType(status.connectionStatus)" size="small">
            {{ getStatusText(status.connectionStatus) }}
          </el-tag>
        </div>
        <div class="status-item">
          <span class="label">当前代理:</span>
          <span class="value">{{ status.currentProxy || '无' }}</span>
        </div>
        <div class="status-item">
          <span class="label">最后更新:</span>
          <span class="value">{{ formatTime(status.lastUpdate) }}</span>
        </div>
        <div class="status-item">
          <span class="label">运行时长:</span>
          <span class="value">{{ formatUptime(status.uptime) }}</span>
        </div>
      </div>
    </div>

    <!-- 性能统计 -->
    <div class="stats-section" v-if="status.stats">
      <h4>性能统计</h4>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ status.stats.latency || 0 }}ms</div>
          <div class="stat-label">延迟</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ formatBytes(status.stats.bytesTransferred || 0) }}</div>
          <div class="stat-label">传输量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ status.stats.connectionsCount || 0 }}</div>
          <div class="stat-label">连接数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ status.stats.successRate || 0 }}%</div>
          <div class="stat-label">成功率</div>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="actions-section">
      <el-button @click="handleRefresh" :loading="refreshing" size="small">
        刷新状态
      </el-button>
      <el-button 
        v-if="enabled && status.connectionStatus === 'connected'" 
        @click="handleDisconnect" 
        type="warning" 
        size="small"
      >
        断开连接
      </el-button>
      <el-button 
        v-if="enabled && status.connectionStatus === 'disconnected'" 
        @click="handleConnect" 
        type="primary" 
        size="small"
      >
        重新连接
      </el-button>
    </div>

    <!-- 日志输出 -->
    <div class="logs-section" v-if="status.logs && status.logs.length > 0">
      <h4>
        最近日志
        <el-button @click="clearLogs" type="text" size="small">清空</el-button>
      </h4>
      <div class="logs-container">
        <div 
          v-for="(log, index) in status.logs.slice(-10)" 
          :key="index"
          :class="['log-item', `log-${log.level}`]"
        >
          <span class="log-time">{{ formatTime(log.timestamp) }}</span>
          <span class="log-level">{{ log.level.toUpperCase() }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  status: {
    type: Object,
    default: () => ({
      connectionStatus: 'disconnected',
      currentProxy: null,
      lastUpdate: null,
      uptime: 0,
      stats: null,
      logs: []
    })
  },
  enabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['refresh', 'connect', 'disconnect'])

const refreshing = ref(false)

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

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return '无'
  return new Date(timestamp).toLocaleString('zh-CN')
}

// 格式化运行时长
const formatUptime = (seconds) => {
  if (!seconds) return '0秒'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟${secs}秒`
  } else {
    return `${secs}秒`
  }
}

// 格式化字节数
const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`
}

// 刷新状态
const handleRefresh = async () => {
  refreshing.value = true
  try {
    emit('refresh')
    ElMessage.success('状态已刷新')
  } catch (error) {
    ElMessage.error('刷新失败')
  } finally {
    setTimeout(() => {
      refreshing.value = false
    }, 1000)
  }
}

// 连接代理
const handleConnect = () => {
  emit('connect')
}

// 断开代理
const handleDisconnect = () => {
  emit('disconnect')
}

// 清空日志
const clearLogs = () => {
  // 这里可以发送清空日志的请求
  ElMessage.success('日志已清空')
}
</script>

<style scoped>
.proxy-monitor {
  padding: 16px;
}

.status-section,
.stats-section,
.actions-section,
.logs-section {
  margin-bottom: 24px;
}

.status-section h4,
.stats-section h4,
.logs-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-item .label {
  font-size: 13px;
  color: #606266;
  min-width: 70px;
}

.status-item .value {
  font-size: 13px;
  color: #303133;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 16px;
}

.stat-card {
  text-align: center;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.actions-section {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.logs-section h4 {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logs-container {
  max-height: 200px;
  overflow-y: auto;
  background: #f8f9fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 8px;
}

.log-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  font-family: 'Courier New', monospace;
}

.log-time {
  color: #909399;
  min-width: 80px;
}

.log-level {
  min-width: 50px;
  font-weight: 600;
}

.log-level.log-info {
  color: #409eff;
}

.log-level.log-warn {
  color: #e6a23c;
}

.log-level.log-error {
  color: #f56c6c;
}

.log-message {
  color: #303133;
  flex: 1;
}
</style>
