<template>
  <div class="proxy-list">
    <el-table 
      :data="proxies" 
      stripe 
      :loading="loading"
      empty-text="暂无代理配置"
    >
      <el-table-column prop="name" label="代理名称" width="150" />
      
      <el-table-column prop="type" label="协议类型" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="getTypeColor(row.type)">
            {{ getTypeText(row.type) }}
          </el-tag>
        </template>
      </el-table-column>
      
      <el-table-column label="代理配置" min-width="300">
        <template #default="{ row }">
          <div class="proxy-config-display">
            <span class="config-text">{{ formatProxyConfig(row.config) }}</span>
            <el-button 
              size="small" 
              text 
              @click="copyConfig(row.config)"
              :icon="DocumentCopy"
              title="复制配置"
            />
          </div>
        </template>
      </el-table-column>
      
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)" size="small">
            {{ getStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      
      <el-table-column prop="latency" label="延迟" width="80">
        <template #default="{ row }">
          <span v-if="row.latency" class="latency-text">
            {{ row.latency }}ms
          </span>
          <span v-else class="no-data">-</span>
        </template>
      </el-table-column>
      
      <el-table-column prop="priority" label="优先级" width="80" />
      
      <el-table-column label="最后检查" width="120">
        <template #default="{ row }">
          <span class="last-check">
            {{ formatDateTime(row.lastCheck) }}
          </span>
        </template>
      </el-table-column>
      
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <div class="action-buttons">
            <el-button 
              size="small" 
              @click="$emit('activate', row)"
              :disabled="row.id === activeProxy"
              :type="row.id === activeProxy ? 'success' : 'primary'"
              :icon="row.id === activeProxy ? Check : Switch"
            >
              {{ row.id === activeProxy ? '当前' : '激活' }}
            </el-button>
            
            <el-button 
              size="small" 
              type="warning"
              @click="$emit('test', row)"
              :icon="Connection"
              :loading="testingProxies.has(row.id)"
            >
              测试
            </el-button>
            
            <el-button 
              size="small" 
              @click="$emit('edit', row)"
              :icon="Edit"
            >
              编辑
            </el-button>
            
            <el-button 
              size="small" 
              type="danger" 
              @click="$emit('delete', row)"
              :icon="Delete"
              :disabled="row.id === activeProxy"
            >
              删除
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { 
  Edit, 
  Delete, 
  Check, 
  Switch, 
  Connection,
  DocumentCopy 
} from '@element-plus/icons-vue'

const props = defineProps({
  proxies: {
    type: Array,
    default: () => []
  },
  activeProxy: {
    type: String,
    default: null
  },
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['edit', 'delete', 'activate', 'test'])

// 正在测试的代理集合
const testingProxies = ref(new Set())

// 获取协议类型颜色
const getTypeColor = (type) => {
  const colorMap = {
    'vless': 'success',
    'vmess': 'primary',
    'ss': 'warning',
    'http': 'info'
  }
  return colorMap[type] || 'info'
}

// 获取协议类型文本
const getTypeText = (type) => {
  const textMap = {
    'vless': 'VLESS',
    'vmess': 'VMess',
    'ss': 'Shadowsocks',
    'http': 'HTTP'
  }
  return textMap[type] || type.toUpperCase()
}

// 获取状态类型
const getStatusType = (status) => {
  const statusMap = {
    'active': 'success',
    'inactive': 'info',
    'error': 'danger',
    'testing': 'warning'
  }
  return statusMap[status] || 'info'
}

// 获取状态文本
const getStatusText = (status) => {
  const statusMap = {
    'active': '正常',
    'inactive': '未激活',
    'error': '错误',
    'testing': '测试中'
  }
  return statusMap[status] || '未知'
}

// 格式化代理配置显示
const formatProxyConfig = (config) => {
  if (!config) return ''
  
  // 截取配置字符串，避免过长
  if (config.length > 60) {
    return config.substring(0, 60) + '...'
  }
  return config
}

// 复制配置到剪贴板
const copyConfig = async (config) => {
  try {
    await navigator.clipboard.writeText(config)
    ElMessage.success('配置已复制到剪贴板')
  } catch (error) {
    // 降级方案：创建临时文本框
    const textArea = document.createElement('textarea')
    textArea.value = config
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    ElMessage.success('配置已复制到剪贴板')
  }
}

// 格式化日期时间
const formatDateTime = (dateString) => {
  if (!dateString) return '从未'
  
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now - date
    
    // 小于1分钟显示"刚刚"
    if (diff < 60000) {
      return '刚刚'
    }
    
    // 小于1小时显示分钟
    if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}分钟前`
    }
    
    // 小于24小时显示小时
    if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}小时前`
    }
    
    // 超过24小时显示具体时间
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (error) {
    return '无效时间'
  }
}
</script>

<style scoped>
.proxy-list {
  width: 100%;
}

.proxy-config-display {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-text {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  color: #606266;
  flex: 1;
  word-break: break-all;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-start;
}

.action-buttons .el-button {
  margin: 0;
  padding: 4px 8px;
  font-size: 12px;
  min-width: auto;
}

.latency-text {
  color: #67c23a;
  font-weight: 500;
}

.no-data {
  color: #c0c4cc;
}

.last-check {
  font-size: 12px;
  color: #909399;
}

:deep(.el-table) {
  font-size: 14px;
}

:deep(.el-table .cell) {
  padding: 8px 12px;
}

:deep(.el-table th) {
  padding: 8px 0;
}

:deep(.el-table td) {
  padding: 6px 0;
}

:deep(.el-table__body-wrapper) {
  max-height: calc(100vh - 500px);
  overflow-y: auto;
}
</style>
