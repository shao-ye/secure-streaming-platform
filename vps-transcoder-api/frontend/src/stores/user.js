import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from '../utils/axios'

export const useUserStore = defineStore('user', () => {
  const user = ref(null)
  const token = ref(null) // 不在初始化时直接从localStorage获取，避免响应式触发
  const isChecking = ref(false)
  const isInitialized = ref(false) // 添加初始化标志

  const isLoggedIn = computed(() => !!user.value && !!token.value && isInitialized.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  const login = async (username, password) => {
    try {
      const response = await axios.post('/api/login', {
        username,
        password
      })

      if (response.data.status === 'success') {
        user.value = response.data.data.user
        token.value = response.data.data.token
        
        // 保存token到localStorage
        localStorage.setItem('auth_token', token.value)
        localStorage.setItem('user', JSON.stringify(user.value))
        
        return { success: true }
      } else {
        return { success: false, message: response.data.message }
      }
    } catch (error) {
      return { 
        success: false, 
        message: error.response?.data?.message || '登录失败' 
      }
    }
  }

  const logout = async () => {
    try {
      await axios.post('/api/logout')
    } catch (error) {
      console.error('退出登录失败:', error)
    } finally {
      // 清除本地存储
      user.value = null
      token.value = null
      localStorage.removeItem('auth_token')
      localStorage.removeItem('user')
    }
  }

  const checkAuth = async () => {
    // 防止重复调用
    if (isChecking.value) {
      return
    }
    
    isChecking.value = true
    try {
      // 如果没有token，直接返回
      if (!token.value) {
        user.value = null
        return
      }

      const response = await axios.get('/api/user')
      if (response.data.status === 'success') {
        user.value = response.data.data
        // 更新localStorage中的用户信息
        localStorage.setItem('user', JSON.stringify(response.data.data))
      }
    } catch (error) {
      console.error('认证检查失败:', error)
      // 认证失败，清除本地存储，但不在这里清除，避免触发循环
      // 让路由守卫处理重定向
      user.value = null
      token.value = null
      // 不在这里清除localStorage，避免触发响应式更新导致路由循环
      throw error // 抛出错误让路由守卫处理
    } finally {
      isChecking.value = false
    }
  }

  // 初始化时从localStorage恢复用户信息
  const initFromStorage = () => {
    const storedUser = localStorage.getItem('user')
    const storedToken = localStorage.getItem('auth_token')
    
    if (storedUser && storedToken) {
      try {
        user.value = JSON.parse(storedUser)
        token.value = storedToken
      } catch (error) {
        console.error('恢复用户信息失败:', error)
        localStorage.removeItem('auth_token')
        localStorage.removeItem('user')
      }
    }
    
    // 设置初始化完成标志
    isInitialized.value = true
  }

  // 延迟初始化，避免在store创建时立即触发响应式更新
  setTimeout(() => {
    initFromStorage()
  }, 0)

  return {
    user,
    token,
    isChecking,
    isInitialized,
    isLoggedIn,
    isAdmin,
    login,
    logout,
    checkAuth,
    initFromStorage
  }
})
