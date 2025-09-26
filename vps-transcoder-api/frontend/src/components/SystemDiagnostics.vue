<template>
  <div class="system-diagnostics">
    <!-- 系统状态概览 -->
    <el-row :gutter="20" class="status-overview">
      <el-col :span="6">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="32" color="#67c23a">
                <CircleCheck />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ systemStatus.status }}</div>
              <div class="status-label">系统状态</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="32" color="#409eff">
                <DataBoard />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ cacheStats.totalKeys || 0 }}</div>
              <div class="status-label">缓存条目</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="32" color="#e6a23c">
                <Monitor />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ vpsStatus.status || 'Unknown' }}</div>
              <div class="status-label">VPS状态</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="6">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="32" color="#f56c6c">
                <Clock />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ formatUptime(systemStatus.uptime) }}</div>
              <div class="status-label">运行时间</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 操作按钮 -->
    <el-row :gutter="20" class="action-buttons">
      <el-col :span="24">
        <el-card shadow="never">
          <template #header>
            <h3>系统操作</h3>
          </template>
          <div class="button-group">
            <el-button
              type="primary"
              :icon="Refresh"
              @click="refreshSystemStatus"
              :loading="loading.system"
            >
              刷新状态
            </el-button>
            <el-button
              type="warning"
              :icon="Delete"
              @click="clearCache"
              :loading="loading.cache"
            >
              清理缓存
            </el-button>
            <el-button
              type="info"
              :icon="Download"
              @click="reloadStreamsConfig"
              :loading="loading.config"
            >
              重载配置
            </el-button>
            <el-button
              type="success"
              :icon="Monitor"
              @click="checkVpsHealth"
              :loading="loading.vps"
            >
              VPS健康检查
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 详细信息 -->
    <el-row :gutter="20">
      <!-- 缓存统计 -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <h3>缓存统计</h3>
              <el-button
                size="small"
                :icon="Refresh"
                @click="refreshCacheStats"
                :loading="loading.cacheStats"
              />
            </div>
          </template>

          <div v-if="cacheStats.totalKeys > 0">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="总条目数">
                {{ cacheStats.totalKeys }}
              </el-descriptions-item>
              <el-descriptions-item label="命中率">
                {{ cacheStats.hitRate ? (cacheStats.hitRate * 100).toFixed(2) + '%' : 'N/A' }}
              </el-descriptions-item>
              <el-descriptions-item label="总命中数">
                {{ cacheStats.hits || 0 }}
              </el-descriptions-item>
              <el-descriptions-item label="总未命中数">
                {{ cacheStats.misses || 0 }}
              </el-descriptions-item>
              <el-descriptions-item label="内存使用">
                {{ formatBytes(cacheStats.memoryUsage || 0) }}
              </el-descriptions-item>
              <el-descriptions-item label="最后更新">
                {{ formatTime(cacheStats.lastUpdated) }}
              </el-descriptions-item>
            </el-descriptions>

            <!-- 缓存键列表 -->
            <div class="cache-keys" v-if="cacheStats.keys && cacheStats.keys.length > 0">
              <h4>缓存键列表</h4>
              <el-tag
                v-for="key in cacheStats.keys.slice(0, 10)"
                :key="key"
                size="small"
                class="cache-key-tag"
              >
                {{ key }}
              </el-tag>
              <el-tag v-if="cacheStats.keys.length > 10" size="small" type="info">
                +{{ cacheStats.keys.length - 10 }} more...
              </el-tag>
            </div>
          </div>

          <el-empty v-else description="暂无缓存数据" />
        </el-card>
      </el-col>

      <!-- 系统诊断 -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <h3>系统诊断</h3>
              <el-button
                size="small"
                :icon="Refresh"
                @click="runDiagnostics"
                :loading="loading.diagnostics"
              />
            </div>
          </template>

          <div v-if="diagnostics.checks && diagnostics.checks.length > 0">
            <div
              v-for="check in diagnostics.checks"
              :key="check.name"
              class="diagnostic-item"
            >
              <div class="diagnostic-header">
                <el-icon
                  :color="check.status === 'ok' ? '#67c23a' : '#f56c6c'"
                  size="16"
                >
                  <CircleCheck v-if="check.status === 'ok'" />
                  <CircleClose v-else />
                </el-icon>
                <span class="diagnostic-name">{{ check.name }}</span>
                <el-tag
                  :type="check.status === 'ok' ? 'success' : 'danger'"
                  size="small"
                >
                  {{ check.status }}
                </el-tag>
              </div>
              <div class="diagnostic-details" v-if="check.details">
                <el-text size="small" type="info">{{ check.details }}</el-text>
              </div>
              <div class="diagnostic-error" v-if="check.error">
                <el-text size="small" type="danger">{{ check.error }}</el-text>
              </div>
            </div>
          </div>

          <el-empty v-else description="点击刷新按钮运行诊断" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 日志查看器 -->
    <el-row>
      <el-col :span="24">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <h3>系统日志</h3>
              <div>
                <el-button
                  size="small"
                  :icon="Refresh"
                  @click="refreshLogs"
                  :loading="loading.logs"
                />
                <el-button
                  size="small"
                  :icon="Delete"
                  @click="clearLogs"
                  type="danger"
                />
              </div>
            </div>
          </template>

          <div class="log-viewer">
            <div
              v-for="(log, index) in logs"
              :key="index"
              class="log-entry"
              :class="'log-' + log.level"
            >
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <span class="log-level">{{ log.level.toUpperCase() }}</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
            <div v-if="logs.length === 0" class="no-logs">
              <el-text type="info">暂无日志记录</el-text>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  CircleClose,
  DataBoard,
  Monitor,
  Clock,
  Refresh,
  Delete,
  Download
} from '@element-plus/icons-vue'
import axios from '../utils/axios'
import { debugLog, errorLog, infoLog } from '../utils/config'

