import { axios } from '../utils/axios'

// 使用项目统一的axios实例，已包含认证配置

/**
 * 代理管理API服务
 */
export const proxyApi = {
  /**
   * 获取代理配置
   */
  async getConfig() {
    try {
      const response = await axios.get('/api/admin/proxy/config')
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
      const response = await axios.put('/api/admin/proxy/settings', settings)
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
      const response = await axios.get('/api/admin/proxy/status')
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
      const response = await axios.post('/api/admin/proxy/config', proxyData)
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
      const response = await axios.put(`/api/admin/proxy/config/${proxyId}`, updateData)
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
      const response = await axios.delete(`/api/admin/proxy/config/${proxyId}`)
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
      const response = await axios.post('/api/admin/proxy/test', proxyData)
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
      const response = await axios.put('/api/admin/proxy/settings', { enabled })
      return response.data
    } catch (error) {
      console.error('切换代理状态失败:', error)
      throw error
    }
  },
  
  /**
   * 启用代理
   */
  async enableProxy(proxyId) {
    try {
      const response = await axios.post('/api/admin/proxy/control', {
        action: 'enable',
        proxyId: proxyId
      })
      return response.data
    } catch (error) {
      console.error('启用代理失败:', error)
      throw error
    }
  },
  
  /**
   * 禁用代理
   */
  async disableProxy(proxyId) {
    try {
      const response = await axios.post('/api/admin/proxy/control', {
        action: 'disable',
        proxyId: proxyId
      })
      return response.data
    } catch (error) {
      console.error('禁用代理失败:', error)
      throw error
    }
  },
  
  /**
   * 代理控制操作
   */
  async controlProxy(action, data = {}) {
    try {
      const response = await axios.post('/api/admin/proxy/control', {
        action,
        ...data
      })
      return response.data
    } catch (error) {
      console.error('代理控制操作失败:', error)
      throw error
    }
  },
  
  /**
   * 获取全局配置
   */
  async getGlobalConfig() {
    try {
      const response = await axios.get('/api/admin/proxy/global-config')
      return response.data
    } catch (error) {
      console.error('获取全局配置失败:', error)
      // 返回默认配置而不是抛出错误
      return { currentTestUrlId: 'baidu' }
    }
  },
  
  /**
   * 设置全局测试网站ID
   */
  async setGlobalTestUrlId(testUrlId) {
    try {
      const response = await axios.put('/api/admin/proxy/global-config', {
        currentTestUrlId: testUrlId
      })
      return response.data
    } catch (error) {
      console.error('设置全局测试网站ID失败:', error)
      throw error
    }
  },
  
  /**
   * 获取代理测试历史
   */
  async getProxyTestHistory(proxyId, limit = 10) {
    try {
      const response = await axios.get(`/api/admin/proxy/test-history/${proxyId}?limit=${limit}`)
      return response.data
    } catch (error) {
      console.error('获取代理测试历史失败:', error)
      // 返回空数组而不是抛出错误
      return { data: [] }
    }
  }
}
