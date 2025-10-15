/**
 * 流媒体API服务
 * 连接前端组件与后端集成流媒体服务
 */

import axios from 'axios'

// API基础配置
const API_BASE_URL = process.env.VUE_APP_API_BASE_URL || 'https://yoyoapi.5202021.xyz'
const API_TIMEOUT = 30000 // 30秒超时

// 创建axios实例
const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api/integrated-streaming`,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    console.log('API请求:', config.method?.toUpperCase(), config.url, config.data)
    return config
  },
  (error) => {
    console.error('API请求错误:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    console.log('API响应:', response.config.url, response.data)
    return response
  },
  (error) => {
    console.error('API响应错误:', error.response?.data || error.message)
    return Promise.reject(error)
  }
)

/**
 * 流媒体API类
 */
class StreamingApi {
  
  /**
   * 启动智能观看
   * @param {string} channelId - 频道ID
   * @param {string} rtmpUrl - RTMP源地址
   * @param {Object} options - 选项参数
   */
  async startWatching(channelId, rtmpUrl, options = {}) {
    try {
      const response = await apiClient.post('/start-watching', {
        channelId,
        rtmpUrl,
        options: {
          userLocation: this.getUserLocation(),
          networkType: this.getNetworkType(),
          deviceInfo: this.getDeviceInfo(),
          ...options
        }
      })
      
      return response.data
    } catch (error) {
      throw this.handleApiError(error, '启动观看失败')
    }
  }

  /**
   * 发送心跳
   * @param {string} channelId - 频道ID
   * @param {Object} clientInfo - 客户端信息
   */
  async sendHeartbeat(channelId, clientInfo = {}) {
    try {
      const response = await apiClient.post('/heartbeat', {
        channelId,
        clientInfo: {
          networkQuality: this.getNetworkQuality(),
          latency: clientInfo.latency || 0,
          bufferHealth: clientInfo.bufferHealth || 100,
          playbackState: clientInfo.playbackState || 'playing',
          timestamp: Date.now(),
          ...clientInfo
        }
      })
      
      return response.data
    } catch (error) {
      throw this.handleApiError(error, '心跳发送失败')
    }
  }

  /**
   * 停止观看
   * @param {string} channelId - 频道ID
   */
  async stopWatching(channelId) {
    try {
      const response = await apiClient.post('/stop-watching', {
        channelId
      })
      
      return response.data
    } catch (error) {
      throw this.handleApiError(error, '停止观看失败')
    }
  }

  /**
   * 获取频道信息
   * @param {string} channelId - 频道ID
   */
  async getChannelInfo(channelId) {
    try {
      const response = await apiClient.get(`/channel/${channelId}`)
      return response.data
    } catch (error) {
      if (error.response?.status === 404) {
        return null // 频道未找到
      }
      throw this.handleApiError(error, '获取频道信息失败')
    }
  }

  /**
   * 获取系统状态
   */
  async getSystemStatus() {
    try {
      const response = await apiClient.get('/system/status')
      return response.data
    } catch (error) {
      throw this.handleApiError(error, '获取系统状态失败')
    }
  }

  /**
   * 手动切换路由
   * @param {string} channelId - 频道ID
   * @param {string} routeType - 路由类型
   * @param {Object} routeConfig - 路由配置
   */
  async switchRoute(channelId, routeType, routeConfig = {}) {
    try {
      const response = await apiClient.post('/switch-route', {
        channelId,
        routeType,
        routeConfig
      })
      
      return response.data
    } catch (error) {
      throw this.handleApiError(error, '路由切换失败')
    }
  }

  /**
   * 更新RTMP源
   * @param {string} channelId - 频道ID
   * @param {string} newRtmpUrl - 新的RTMP地址
   */
  async updateSource(channelId, newRtmpUrl) {
    try {
      const response = await apiClient.post('/update-source', {
        channelId,
        newRtmpUrl,
        notifyClients: true
      })
      
      return response.data
    } catch (error) {
      throw this.handleApiError(error, 'RTMP源更新失败')
    }
  }

  /**
   * 获取可用路由
   * @param {string} channelId - 频道ID
   */
  async getAvailableRoutes(channelId) {
    try {
      const response = await apiClient.get('/routes/available', {
        params: { channelId }
      })
      
      return response.data
    } catch (error) {
      throw this.handleApiError(error, '获取可用路由失败')
    }
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      const response = await apiClient.get('/health')
      return response.data
    } catch (error) {
      throw this.handleApiError(error, '健康检查失败')
    }
  }

  /**
   * 获取用户位置信息
   */
  getUserLocation() {
    // 这里可以集成地理位置API或使用IP定位
    return {
      country: 'CN',
      region: 'Unknown',
      city: 'Unknown',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  }

  /**
   * 获取网络类型
   */
  getNetworkType() {
    if (navigator.connection) {
      return {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
      }
    }
    return { type: 'unknown' }
  }

  /**
   * 获取设备信息
   */
  getDeviceInfo() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth
      }
    }
  }

  /**
   * 获取网络质量
   */
  getNetworkQuality() {
    if (navigator.connection) {
      const { effectiveType, downlink, rtt } = navigator.connection
      
      // 根据网络指标评估质量
      if (effectiveType === '4g' && downlink > 10 && rtt < 100) {
        return 'excellent'
      } else if (effectiveType === '4g' && downlink > 5 && rtt < 200) {
        return 'good'
      } else if (effectiveType === '3g' || (downlink > 1 && rtt < 500)) {
        return 'fair'
      } else {
        return 'poor'
      }
    }
    
    return 'unknown'
  }

  /**
   * 处理API错误
   * @param {Error} error - 错误对象
   * @param {string} defaultMessage - 默认错误消息
   */
  handleApiError(error, defaultMessage) {
    if (error.response) {
      // 服务器响应错误
      const { status, data } = error.response
      return new Error(data?.message || `HTTP ${status}: ${defaultMessage}`)
    } else if (error.request) {
      // 网络错误
      return new Error(`网络连接失败: ${defaultMessage}`)
    } else {
      // 其他错误
      return new Error(error.message || defaultMessage)
    }
  }

  /**
   * 创建心跳管理器
   * @param {string} channelId - 频道ID
   * @param {number} interval - 心跳间隔（毫秒）
   */
  createHeartbeatManager(channelId, interval = 30000) {
    let heartbeatTimer = null
    let isActive = false

    const manager = {
      start: (clientInfoProvider) => {
        if (isActive) return

        isActive = true
        const sendHeartbeat = async () => {
          try {
            const clientInfo = typeof clientInfoProvider === 'function' 
              ? clientInfoProvider() 
              : clientInfoProvider || {}
            
            await this.sendHeartbeat(channelId, clientInfo)
          } catch (error) {
            console.error('心跳发送失败:', error)
          }
        }

        // 立即发送一次心跳
        sendHeartbeat()

        // 设置定时心跳
        heartbeatTimer = setInterval(sendHeartbeat, interval)
      },

      stop: () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        isActive = false
      },

      isActive: () => isActive
    }

    return manager
  }

  /**
   * 创建实时状态监控器
   * @param {string} channelId - 频道ID
   * @param {Function} onStatusChange - 状态变化回调
   */
  createStatusMonitor(channelId, onStatusChange) {
    let monitorTimer = null
    let lastStatus = null

    const monitor = {
      start: (interval = 10000) => {
        const checkStatus = async () => {
          try {
            const channelInfo = await this.getChannelInfo(channelId)
            
            if (JSON.stringify(channelInfo) !== JSON.stringify(lastStatus)) {
              lastStatus = channelInfo
              if (typeof onStatusChange === 'function') {
                onStatusChange(channelInfo)
              }
            }
          } catch (error) {
            console.error('状态监控失败:', error)
          }
        }

        checkStatus()
        monitorTimer = setInterval(checkStatus, interval)
      },

      stop: () => {
        if (monitorTimer) {
          clearInterval(monitorTimer)
          monitorTimer = null
        }
      }
    }

    return monitor
  }
}

// 创建单例实例
const streamingApi = new StreamingApi()

export default streamingApi

// 导出类以便需要时创建新实例
export { StreamingApi }