// 响应式数据
const systemStatus = reactive({
  status: 'Unknown',
  uptime: 0,
  lastCheck: null
})

const cacheStats = reactive({
  totalKeys: 0,
  hits: 0,
  misses: 0,
  hitRate: 0,
  memoryUsage: 0,
  keys: [],
  lastUpdated: null
})

const vpsStatus = reactive({
  status: 'Unknown',
  lastCheck: null,
  responseTime: 0
})

const diagnostics = reactive({
  checks: [],
  lastRun: null
})

const logs = ref([])

const loading = reactive({
  system: false,
  cache: false,
  config: false,
  vps: false,
  cacheStats: false,
  diagnostics: false,
  logs: false
})

// 定时器
let statusTimer = null

// 工具函数
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const formatTime = (timestamp) => {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString('zh-CN')
}

const formatUptime = (seconds) => {
  if (!seconds) return 'N/A'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days}天 ${hours}小时 ${minutes}分钟`
}

// API调用方法
const refreshSystemStatus = async () => {
  loading.system = true
  try {
    const response = await axios.get('/api/admin/system/status')
    if (response.data.status === 'success') {
      Object.assign(systemStatus, response.data.data)
      infoLog('系统状态刷新成功')
    }
  } catch (error) {
    errorLog('获取系统状态失败:', error)
    ElMessage.error('获取系统状态失败')
  } finally {
    loading.system = false
  }
}

const refreshCacheStats = async () => {
  loading.cacheStats = true
  try {
    const response = await axios.get('/api/admin/cache/stats')
    if (response.data.status === 'success') {
      Object.assign(cacheStats, response.data.data)
      infoLog('缓存统计刷新成功')
    }
  } catch (error) {
    errorLog('获取缓存统计失败:', error)
    ElMessage.error('获取缓存统计失败')
  } finally {
    loading.cacheStats = false
  }
}

const clearCache = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清理所有缓存吗？这将影响系统性能。',
      '确认清理缓存',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    loading.cache = true
    const response = await axios.post('/api/admin/cache/clear')

    if (response.data.status === 'success') {
      ElMessage.success('缓存清理成功')
      await refreshCacheStats()
    }
  } catch (error) {
    if (error !== 'cancel') {
      errorLog('清理缓存失败:', error)
      ElMessage.error('清理缓存失败')
    }
  } finally {
    loading.cache = false
  }
}

const reloadStreamsConfig = async () => {
  loading.config = true
  try {
    const response = await axios.post('/api/admin/streams/reload')
    if (response.data.status === 'success') {
      ElMessage.success('配置重载成功')
    }
  } catch (error) {
    errorLog('重载配置失败:', error)
    ElMessage.error('重载配置失败')
  } finally {
    loading.config = false
  }
}

const checkVpsHealth = async () => {
  loading.vps = true
  try {
    const response = await axios.get('/api/admin/vps/health')
    if (response.data.status === 'success') {
      Object.assign(vpsStatus, response.data.data)
      ElMessage.success('VPS健康检查完成')
    }
  } catch (error) {
    errorLog('VPS健康检查失败:', error)
    ElMessage.error('VPS健康检查失败')
  } finally {
    loading.vps = false
  }
}

const runDiagnostics = async () => {
  loading.diagnostics = true
  try {
    const response = await axios.get('/api/admin/diagnostics')
    if (response.data.status === 'success') {
      diagnostics.checks = response.data.data.checks || []
      diagnostics.lastRun = new Date().toISOString()
      infoLog('系统诊断完成')
    }
  } catch (error) {
    errorLog('系统诊断失败:', error)
    ElMessage.error('系统诊断失败')
  } finally {
    loading.diagnostics = false
  }
}

const refreshLogs = async () => {
  loading.logs = true
  try {
    // 模拟日志数据，实际应该从后端获取
    logs.value = [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: '系统启动完成'
      },
      {
        timestamp: new Date(Date.now() - 60000).toISOString(),
        level: 'warn',
        message: '缓存命中率较低'
      },
      {
        timestamp: new Date(Date.now() - 120000).toISOString(),
        level: 'error',
        message: 'VPS连接超时'
      }
    ]
  } catch (error) {
    errorLog('获取日志失败:', error)
    ElMessage.error('获取日志失败')
  } finally {
    loading.logs = false
  }
}

const clearLogs = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清理所有日志吗？',
      '确认清理日志',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    logs.value = []
    ElMessage.success('日志清理成功')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('清理日志失败')
    }
  }
}

// 初始化数据
const initData = async () => {
  await Promise.all([
    refreshSystemStatus(),
    refreshCacheStats(),
    checkVpsHealth(),
    runDiagnostics(),
    refreshLogs()
  ])
}

// 启动定时刷新
const startAutoRefresh = () => {
  statusTimer = setInterval(() => {
    refreshSystemStatus()
    refreshCacheStats()
  }, 30000) // 30秒刷新一次
}

// 停止定时刷新
const stopAutoRefresh = () => {
  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }
}

onMounted(() => {
  debugLog('SystemDiagnostics组件挂载')
  initData()
  startAutoRefresh()
})

onUnmounted(() => {
  debugLog('SystemDiagnostics组件卸载')
  stopAutoRefresh()
})
</script>

<style scoped>
.system-diagnostics {
  padding: 20px 0;
}

.status-overview {
  margin-bottom: 20px;
}

.status-card {
  cursor: pointer;
  transition: all 0.3s ease;
}

.status-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.status-item {
  display: flex;
  align-items: center;
  padding: 20px;
}

.status-icon {
  margin-right: 15px;
}

.status-info {
  flex: 1;
}

.status-value {
  font-size: 24px;
  font-weight: bold;
  color: #303133;
  margin-bottom: 5px;
}

.status-label {
  font-size: 14px;
  color: #909399;
}

.action-buttons {
  margin-bottom: 20px;
}

.button-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
}

.cache-keys {
  margin-top: 20px;
}

.cache-keys h4 {
  margin-bottom: 10px;
  color: #303133;
}

.cache-key-tag {
  margin: 2px 4px 2px 0;
}

.diagnostic-item {
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.diagnostic-item:last-child {
  border-bottom: none;
}

.diagnostic-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.diagnostic-name {
  flex: 1;
  font-weight: 500;
}

.diagnostic-details,
.diagnostic-error {
  margin-left: 24px;
  margin-top: 4px;
}

.log-viewer {
  max-height: 400px;
  overflow-y: auto;
  background-color: #f8f9fa;
  border-radius: 4px;
  padding: 10px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
}

.log-entry {
  display: flex;
  margin-bottom: 4px;
  padding: 2px 0;
}

.log-time {
  width: 160px;
  color: #909399;
  margin-right: 10px;
}

.log-level {
  width: 60px;
  margin-right: 10px;
  font-weight: bold;
}

.log-message {
  flex: 1;
}

.log-info .log-level {
  color: #409eff;
}

.log-warn .log-level {
  color: #e6a23c;
}

.log-error .log-level {
  color: #f56c6c;
}

.no-logs {
  text-align: center;
  padding: 20px;
}

@media (max-width: 768px) {
  .status-overview .el-col {
    margin-bottom: 10px;
  }

  .button-group {
    justify-content: center;
  }

  .log-time {
    width: 120px;
  }

  .log-level {
    width: 50px;
  }
}
</style>
