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

    <!-- 测试网站配置 -->
    <el-card class="test-config-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span>测试配置</span>
        </div>
      </template>
      
      <el-form inline>
        <el-form-item label="测试网站:">
          <el-select 
            v-model="globalTestUrlId" 
            placeholder="选择测试网站"
            style="width: 200px"
            @change="updateGlobalTestUrlId"
          >
            <el-option 
              label="百度 (推荐)" 
              value="baidu"
            />
            <el-option 
              label="谷歌" 
              value="google"
            />
          </el-select>
          <el-text class="ml-2" type="info" size="small">
            百度：测试代理对中国用户的加速效果 | 谷歌：测试代理的国际访问能力
          </el-text>
        </el-form-item>
      </el-form>
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
      
      <div class="table-container">
        <el-table 
        :data="proxyList" 
        stripe 
        :loading="loading"
        empty-text="暂无代理配置"
        style="width: 100%; min-width: 1000px;"
        :table-layout="'auto'"
      >
        <el-table-column type="index" label="序号" width="60" />
        
        <el-table-column prop="id" label="代理ID" width="180">
          <template #default="{ row }">
            <span class="proxy-id">{{ row.id }}</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="name" label="代理名称" min-width="150" />
        
        <el-table-column prop="type" label="协议类型" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="getTypeColor(row.type)">
              {{ getTypeText(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        
        <el-table-column label="延迟" width="100" align="center">
          <template #default="{ row }">
            <span v-if="row.testing" class="testing-status">
              <el-icon class="is-loading"><Loading /></el-icon>
              测试中...
            </span>
            <span v-else-if="row.currentTestFailed" class="failed-status">-1</span>
            <span v-else-if="typeof row.latency === 'number' && row.latency > 0" class="success-status">{{ row.latency }}ms</span>
            <span v-else-if="row.lastTestLatency && row.lastTestLatency > 0" class="history-status">{{ row.lastTestLatency }}ms</span>
            <span v-else class="default-status">-</span>
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button 
              v-if="!row.isActive"
              @click="enableProxy(row)" 
              size="small" 
              type="success"
              :loading="row.enabling"
              :disabled="!proxySettings.enabled || row.enabling"
            >
              {{ row.enabling ? '连接中...' : '连接' }}
            </el-button>
            <el-button 
              v-else
              @click="disableProxy(row)" 
              size="small" 
              type="warning"
              :loading="row.disabling"
              :disabled="row.disabling"
            >
              {{ row.disabling ? '断开中...' : '断开' }}
            </el-button>
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
      </div>
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
import { ref, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
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

// 代理设置
const proxySettings = ref({
  enabled: false,
  activeProxyId: null
})

// 代理列表 - 从API加载
const proxyList = ref([])

// 全局测试网站ID配置
const globalTestUrlId = ref('baidu') // 默认选择百度

// 并发测试控制
const testingCount = ref(0)
const MAX_CONCURRENT_TESTS = 1 // 只允许同时测试一个

// 频率限制
const testFrequencyCount = ref(0)
const MAX_TESTS_PER_MINUTE = 20

// 每分钟重置计数器
setInterval(() => {
  testFrequencyCount.value = 0
}, 60000)

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

// 获取代理初始状态
const getInitialProxyStatus = (proxy, activeProxyId) => {
  // 如果是活跃代理，需要根据实际连接状态设置
  if (proxy.id === activeProxyId) {
    // 这里先设置为连接中，后续会通过API更新实际状态
    return 'connecting'
  }
  // 非活跃代理设置为未连接
  return 'disconnected'
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

// 基于服务器位置估算延迟
const estimateLatencyByServer = (config) => {
  if (!config) return '配置验证'
  
  try {
    // 解析代理配置中的服务器地址
    let serverHost = ''
    
    if (config.includes('@')) {
      const parts = config.split('@')
      if (parts[1]) {
        const hostPart = parts[1].split(':')[0].split('?')[0]
        serverHost = hostPart
      }
    }
    
    // 基于服务器地址估算延迟
    if (serverHost) {
      // 日本服务器
      if (serverHost.includes('jp') || serverHost.includes('japan') || serverHost.includes('136.0.11')) {
        return '~80ms'
      }
      // 美国服务器
      if (serverHost.includes('us') || serverHost.includes('america') || serverHost.includes('104.224')) {
        return '~150ms'
      }
      // 香港服务器
      if (serverHost.includes('hk') || serverHost.includes('hongkong')) {
        return '~30ms'
      }
      // 新加坡服务器
      if (serverHost.includes('sg') || serverHost.includes('singapore')) {
        return '~50ms'
      }
      // 欧洲服务器
      if (serverHost.includes('eu') || serverHost.includes('europe')) {
        return '~200ms'
      }
    }
    
    // 默认估算
    return '~100ms'
  } catch (error) {
    console.warn('延迟估算失败:', error)
    return '配置验证'
  }
}

// 处理代理开关切换
const handleProxyToggle = async (enabled) => {
  switchLoading.value = true
  try {
    // 更新代理设置
    proxySettings.value.enabled = enabled
    
    // 调用API更新设置
    await proxyApi.updateSettings({ enabled })
    
    // 保存代理配置到localStorage供前端路由使用
    const proxyConfig = {
      enabled: enabled,
      activeProxyId: proxySettings.value.activeProxyId,
      updatedAt: new Date().toISOString()
    }
    localStorage.setItem('proxy_config', JSON.stringify(proxyConfig))
    console.log('代理配置已保存到localStorage:', proxyConfig)
    
    if (enabled) {
      ElMessage.success('代理功能已启用，请选择一个代理进行连接')
      // 如果有活跃代理，尝试获取状态
      if (proxySettings.value.activeProxyId) {
        try {
          const status = await proxyApi.getStatus()
          connectionStatus.value = status.connectionStatus || 'disconnected'
          currentProxy.value = status.currentProxy
        } catch (error) {
          console.warn('获取代理状态失败:', error)
        }
      }
    } else {
      // 禁用代理功能时，同时禁用所有活跃代理
      if (proxySettings.value.activeProxyId) {
        const activeProxy = proxyList.value.find(p => p.isActive)
        if (activeProxy) {
          try {
            await proxyApi.disableProxy(activeProxy.id)
            activeProxy.isActive = false
            activeProxy.status = 'disconnected'
            activeProxy.latency = null
          } catch (error) {
            console.warn('禁用活跃代理失败:', error)
          }
        }
      }
      
      // 重置状态
      proxySettings.value.activeProxyId = null
      connectionStatus.value = 'disconnected'
      currentProxy.value = null
      
      // 更新所有代理状态
      proxyList.value.forEach(proxy => {
        proxy.isActive = false
        proxy.status = 'disconnected'
      })
      
      ElMessage.info('代理功能已禁用')
    }
  } catch (error) {
    console.error('代理切换失败:', error)
    ElMessage.error('代理切换失败: ' + (error.message || '网络错误'))
    // 回滚状态
    proxyEnabled.value = !enabled
    proxySettings.value.enabled = !enabled
  } finally {
    switchLoading.value = false
  }
}

// ID验证函数
const validateTestUrlId = (urlId) => {
  const allowedIds = ['baidu', 'google']
  return allowedIds.includes(urlId)
}

// 更新全局测试网站配置
const updateGlobalTestUrlId = async (newUrlId) => {
  try {
    await proxyApi.setGlobalTestUrlId(newUrlId)
    ElMessage.success('测试网站配置已更新')
  } catch (error) {
    ElMessage.error('更新配置失败')
    // 回滚到之前的值
    globalTestUrlId.value = 'baidu'
  }
}

// 🔧 新增：加载所有代理的历史测试结果
const loadProxyTestHistory = async () => {
  try {
    console.log('🔄 开始加载代理历史测试结果...')
    
    for (const proxy of proxyList.value) {
      try {
        const historyResult = await proxyApi.getProxyTestHistory(proxy.id, 1) // 只获取最新的一条记录
        const historyData = historyResult.data || historyResult
        
        if (historyData && historyData.length > 0) {
          const latestTest = historyData[0]
          if (latestTest.success && latestTest.latency > 0) {
            proxy.lastTestLatency = latestTest.latency
            proxy.lastTestTime = latestTest.timestamp
            console.log(`✅ 代理 ${proxy.name} 历史延迟: ${latestTest.latency}ms`)
          }
        }
      } catch (error) {
        console.warn(`获取代理 ${proxy.name} 历史测试结果失败:`, error)
      }
    }
    
    console.log('✅ 代理历史测试结果加载完成')
  } catch (error) {
    console.error('加载代理历史测试结果失败:', error)
  }
}

// 🔧 新增：自动刷新已连接代理的延迟测试
const refreshActiveProxyLatency = async () => {
  try {
    console.log('🔄 开始刷新已连接代理的延迟...')
    
    const activeProxy = proxyList.value.find(proxy => proxy.isActive && proxy.status === 'connected')
    
    if (activeProxy) {
      console.log(`🎯 发现已连接代理: ${activeProxy.name}，开始测试延迟...`)
      
      // 异步测试延迟，不阻塞页面加载
      setTimeout(() => {
        testProxy(activeProxy)
      }, 1000) // 延迟1秒执行，确保页面完全加载
    } else {
      console.log('ℹ️ 没有发现已连接的代理，跳过延迟刷新')
    }
  } catch (error) {
    console.error('刷新已连接代理延迟失败:', error)
  }
}

// 测试代理连接 - 真实延迟测试
const testProxy = async (proxy) => {
  try {
    // 检查频率限制
    if (testFrequencyCount.value >= MAX_TESTS_PER_MINUTE) {
      ElMessage.warning('测试频率过高，请稍后再试')
      return
    }
    
    // 检查并发限制
    if (testingCount.value >= MAX_CONCURRENT_TESTS) {
      ElMessage.warning('请等待当前测试完成')
      return
    }
    
    // ID安全验证
    if (!validateTestUrlId(globalTestUrlId.value)) {
      ElMessage.error('无效的测试网站ID')
      return
    }
    
    testingCount.value++
    testFrequencyCount.value++
    proxy.testing = true
    proxy.currentTestFailed = false // 清除之前的测试失败标志
    
    console.log('🚀 开始真实代理测试:', { name: proxy.name, testUrlId: globalTestUrlId.value })
    
    // 调用真实API测试代理，传递ID而不是URL
    const result = await proxyApi.testProxy({
      id: proxy.id,
      name: proxy.name,
      type: proxy.type,
      config: proxy.config,
      testUrlId: globalTestUrlId.value
    })
    
    console.log('代理测试结果:', result)
    
    // 检查API响应结构
    const testData = result.data || result
    
    if (testData && testData.success && testData.method === 'real_test') {
      // 显示真实延迟
      proxy.latency = testData.latency
      proxy.currentTestFailed = false
      ElMessage.success(`代理测试成功 - 延迟: ${testData.latency}ms`)
    } else {
      // 标记当前测试失败，但不覆盖历史延迟
      proxy.currentTestFailed = true
      proxy.latency = null // 重置当前延迟，让历史延迟显示
      ElMessage.error('代理测试失败 - 连接不可用')
    }
  } catch (error) {
    proxy.currentTestFailed = true
    proxy.latency = null // 重置当前延迟，让历史延迟显示
    ElMessage.error(`代理测试失败: ${error.message}`)
  } finally {
    proxy.testing = false
    testingCount.value--
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
    
    console.log('🔍 API返回的完整配置:', config)
    
    // 修复：检查正确的响应格式 (status === 'success' 而不是 success)
    if (config.status === 'success' && config.data) {
      // 更新代理设置
      proxySettings.value = {
        enabled: config.data.settings?.enabled || false,
        activeProxyId: config.data.settings?.activeProxyId || null
      }
      proxyEnabled.value = proxySettings.value.enabled
      
      // 加载代理列表并设置初始状态 - 根据isActive和后台连接状态正确设置
      proxyList.value = (config.data.proxies || []).map(proxy => ({
        ...proxy,
        status: getInitialProxyStatus(proxy, proxySettings.value.activeProxyId),
        latency: proxy.latency || null,
        testing: false,
        enabling: false,
        disabling: false,
        isActive: proxy.id === proxySettings.value.activeProxyId,
        currentTestFailed: false, // 初始化测试失败标志
        lastTestLatency: null, // 初始化历史延迟
        lastTestTime: null // 初始化历史测试时间
      }))
      
      console.log('加载的代理列表:', proxyList.value.length, '个代理')
      console.log('代理列表内容:', proxyList.value)
      console.log('活跃代理ID:', proxySettings.value.activeProxyId)
      
      // 强制触发Vue响应式更新
      nextTick(() => {
        console.log('Vue nextTick - 代理列表长度:', proxyList.value.length)
      })
      
      // 获取VPS代理状态 - 总是尝试获取状态以确保显示正确
      try {
        const status = await proxyApi.getStatus()
        console.log('获取到的代理状态:', status)
        
        // 处理API响应的数据结构 - 可能有data嵌套
        const statusData = status.data || status
        console.log('解析后的状态数据:', statusData)
        
        connectionStatus.value = statusData.connectionStatus || 'disconnected'
        currentProxy.value = statusData.currentProxy
        
        // 强制更新所有代理的连接状态，使用API返回的真实状态
        console.log('开始更新代理状态，代理列表长度:', proxyList.value.length)
        console.log('VPS返回的活跃代理ID:', statusData.currentProxy)
        console.log('配置中的活跃代理ID:', proxySettings.value.activeProxyId)
        
        proxyList.value.forEach(proxy => {
          // 🔧 修复：正确处理VPS返回的currentProxy（可能是对象或字符串）
          const currentProxyId = statusData.currentProxy?.id || statusData.currentProxy
          const isActiveProxy = proxy.id === currentProxyId
          
          if (isActiveProxy && statusData.connectionStatus === 'connected') {
            // 当前连接的代理
            proxy.status = 'connected'
            proxy.isActive = true
            console.log(`✅ 设置活跃代理 ${proxy.name}(${proxy.id}) 状态: connected`)
            
            // 🔧 修复：设置真实的延迟信息
            if (statusData.statistics) {
              // 优先使用平均延迟（真实的网络延迟）
              if (statusData.statistics.avgLatency && statusData.statistics.avgLatency > 0) {
                proxy.latency = statusData.statistics.avgLatency
                console.log(`✅ 设置活跃代理 ${proxy.name} 真实延迟: ${proxy.latency}ms`)
              } else {
                // 如果没有真实延迟数据，启动延迟测试
                console.log(`🔄 活跃代理 ${proxy.name} 缺少延迟数据，启动测试...`)
                proxy.latency = null // 先设为null，避免显示错误数据
                
                // 异步测试真实延迟
                this.testProxyLatencyAsync(proxy)
              }
            } else {
              console.log(`⚠️ 活跃代理 ${proxy.name} 缺少统计数据`)
              proxy.latency = null
              // 异步测试真实延迟
              this.testProxyLatencyAsync(proxy)
            }
          } else if (isActiveProxy && statusData.connectionStatus === 'connecting') {
            // 正在连接的代理
            proxy.status = 'connecting'
            proxy.isActive = true
            proxy.latency = null
            console.log(`🔄 设置活跃代理 ${proxy.name}(${proxy.id}) 状态: connecting`)
          } else {
            // 非活跃代理设置为未连接
            proxy.status = 'disconnected'
            proxy.isActive = false
            proxy.latency = null
            console.log(`❌ 设置非活跃代理 ${proxy.name}(${proxy.id}) 为未连接`)
          }
        })
        
        // 同步更新activeProxyId以确保一致性
        if (statusData.currentProxy && statusData.currentProxy !== proxySettings.value.activeProxyId) {
          console.log(`🔄 同步活跃代理ID: ${proxySettings.value.activeProxyId} -> ${statusData.currentProxy}`)
          proxySettings.value.activeProxyId = statusData.currentProxy
        }
      } catch (error) {
        console.warn('获取代理状态失败:', error)
        // 如果获取状态失败，至少确保非活跃代理显示为未连接
        proxyList.value.forEach(proxy => {
          if (proxy.id !== proxySettings.value.activeProxyId) {
            proxy.status = 'disconnected'
          } else {
            // 活跃代理设置为错误状态
            proxy.status = 'error'
          }
        })
      }
      
      // 保存代理配置到localStorage供前端路由使用
      const proxyConfig = {
        enabled: proxySettings.value.enabled,
        activeProxyId: proxySettings.value.activeProxyId,
        updatedAt: new Date().toISOString()
      }
      localStorage.setItem('proxy_config', JSON.stringify(proxyConfig))
      console.log('代理配置已保存到localStorage:', proxyConfig)
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

// 启用代理
const enableProxy = async (proxy) => {
  if (!proxySettings.value.enabled) {
    ElMessage.warning('请先开启代理功能总开关')
    return
  }
  
  proxy.enabling = true
  try {
    // 禁用其他代理
    proxyList.value.forEach(p => {
      if (p.id !== proxy.id) {
        p.isActive = false
        p.status = 'disconnected'
      }
    })
    
    // 调用API启用代理
    const result = await proxyApi.enableProxy(proxy.id)
    
    if (result.success) {
      // 更新本地状态
      proxy.isActive = true
      proxy.status = 'connecting'
      proxySettings.value.activeProxyId = proxy.id
      
      // 测试网络延迟
      await testProxyLatency(proxy)
      
      // 检查连接状态 - 给VPS更多时间建立连接
      setTimeout(async () => {
        try {
          const status = await proxyApi.getStatus()
          connectionStatus.value = status.connectionStatus
          currentProxy.value = status.currentProxy
          
          if (status.connectionStatus === 'connected') {
            proxy.status = 'connected'
            ElMessage.success(`代理 "${proxy.name}" 连接成功`)
          } else if (status.connectionStatus === 'connecting') {
            proxy.status = 'connecting'
            ElMessage.info(`代理 "${proxy.name}" 正在连接中...`)
            // 如果还在连接中，再等待一段时间
            setTimeout(async () => {
              try {
                const finalStatus = await proxyApi.getStatus()
                proxy.status = finalStatus.connectionStatus === 'connected' ? 'connected' : 'error'
                if (proxy.status === 'connected') {
                  ElMessage.success(`代理 "${proxy.name}" 连接成功`)
                } else {
                  ElMessage.warning(`代理 "${proxy.name}" 连接超时，请检查代理配置或网络状况`)
                }
              } catch (error) {
                proxy.status = 'error'
                ElMessage.error(`代理 "${proxy.name}" 连接检查失败`)
              }
            }, 5000)
          } else {
            proxy.status = 'error'
            ElMessage.warning(`代理 "${proxy.name}" 连接失败 - 可能是代理服务器不可达或配置错误`)
          }
        } catch (error) {
          console.error('检查代理状态失败:', error)
          proxy.status = 'error'
          ElMessage.error(`代理 "${proxy.name}" 状态检查失败: ${error.message}`)
        }
      }, 3000) // 增加到3秒，给VPS更多时间
      
    } else {
      ElMessage.error(`连接代理失败: ${result.message || '未知错误'}`)
      proxy.status = 'error'
    }
  } catch (error) {
    console.error('连接代理失败:', error)
    ElMessage.error(`连接代理失败: ${error.message || '网络错误'}`)
    proxy.status = 'error'
  } finally {
    proxy.enabling = false
  }
}

// 禁用代理
const disableProxy = async (proxy) => {
  proxy.disabling = true
  try {
    // 调用API禁用代理
    const result = await proxyApi.disableProxy(proxy.id)
    
    if (result.success) {
      // 更新本地状态
      proxy.isActive = false
      proxy.status = 'disconnected'
      proxy.latency = null
      proxySettings.value.activeProxyId = null
      connectionStatus.value = 'disconnected'
      currentProxy.value = null
      
      ElMessage.success(`代理 "${proxy.name}" 已断开`)
    } else {
      ElMessage.error(`断开代理失败: ${result.message || '未知错误'}`)
    }
  } catch (error) {
    console.error('断开代理失败:', error)
    ElMessage.error(`断开代理失败: ${error.message || '网络错误'}`)
  } finally {
    proxy.disabling = false
  }
}

// 测试代理延迟（启用时调用）
const testProxyLatency = async (proxy) => {
  try {
    const result = await proxyApi.testProxy({
      id: proxy.id,
      name: proxy.name,
      type: proxy.type,
      config: proxy.config
    })
    
    if (result.success && result.data.success) {
      const testData = result.data
      const method = testData.method || 'unknown'
      
      if (method === 'network_test') {
        proxy.latency = testData.latency
      } else if (method === 'vps_validation') {
        proxy.latency = testData.latency
      } else if (testData.latency === -1) {
        proxy.latency = '网络超时'
      } else {
        proxy.latency = '配置验证'
      }
    }
  } catch (error) {
    console.warn('测试代理延迟失败:', error)
    proxy.latency = '测试失败'
  }
}

// 组件挂载时初始化
onMounted(async () => {
  try {
    // 获取全局测试网站配置
    const config = await proxyApi.getGlobalConfig()
    globalTestUrlId.value = config.currentTestUrlId || 'baidu'
  } catch (error) {
    console.warn('获取全局配置失败，使用默认值')
  }
  
  // 页面加载时重置所有测试状态
  proxyList.value.forEach(proxy => {
    proxy.testing = false // 重置测试状态
  })
  
  // 重置并发和频率计数器
  testingCount.value = 0
  testFrequencyCount.value = 0
  
  // 加载代理配置和历史测试结果
  await loadProxyConfig()
  
  // 为所有代理加载历史测试结果
  await loadProxyTestHistory()
  
  // 自动刷新已连接代理的延迟测试
  await refreshActiveProxyLatency()
})

// 🔧 新增：异步测试代理真实延迟
const testProxyLatencyAsync = async (proxy) => {
  try {
    console.log(`🔄 开始测试代理 ${proxy.name} 的真实延迟...`)
    
    // 设置测试状态
    proxy.latency = '测试中...'
    
    // 调用代理测试API获取真实延迟
    const result = await proxyApi.testProxy(proxy.id)
    
    if (result.success && result.latency && result.latency > 0) {
      proxy.latency = result.latency
      console.log(`✅ 代理 ${proxy.name} 真实延迟: ${result.latency}ms`)
    } else {
      // 如果API测试失败，尝试简单的ping测试
      const pingResult = await testProxyPing(proxy)
      proxy.latency = pingResult.latency || null
      console.log(`⚠️ 代理 ${proxy.name} ping延迟: ${proxy.latency}ms`)
    }
  } catch (error) {
    console.error(`❌ 测试代理 ${proxy.name} 延迟失败:`, error)
    proxy.latency = null
  }
}

// 🔧 新增：简单的ping测试（备用方案）
const testProxyPing = async (proxy) => {
  try {
    // 解析代理配置获取服务器地址
    const config = proxy.config
    let serverHost = null
    
    if (config.startsWith('vless://')) {
      // 解析VLESS URL: vless://uuid@host:port?params
      const match = config.match(/vless:\/\/[^@]+@([^:]+):/)
      if (match) {
        serverHost = match[1]
      }
    }
    
    if (!serverHost) {
      return { latency: null }
    }
    
    console.log(`🔄 Ping测试代理服务器: ${serverHost}`)
    
    // 使用简单的HTTP请求测试延迟（通过代理服务器的HTTP端口或其他可访问端口）
    const startTime = Date.now()
    
    try {
      // 尝试连接代理服务器（这里只是测试连通性，不是真正的代理延迟）
      await fetch(`https://${serverHost}`, { 
        method: 'HEAD',
        mode: 'no-cors',
        signal: AbortSignal.timeout(3000)
      })
      
      const latency = Date.now() - startTime
      return { latency: Math.min(latency, 999) } // 限制最大延迟显示
    } catch (error) {
      // 连接失败，返回null
      return { latency: null }
    }
  } catch (error) {
    console.error('Ping测试失败:', error)
    return { latency: null }
  }
}
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

.proxy-id {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #409eff;
  background-color: #f0f9ff;
  padding: 2px 6px;
  border-radius: 4px;
}

.table-container {
  overflow-x: auto;
  width: 100%;
}

/* 响应式表格 */
@media (max-width: 1200px) {
  .table-container {
    overflow-x: scroll;
  }
  
  .proxy-list-card {
    margin: 0 -10px;
  }
}

@media (min-width: 1201px) {
  .table-container .el-table {
    min-width: auto !important;
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 测试配置卡片样式 */
.test-config-card {
  margin-bottom: 20px;
}

.test-config-card .el-form-item {
  margin-bottom: 0;
}

.test-config-card .el-text {
  margin-left: 8px;
  font-size: 12px;
}

/* 延迟显示状态样式 */
.testing-status {
  color: #409eff;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.success-status {
  color: #67c23a;
  font-weight: 600;
  font-size: 12px;
}

.failed-status {
  color: #f56c6c;
  font-weight: 600;
  font-size: 12px;
}

.history-status {
  color: #909399;
  font-size: 12px;
  font-style: italic;
}

.default-status {
  color: #c0c4cc;
  font-size: 12px;
}
</style>
