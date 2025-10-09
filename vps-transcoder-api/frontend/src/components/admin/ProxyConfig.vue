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

    <!-- 代理列表管理 -->
    <el-card class="proxy-list-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>代理配置列表</span>
          <el-button 
            type="primary" 
            @click="showAddDialog = true"
            size="small"
          >
            添加代理
          </el-button>
        </div>
      </template>
      
      <el-table 
        :data="proxyList" 
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
            <span class="proxy-url">{{ maskProxyUrl(row.config) }}</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        
        <el-table-column label="延迟" width="100">
          <template #default="{ row }">
            <span v-if="row.latency">
              <span v-if="typeof row.latency === 'string'">{{ row.latency }}</span>
              <span v-else>{{ row.latency }}ms</span>
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button 
              @click="testProxy(row)" 
              size="small" 
              type="info"
              :loading="row.testing"
            >
              测试
            </el-button>
            <el-button 
              @click="editProxy(row)" 
              size="small" 
              type="primary"
            >
              编辑
            </el-button>
            <el-button 
              @click="deleteProxy(row)" 
              size="small" 
              type="danger"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 添加/编辑代理对话框 -->
    <el-dialog
      v-model="showAddDialog"
      :title="editMode ? '编辑代理' : '添加代理'"
      width="600px"
      @close="resetForm"
    >
      <el-form
        ref="formRef"
        :model="proxyForm"
        :rules="formRules"
        label-width="100px"
      >
        <el-form-item label="代理名称" prop="name">
          <el-input
            v-model="proxyForm.name"
            placeholder="请输入代理名称"
            maxlength="50"
          />
        </el-form-item>

        <el-form-item label="代理类型" prop="type">
          <el-select v-model="proxyForm.type" placeholder="请选择代理类型" style="width: 100%">
            <el-option label="VLESS" value="vless" />
            <el-option label="VMess" value="vmess" />
            <el-option label="Shadowsocks" value="shadowsocks" />
            <el-option label="HTTP" value="http" />
          </el-select>
        </el-form-item>

        <el-form-item label="代理配置" prop="config">
          <el-input
            v-model="proxyForm.config"
            type="textarea"
            :rows="4"
            placeholder="请输入代理配置URL，例如：vless://uuid@host:port?params"
          />
        </el-form-item>

        <el-form-item label="优先级" prop="priority">
          <el-input-number
            v-model="proxyForm.priority"
            :min="1"
            :max="100"
            style="width: 100%"
          />
        </el-form-item>

        <el-form-item label="备注">
          <el-input
            v-model="proxyForm.remarks"
            placeholder="可选的备注信息"
            maxlength="200"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showAddDialog = false">取消</el-button>
          <el-button type="primary" @click="saveProxy" :loading="saving">
            {{ editMode ? '保存' : '添加' }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { proxyApi } from '../../services/proxyApi'

// 响应式数据
const proxyEnabled = ref(false)
const switchLoading = ref(false)
const connectionStatus = ref('disconnected')
const currentProxy = ref(null)
const loading = ref(false)
const saving = ref(false)
const showAddDialog = ref(false)
const editMode = ref(false)
const formRef = ref()

// 代理列表 - 从API加载
const proxyList = ref([])

// 表单数据
const proxyForm = ref({
  name: '',
  type: 'vless',
  config: '',
  priority: 1,
  remarks: ''
})

// 表单验证规则
const formRules = {
  name: [
    { required: true, message: '请输入代理名称', trigger: 'blur' },
    { min: 2, max: 50, message: '名称长度在 2 到 50 个字符', trigger: 'blur' }
  ],
  type: [
    { required: true, message: '请选择代理类型', trigger: 'change' }
  ],
  config: [
    { required: true, message: '请输入代理配置', trigger: 'blur' }
  ],
  priority: [
    { required: true, message: '请设置优先级', trigger: 'blur' },
    { type: 'number', min: 1, max: 100, message: '优先级范围为 1-100', trigger: 'blur' }
  ]
}

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

// 获取协议类型颜色
const getTypeColor = (type) => {
  switch (type) {
    case 'vless': return 'success'
    case 'vmess': return 'primary'
    case 'shadowsocks': return 'warning'
    case 'http': return 'info'
    default: return 'info'
  }
}

// 获取协议类型文本
const getTypeText = (type) => {
  switch (type) {
    case 'vless': return 'VLESS'
    case 'vmess': return 'VMess'
    case 'shadowsocks': return 'SS'
    case 'http': return 'HTTP'
    default: return type.toUpperCase()
  }
}

// 隐藏代理URL敏感信息
const maskProxyUrl = (url) => {
  if (!url) return ''
  
  // 简单的URL脱敏处理
  if (url.includes('://')) {
    const parts = url.split('://')
    if (parts[1]) {
      const afterProtocol = parts[1]
      const atIndex = afterProtocol.indexOf('@')
      if (atIndex > 0) {
        const masked = afterProtocol.substring(0, 4) + '****' + afterProtocol.substring(atIndex)
        return parts[0] + '://' + masked
      }
    }
  }
  
  return url.length > 50 ? url.substring(0, 50) + '...' : url
}

// 处理代理开关切换
const handleProxyToggle = async (enabled) => {
  switchLoading.value = true
  try {
    // 调用真实API
    await proxyApi.toggleProxy(enabled)
    
    if (enabled) {
      connectionStatus.value = 'connecting'
      // 获取代理状态
      const status = await proxyApi.getStatus()
      connectionStatus.value = status.connectionStatus || 'connected'
      currentProxy.value = status.currentProxy || '已启用代理'
      ElMessage.success('代理已启用')
    } else {
      connectionStatus.value = 'disconnected'
      currentProxy.value = null
      ElMessage.info('代理已禁用')
    }
  } catch (error) {
    ElMessage.error('代理切换失败: ' + (error.message || '网络错误'))
    proxyEnabled.value = !enabled
  } finally {
    switchLoading.value = false
  }
}

// 测试代理连接
const testProxy = async (proxy) => {
  proxy.testing = true
  try {
    // 调用真实API测试代理
    const result = await proxyApi.testProxy({
      id: proxy.id,
      name: proxy.name,
      type: proxy.type,
      config: proxy.config
    })
    
    console.log('代理测试结果:', result)
    
    // 检查API响应结构
    const testData = result.data || result
    
    if (testData && testData.success) {
      // 代理测试成功
      proxy.latency = testData.latency || 0
      proxy.status = 'connected'
      
      // 根据测试方法显示不同的消息
      const method = testData.method || 'unknown'
      const latencyText = testData.latency ? `${testData.latency}ms` : '< 1ms'
      
      if (method === 'local_validation') {
        ElMessage.success(`代理配置验证通过 (本地验证) - 配置格式正确，服务器信息有效`)
        // 对于本地验证，不显示延迟或显示为"配置验证"
        proxy.latency = '配置验证'
      } else if (method === 'vps_validation') {
        ElMessage.success(`代理连接测试成功 (VPS验证), 网络延迟: ${latencyText}`)
        proxy.latency = testData.latency
      } else {
        ElMessage.success(`代理测试成功, 延迟: ${latencyText}`)
        proxy.latency = testData.latency
      }
    } else {
      // 代理测试失败
      proxy.status = 'error'
      const errorMsg = testData?.error || result.message || '连接测试失败'
      ElMessage.error(`代理测试失败: ${errorMsg}`)
    }
  } catch (error) {
    console.error('代理测试异常:', error)
    proxy.status = 'error'
    ElMessage.error('代理测试失败: ' + (error.message || '网络错误'))
  } finally {
    proxy.testing = false
  }
}

// 编辑代理
const editProxy = (proxy) => {
  editMode.value = true
  proxyForm.value = {
    id: proxy.id,
    name: proxy.name,
    type: proxy.type,
    config: proxy.config,
    priority: proxy.priority,
    remarks: proxy.remarks
  }
  showAddDialog.value = true
}

// 删除代理
const deleteProxy = async (proxy) => {
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
    
    // 调用API删除代理
    await proxyApi.deleteProxy(proxy.id)
    
    // 从本地列表中删除
    const index = proxyList.value.findIndex(p => p.id === proxy.id)
    if (index > -1) {
      proxyList.value.splice(index, 1)
    }
    
    ElMessage.success('代理删除成功')
    
    // 刷新代理列表以确保数据同步
    await loadProxyConfig()
    
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除代理失败:', error)
      ElMessage.error(`删除代理失败: ${error.message || '未知错误'}`)
    }
  }
}

