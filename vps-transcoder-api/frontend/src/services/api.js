import { axios } from '../utils/axios'
import { tunnelMonitor } from '../utils/tunnel-monitor'
import { selectBestCloudflareIP, getOptimizerStats } from './cfIpOptimizer'

export class APIService {
  constructor() {
    this.hostname = 'yoyoapi.5202021.xyz'
    this.baseURL = `https://${this.hostname}` // 默认使用域名
    this.optimizedIP = null // 优选的IP
    this.ipOptimizationEnabled = true // IP优选开关
    this.initializeIPOptimization() // 自动初始化IP优选
  }
  
  /**
   * 初始化IP优选
   */
  async initializeIPOptimization() {
    if (!this.ipOptimizationEnabled) return
    
    try {
      console.log('[APIService] 🚀 初始化Cloudflare IP优选...')
      const bestIP = await selectBestCloudflareIP(this.hostname, 5)
      if (bestIP) {
        this.optimizedIP = bestIP
        console.log(`[APIService] ✅ 已启用IP优选: ${bestIP}`)
      }
    } catch (error) {
      console.warn('[APIService] ⚠️ IP优选失败，使用默认域名:', error)
    }
  }
  
  /**
   * 获取当前使用的baseURL
   */
  getBaseURL() {
    // 如果有优选IP，使用IP访问
    if (this.ipOptimizationEnabled && this.optimizedIP) {
      return `https://${this.optimizedIP}`
    }
    return this.baseURL
  }
  
  async request(endpoint, options = {}) {
    const start = performance.now()
    const currentBaseURL = this.getBaseURL()
    
    try {
      const response = await axios({
        url: endpoint,
        method: options.method || 'GET',
        data: options.body ? JSON.parse(options.body) : options.data,
        headers: {
          'Host': this.hostname, // 使用Host头指定域名
          'X-Client-Type': 'web-frontend-optimized',
          'X-Tunnel-Optimized': 'true',
          'X-CF-IP-Optimized': this.optimizedIP ? 'true' : 'false',
          ...options.headers
        },
        baseURL: currentBaseURL,
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
  
  // 🔥 新增：IP优选相关方法
  
  /**
   * 启用/禁用IP优选
   */
  setIPOptimization(enabled) {
    this.ipOptimizationEnabled = enabled
    console.log(`[APIService] IP优选已${enabled ? '启用' : '禁用'}`)
    if (enabled && !this.optimizedIP) {
      this.initializeIPOptimization()
    }
  }
  
  /**
   * 手动刷新最优IP
   */
  async refreshOptimizedIP() {
    if (!this.ipOptimizationEnabled) {
      console.warn('[APIService] IP优选已禁用，无法刷新')
      return
    }
    
    await this.initializeIPOptimization()
  }
  
  /**
   * 获取IP优选状态
   */
  getIPOptimizationStatus() {
    return {
      enabled: this.ipOptimizationEnabled,
      optimizedIP: this.optimizedIP,
      hostname: this.hostname,
      currentBaseURL: this.getBaseURL(),
      stats: getOptimizerStats()
    }
  }
}

// 创建单例实例
const apiService = new APIService()

// 导出composable函数
export function useApiService() {
  return apiService
}
