import { axios } from '../utils/axios'

/**
 * 用户管理API服务
 */
export const userApi = {
  /**
   * 获取用户列表
   */
  getUsers(params = {}) {
    return axios.get('/api/users', { params })
  },
  
  /**
   * 获取用户详情
   */
  getUser(userId) {
    return axios.get(`/api/users/${userId}`)
  },
  
  /**
   * 创建用户
   */
  createUser(userData) {
    return axios.post('/api/users', userData)
  },
  
  /**
   * 更新用户信息
   */
  updateUser(userId, updateData) {
    return axios.put(`/api/users/${userId}`, updateData)
  },
  
  /**
   * 删除用户
   */
  deleteUser(userId) {
    return axios.delete(`/api/users/${userId}`)
  },
  
  /**
   * 修改用户密码
   */
  changePassword(userId, newPassword) {
    return axios.put(`/api/users/${userId}/password`, { newPassword })
  },
  
  /**
   * 切换用户状态（启用/禁用）
   */
  toggleUserStatus(userId, status) {
    return axios.put(`/api/users/${userId}/status`, { status })
  },
  
  /**
   * 获取用户操作日志
   */
  getOperationLogs(params = {}) {
    return axios.get('/api/users/logs', { params })
  },

  /**
   * 获取系统状态
   */
  getSystemStatus() {
    return axios.get('/api/system/status')
  },

  /**
   * 初始化系统
   */
  initializeSystem() {
    return axios.post('/api/system/init')
  }
}
