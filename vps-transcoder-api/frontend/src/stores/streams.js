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
      // 如果当前有正在播放的流，先停止它
      if (currentStream.value && currentStream.value.channelId !== streamId) {
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
        // 从SimpleStreamManager响应中获取数据
        const data = response.data.data
        let hlsUrl = data.hlsUrl
        
        // 🔥 根据tunnel_config选择最优HLS端点
        if (hlsUrl && hlsUrl.includes('yoyo-vps.5202021.xyz')) {
          const streamPath = hlsUrl.match(/\/hls\/([^\/]+\/[^\/]+)$/);
          if (streamPath) {
            // 读取隧道配置
            const tunnelConfigStr = localStorage.getItem('tunnel_config');
            let useWorkerProxy = false;
            let tunnelBaseURL = 'https://yoyoapi.5202021.xyz';
            
            if (tunnelConfigStr) {
              try {
                const tunnelConfig = JSON.parse(tunnelConfigStr);
                if (tunnelConfig.enabled) {
                  if (tunnelConfig.useWorkerProxy) {
                    // 使用Workers代理模式
                    useWorkerProxy = true;
                    tunnelBaseURL = tunnelConfig.api?.baseURL || 'https://yoyoapi.5202021.xyz';
                    console.log('🔄 使用Workers隧道代理（解决SSL问题）');
                  } else {
                    // 使用直接隧道模式
                    tunnelBaseURL = tunnelConfig.api?.baseURL || 'https://tunnel-hls.yoyo-vps.5202021.xyz';
                    console.log('🚀 使用隧道优化端点');
                  }
                } else {
                  // 隧道禁用，使用直连模式
                  tunnelBaseURL = 'https://yoyo-vps.5202021.xyz';
                  console.log('🔗 使用直连模式');
                }
              } catch (e) {
                console.warn('⚠️ 隧道配置解析失败，使用默认配置');
              }
            }
            
            // 构建最终HLS URL
            const authToken = localStorage.getItem('auth_token');
            const videoToken = localStorage.getItem('video_token');
            const token = videoToken || authToken;
            
            if (useWorkerProxy) {
              // Workers代理模式：通过/tunnel-proxy/路径
              hlsUrl = `${tunnelBaseURL}/tunnel-proxy/hls/${streamPath[1]}${token ? `?token=${token}` : ''}`;
              console.log('🎯 使用JWT Token进行HLS认证 (零KV读取)');
            } else {
              // 直接隧道或直连模式
              hlsUrl = `${tunnelBaseURL}/hls/${streamPath[1]}${token ? `?token=${token}` : ''}`;
              if (videoToken) {
                console.log('🎯 使用JWT Token进行HLS认证 (零KV读取)');
              } else {
                console.log('⚠️ JWT Token不存在，降级到会话token');
              }
            }
          }
        }
        
        console.log('🔥 HLS URL处理结果:', { 
          original: data.hlsUrl, 
          processed: hlsUrl,
          channelId: streamId 
        });
        
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
    
    // 立即发送一次心跳
    sendHeartbeat(channelId)
    
    // 每30秒发送一次心跳（严格按照设计）
    heartbeatTimer = setInterval(() => {
      sendHeartbeat(channelId)
    }, 30000)
    
    console.log(`💓 开始心跳: ${channelId}`)
  }

  const sendHeartbeat = async (channelId) => {
    try {
      await axios.post('/api/simple-stream/heartbeat', {
        channelId: channelId
      })
      console.log(`💓 心跳发送: ${channelId}`)
    } catch (error) {
      console.error('心跳发送失败:', error)
    }
  }

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const stopStream = async () => {
    // 🔥 修复：根据频道级心跳设计，只需要停止心跳即可
    // VPS会在60秒无心跳后自动清理转码进程
    // 不调用stop-watching API，避免影响其他用户观看
    
    // 停止心跳
    stopHeartbeat()
    
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