// 保存代理
const saveProxy = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    saving.value = true
    
    if (editMode.value) {
      // 编辑模式 - 调用真实API
      await proxyApi.updateProxy(proxyForm.value.id, proxyForm.value)
      
      // 更新本地列表
      const index = proxyList.value.findIndex(p => p.id === proxyForm.value.id)
      if (index > -1) {
        proxyList.value[index] = {
          ...proxyList.value[index],
          ...proxyForm.value,
          status: 'disconnected',
          latency: null,
          testing: false
        }
      }
      ElMessage.success('代理更新成功')
    } else {
      // 添加模式 - 调用真实API
      const result = await proxyApi.createProxy(proxyForm.value)
      
      // 添加到本地列表
      const newProxy = {
        id: result.id || `proxy_${Date.now()}`,
        ...proxyForm.value,
        status: 'disconnected',
        latency: null,
        testing: false
      }
      proxyList.value.push(newProxy)
      ElMessage.success('代理添加成功')
    }
    
    showAddDialog.value = false
    resetForm()
  } catch (error) {
    ElMessage.error('保存失败: ' + (error.message || '网络错误'))
  } finally {
    saving.value = false
  }
}

// 重置表单
const resetForm = () => {
  editMode.value = false
  proxyForm.value = {
    name: '',
    type: 'vless',
    config: '',
    priority: 1,
    remarks: ''
  }
  if (formRef.value) {
    formRef.value.clearValidate()
  }
}

