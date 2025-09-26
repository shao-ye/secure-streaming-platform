import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from '../utils/axios'

export const useUserStore = defineStore('user', () => {
  const user = ref(null)
  const isChecking = ref(false)

  const isLoggedIn = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  const login = async (username, password) => {
    try {
      const response = await axios.post('/login', {
        username,
        password
      })

      if (response.data.status === 'success') {
        user.value = response.data.user
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
      await axios.post('/logout')
    } catch (error) {
      console.error('退出登录失败:', error)
    } finally {
      user.value = null
    }
  }

  const checkAuth = async () => {
    isChecking.value = true
    try {
      const response = await axios.get('/api/user')
      if (response.data.status === 'success') {
        user.value = response.data.user
      }
    } catch (error) {
      user.value = null
    } finally {
      isChecking.value = false
    }
  }

  return {
    user,
    isChecking,
    isLoggedIn,
    isAdmin,
    login,
    logout,
    checkAuth
  }
})
