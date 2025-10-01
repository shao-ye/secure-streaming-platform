import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from '../utils/axios'
import { config } from '../utils/config'

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
      const response = await axios.post(`/api/play/${streamId}`)
      if (response.data.status === 'success') {
        // 将相对路径转换为完整的HLS代理URL
        let hlsUrl = response.data.hlsUrl
        if (hlsUrl.startsWith('/hls/')) {
          // 构建完整的HLS代理URL
          hlsUrl = `${config.api.baseURL}${hlsUrl}`
        }
        
        currentStream.value = {
          id: streamId,
          hlsUrl: hlsUrl
        }
        return hlsUrl
      }
      throw new Error(response.data.message)
    } catch (error) {
      console.error('播放流失败:', error)
      throw error
    }
  }

  const stopStream = () => {
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
    fetchAdminStreams,
    addStream,
    updateStream,
    deleteStream,
    updateStreamSort
  }
})
