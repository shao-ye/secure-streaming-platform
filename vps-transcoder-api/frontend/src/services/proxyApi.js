import axios from 'axios'

// 配置API基础URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://yoyoapi.5202021.xyz'

// 创建axios实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
})

/**
 * 代理管理API服务
 */
export const proxyApi = {
  /**
   * 获取代理配置
   */
  async getConfig() {
    try {
      const response = await apiClient.get('/api/admin/proxy/config')
      return response.data
    } catch (error) {
      console.error('获取代理配置失败:', error)
      throw error
    }
  },
  
  /**
   * 更新代理设置
   */
  async updateSettings(settings) {
    try {
      const response = await apiClient.put('/api/admin/proxy/settings', settings)
      return response.data
    } catch (error) {
      console.error('更新代理设置失败:', error)
      throw error
    }
  },
  
  /**
   * 获取代理状态
   */
  async getStatus() {
    try {
      const response = await apiClient.get('/api/admin/proxy/status')
      return response.data
    } catch (error) {
      console.error('获取代理状态失败:', error)
      throw error
    }
  },
  
  /**
   * 创建代理
   */
  async createProxy(proxyData) {
    try {
      const response = await apiClient.post('/api/admin/proxy/config', proxyData)
      return response.data
    } catch (error) {
      console.error('创建代理失败:', error)
      throw error
    }
  },
  
  /**
   * 更新代理
   */
  async updateProxy(proxyId, updateData) {
    try {
      const response = await apiClient.put(`/api/admin/proxy/config/${proxyId}`, updateData)
      return response.data
    } catch (error) {
      console.error('更新代理失败:', error)
      throw error
    }
  },
  
  /**
   * 删除代理
   */
  async deleteProxy(proxyId) {
    try {
      const response = await apiClient.delete(`/api/admin/proxy/config/${proxyId}`)
      return response.data
    } catch (error) {
      console.error('删除代理失败:', error)
      throw error
    }
  },
  
  /**
   * 测试代理连接
   */
  async testProxy(proxyData) {
    try {
      const response = await apiClient.post('/api/admin/proxy/test', proxyData)
      return response.data
    } catch (error) {
      console.error('测试代理失败:', error)
      throw error
    }
  },
  
  /**
   * 切换代理状态
   */
  async toggleProxy(enabled) {
    try {
      const response = await apiClient.post('/api/admin/proxy/toggle', { enabled })
      return response.data
    } catch (error) {
      console.error('切换代理状态失败:', error)
      throw error
    }
  },
  
  /**
   * 代理控制操作
   */
  async controlProxy(action, data = {}) {
    try {
      const response = await apiClient.post('/api/admin/proxy/control', {
        action,
        ...data
      })
      return response.data
    } catch (error) {
      console.error('代理控制操作失败:', error)
      throw error
    }
  }
}
