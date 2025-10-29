import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from '../utils/axios'
import { config } from '../utils/config'
import { useUserStore } from './user'

export const useStreamsStore = defineStore('streams', () => {
  const streams = ref([])
  const loading = ref(false)
  const currentStream = ref(null)
  
  // 🔧 新增：代理状态监控
  const proxyStatusMonitor = ref(null)
  const lastProxyStatus = ref(null)

  const fetchStreams = async () => {
    loading.value = true
    try {
      const response = await axios.get('/api/streams')
      if (response.data.status === 'success') {
        // 修复数据结构解析：API返回的数据在 response.data.data.streams 中
        streams.value = response.data.data?.streams || []
      }
    } catch (error) {
      console.error('获取频道列表失败:', error)
      streams.value = [] // 确保出错时清空列表
    } finally {
      loading.value = false
    }
  }

  const playStream = async (streamId, forceReset = false) => {
    try {
      // 🔥 关键修复：支持强制重置参数
      // 如果forceReset=true或切换到不同频道，执行完整重置流程
      if (forceReset || (currentStream.value && currentStream.value.channelId !== streamId)) {
        // 🔥 关键修复：立即清除当前流状态，强制VideoPlayer重置
        currentStream.value = null
        
        await stopStream()
        
        // 🔥 新增：等待1秒确保HLS播放器完全重置
        console.log('等待停止操作完成...')
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      
      console.log('启动新频道:', streamId)
      
      // 使用新的SimpleStreamManager API - 只需要channelId
      const response = await axios.post('/api/simple-stream/start-watching', {
        channelId: streamId
      })
      
      if (response.data.status === 'success') {
        // ✅ 双维度路由：直接使用后端返回的HLS URL
        const data = response.data.data
        const hlsUrl = data.hlsUrl
        
        console.log('✅ 使用后端双维度路由返回的HLS URL:', { 
          hlsUrl: hlsUrl,
          routingMode: data.routingMode,
          routingReason: data.routingReason
        });
        
        // 解析双维度路由信息
        const routingMode = data.routingMode || 'direct+direct'
        const [frontendPath, backendPath] = routingMode.split('+')
        
        // 🆕 生成用户会话ID（用于统计活跃用户数）
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        currentStream.value = {
          id: streamId,
          channelId: streamId, // 使用channelId替代sessionId
          sessionId: sessionId, // 🆕 用户会话ID
          hlsUrl: hlsUrl,
          channelName: data.channelName || `频道 ${streamId}`,
          totalViewers: data.totalViewers || 0,
          // 双维度路由信息
          routingMode: routingMode,
          frontendPath: frontendPath || 'direct',
          backendPath: backendPath || 'direct',
          routingReason: data.routingReason || ''
        }
        
        // 启动心跳保持频道活跃
        startHeartbeat(streamId)
        
        // 🔧 新增：启动代理状态监控
        startProxyStatusMonitoring()
        
        return hlsUrl
      }
      throw new Error(response.data.message)
    } catch (error) {
      console.error('播放流失败:', error)
      throw error
    }
  }

  // 心跳定时器
  let heartbeatTimer = null
  let visibilityHandler = null
  let lastHeartbeatTime = 0
  
  const startHeartbeat = (channelId) => {
    // 清除之前的定时器
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
    }
    
    // 移除之前的可见性监听器
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
    }
    
    // 立即发送一次心跳
    sendHeartbeat(channelId)
    
    // 每30秒发送一次心跳（严格按照设计）
    heartbeatTimer = setInterval(() => {
      sendHeartbeat(channelId)
    }, 30000)
    
    // 🔥 新增：Page Visibility API监听，防止标签页切换后心跳中断
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now()
        const timeSinceLastHeartbeat = now - lastHeartbeatTime
        const secondsSinceLastHeartbeat = Math.round(timeSinceLastHeartbeat / 1000)
        
        console.log(`📱 页面重新可见，距离上次心跳: ${secondsSinceLastHeartbeat}秒`)
        
        // 🎯 关键：只补发心跳，不主动重新加载
        // 如果视频真的404了，HLS播放器会触发error事件，由VideoPlayer处理
        if (timeSinceLastHeartbeat > 25000) {
          console.log('⚡ 立即补发心跳，恢复会话')
          sendHeartbeat(channelId)
        } else {
          console.log('✅ 心跳状态正常，无需处理')
        }
      } else {
        console.log('📱 页面切换到后台')
      }
    }
    
    document.addEventListener('visibilitychange', visibilityHandler)
    
    console.log(`💓 开始心跳（支持后台恢复）: ${channelId}`)
  }

  const sendHeartbeat = async (channelId) => {
    try {
      lastHeartbeatTime = Date.now()
      
      // 🆕 获取当前会话ID
      const sessionId = currentStream.value?.sessionId
      
      await axios.post('/api/simple-stream/heartbeat', {
        channelId: channelId,
        sessionId: sessionId  // 🆕 传递会话ID（可选）
      })
      console.log(`💓 心跳发送成功: ${channelId}`)
    } catch (error) {
      console.error('❌ 心跳发送失败:', error)
    }
  }

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    
    // 🔥 新增：清理可见性监听器
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  const stopStream = async () => {
    // 🔥 修复：根据频道级心跳设计，只需要停止心跳即可
    // VPS会在60秒无心跳后自动清理转码进程
    // 不调用stop-watching API，避免影响其他用户观看
    
    // 停止心跳
    stopHeartbeat()
    
    // 🔧 新增：停止代理状态监控
    stopProxyStatusMonitoring()
    
    // 清除当前流
    currentStream.value = null
    
    console.log('🛑 停止观看，心跳已停止')
  }

  // 管理员功能
  const fetchAdminStreams = async () => {
    loading.value = true
    try {
      const response = await axios.get('/api/admin/streams')
      if (response.data.status === 'success') {
        // 修复数据结构解析：API返回的数据在 response.data.data.streams 中
        streams.value = response.data.data?.streams || []
      }
    } catch (error) {
      console.error('获取管理员频道列表失败:', error)
      streams.value = [] // 确保出错时清空列表
    } finally {
      loading.value = false
    }
  }

  const addStream = async (stream) => {
    try {
      const response = await axios.post('/api/admin/streams', stream)
      if (response.data.status === 'success') {
        await fetchAdminStreams()
        return { success: true }
      }
      return { success: false, message: response.data.message }
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || '添加频道失败' 
      }
    }
  }

  const updateStream = async (id, stream) => {
    try {
      console.log('🔧 发送更新请求:', { id, stream })
      
      const response = await axios.put(`/api/admin/streams/${id}`, stream)
      
      console.log('🔧 API响应:', response.data)
      
      if (response.data.status === 'success') {
        await fetchAdminStreams()
        return { success: true }
      }
      return { success: false, message: response.data.message }
    } catch (error) {
      console.error('🔧 更新请求失败:', error)
      console.error('🔧 错误详情:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      })
      
      return { 
        success: false, 
        message: error.response?.data?.message || error.message || '更新频道失败' 
      }
    }
  }

  const deleteStream = async (id) => {
    try {
      const response = await axios.delete(`/api/admin/streams/${id}`)
      if (response.data.status === 'success') {
        await fetchAdminStreams()
        return { success: true }
      }
      return { success: false, message: response.data.message }
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || '删除频道失败' 
      }
    }
  }

  const updateStreamSort = async (id, sortOrder) => {
    try {
      const response = await axios.put(`/api/admin/streams/${id}/sort`, { sortOrder })
      if (response.data.status === 'success') {
        return { success: true }
      }
      return { success: false, message: response.data.message }
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || '更新排序失败' 
      }
    }
  }

  // 🔧 新增：启动代理状态监控
  const startProxyStatusMonitoring = () => {
    if (proxyStatusMonitor.value) {
      clearInterval(proxyStatusMonitor.value)
    }
    
    proxyStatusMonitor.value = setInterval(async () => {
      if (currentStream.value) {
        try {
          const response = await axios.get('/api/admin/proxy/status')
          const currentProxyStatus = response.data?.data?.connectionStatus
          
          // 检查代理状态是否发生变化
          if (lastProxyStatus.value && lastProxyStatus.value !== currentProxyStatus) {
            console.log(`🔄 代理状态变化: ${lastProxyStatus.value} → ${currentProxyStatus}`)
            
            if (lastProxyStatus.value === 'connected' && currentProxyStatus === 'disconnected') {
              console.log('🚨 代理断开，执行智能通道切换')
              await handleProxyDisconnection()
            }
          }
          
          lastProxyStatus.value = currentProxyStatus
        } catch (error) {
          console.error('代理状态监控失败:', error)
        }
      }
    }, 10000) // 每10秒检查一次
  }

  // 🔧 新增：停止代理状态监控
  const stopProxyStatusMonitoring = () => {
    if (proxyStatusMonitor.value) {
      clearInterval(proxyStatusMonitor.value)
      proxyStatusMonitor.value = null
    }
  }

  // 🔧 新增：处理代理断开事件
  const handleProxyDisconnection = async () => {
    if (!currentStream.value) return
    
    try {
      console.log('🔄 代理断开，尝试切换到直连模式...')
      
      // 重新播放当前流，这会触发通道选择逻辑
      const streamId = currentStream.value.channelId
      
      // 清除当前流状态，强制重新选择通道
      currentStream.value = null
      
      // 等待一秒后重新播放
      setTimeout(async () => {
        try {
          await playStream(streamId)
          console.log('✅ 智能切换到直连模式成功')
        } catch (error) {
          console.error('❌ 智能切换失败:', error)
        }
      }, 1000)
      
    } catch (error) {
      console.error('处理代理断开失败:', error)
    }
  }

  return {
    streams,
    loading,
    currentStream,
    fetchStreams,
    playStream,
    stopStream,
    stopHeartbeat,
    fetchAdminStreams,
    addStream,
    updateStream,
    deleteStream,
    updateStreamSort,
    // 🔧 新增：代理状态监控方法
    startProxyStatusMonitoring,
    stopProxyStatusMonitoring,
    handleProxyDisconnection
  }
})
