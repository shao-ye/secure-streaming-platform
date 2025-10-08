<template>
  <div class="tunnel-config">
    <el-card class="config-card">
      <template #header>
        <div class="card-header">
          <span>🌐 隧道优化配置</span>
          <el-tag :type="tunnelConfig.enabled ? 'success' : 'info'">
            {{ tunnelConfig.enabled ? '已启用' : '已禁用' }}
          </el-tag>
        </div>
      </template>
      
      <div class="config-content">
        <div class="config-item">
          <el-switch
            v-model="tunnelConfig.enabled"
            :loading="updating"
            active-text="启用隧道优化"
            inactive-text="禁用隧道优化"
            @change="handleToggle"
          />
        </div>
        
        <div class="config-description">
          <p>{{ tunnelConfig.description || '隧道优化功能可以显著提升视频加载速度和稳定性' }}</p>
        </div>
        
        <!-- 部署状态显示 -->
        <div v-if="deploymentStatus" class="deployment-status">
          <el-alert
            :title="deploymentStatus.message"
            :type="getDeploymentType(deploymentStatus.status)"
            :closable="false"
            show-icon
          >
            <template v-if="deploymentStatus.status === 'deploying'">
              <el-progress :percentage="deploymentProgress" :show-text="false" />
              <p>预计剩余时间: {{ estimatedTime }}</p>
            </template>
            <template v-else-if="deploymentStatus.status === 'manual_required'">
              <div class="manual-deployment">
                <p><strong>{{ deploymentStatus.note }}</strong></p>
                <ol class="manual-steps">
                  <li v-for="step in deploymentStatus.manualSteps" :key="step">
                    {{ step }}
                  </li>
                </ol>
              </div>
            </template>
          </el-alert>
        </div>
        
        <!-- 隧道状态显示（仅在启用时显示） -->
        <div class="tunnel-status" v-if="tunnelConfig.enabled">
          <h4>隧道状态</h4>
          <div class="status-grid">
            <div class="status-item">
              <span class="label">健康状态:</span>
              <el-tag :type="getHealthType(tunnelStatus?.health)">
                {{ getHealthText(tunnelStatus?.health) }}
              </el-tag>
            </div>
            <div class="status-item">
              <span class="label">响应时间:</span>
              <span>{{ tunnelConfig.endpoints?.tunnel?.responseTime || '未知' }}</span>
            </div>
            <div class="status-item">
              <span class="label">最后检查:</span>
              <span>{{ formatTime(tunnelConfig.endpoints?.tunnel?.lastCheck) }}</span>
            </div>
          </div>
        </div>
        
        <!-- 禁用状态说明 -->
        <div class="disabled-info" v-else>
          <el-alert
            title="隧道优化已禁用"
            type="info"
            description="当前使用直连模式访问VPS服务器。启用隧道优化可显著提升视频加载速度和稳定性。"
            :closable="false"
            show-icon
          />
        </div>
        
        <div class="tunnel-endpoints">
          <h4>端点配置</h4>
          <div class="endpoints-grid">
            <div class="endpoint-group">
              <h5>🚀 隧道端点 (优化)</h5>
              <ul>
                <li v-for="(value, service) in tunnelConfig.endpoints?.tunnel" :key="service">
                  <strong>{{ service }}:</strong> 
                  <span v-if="typeof value === 'string'">{{ value }}</span>
                  <span v-else-if="service === 'status'" :class="`status-${value}`">{{ value }}</span>
                  <span v-else-if="service === 'responseTime'">{{ value }}</span>
                  <span v-else>{{ value }}</span>
                </li>
              </ul>
            </div>
            <div class="endpoint-group">
              <h5>🔗 直连端点 (备用)</h5>
              <ul>
                <li v-for="(value, service) in tunnelConfig.endpoints?.direct" :key="service">
                  <strong>{{ service }}:</strong> 
                  <span v-if="typeof value === 'string'">{{ value }}</span>
                  <span v-else-if="service === 'status'" :class="`status-${value}`">{{ value }}</span>
                  <span v-else-if="service === 'responseTime'">{{ value }}</span>
                  <span v-else>{{ value }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useApiService } from '@/services/api'

const api = useApiService()
const tunnelConfig = ref({
  enabled: false,
  description: '',
  endpoints: null
})
const tunnelStatus = ref(null)
const updating = ref(false)
const deploymentStatus = ref(null)
const deploymentProgress = ref(0)
const estimatedTime = ref('')

