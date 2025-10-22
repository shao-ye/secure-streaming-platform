/**
 * Cloudflare IP优选器
 * 参考cfnew项目，自动测试并选择最快的Cloudflare IP
 */

// Cloudflare优质IP池（国内优化）
const CF_IPS = [
  // 香港节点
  '104.16.123.96',
  '172.67.134.52',
  '104.21.48.200',
  
  // 新加坡节点
  '104.18.32.167',
  '172.67.182.83',
  
  // 日本节点
  '104.19.176.21',
  '172.67.199.47',
  
  // 美国节点
  '104.17.224.244',
  '172.67.161.92'
];

/**
 * 测试单个IP的延迟
 */
async function testIPLatency(ip, hostname) {
  const startTime = Date.now();
  try {
    const response = await fetch(`https://${ip}/health`, {
      method: 'GET',
      headers: {
        'Host': hostname,
        'User-Agent': 'CF-IP-Optimizer/1.0'
      },
      signal: AbortSignal.timeout(3000) // 3秒超时
    });
    
    if (response.ok) {
      const latency = Date.now() - startTime;
      return { ip, latency, success: true };
    }
    return { ip, latency: 9999, success: false };
  } catch (error) {
    return { ip, latency: 9999, success: false };
  }
}

/**
 * 优选最快的Cloudflare IP
 */
export async function selectBestCloudflareIP(hostname = 'yoyoapi.5202021.xyz', maxTest = 5) {
  console.log('[CF-IP-Optimizer] 开始优选Cloudflare IP...');
  
  // 随机选择maxTest个IP进行测试
  const testIPs = CF_IPS.sort(() => Math.random() - 0.5).slice(0, maxTest);
  
  // 并行测试所有IP
  const results = await Promise.all(
    testIPs.map(ip => testIPLatency(ip, hostname))
  );
  
  // 过滤成功的结果并按延迟排序
  const successResults = results
    .filter(r => r.success)
    .sort((a, b) => a.latency - b.latency);
  
  if (successResults.length === 0) {
    console.warn('[CF-IP-Optimizer] 所有IP测试失败，使用默认域名');
    return null;
  }
  
  const bestIP = successResults[0];
  console.log(`[CF-IP-Optimizer] 最优IP: ${bestIP.ip}, 延迟: ${bestIP.latency}ms`);
  
  return bestIP.ip;
}

/**
 * 缓存最优IP（使用localStorage）
 */
export function getCachedBestIP() {
  try {
    const cached = localStorage.getItem('cf_best_ip');
    if (cached) {
      const { ip, timestamp } = JSON.parse(cached);
      // 缓存有效期15分钟
      if (Date.now() - timestamp < 15 * 60 * 1000) {
        return ip;
      }
    }
  } catch (error) {
    console.warn('[CF-IP-Optimizer] 读取缓存失败:', error);
  }
  return null;
}

/**
 * 保存最优IP到缓存
 */
export function cacheBestIP(ip) {
  try {
    localStorage.setItem('cf_best_ip', JSON.stringify({
      ip,
      timestamp: Date.now()
    }));
  } catch (error) {
    console.warn('[CF-IP-Optimizer] 保存缓存失败:', error);
  }
}
