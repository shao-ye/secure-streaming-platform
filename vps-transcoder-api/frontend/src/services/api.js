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
   * 初始化延迟检测（不实际使用IP，仅作诊断）
   */
  async initializeIPOptimization() {
    if (!this.ipOptimizationEnabled) return
    
    try {
      console.log('[APIService] 🚀 初始化连接延迟检测...')
      const selectedIP = await selectBestCloudflareIP(this.hostname)
      if (selectedIP) {
        this.optimizedIP = selectedIP
        console.log(`[APIService] 💡 检测到优质IP: ${selectedIP}（仅供参考）`)
        console.log(`[APIService] ⚠️ 注意：由于浏览器SSL限制，仍使用域名访问`)
      } else {
        console.log(`[APIService] ✅ 当前延迟正常，无需优化`)
      }
    } catch (error) {
      console.warn('[APIService] ⚠️ 延迟检测失败:', error)
    }
  }
  
  /**
   * 获取当前使用的baseURL
   * 注意：由于浏览器HTTPS/SSL限制，始终使用域名
   */
  getBaseURL() {
    // 由于SSL证书限制，浏览器无法直接用IP访问HTTPS
    // 即使有优选IP，也只能使用域名
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
          'X-Client-Type': 'web-frontend-optimized',
          'X-Tunnel-Optimized': 'true',
          'X-CF-Latency-Checked': this.optimizedIP ? 'true' : 'false',
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
