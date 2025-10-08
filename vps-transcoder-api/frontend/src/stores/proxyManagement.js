import { defineStore } from 'pinia'
import { proxyApi } from '../services/proxyApi'

export const useProxyManagementStore = defineStore('proxyManagement', {
  state: () => ({
    proxies: [],
    proxySettings: {
      enabled: false,
      activeProxyId: null,
      autoSwitch: true,
      healthCheckInterval: 30000,
      fallbackMode: 'tunnel'
    },
    proxyStatus: {
      connectionStatus: 'disconnected',
      currentProxy: null,
      throughput: {
        upload: '0KB/s',
        download: '0KB/s'
      },
      statistics: {
        totalConnections: 0,
        successRate: 0,
        avgLatency: 0
      },
      lastUpdate: null
    },
    loading: false
  }),
  
  getters: {
    // 活跃代理列表
    activeProxies: (state) => state.proxies.filter(proxy => proxy.status === 'active'),
    
    // 按优先级排序的代理列表
    sortedProxies: (state) => {
      return [...state.proxies].sort((a, b) => a.priority - b.priority)
    },
    
    // 当前活跃的代理
    currentActiveProxy: (state) => {
      return state.proxies.find(proxy => proxy.id === state.proxySettings.activeProxyId)
    },
    
    // 代理统计信息
    proxyStats: (state) => ({
      total: state.proxies.length,
      active: state.proxies.filter(proxy => proxy.status === 'active').length,
      inactive: state.proxies.filter(proxy => proxy.status === 'inactive').length,
      error: state.proxies.filter(proxy => proxy.status === 'error').length
    })
  },
  
  actions: {
    /**
     * 获取代理配置
     */
    async fetchProxyConfig() {
      this.loading = true
      try {
        const response = await proxyApi.getConfig()
        this.proxies = response.data.proxies || []
        this.proxySettings = { ...this.proxySettings, ...response.data.settings }
        return response.data
      } catch (error) {
        console.error('获取代理配置失败:', error)
        throw new Error(error.response?.data?.message || '获取代理配置失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 获取代理状态
     */
    async fetchProxyStatus() {
      try {
        const response = await proxyApi.getStatus()
        this.proxyStatus = { ...this.proxyStatus, ...response.data }
        return response.data
      } catch (error) {
        console.error('获取代理状态失败:', error)
        throw new Error(error.response?.data?.message || '获取代理状态失败')
      }
    },

    /**
     * 添加代理
     */
    async addProxy(proxyData) {
      this.loading = true
      try {
        const response = await proxyApi.createProxy(proxyData)
        this.proxies.push(response.data)
        return response.data
      } catch (error) {
        console.error('添加代理失败:', error)
        throw new Error(error.response?.data?.message || '添加代理失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 更新代理
     */
    async updateProxy(proxyId, updateData) {
      this.loading = true
      try {
        const response = await proxyApi.updateProxy(proxyId, updateData)
        
        // 更新本地代理列表
        const index = this.proxies.findIndex(proxy => proxy.id === proxyId)
        if (index !== -1) {
          this.proxies[index] = { ...this.proxies[index], ...response.data }
        }
        
        return response.data
      } catch (error) {
        console.error('更新代理失败:', error)
        throw new Error(error.response?.data?.message || '更新代理失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 删除代理
     */
    async deleteProxy(proxyId) {
      this.loading = true
      try {
        await proxyApi.deleteProxy(proxyId)
        
        // 从本地代理列表中移除
        const index = this.proxies.findIndex(proxy => proxy.id === proxyId)
        if (index !== -1) {
          this.proxies.splice(index, 1)
        }
        
        // 如果删除的是当前活跃代理，清除设置
        if (this.proxySettings.activeProxyId === proxyId) {
          this.proxySettings.activeProxyId = null
        }
        
        return true
      } catch (error) {
        console.error('删除代理失败:', error)
        throw new Error(error.response?.data?.message || '删除代理失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 更新代理设置
     */
    async updateProxySettings(settings) {
      this.loading = true
      try {
        const newSettings = { ...this.proxySettings, ...settings }
        const response = await proxyApi.updateSettings(newSettings)
        
        this.proxySettings = newSettings
        return response.data
      } catch (error) {
        console.error('更新代理设置失败:', error)
        throw new Error(error.response?.data?.message || '更新代理设置失败')
      } finally {
        this.loading = false
      }
    },

    /**
     * 测试代理连接
     */
    async testProxy(proxyId) {
      try {
        // 更新代理状态为测试中
        const proxyIndex = this.proxies.findIndex(proxy => proxy.id === proxyId)
        if (proxyIndex !== -1) {
          this.proxies[proxyIndex].status = 'testing'
        }
        
        const response = await proxyApi.testProxy(proxyId)
        
        // 更新代理状态和延迟
        if (proxyIndex !== -1) {
          this.proxies[proxyIndex].status = response.data.success ? 'active' : 'error'
          this.proxies[proxyIndex].latency = response.data.latency
          this.proxies[proxyIndex].lastCheck = new Date().toISOString()
        }
        
        return response.data
      } catch (error) {
        // 测试失败，更新状态为错误
        const proxyIndex = this.proxies.findIndex(proxy => proxy.id === proxyId)
        if (proxyIndex !== -1) {
          this.proxies[proxyIndex].status = 'error'
          this.proxies[proxyIndex].lastCheck = new Date().toISOString()
        }
        
        console.error('测试代理失败:', error)
        throw new Error(error.response?.data?.message || '测试代理失败')
      }
    },

    /**
     * 切换代理状态
     */
    async toggleProxyStatus(proxyId) {
      try {
        const response = await proxyApi.toggleProxy(proxyId)
        
        // 更新本地代理状态
        const proxy = this.proxies.find(proxy => proxy.id === proxyId)
        if (proxy) {
          proxy.status = response.data.status
        }
        
        return response.data
      } catch (error) {
        console.error('切换代理状态失败:', error)
        throw new Error(error.response?.data?.message || '切换代理状态失败')
      }
    },

    /**
     * 重置状态
     */
    resetState() {
      this.proxies = []
      this.proxySettings = {
        enabled: false,
        activeProxyId: null,
        autoSwitch: true,
        healthCheckInterval: 30000,
        fallbackMode: 'tunnel'
      }
      this.proxyStatus = {
        connectionStatus: 'disconnected',
        currentProxy: null,
        throughput: { upload: '0KB/s', download: '0KB/s' },
        statistics: { totalConnections: 0, successRate: 0, avgLatency: 0 },
        lastUpdate: null
      }
      this.loading = false
    }
  }
})