const loadTunnelConfig = async () => {
  try {
    const response = await api.request('/api/admin/tunnel/config')
    const data = response.data
    if (data.status === 'success') {
      // 修复数据结构解析
      tunnelConfig.value = {
        enabled: data.data.enabled,
        description: data.data.description,
        endpoints: data.data.endpoints,
        performance: data.data.performance,
        updatedAt: data.data.updatedAt
      }
      tunnelStatus.value = { 
        health: data.data.endpoints?.tunnel?.status || 'unknown'
      }
    }
  } catch (error) {
    ElMessage.error('加载隧道配置失败')
  }
}

const handleToggle = async (enabled) => {
  updating.value = true
  try {
    const response = await api.request('/api/admin/tunnel/config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: enabled,
        description: tunnelConfig.value.description
      })
    })
    
    const data = response.data
    if (data.status === 'success') {
      // 检查是否需要手动部署
      if (data.data.status === 'manual_deployment_required') {
        ElMessage.warning({
          message: data.data.message,
          duration: 8000
        })
        // 显示手动部署步骤
        deploymentStatus.value = {
          status: 'manual_required',
          message: data.data.message,
          note: data.data.note,
          manualSteps: data.data.manualSteps
        }
        // 更新配置状态
        tunnelConfig.value.enabled = data.data.enabled
      } else {
        deploymentStatus.value = {
          status: 'deploying',
          message: data.data.message,
          deploymentId: data.data.deploymentId
        }
        
        ElMessage.success('隧道配置更新中，正在自动部署...')
        
        // 开始轮询部署状态
        startDeploymentPolling(data.data.deploymentId)
      }
    } else {
      throw new Error(data.message)
    }
  } catch (error) {
    ElMessage.error('更新隧道配置失败: ' + error.message)
    // 回滚开关状态
    tunnelConfig.value.enabled = !enabled
  } finally {
    updating.value = false
  }
}

const startDeploymentPolling = (deploymentId) => {
  let progress = 0
  let timeRemaining = 60
  
  const progressInterval = setInterval(() => {
    progress += 2
    timeRemaining -= 1
    
    deploymentProgress.value = Math.min(progress, 95)
    estimatedTime.value = `${timeRemaining}秒`
    
    if (progress >= 95) {
      clearInterval(progressInterval)
    }
  }, 1000)
  
  // 2分钟后停止轮询并显示完成
  setTimeout(() => {
    clearInterval(progressInterval)
    deploymentProgress.value = 100
    deploymentStatus.value = {
      status: 'success',
      message: '隧道配置部署完成！'
    }
    
    setTimeout(() => {
      deploymentStatus.value = null
      loadTunnelConfig() // 重新加载配置
    }, 3000)
  }, 60000) // 60秒后完成
}

const getDeploymentType = (status) => {
  switch (status) {
    case 'deploying': return 'warning'
    case 'success': return 'success'
    case 'failed': return 'error'
    case 'manual_required': return 'warning'
    default: return 'info'
  }
}

const getHealthType = (status) => {
  switch (status) {
    case 'healthy': return 'success'
    case 'ready': return 'success'
    case 'warning': return 'warning'
    case 'unhealthy': return 'warning'
    case 'error': return 'danger'
    default: return 'info'
  }
}

const getHealthText = (status) => {
  switch (status) {
    case 'healthy': return '健康'
    case 'ready': return '就绪'
    case 'warning': return '警告'
    case 'unhealthy': return '不健康'
    case 'error': return '错误'
    default: return '未知'
  }
}

const formatTime = (timestamp) => {
  if (!timestamp) return '未知'
  try {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return '未知'
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch (error) {
    return '未知'
  }
}

onMounted(() => {
  loadTunnelConfig()
})
</script>

<style scoped>
.tunnel-config {
  max-width: 800px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.config-content {
  space-y: 20px;
}

.config-item {
  margin-bottom: 20px;
}

.config-description {
  color: #666;
  font-size: 14px;
  margin-bottom: 20px;
}

.deployment-status {
  margin-bottom: 20px;
}

.tunnel-status {
  margin-bottom: 20px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 6px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 15px;
  margin-top: 10px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: white;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
}

.disabled-info {
  margin: 20px 0;
}

.label {
  font-weight: 500;
}

.tunnel-endpoints {
  margin-top: 20px;
}

.endpoints-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 10px;
}

.endpoint-group ul {
  list-style: none;
  padding: 0;
  margin: 10px 0;
}

.endpoint-group li {
  padding: 5px 0;
  font-size: 12px;
  word-break: break-all;
}

.manual-deployment {
  margin-top: 15px;
}

.manual-steps {
  margin: 10px 0;
  padding-left: 20px;
}

.manual-steps li {
  margin: 8px 0;
  font-family: 'Courier New', monospace;
  background: #f5f5f5;
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 3px solid #409eff;
}
</style>
