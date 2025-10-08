import { axios } from '../utils/axios'

/**
 * 代理管理API服务
 */
export const proxyApi = {
  /**
   * 获取代理配置
   */
  getConfig() {
    return axios.get('/api/admin/proxy/config')
  },
  
  /**
   * 更新代理设置
   */
  updateSettings(settings) {
    return axios.put('/api/admin/proxy/settings', settings)
  },
  
  /**
   * 获取代理状态
   */
  getStatus() {
    return axios.get('/api/admin/proxy/status')
  },
  
  /**
   * 创建代理
   */
  createProxy(proxyData) {
    return axios.post('/api/admin/proxy/config', proxyData)
  },
  
  /**
   * 更新代理
   */
  updateProxy(proxyId, updateData) {
    return axios.put(`/api/admin/proxy/config/${proxyId}`, updateData)
  },
  
  /**
   * 删除代理
   */
  deleteProxy(proxyId) {
    return axios.delete(`/api/admin/proxy/config/${proxyId}`)
  },
  
  /**
   * 测试代理连接
   */
  testProxy(proxyId) {
    return axios.post(`/api/admin/proxy/test/${proxyId}`)
  },
  
  /**
   * 切换代理状态
   */
  toggleProxy(proxyId) {
    return axios.put(`/api/admin/proxy/toggle/${proxyId}`)
  },
  
  /**
   * 代理控制操作
   */
  controlProxy(action, data = {}) {
    return axios.post('/api/admin/proxy/control', {
      action,
      ...data
    })
  }
}
