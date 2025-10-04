import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from '../utils/axios'
import { config } from '../utils/config'
import { useUserStore } from './user'

export const useStreamsStore = defineStore('streams', () => {
  const streams = ref([])
  const loading = ref(false)
  const currentStream = ref(null)

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

  const playStream = async (streamId) => {
    try {
      // 使用新的SimpleStreamManager API - 只需要channelId
      const response = await axios.post('/api/simple-stream/start-watching', {
        channelId: streamId
      })
      
      if (response.data.status === 'success') {
        // 从SimpleStreamManager响应中获取数据
        const data = response.data.data
        let hlsUrl = data.hlsUrl
        
        if (hlsUrl.startsWith('/hls/')) {
          // 构建完整的HLS代理URL
          hlsUrl = `${config.api.baseURL}${hlsUrl}`
        }
        
        currentStream.value = {
          id: streamId,
          channelId: streamId, // 使用channelId替代sessionId
          hlsUrl: hlsUrl,
          channelName: data.channelName || `频道 ${streamId}`,
          totalViewers: data.totalViewers || 0
        }
        
        // 启动心跳保持频道活跃
        startHeartbeat(streamId)
        
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
  
  const startHeartbeat = (channelId) => {
    // 清除之前的定时器
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
    }
    
    // 每30秒发送一次心跳
    heartbeatTimer = setInterval(async () => {
      try {
        await axios.post('/api/simple-stream/heartbeat', {
          channelId: channelId
        })
      } catch (error) {
        console.error('心跳失败:', error)
        // 如果心跳失败，可能需要重新启动观看
        console.warn('心跳失败，频道可能已被清理')
      }
    }, 30000)
  }

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const stopStream = async () => {
    if (currentStream.value && currentStream.value.channelId) {
      try {
        // 停止观看频道
        await axios.post('/api/simple-stream/stop-watching', {
          channelId: currentStream.value.channelId
        })
      } catch (error) {
        console.error('停止观看失败:', error)
      }
    }
    
    // 停止心跳
    stopHeartbeat()
    
    // 清除当前流
    currentStream.value = null
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
      const response = await axios.put(`/api/admin/streams/${id}`, stream)
      if (response.data.status === 'success') {
        await fetchAdminStreams()
        return { success: true }
      }
      return { success: false, message: response.data.message }
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || '更新频道失败' 
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
    updateStreamSort
  }
})
