<template>
  <div class="streaming-test">
    <el-container>
      <el-header class="test-header">
        <h1>统一视频流系统测试</h1>
        <el-tag :type="systemStatus === 'healthy' ? 'success' : 'danger'">
          系统状态: {{ systemStatusText }}
        </el-tag>
      </el-header>

      <el-main>
        <el-row :gutter="20">
          <!-- 左侧控制面板 -->
          <el-col :span="8">
            <el-card class="control-panel">
              <template #header>
                <span>测试控制面板</span>
              </template>

              <!-- 基础配置 -->
              <el-form :model="testConfig" label-width="120px" size="default">
                <el-form-item label="频道ID">
                  <el-input v-model="testConfig.channelId" placeholder="输入频道ID" />
                </el-form-item>

                <el-form-item label="RTMP源地址">
                  <el-input 
                    v-model="testConfig.rtmpUrl" 
                    type="textarea" 
                    :rows="3"
                    placeholder="输入RTMP源地址"
                  />
                </el-form-item>

                <el-form-item label="自动播放">
                  <el-switch v-model="testConfig.autoPlay" />
                </el-form-item>

                <el-form-item label="显示信息">
                  <el-switch v-model="testConfig.showInfo" />
                </el-form-item>

                <el-form-item>
                  <el-button 
                    type="primary" 
                    @click="startTest"
                    :loading="isStarting"
                    :disabled="!testConfig.channelId || !testConfig.rtmpUrl"
                  >
                    开始测试
                  </el-button>
                  <el-button @click="stopTest" :disabled="!isPlaying">
                    停止测试
                  </el-button>
                </el-form-item>
              </el-form>

              <!-- 路由控制 -->
              <el-divider>路由控制</el-divider>
              
              <el-form label-width="120px" size="small">
                <el-form-item label="当前路由">
                  <el-tag :type="getRouteTypeColor(currentRoute)">
                    {{ getRouteTypeName(currentRoute) }}
                  </el-tag>
                </el-form-item>

                <el-form-item label="手动切换">
                  <el-select v-model="selectedRoute" placeholder="选择路由类型">
                    <el-option label="代理优化" value="proxy" />
                    <el-option label="隧道优化" value="tunnel" />
                    <el-option label="直接连接" value="direct" />
                  </el-select>
                </el-form-item>

                <el-form-item>
                  <el-button 
                    size="small" 
                    @click="switchRoute"
                    :disabled="!selectedRoute || !isPlaying"
                  >
                    切换路由
                  </el-button>
                </el-form-item>
              </el-form>

              <!-- 系统信息 -->
              <el-divider>系统信息</el-divider>
              
              <div class="system-info">
                <div class="info-item">
                  <span class="label">活跃频道:</span>
                  <span class="value">{{ systemInfo.activeChannels || 0 }}</span>
                </div>
                <div class="info-item">
                  <span class="label">网络质量:</span>
                  <el-tag :type="getNetworkQualityColor(networkQuality)" size="small">
                    {{ getNetworkQualityText(networkQuality) }}
                  </el-tag>
                </div>
                <div class="info-item">
                  <span class="label">延迟:</span>
                  <span class="value">{{ latency }}ms</span>
                </div>
              </div>
            </el-card>

            <!-- 测试日志 -->
            <el-card class="test-logs" style="margin-top: 20px;">
              <template #header>
                <div class="log-header">
                  <span>测试日志</span>
                  <el-button size="small" @click="clearLogs">清空</el-button>
                </div>
              </template>
              
              <div class="log-content">
                <div 
                  v-for="(log, index) in testLogs" 
                  :key="index"
                  :class="['log-item', `log-${log.type}`]"
                >
                  <span class="log-time">{{ formatTime(log.timestamp) }}</span>
                  <span class="log-message">{{ log.message }}</span>
                </div>
              </div>
            </el-card>
          </el-col>

          <!-- 右侧视频播放器 -->
          <el-col :span="16">
            <el-card class="video-panel">
              <template #header>
                <span>视频播放器</span>
              </template>

              <div v-if="isPlaying" class="video-container">
                <UnifiedVideoPlayer
                  ref="videoPlayer"
                  :channel-id="testConfig.channelId"
                  :rtmp-url="testConfig.rtmpUrl"
                  :auto-play="testConfig.autoPlay"
                  :show-info="testConfig.showInfo"
                  @play="onVideoPlay"
                  @pause="onVideoPause"
                  @error="onVideoError"
                  @channelSwitch="onChannelSwitch"
                  @sourceUpdate="onSourceUpdate"
                />
              </div>

              <div v-else class="placeholder">
                <el-empty description="请配置频道信息并开始测试" />
              </div>
            </el-card>

            <!-- 实时统计 -->
            <el-card style="margin-top: 20px;">
              <template #header>
                <span>实时统计</span>
              </template>

              <el-row :gutter="20">
                <el-col :span="6">
                  <el-statistic title="播放时长" :value="playDuration" suffix="秒" />
                </el-col>
                <el-col :span="6">
                  <el-statistic title="缓冲健康度" :value="bufferHealth" suffix="%" />
                </el-col>
                <el-col :span="6">
                  <el-statistic title="路由切换次数" :value="routeSwitchCount" />
                </el-col>
                <el-col :span="6">
                  <el-statistic title="错误次数" :value="errorCount" />
                </el-col>
              </el-row>
            </el-card>
          </el-col>
        </el-row>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import UnifiedVideoPlayer from '@/components/video/UnifiedVideoPlayer.vue'
