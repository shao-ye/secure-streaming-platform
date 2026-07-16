<template>
  <div class="system-diagnostics">
    <!-- 系统运行提示 -->
    <el-alert
      title="系统运行正常"
      type="success"
      :closable="false"
      show-icon
      style="margin-bottom: 15px;"
    />
    
    <!-- 系统状态概览 -->
    <el-row :gutter="10" class="status-overview" style="margin-bottom: 15px;">
      <!-- 1. 系统状态 -->
      <el-col :xs="12" :sm="8" :md="4" :lg="4">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="28" color="#67c23a">
                <CircleCheck />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ systemStatus.vps?.status || 'Unknown' }}</div>
              <div class="status-label">系统状态</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 2. 频道总数 -->
      <el-col :xs="12" :sm="8" :md="4" :lg="4">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="28" color="#409eff">
                <List />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ systemStatus.streams?.configured || 0 }}</div>
              <div class="status-label">频道总数</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 3. 在线用户 -->
      <el-col :xs="12" :sm="8" :md="4" :lg="4">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="28" color="#e6a23c">
                <User />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">1</div>
              <div class="status-label">在线用户</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 4. 活跃播放 -->
      <el-col :xs="12" :sm="8" :md="4" :lg="4">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="28" :color="systemStatus.sessions?.total > 0 ? '#67c23a' : '#909399'">
                <UserFilled />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ systemStatus.sessions?.total || 0 }}</div>
              <div class="status-label">活跃播放</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 5. 活跃转码 -->
      <el-col :xs="12" :sm="8" :md="4" :lg="4">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="28" :color="systemStatus.streams?.active > 0 ? '#67c23a' : '#909399'">
                <VideoCamera />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ systemStatus.streams?.active || 0 }}</div>
              <div class="status-label">活跃转码</div>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 6. 活跃录制 -->
      <el-col :xs="12" :sm="8" :md="4" :lg="4">
        <el-card class="status-card" shadow="hover">
          <div class="status-item">
            <div class="status-icon">
              <el-icon size="28" :color="systemStatus.streams?.activeRecordings > 0 ? '#e6a23c' : '#909399'">
                <VideoCameraFilled />
              </el-icon>
            </div>
            <div class="status-info">
              <div class="status-value">{{ systemStatus.streams?.activeRecordings || 0 }}</div>
              <div class="status-label">活跃录制</div>
            </div>
          </div>
        </el-card>
      </el-col>

    </el-row>

    <!-- 操作按钮 -->
    <el-row :gutter="20" class="action-buttons" style="margin-bottom: 15px;">
      <el-col :span="24">
        <el-card shadow="never" style="padding: 10px;">
          <div class="button-group" style="display: flex; gap: 10px; align-items: center;">
            <span style="font-weight: 600; margin-right: 10px;">系统操作:</span>
            <el-button
              size="small"
              type="primary"
              :icon="Refresh"
              @click="refreshSystemStatus"
              :loading="loading.system"
            >
              刷新状态
            </el-button>
            <el-button
              size="small"
              type="warning"
              :icon="Delete"
              @click="clearCache"
              :loading="loading.cache"
            >
              清理缓存
            </el-button>
            <el-button
              size="small"
              type="info"
              :icon="Download"
              @click="reloadStreamsConfig"
              :loading="loading.config"
            >
              重载配置
            </el-button>
            <el-button
              size="small"
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

    <!-- 上传 Worker 控制面板（录制视频上传到 139 云盘） -->
    <el-row :gutter="20" class="upload-worker-panel" style="margin-bottom: 15px;">
      <el-col :span="24">
        <el-card shadow="never" style="padding: 10px;">
          <div class="worker-panel-layout">
            <!-- 左侧：状态 + 统计 -->
            <div class="worker-panel-info">
              <span style="font-weight: 600; margin-right: 12px;">上传队列:</span>
              <el-tag :type="uploadWorkerRunningTagType" size="small">
                {{ uploadWorkerRunningLabel }}
              </el-tag>
              <span class="worker-metrics" v-if="uploadWorkerStatus">
                待传 <b>{{ uploadWorkerStatus?.queue?.pending ?? 0 }}</b>
                · 上传中 <b>{{ uploadWorkerStatus?.queue?.uploading ?? 0 }}</b>
                · 累计成功 <b style="color: #67c23a;">{{ uploadWorkerStatus?.worker?.stats?.totalSuccess ?? 0 }}</b>
                · 累计失败 <b style="color: #e6a23c;">{{ uploadWorkerStatus?.worker?.stats?.totalFailed ?? 0 }}</b>
              </span>
            </div>

            <!-- 右侧：操作按钮 -->
            <div class="worker-panel-actions">
              <el-button
                v-if="canPauseUploadWorker"
                size="small"
                type="warning"
                @click="pauseUploadWorker"
                :loading="loading.uploadWorker"
              >
                暂停消费
              </el-button>
              <el-button
                v-if="canResumeUploadWorker"
                size="small"
                type="success"
                @click="resumeUploadWorker"
                :loading="loading.uploadWorker"
              >
                恢复消费
              </el-button>
              <el-button
                size="small"
                :icon="Refresh"
                @click="fetchUploadQueueStatus"
                :loading="loading.uploadWorker"
              >
                刷新
              </el-button>
            </div>
          </div>

          <!-- 当前任务 + 最近失败（有内容才展示） -->
          <div class="worker-panel-extra" v-if="uploadWorkerCurrentFile || uploadWorkerLatestFailure">
            <div v-if="uploadWorkerCurrentFile" class="worker-panel-current">
              📤 当前：{{ uploadWorkerCurrentFile }}
              <span v-if="uploadWorkerAttemptText" style="color: #e6a23c; margin-left: 6px;">
                {{ uploadWorkerAttemptText }}
              </span>
            </div>
            <div v-if="uploadWorkerLatestFailure" class="worker-panel-failure">
              ❌ 最近失败：{{ uploadWorkerLatestFailure }}
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 详细信息 -->
    <el-row :gutter="20">
      <!-- 缓存统计 -->
      <el-col :xs="24" :sm="24" :md="12" :lg="12">
        <el-card shadow="never" style="height: 450px;">
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

          <div v-if="cacheStats.totalItems >= 0" style="max-height: 350px; overflow-y: auto;">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="总条目数">
                {{ cacheStats.totalItems || 0 }}
              </el-descriptions-item>
              <el-descriptions-item label="缓存状态">
                <el-tag :type="cacheStats.totalItems > 0 ? 'success' : 'info'" size="small">
                  {{ cacheStats.totalItems > 0 ? '有数据' : '空缓存' }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="频道数量">
                {{ cacheStats.channels || 0 }}
              </el-descriptions-item>
              <el-descriptions-item label="用户数量">
                {{ cacheStats.users || 0 }}
              </el-descriptions-item>
              <el-descriptions-item label="系统配置">
                {{ cacheStats.systemKeys || 0 }} 项
              </el-descriptions-item>
              <el-descriptions-item label="存储位置">
                Cloudflare KV
              </el-descriptions-item>
              <el-descriptions-item label="缓存类型">
                索引系统
              </el-descriptions-item>
              <el-descriptions-item label="可用性">
                <el-tag type="success" size="small">正常</el-tag>
              </el-descriptions-item>
            </el-descriptions>

            <!-- 🔥 V2.6: 移除缓存键列表显示，避免KV list操作 -->
            <div style="margin-top: 15px; padding: 10px; background-color: #f5f7fa; border-radius: 4px;">
              <el-text size="small" type="info">
                <i class="el-icon-info-filled"></i>
                {{ cacheStats.note || '统计基于索引系统，避免KV list操作限制' }}
              </el-text>
            </div>
          </div>

          <el-empty v-else description="暂无缓存数据" />
        </el-card>
      </el-col>

      <!-- 系统诊断 -->
      <el-col :xs="24" :sm="24" :md="12" :lg="12">
        <el-card shadow="never" style="height: 450px;">
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

          <div v-if="diagnostics.checks && diagnostics.checks.length > 0" style="max-height: 350px; overflow-y: auto;">
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

    <!-- 流量统计 -->
    <el-row style="margin-top: 20px;" :gutter="20">
      <el-col :xs="24" :sm="24" :md="12" :lg="12">
        <el-card shadow="never" style="height: 500px;">
          <template #header>
            <div class="card-header">
              <h3>流量统计</h3>
              <el-button
                size="small"
                :icon="Refresh"
                @click="refreshTrafficStats"
                :loading="loading.traffic"
              />
            </div>
          </template>

          <div style="max-height: 420px; overflow-y: auto;">
            <div v-if="trafficStats.summary">
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item label="总流量">
                  {{ trafficStats.summary.totalBandwidth }} GB
                </el-descriptions-item>
                <el-descriptions-item label="总请求数">
                  {{ trafficStats.summary.totalRequests.toLocaleString() }}
                </el-descriptions-item>
                <el-descriptions-item label="总费用">
                  ${{ trafficStats.summary.totalCost }}
                </el-descriptions-item>
                <el-descriptions-item label="月均流量">
                  {{ trafficStats.summary.avgMonthlyBandwidth }} GB
                </el-descriptions-item>
              </el-descriptions>

              <!-- 月度流量表格 -->
              <div style="margin-top: 15px;">
                <h4>月度流量详情</h4>
                <el-table :data="trafficStats.monthly.slice(-6)" size="small" style="width: 100%">
                  <el-table-column prop="month" label="月份" width="80" />
                  <el-table-column prop="bandwidth" label="流量(GB)" width="80" />
                  <el-table-column prop="requests" label="请求数" width="80">
                    <template #default="scope">
                      {{ scope.row.requests.toLocaleString() }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="cost" label="费用($)" width="70" />
                </el-table>
              </div>
            </div>
            <el-empty v-else description="点击刷新按钮获取流量统计" />
          </div>
        </el-card>
      </el-col>

      <!-- 登录日志 -->
      <el-col :xs="24" :sm="24" :md="12" :lg="12">
        <el-card shadow="never" style="height: 500px;">
          <template #header>
            <div class="card-header">
              <h3>登录日志</h3>
              <div class="header-controls" style="display: flex; gap: 8px; align-items: center;">
                <el-date-picker
                  v-model="dateRange"
                  type="daterange"
                  size="small"
                  range-separator="至"
                  start-placeholder="开始日期"
                  end-placeholder="结束日期"
                  @change="refreshLoginLogs"
                  style="width: 240px;"
                />
                <el-button
                  size="small"
                  :icon="Refresh"
                  @click="refreshLoginLogs"
                  :loading="loading.loginLogs"
                />
              </div>
            </div>
          </template>

          <div class="logs-container" style="height: 380px; display: flex; flex-direction: column;">
            <div style="flex: 1; overflow-y: auto; margin-bottom: 10px;">
              <div v-if="loginLogs.length > 0">
                <div
                  v-for="log in loginLogs"
                  :key="log.id"
                  class="login-log-item"
                  style="border-bottom: 1px solid #eee; padding: 8px 0;"
                >
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <el-tag :type="log.status === 'success' ? 'success' : 'danger'" size="small">
                        {{ log.username }}
                      </el-tag>
                      <span style="margin-left: 8px; font-size: 12px; color: #666;">
                        {{ log.ip }} - {{ log.location }}
                      </span>
                      <el-tag v-if="log.details?.source" size="small" type="info" style="margin-left: 8px;">
                        {{ log.details.source === 'R2' ? 'R2' : log.details.source === 'Mock' ? '模拟' : 'KV' }}
                      </el-tag>
                    </div>
                    <div style="font-size: 12px; color: #999;">
                      {{ formatTime(log.timestamp) }}
                    </div>
                  </div>
                  <div style="font-size: 11px; color: #999; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    {{ log.userAgent }}
                  </div>
                  <div v-if="log.details?.reason" style="font-size: 11px; color: #f56c6c; margin-top: 2px;">
                    失败原因: {{ log.details.reason }}
                  </div>
                </div>
              </div>
              <el-empty v-else description="暂无登录日志数据" />
            </div>
            
            <!-- 分页组件 -->
            <div v-if="loginLogsPagination.total > 0" style="display: flex; justify-content: center;">
              <el-pagination
                v-model:current-page="loginLogsPagination.current"
                v-model:page-size="loginLogsPagination.pageSize"
                :total="loginLogsPagination.total"
                :page-sizes="[10, 20, 50]"
                layout="total, sizes, prev, pager, next"
                @size-change="refreshLoginLogs"
                @current-change="refreshLoginLogs"
                small
              />
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 系统日志 -->
    <el-row style="margin-top: 20px;">
      <el-col :span="24">
        <el-card shadow="never" style="height: 350px;">
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

          <div class="log-viewer" style="max-height: 250px; overflow-y: auto; padding: 10px; background-color: #f5f5f5; border-radius: 4px;">
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
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  CircleClose,
  DataBoard,
  Monitor,
  Refresh,
  Delete,
  Download,
  VideoCamera,
  VideoCameraFilled,
  List,
  User,
  UserFilled
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

const trafficStats = reactive({
  monthly: [],
  summary: null,
  realtime: null
})

const loginLogs = ref([])
const dateRange = ref([
  new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  new Date()
])
const loginLogsPagination = reactive({
  current: 1,
  pageSize: 20,
  total: 0
})

const loading = reactive({
  system: false,
  cache: false,
  config: false,
  vps: false,
  cacheStats: false,
  diagnostics: false,
  logs: false,
  traffic: false,
  loginLogs: false,
  uploadWorker: false
})

// 录制视频上传 Worker 实时状态（/api/upload/queue-status 返回）
// 数据结构参见 vps-server/src/routes/upload.js
const uploadWorkerStatus = ref(null)

/**
 * Worker 运行标签颜色
 * - 未启动 / 未知 → info（灰）
 * - 已暂停 → warning（黄）
 * - 运行中 → success（绿）
 */
const uploadWorkerRunningTagType = computed(() => {
  const w = uploadWorkerStatus.value?.worker
  if (!w || !w.running) return 'info'
  if (w.paused) return 'warning'
  return 'success'
})

/**
 * Worker 运行标签文案
 * 登录失效暂停时附带原因，方便管理员识别
 */
const uploadWorkerRunningLabel = computed(() => {
  const w = uploadWorkerStatus.value?.worker
  if (!w) return '未启动'
  if (!w.running) return '已停止'
  if (w.paused) {
    const reason = w.lastAuthMessage || '手动暂停'
    return `已暂停（${reason}）`
  }
  return '运行中'
})

/**
 * "暂停消费"按钮是否可用：运行中且未暂停才显示
 */
const canPauseUploadWorker = computed(() => {
  const w = uploadWorkerStatus.value?.worker
  return !!(w && w.running && !w.paused)
})

/**
 * "恢复消费"按钮是否可用：已暂停才显示
 */
const canResumeUploadWorker = computed(() => {
  const w = uploadWorkerStatus.value?.worker
  return !!(w && w.paused)
})

/**
 * 当前正在上传的文件名（路径最后一段，超长截断避免撑破面板）
 */
const uploadWorkerCurrentFile = computed(() => {
  const task = uploadWorkerStatus.value?.worker?.stats?.currentTask
  if (!task || !task.filePath) return ''
  const name = task.filePath.split('/').pop() || ''
  return name.length > 60 ? '…' + name.slice(-60) : name
})

/**
 * 当前任务重试次数提示（第 1 次不提示，≥ 2 才提示，减少正常情况干扰）
 */
const uploadWorkerAttemptText = computed(() => {
  const task = uploadWorkerStatus.value?.worker?.stats?.currentTask
  if (!task || !task.attempt || task.attempt <= 1) return ''
  return `第 ${task.attempt} 次重试`
})

/**
 * 最近一条失败摘要：文件名 + 失败原因 + 时间
 */
const uploadWorkerLatestFailure = computed(() => {
  const arr = uploadWorkerStatus.value?.queue?.recentFailures || []
  if (!arr.length) return ''
  const f = arr[0]
  const name = (f.filePath || '').split('/').pop() || '(未知文件)'
  const short = name.length > 50 ? '…' + name.slice(-50) : name
  const when = f.finishedAt ? new Date(f.finishedAt).toLocaleTimeString() : ''
  const reason = f.reason || f.error || '未知原因'
  return `${short}（${reason}${when ? ' · ' + when : ''}）`
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
      // 正确解析API返回的数据结构
      Object.assign(systemStatus, response.data.data)
      // 同时更新VPS状态
      if (response.data.data.vps) {
        Object.assign(vpsStatus, response.data.data.vps)
      }
      infoLog('系统状态刷新成功')
    }
    
    // 同时刷新缓存统计，确保数据一致性
    await refreshCacheStats()
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
      // 正确解析缓存统计数据
      Object.assign(cacheStats, response.data.data.cache || response.data.data)
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
      // 将API返回的数据转换为前端期望的格式
      const data = response.data.data
      const checks = [
        {
          name: 'Worker服务',
          status: 'ok',
          details: `版本: ${data.worker?.version}, 环境: ${data.worker?.environment}`
        },
        {
          name: 'KV数据库',
          status: data.kv?.available ? 'ok' : 'error',
          details: `命名空间: ${data.kv?.namespace}`,
          error: data.kv?.available ? null : data.kv?.testResult
        },
        {
          name: 'VPS连接',
          status: data.vps?.available ? 'ok' : 'error',
          details: data.vps?.url,
          error: data.vps?.available ? null : data.vps?.testResult
        },
        {
          name: '缓存系统',
          status: 'ok',
          details: `缓存条目: ${data.cache?.totalItems || 0}`
        },
        {
          name: '性能检测',
          status: 'ok',
          details: `诊断耗时: ${data.performance?.diagnosticsTime}ms`
        }
      ]
      
      diagnostics.checks = checks
      diagnostics.lastRun = new Date().toISOString()
      ElMessage.success('系统诊断完成')
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
    // 从VPS获取真实的日志数据
    const response = await axios.get('/api/admin/logs/recent?lines=50')
    if (response.data.status === 'success') {
      logs.value = response.data.data.logs || []
      debugLog('成功加载VPS日志:', logs.value.length + '条')
    } else {
      throw new Error(response.data.message || '获取日志失败')
    }
  } catch (error) {
    errorLog('获取VPS日志失败:', error)
    ElMessage.error('获取日志失败: ' + (error.response?.data?.message || error.message))
    logs.value = [] // 清空日志
  } finally {
    loading.logs = false
  }
}

const clearLogs = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清理VPS上的所有日志文件吗？此操作不可恢复！',
      '确认清理日志',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    // 调用VPS API清空日志文件
    const response = await axios.delete('/api/admin/logs/clear')
    if (response.data.status === 'success') {
      logs.value = []
      ElMessage.success('日志清理成功')
      debugLog('VPS日志已清空:', response.data.data)
    } else {
      throw new Error(response.data.message || '清理日志失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      errorLog('清理VPS日志失败:', error)
      ElMessage.error('清理日志失败: ' + (error.response?.data?.message || error.message))
    }
  }
}

