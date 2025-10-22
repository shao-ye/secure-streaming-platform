<template>
  <div class="ip-optimizer-panel">
    <div class="panel-header">
      <h3>🚀 Cloudflare IP优选</h3>
      <span class="status-badge" :class="statusClass">
        {{ statusText }}
      </span>
    </div>

    <div class="panel-content">
      <!-- 优选状态 -->
      <div class="status-section">
        <div class="status-item">
          <span class="label">优选功能:</span>
          <span class="value">{{ status.enabled ? '✅ 已启用' : '❌ 已禁用' }}</span>
        </div>
        <div class="status-item" v-if="status.optimizedIP">
          <span class="label">优选IP:</span>
          <span class="value ip-address">{{ status.optimizedIP }}</span>
        </div>
        <div class="status-item">
          <span class="label">访问域名:</span>
          <span class="value">{{ status.hostname }}</span>
        </div>
        <div class="status-item">
          <span class="label">当前URL:</span>
          <span class="value url">{{ status.currentBaseURL }}</span>
        </div>
      </div>

      <!-- 统计信息 -->
      <div class="stats-section" v-if="status.stats">
        <div class="stat-item">
          <span class="stat-label">IP池大小</span>
          <span class="stat-value">{{ status.stats.totalIPs }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">缓存状态</span>
          <span class="stat-value">{{ status.stats.cacheValid ? '有效' : '无效' }}</span>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <button 
          @click="toggleOptimization" 
          class="btn"
          :class="status.enabled ? 'btn-warning' : 'btn-primary'"
        >
          {{ status.enabled ? '禁用优选' : '启用优选' }}
        </button>
        <button 
          @click="refreshIP" 
          class="btn btn-secondary"
          :disabled="!status.enabled || refreshing"
        >
          {{ refreshing ? '刷新中...' : '刷新IP' }}
        </button>
        <button 
          @click="testConnection" 
          class="btn btn-info"
          :disabled="testing"
        >
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
      </div>

      <!-- 测试结果 -->
      <div class="test-result" v-if="testResult">
        <div class="result-item" :class="testResult.success ? 'success' : 'error'">
          <strong>{{ testResult.success ? '✅ 连接成功' : '❌ 连接失败' }}</strong>
          <p v-if="testResult.latency">延迟: {{ testResult.latency }}ms</p>
          <p v-if="testResult.error" class="error-msg">{{ testResult.error }}</p>
        </div>
      </div>

      <!-- 说明文字 -->
      <div class="info-box">
        <p>💡 IP优选可以自动选择最快的Cloudflare节点，优化国内访问速度</p>
        <p>📌 优选结果会缓存15分钟，自动在后台刷新</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useApiService } from '../services/api'

const apiService = useApiService()

const status = ref({
  enabled: false,
  optimizedIP: null,
  hostname: '',
  currentBaseURL: '',
  stats: null
})

const refreshing = ref(false)
const testing = ref(false)
const testResult = ref(null)

const statusClass = computed(() => {
  if (!status.value.enabled) return 'status-disabled'
  if (status.value.optimizedIP) return 'status-active'
  return 'status-pending'
})

const statusText = computed(() => {
  if (!status.value.enabled) return '已禁用'
  if (status.value.optimizedIP) return '运行中'
  return '初始化中'
})

// 更新状态
function updateStatus() {
  status.value = apiService.getIPOptimizationStatus()
}

// 切换优选功能
function toggleOptimization() {
  apiService.setIPOptimization(!status.value.enabled)
  updateStatus()
}

// 刷新IP
async function refreshIP() {
  refreshing.value = true
  testResult.value = null
  try {
    await apiService.refreshOptimizedIP()
    updateStatus()
    testResult.value = {
      success: true,
      message: 'IP优选刷新成功'
    }
  } catch (error) {
    testResult.value = {
      success: false,
      error: error.message
    }
  } finally {
    refreshing.value = false
  }
}

// 测试连接
async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const start = performance.now()
    const response = await apiService.request('/health')
    const latency = Math.round(performance.now() - start)
    
    testResult.value = {
      success: response.status === 200,
      latency,
      message: '连接测试成功'
    }
  } catch (error) {
    testResult.value = {
      success: false,
      error: error.message
    }
  } finally {
    testing.value = false
  }
}

onMounted(() => {
  updateStatus()
  // 每30秒更新一次状态
  setInterval(updateStatus, 30000)
})
</script>

<style scoped>
.ip-optimizer-panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 2px solid #f0f0f0;
}

.panel-header h3 {
  margin: 0;
  color: #333;
  font-size: 18px;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.status-active {
  background: #d4edda;
  color: #155724;
}

.status-disabled {
  background: #f8d7da;
  color: #721c24;
}

.status-pending {
  background: #fff3cd;
  color: #856404;
}

.status-section {
  margin-bottom: 20px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}

.status-item:last-child {
  border-bottom: none;
}

.label {
  color: #666;
  font-weight: 500;
}

.value {
  color: #333;
  font-family: monospace;
}

.ip-address {
  color: #007bff;
  font-weight: 600;
}

.url {
  font-size: 12px;
  color: #28a745;
}

.stats-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 6px;
}

.stat-item {
  text-align: center;
}

.stat-label {
  display: block;
  color: #666;
  font-size: 12px;
  margin-bottom: 5px;
}

.stat-value {
  display: block;
  color: #333;
  font-size: 20px;
  font-weight: 600;
}

.action-buttons {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.btn {
  flex: 1;
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0056b3;
}

.btn-warning {
  background: #ffc107;
  color: #333;
}

.btn-warning:hover:not(:disabled) {
  background: #e0a800;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-secondary:hover:not(:disabled) {
  background: #545b62;
}

.btn-info {
  background: #17a2b8;
  color: white;
}

.btn-info:hover:not(:disabled) {
  background: #117a8b;
}

.test-result {
  margin-bottom: 20px;
}

.result-item {
  padding: 15px;
  border-radius: 6px;
  margin-bottom: 10px;
}

.result-item.success {
  background: #d4edda;
  border: 1px solid #c3e6cb;
  color: #155724;
}

.result-item.error {
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
}

.result-item strong {
  display: block;
  margin-bottom: 5px;
}

.result-item p {
  margin: 5px 0;
  font-size: 14px;
}

.error-msg {
  color: #a94442;
  font-family: monospace;
  font-size: 12px;
}

.info-box {
  background: #e7f3ff;
  border-left: 4px solid #007bff;
  padding: 15px;
  border-radius: 4px;
}

.info-box p {
  margin: 5px 0;
  color: #004085;
  font-size: 13px;
}
</style>
