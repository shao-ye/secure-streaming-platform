// 简化的隧道性能监控
export class TunnelMonitor {
  constructor() {
    this.stats = {
      requests: 0,
      totalLatency: 0,
      errors: 0
    };
  }
  
  recordRequest(latency, success = true) {
    this.stats.requests++;
    this.stats.totalLatency += latency;
    if (!success) this.stats.errors++;
  }
  
  getStats() {
    return {
      totalRequests: this.stats.requests,
      averageLatency: this.stats.requests > 0 ? Math.round(this.stats.totalLatency / this.stats.requests) : 0,
      errorRate: this.stats.requests > 0 ? (this.stats.errors / this.stats.requests * 100).toFixed(1) : 0,
      tunnelOptimized: true
    };
  }
  
  reset() {
    this.stats = {
      requests: 0,
      totalLatency: 0,
      errors: 0
    };
  }
}

// 全局隧道监控实例
export const tunnelMonitor = new TunnelMonitor();