// 刷新流量统计
const refreshTrafficStats = async () => {
  loading.traffic = true
  try {
    const response = await axios.get('/api/admin/traffic/stats')
    if (response.data.status === 'success') {
      Object.assign(trafficStats, response.data.data.traffic)
      infoLog('流量统计刷新成功')
    }
  } catch (error) {
    errorLog('获取流量统计失败:', error)
    ElMessage.error('获取流量统计失败')
  } finally {
    loading.traffic = false
  }
}

/**
 * 拉取上传 Worker + 队列状态（/api/upload/queue-status）
 * 静默失败：网络抖动 / 服务重启时不弹错误框，避免打扰管理员
 */
const fetchUploadQueueStatus = async () => {
  loading.uploadWorker = true
  try {
    const resp = await axios.get('/api/upload/queue-status')
    if (resp.data?.status === 'success') {
      uploadWorkerStatus.value = resp.data.data
    }
  } catch (err) {
    // 静默忽略，避免 30s 定时轮询刷出大量错误提示
    debugLog('获取上传队列状态失败（已忽略）', err && err.message)
  } finally {
    loading.uploadWorker = false
  }
}

/**
 * 暂停上传 Worker 消费
 * 确认对话框 → POST /api/upload/worker/pause → 立即刷新状态
 * 典型场景：上游链路持续失败、需要静默期做变更
 */
