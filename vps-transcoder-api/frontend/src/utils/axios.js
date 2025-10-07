import axios from 'axios'
import { ElMessage } from 'element-plus'
import { config, debugLog, errorLog, warnLog } from './config'
import router from '../router'

const instance = axios.create({
  baseURL: config.api.baseURL,
  timeout: config.api.timeout,
  withCredentials: config.api.withCredentials,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
instance.interceptors.request.use(
  (config) => {
    debugLog('发送请求:', config.method?.toUpperCase(), config.url, config.data)
    
    // 添加时间戳防止缓存
    if (config.method === 'get') {
      config.params = {
        ...config.params,
        _t: Date.now()
      }
    }
    
    // 自动添加Authorization header
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    
    return config
  },
  (error) => {
    errorLog('请求拦截器错误:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
instance.interceptors.response.use(
  (response) => {
    debugLog('收到响应:', response.status, response.config.url, response.data)
    
    // 检查业务状态码
    if (response.data && response.data.status === 'error') {
      const message = response.data.message || '请求失败'
      warnLog('业务错误:', message)
      ElMessage.error(message)
      return Promise.reject(new Error(message))
    }
    
    return response
  },
  (error) => {
    errorLog('响应拦截器错误:', error)
    
    if (error.response) {
      const { status, data } = error.response
      let message = '请求失败'

      switch (status) {
        case 400:
          message = data?.message || '请求参数错误'
          break
        case 401:
          message = '登录已失效，正在跳转到登录页面...'
          // 清除本地存储的认证信息
          localStorage.removeItem('auth_token')
          localStorage.removeItem('user_info')
          localStorage.removeItem('video_token')
          localStorage.removeItem('user')
          // 清除用户状态
          if (window.userStore) {
            window.userStore.logout()
          }
          // 立即跳转到登录页面，避免延迟
          if (router.currentRoute.value.path !== '/login') {
            router.replace('/login').catch(err => {
              console.warn('路由跳转失败:', err)
              // 如果路由跳转失败，使用原生方法跳转
              window.location.href = '/login'
            })
          }
          break
        case 403:
          message = '权限不足，无法访问该资源'
          break
        case 404:
          message = '请求的资源不存在'
          break
        case 408:
          message = '请求超时，请稍后重试'
          break
        case 429:
          message = '请求过于频繁，请稍后重试'
          break
        case 500:
          message = '服务器内部错误'
          break
        case 502:
          message = '网关错误'
          break
        case 503:
          message = '服务暂时不可用'
          break
        case 504:
          message = '网关超时'
          break
        default:
          message = data?.message || `请求失败 (${status})`
      }

      ElMessage.error(message)
    } else if (error.request) {
      // 网络错误处理 - 区分CORS错误和真正的网络错误
      if (error.message && error.message.includes('CORS')) {
        // CORS错误，可能是认证相关问题
        warnLog('CORS错误，可能是认证问题:', error.message)
        ElMessage.error('访问权限错误，请重新登录')
        
        // 检查是否需要跳转到登录页
        const currentPath = router.currentRoute.value.path
        if (currentPath !== '/login') {
          // 清除认证信息
          localStorage.removeItem('auth_token')
          localStorage.removeItem('user_info')
          localStorage.removeItem('video_token')
          localStorage.removeItem('user')
          
          // 跳转到登录页
          router.replace('/login').catch(err => {
            console.warn('路由跳转失败:', err)
            window.location.href = '/login'
          })
        }
      } else if (error.code === 'ERR_NETWORK' && error.config?.url?.includes('/api/admin/')) {
        // 管理API的网络错误，可能是认证问题
        warnLog('管理API网络错误，检查认证状态:', error.config.url)
        
        // 尝试验证当前认证状态
        const token = localStorage.getItem('auth_token')
        if (!token) {
          ElMessage.error('登录已失效，正在跳转到登录页面...')
          router.replace('/login').catch(() => {
            window.location.href = '/login'
          })
        } else {
          ElMessage.error('网络连接异常，请稍后重试')
        }
      } else {
        // 普通网络错误
        ElMessage.error('网络错误，请检查网络连接')
      }
    } else {
      // 其他错误
      ElMessage.error(error.message || '未知错误')
    }

    return Promise.reject(error)
  }
)

// 创建带重试机制的请求方法
export const requestWithRetry = async (requestConfig, maxRetries = 3, retryDelay = 1000) => {
  let lastError
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const response = await instance(requestConfig)
      return response
    } catch (error) {
      lastError = error
      
      // 如果是最后一次重试或者是不可重试的错误，直接抛出
      if (i === maxRetries || error.response?.status < 500) {
        throw error
      }
      
      // 等待后重试
      debugLog(`请求失败，${retryDelay}ms后进行第${i + 1}次重试...`)
      await new Promise(resolve => setTimeout(resolve, retryDelay))
      
      // 指数退避
      retryDelay *= 2
    }
  }
  
  throw lastError
}

// 导出实例和工具方法
export { instance as axios }
export default instance