import streamingApi from '@/services/streamingApi'

// 响应式数据
const isPlaying = ref(false)
const isStarting = ref(false)
const systemStatus = ref('unknown')
const currentRoute = ref('unknown')
const selectedRoute = ref('')
const networkQuality = ref('unknown')
const latency = ref(0)
const bufferHealth = ref(0)
const playDuration = ref(0)
const routeSwitchCount = ref(0)
const errorCount = ref(0)

// 测试配置
const testConfig = reactive({
  channelId: 'test-channel-001',
  rtmpUrl: 'rtmp://example.com/live/test',
  autoPlay: true,
  showInfo: true
})

// 系统信息
const systemInfo = ref({})

// 测试日志
const testLogs = ref([])

// 定时器
let statusTimer = null
let durationTimer = null

// 计算属性
const systemStatusText = computed(() => {
  switch (systemStatus.value) {
    case 'healthy': return '正常'
    case 'error': return '异常'
    case 'unknown': return '未知'
    default: return '检测中'
  }
})

// 组件引用
const videoPlayer = ref(null)

// 方法
const addLog = (type, message) => {
  testLogs.value.unshift({
    type,
    message,
    timestamp: Date.now()
  })
  
  // 限制日志数量
  if (testLogs.value.length > 100) {
    testLogs.value = testLogs.value.slice(0, 100)
  }
}

const clearLogs = () => {
  testLogs.value = []
}

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleTimeString()
}

const startTest = async () => {
  try {
    isStarting.value = true
    addLog('info', `开始测试频道: ${testConfig.channelId}`)
    
    // 检查系统健康状态
    await checkSystemHealth()
    
    if (systemStatus.value !== 'healthy') {
      throw new Error('系统状态异常，无法开始测试')
    }
    
    isPlaying.value = true
    
    // 启动统计定时器
    startTimers()
    
    addLog('success', '测试启动成功')
    
  } catch (error) {
    addLog('error', `测试启动失败: ${error.message}`)
    ElMessage.error(`测试启动失败: ${error.message}`)
  } finally {
    isStarting.value = false
  }
}

const stopTest = async () => {
  try {
    addLog('info', '停止测试')
    
    isPlaying.value = false
    
    // 停止定时器
    stopTimers()
    
    // 重置统计
    resetStats()
    
    addLog('success', '测试已停止')
    
  } catch (error) {
    addLog('error', `停止测试失败: ${error.message}`)
    ElMessage.error(`停止测试失败: ${error.message}`)
  }
}

const switchRoute = async () => {
  try {
    addLog('info', `切换路由到: ${selectedRoute.value}`)
    
    if (videoPlayer.value) {
      await videoPlayer.value.switchChannel('manual', selectedRoute.value)
      routeSwitchCount.value++
      addLog('success', `路由切换成功: ${selectedRoute.value}`)
    }
    
  } catch (error) {
    addLog('error', `路由切换失败: ${error.message}`)
    ElMessage.error(`路由切换失败: ${error.message}`)
  }
}