const pauseUploadWorker = async () => {
  try {
    await ElMessageBox.confirm(
      '确认暂停上传队列消费？\n\n已经在上传中的任务会自然结束；后续 Worker 不再从队列取新任务，直到恢复。',
      '暂停上传 Worker',
      {
        confirmButtonText: '确定暂停',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    loading.uploadWorker = true
    const resp = await axios.post('/api/upload/worker/pause', {
      reason: 'admin_ui_pause'
    })
    if (resp.data?.status === 'success') {
      uploadWorkerStatus.value = {
        ...(uploadWorkerStatus.value || {}),
        worker: resp.data.data
      }
      ElMessage.success('上传 Worker 已暂停')
      // 立即刷新完整状态，拿最新队列计数
      await fetchUploadQueueStatus()
    } else {
      ElMessage.warning(resp.data?.message || '暂停失败')
    }
  } catch (err) {
    // ElMessageBox 取消会 throw 'cancel'，此时不视为错误
    if (err !== 'cancel') {
      errorLog('暂停上传 Worker 失败:', err)
      ElMessage.error('暂停失败：' + (err.response?.data?.message || err.message))
    }
  } finally {
    loading.uploadWorker = false
  }
}

/**
 * 恢复上传 Worker 消费
 * 无需二次确认（恢复是无害操作，登录失效场景会自动再次暂停）
 */
const resumeUploadWorker = async () => {
  loading.uploadWorker = true
  try {
    const resp = await axios.post('/api/upload/worker/resume')
    if (resp.data?.status === 'success') {
      uploadWorkerStatus.value = {
        ...(uploadWorkerStatus.value || {}),
        worker: resp.data.data
      }
      ElMessage.success('上传 Worker 已恢复')
      await fetchUploadQueueStatus()
    } else {
      ElMessage.warning(resp.data?.message || '恢复失败')
    }
  } catch (err) {
    errorLog('恢复上传 Worker 失败:', err)
    ElMessage.error('恢复失败：' + (err.response?.data?.message || err.message))
  } finally {
    loading.uploadWorker = false
  }
}

// 刷新登录日志
const refreshLoginLogs = async () => {
  loading.loginLogs = true
  try {
    const [startDate, endDate] = dateRange.value || [
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date()
    ]
    
    const params = new URLSearchParams({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      limit: loginLogsPagination.pageSize.toString(),
      offset: ((loginLogsPagination.current - 1) * loginLogsPagination.pageSize).toString()
    })

    const response = await axios.get(`/api/admin/login/logs?${params}`)
    if (response.data.status === 'success') {
      loginLogs.value = response.data.data.logs
      loginLogsPagination.total = response.data.data.total
      
      const source = response.data.data.source || 'Unknown'
      infoLog(`登录日志刷新成功 (数据源: ${source})`)
      
      if (source === 'Mock') {
        ElMessage.warning('当前显示的是模拟数据，请检查R2存储桶配置')
      }
    }
  } catch (error) {
    errorLog('获取登录日志失败:', error)
    ElMessage.error('获取登录日志失败')
  } finally {
    loading.loginLogs = false
  }
}

// 初始化数据
const initData = async () => {
  await Promise.all([
    refreshSystemStatus(),
    refreshCacheStats(),
    checkVpsHealth(),
    runDiagnostics(),
    refreshLogs(),
    refreshTrafficStats(),
    refreshLoginLogs(),
    fetchUploadQueueStatus()
  ])
}

// 启动定时刷新
const startAutoRefresh = () => {
  statusTimer = setInterval(() => {
    refreshSystemStatus()
    refreshCacheStats()
    // 同节拍刷新上传 Worker 状态，省定时器资源
    fetchUploadQueueStatus()
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
  padding: 16px 12px;
}

.status-icon {
  margin-right: 10px;
}

.status-info {
  flex: 1;
}

.status-value {
  font-size: 26px;
  font-weight: bold;
  color: #303133;
  margin-bottom: 4px;
}

.status-label {
  font-size: 13px;
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

/* 上传 Worker 控制面板 */
.upload-worker-panel {
  margin-bottom: 15px;
}

.worker-panel-layout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.worker-panel-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.worker-panel-info .worker-metrics {
  font-size: 12px;
  color: #606266;
}

.worker-panel-info .worker-metrics b {
  font-weight: 600;
  color: #303133;
}

.worker-panel-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.worker-panel-extra {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.worker-panel-current {
  font-size: 12px;
  color: #409eff;
  word-break: break-all;
}

.worker-panel-failure {
  font-size: 12px;
  color: #f56c6c;
  word-break: break-all;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
}

/* 🔥 V2.6: 移除cache-keys和cache-key-tag样式（已废弃） */

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
  .system-diagnostics {
    padding: 10px 0;
  }

  /* 状态卡片移动端优化 - 每行2个 */
  .status-overview .el-col {
    margin-bottom: 10px;
  }
  
  .status-overview {
    margin-bottom: 15px;
  }
  
  .status-item {
    padding: 10px 6px;
  }
  
  .status-icon {
    margin-right: 6px;
  }
  
  .status-icon .el-icon {
    font-size: 20px !important;
  }
  
  .status-value {
    font-size: 16px;
  }
  
  .status-label {
    font-size: 10px;
    margin-top: 2px;
  }

  /* 按钮组移动端优化 */
  .button-group {
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }
  
  .button-group .el-button {
    width: 100%;
    margin: 0;
  }
  
  .button-group span {
    margin-bottom: 8px;
    text-align: center;
  }

  /* 上传 Worker 面板移动端：上下堆叠，按钮组撑满 */
  .worker-panel-layout {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .worker-panel-actions {
    justify-content: stretch;
  }

  .worker-panel-actions .el-button {
    flex: 1;
    margin: 0;
  }

  /* 卡片布局移动端优化 - 每行1个 */
  .el-row .el-col {
    margin-bottom: 15px;
  }
  
  .el-card {
    margin-bottom: 15px;
    height: auto !important;
  }
  
  /* 卡片标题移动端优化 */
  .card-header h3 {
    font-size: 16px;
  }
  
  /* 表格移动端优化 */
  .el-table {
    font-size: 12px;
  }
  
  .el-table .el-table__cell {
    padding: 8px 4px;
  }

  /* 日志查看器移动端优化 */
  .log-viewer {
    font-size: 11px;
  }
  
  .log-time {
    width: 100px;
    font-size: 10px;
  }

  .log-level {
    width: 40px;
    font-size: 10px;
  }
  
  .log-message {
    font-size: 11px;
  }
  
  /* 诊断项目移动端优化 */
  .diagnostic-item {
    padding: 8px 0;
  }
  
  .diagnostic-header {
    flex-wrap: wrap;
    gap: 4px;
  }
  
  .diagnostic-name {
    font-size: 14px;
  }
  
  /* 登录日志移动端优化 */
  .login-log-item {
    padding: 6px 0 !important;
  }
  
  .login-log-item > div {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 4px;
  }
  
  /* 🔥 V2.6: 移除cache-key-tag样式（已废弃） */
}
</style>