// 加载代理配置数据
const loadProxyConfig = async () => {
  loading.value = true
  try {
    // 获取代理配置
    const config = await proxyApi.getConfig()
    
    if (config.success) {
      // 加载代理列表并设置初始状态
      proxyList.value = (config.data.proxies || []).map(proxy => ({
        ...proxy,
        status: proxy.status || 'disconnected', // 设置默认状态
        latency: proxy.latency || null,
        testing: false
      }))
      proxyEnabled.value = config.data.settings?.enabled || false
      
      // 获取代理状态
      if (proxyEnabled.value) {
        const status = await proxyApi.getStatus()
        connectionStatus.value = status.connectionStatus || 'disconnected'
        currentProxy.value = status.currentProxy
      }
    }
  } catch (error) {
    console.warn('加载代理配置失败:', error)
    ElMessage.warning('加载代理配置失败，使用离线模式')
    
    // 如果API失败，显示示例数据
    proxyList.value = [
      {
        id: 'example_1',
        name: '示例节点（请添加真实代理）',
        type: 'vless',
        config: 'vless://example-uuid@example.com:443?params',
        status: 'disconnected',
        latency: null,
        priority: 1,
        remarks: '这是示例数据，请添加真实的代理配置',
        testing: false
      }
    ]
  } finally {
    loading.value = false
  }
}

// 组件挂载时初始化
onMounted(() => {
  loadProxyConfig()
})
</script>

<style scoped>
.proxy-config {
  padding: 20px;
}

.proxy-switch-card,
.proxy-list-card {
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

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.proxy-url {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #606266;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