const checkSystemHealth = async () => {
  try {
    const health = await streamingApi.healthCheck()
    systemStatus.value = health.data?.status === 'healthy' ? 'healthy' : 'error'
    
    const status = await streamingApi.getSystemStatus()
    systemInfo.value = status.data || {}
    
  } catch (error) {
    systemStatus.value = 'error'
    addLog('error', `系统健康检查失败: ${error.message}`)
  }
}

const startTimers = () => {
  // 状态检查定时器
  statusTimer = setInterval(async () => {
    await checkSystemHealth()
    
    // 更新网络质量和延迟（模拟）
    networkQuality.value = ['excellent', 'good', 'fair', 'poor'][Math.floor(Math.random() * 4)]
    latency.value = Math.floor(Math.random() * 200) + 50
    bufferHealth.value = Math.floor(Math.random() * 30) + 70
  }, 5000)
  
  // 播放时长定时器
  durationTimer = setInterval(() => {
    if (isPlaying.value) {
      playDuration.value++
    }
  }, 1000)
}

const stopTimers = () => {
  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }
  
  if (durationTimer) {
    clearInterval(durationTimer)
    durationTimer = null
  }
}

const resetStats = () => {
  playDuration.value = 0
  routeSwitchCount.value = 0
  errorCount.value = 0
  bufferHealth.value = 0
  latency.value = 0
  currentRoute.value = 'unknown'
}

// 视频播放器事件处理
const onVideoPlay = () => {
  addLog('info', '视频开始播放')
}

const onVideoPause = () => {
  addLog('info', '视频暂停')
}

const onVideoError = (error) => {
  errorCount.value++
  addLog('error', `视频播放错误: ${error.message}`)
}

const onChannelSwitch = (data) => {
  currentRoute.value = data.targetRouteType || 'unknown'
  routeSwitchCount.value++
  addLog('info', `频道切换: ${data.reason} -> ${data.targetRouteType}`)
}

const onSourceUpdate = (data) => {
  addLog('info', `源更新通知: ${data.message}`)
}

// 辅助方法
const getRouteTypeColor = (type) => {
  switch (type) {
    case 'proxy': return 'primary'
    case 'tunnel': return 'success'
    case 'direct': return 'warning'
    default: return 'info'
  }
}

const getRouteTypeName = (type) => {
  switch (type) {
    case 'proxy': return '代理优化'
    case 'tunnel': return '隧道优化'
    case 'direct': return '直接连接'
    default: return '未知'
  }
}

const getNetworkQualityColor = (quality) => {
  switch (quality) {
    case 'excellent': return 'success'
    case 'good': return 'primary'
    case 'fair': return 'warning'
    case 'poor': return 'danger'
    default: return 'info'
  }
}

const getNetworkQualityText = (quality) => {
  switch (quality) {
    case 'excellent': return '优秀'
    case 'good': return '良好'
    case 'fair': return '一般'
    case 'poor': return '较差'
    default: return '未知'
  }
}

// 生命周期
onMounted(() => {
  checkSystemHealth()
  addLog('info', '测试页面已加载')
})

onUnmounted(() => {
  stopTimers()
})
</script>

<style scoped>
.streaming-test {
  padding: 20px;
  background: #f5f7fa;
  min-height: 100vh;
}

.test-header {
  background: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.test-header h1 {
  margin: 0;
  color: #303133;
}

.control-panel {
  height: fit-content;
}

.system-info {
  font-size: 14px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.info-item .label {
  color: #606266;
}

.info-item .value {
  font-weight: 600;
  color: #303133;
}

.test-logs {
  max-height: 400px;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.log-content {
  max-height: 300px;
  overflow-y: auto;
}

.log-item {
  display: flex;
  margin-bottom: 4px;
  font-size: 12px;
  line-height: 1.4;
}

.log-time {
  color: #909399;
  margin-right: 8px;
  min-width: 80px;
}

.log-message {
  flex: 1;
}

.log-info .log-message {
  color: #606266;
}

.log-success .log-message {
  color: #67c23a;
}

.log-error .log-message {
  color: #f56c6c;
}

.video-panel {
  min-height: 500px;
}

.video-container {
  width: 100%;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.placeholder {
  height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
