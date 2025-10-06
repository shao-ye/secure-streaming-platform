import { axios } from '../utils/axios'
import { tunnelMonitor } from '../utils/tunnel-monitor'

export class APIService {
  constructor() {
    this.baseURL = 'https://yoyoapi.5202021.xyz' // 通过隧道优化
  }
  
  async request(endpoint, options = {}) {
    const start = performance.now()
    
    try {
      const response = await axios({
        url: endpoint,
        method: options.method || 'GET',
        data: options.body ? JSON.parse(options.body) : options.data,
        headers: {
          'X-Client-Type': 'web-frontend-tunnel',
          'X-Tunnel-Optimized': 'true',
          ...options.headers
        },
        ...options
      })
      
      // 记录性能数据
      const latency = performance.now() - start
      tunnelMonitor.recordRequest(latency, true)
      
      return response
    } catch (error) {
      // 记录错误
      const latency = performance.now() - start
      tunnelMonitor.recordRequest(latency, false)
      throw error
    }
  }
  
  // 获取隧道优化统计
  getTunnelStats() {
    return tunnelMonitor.getStats()
  }
  
  // 重置统计
  resetStats() {
    tunnelMonitor.reset()
  }
}

// 创建单例实例
const apiService = new APIService()

// 导出composable函数
export function useApiService() {
  return apiService
}
