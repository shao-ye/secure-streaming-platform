import { defineStore } from 'pinia'
import { userApi } from '../services/userApi'

export const useUserManagementStore = defineStore('userManagement', {
  state: () => ({
    users: [],
    loading: false,
    currentUser: null,
    operationLogs: []
  }),
  
  getters: {
    // 活跃用户
    activeUsers: (state) => state.users.filter(user => user.status === 'active'),
    
    // 管理员用户
    adminUsers: (state) => state.users.filter(user => user.role === 'admin'),
    
    // 普通用户
    normalUsers: (state) => state.users.filter(user => user.role === 'user'),
    
    // 按角色筛选用户
    usersByRole: (state) => (role) => state.users.filter(user => user.role === role),
    
    // 用户统计
    userStats: (state) => ({
      total: state.users.length,
      active: state.users.filter(user => user.status === 'active').length,
      inactive: state.users.filter(user => user.status === 'inactive').length,
      admin: state.users.filter(user => user.role === 'admin').length,
      user: state.users.filter(user => user.role === 'user').length
    })
  },
  
  actions: {
    /**
     * 获取用户列表
     */
    async fetchUsers() {
      this.loading = true
      try {
        const response = await userApi.getUsers()
        // 修复数据结构解析 - API返回的是 response.data.data.users
        this.users = response.data.data?.users || []
        return this.users
      } catch (error) {
        console.error('获取用户列表失败:', error)
        throw new Error(error.response?.data?.message || '获取用户列表失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 获取用户详情
     */
    async fetchUser(userId) {
      try {
        const response = await userApi.getUser(userId)
        return response.data
      } catch (error) {
        console.error('获取用户详情失败:', error)
        throw new Error(error.response?.data?.message || '获取用户详情失败')
      }
    },

    /**
     * 创建用户
     */
    async createUser(userData) {
      this.loading = true
      try {
        const response = await userApi.createUser(userData)
        
        // 添加到本地用户列表
        if (response.data?.data) {
          this.users.push(response.data.data)
        }
        
        return response.data
      } catch (error) {
        console.error('创建用户失败:', error)
        throw new Error(error.response?.data?.message || '创建用户失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 更新用户信息
     */
    async updateUser(userId, updateData) {
      this.loading = true
      try {
        const response = await userApi.updateUser(userId, updateData)
        
        // 更新本地用户列表
        const index = this.users.findIndex(user => user.id === userId)
        if (index !== -1 && response.data?.data) {
          this.users[index] = response.data.data
        }
        
        return response.data
      } catch (error) {
        console.error('更新用户失败:', error)
        throw new Error(error.response?.data?.message || '更新用户失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 删除用户
     */
    async deleteUser(userId) {
      this.loading = true
      try {
        await userApi.deleteUser(userId)
        
        // 从本地用户列表中移除
        const index = this.users.findIndex(user => user.id === userId)
        if (index !== -1) {
          this.users.splice(index, 1)
        }
        
        return true
      } catch (error) {
        console.error('删除用户失败:', error)
        throw new Error(error.response?.data?.message || '删除用户失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 修改用户密码
     */
    async changePassword(userId, newPassword) {
      this.loading = true
      try {
        await userApi.changePassword(userId, newPassword)
        return true
      } catch (error) {
        console.error('修改密码失败:', error)
        throw new Error(error.response?.data?.message || '修改密码失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 切换用户状态
     */
    async toggleUserStatus(userId, newStatus) {
      this.loading = true
      try {
        const response = await userApi.toggleUserStatus(userId, newStatus)
        
        // 更新本地用户状态
        const user = this.users.find(user => user.id === userId)
        if (user) {
          user.status = newStatus
        }
        
        return response.data
      } catch (error) {
        console.error('切换用户状态失败:', error)
        throw new Error(error.response?.data?.message || '切换用户状态失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 获取用户操作日志
     */
    async fetchOperationLogs() {
      try {
        const response = await userApi.getOperationLogs()
        this.operationLogs = response.data || []
        return this.operationLogs
      } catch (error) {
        console.error('获取操作日志失败:', error)
        throw new Error(error.response?.data?.message || '获取操作日志失败')
      }
    },

    /**
     * 设置当前用户
     */
    setCurrentUser(user) {
      this.currentUser = user
    },

    /**
     * 清空当前用户
     */
    clearCurrentUser() {
      this.currentUser = null
    },

    /**
     * 重置状态
     */
    resetState() {
      this.users = []
      this.loading = false
      this.currentUser = null
      this.operationLogs = []
    }
  }
})
