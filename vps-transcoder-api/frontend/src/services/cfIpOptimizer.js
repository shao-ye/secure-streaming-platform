/**
 * Cloudflare IP优选器 - 前端版本
 * 自动测试并选择最快的Cloudflare IP，优化国内访问速度
 */

// Cloudflare优质IP池（国内优化）
const CF_IPS = [
  // 香港节点 - 优先级最高
  '104.16.123.96',
  '172.67.134.52',
  '104.21.48.200',
  
  // 新加坡节点
  '104.18.32.167',
  '172.67.182.83',
  
  // 日本节点
  '104.19.176.21',
  '172.67.199.47',
  
  // 美国节点（备用）
  '104.17.224.244',
  '172.67.161.92'
];

const CACHE_KEY = 'cf_best_ip_cache';
const CACHE_DURATION = 15 * 60 * 1000; // 15分钟缓存

/**
 * 测试单个IP的延迟
 */
async function testIPLatency(ip, hostname) {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒超时
  
  try {
    const response = await fetch(`https://${ip}/health`, {
      method: 'GET',
      headers: {
        'Host': hostname,
        'User-Agent': 'YOYO-CF-Optimizer/1.0'
      },
      signal: controller.signal,
      mode: 'cors'
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const latency = Math.round(performance.now() - startTime);
      console.log(`[CF-IP] ✅ ${ip}: ${latency}ms`);
      return { ip, latency, success: true };
    }
    
    console.log(`[CF-IP] ❌ ${ip}: HTTP ${response.status}`);
    return { ip, latency: 9999, success: false };
  } catch (error) {
    clearTimeout(timeoutId);
    console.log(`[CF-IP] ❌ ${ip}: ${error.message}`);
    return { ip, latency: 9999, success: false };
  }
}

/**
 * 优选最快的Cloudflare IP
 */
export async function selectBestCloudflareIP(hostname = 'yoyoapi.5202021.xyz', maxTest = 5) {
  console.log('[CF-IP-Optimizer] 🔍 开始优选Cloudflare IP...');
  
  // 检查缓存
  const cached = getCachedBestIP();
  if (cached) {
    console.log(`[CF-IP-Optimizer] 📦 使用缓存IP: ${cached}`);
    return cached;
  }
  
  // 随机选择maxTest个IP进行测试
  const testIPs = [...CF_IPS].sort(() => Math.random() - 0.5).slice(0, maxTest);
  console.log(`[CF-IP-Optimizer] 🧪 测试 ${testIPs.length} 个IP...`);
  
  // 并行测试所有IP
  const results = await Promise.all(
    testIPs.map(ip => testIPLatency(ip, hostname))
  );
  
  // 过滤成功的结果并按延迟排序
  const successResults = results
    .filter(r => r.success)
    .sort((a, b) => a.latency - b.latency);
  
  if (successResults.length === 0) {
    console.warn('[CF-IP-Optimizer] ⚠️ 所有IP测试失败，使用默认域名');
    return null;
  }
  
  const bestIP = successResults[0];
  console.log(`[CF-IP-Optimizer] 🏆 最优IP: ${bestIP.ip}, 延迟: ${bestIP.latency}ms`);
  
  // 缓存最优IP
  cacheBestIP(bestIP.ip);
  
  return bestIP.ip;
}

/**
 * 获取缓存的最优IP
 */
function getCachedBestIP() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { ip, timestamp } = JSON.parse(cached);
      // 检查缓存是否过期
      if (Date.now() - timestamp < CACHE_DURATION) {
        return ip;
      }
      console.log('[CF-IP-Optimizer] 🗑️ 缓存已过期');
    }
  } catch (error) {
    console.warn('[CF-IP-Optimizer] ⚠️ 读取缓存失败:', error);
  }
  return null;
}

/**
 * 保存最优IP到缓存
 */
function cacheBestIP(ip) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ip,
      timestamp: Date.now()
    }));
    console.log(`[CF-IP-Optimizer] 💾 已缓存IP: ${ip}`);
  } catch (error) {
    console.warn('[CF-IP-Optimizer] ⚠️ 保存缓存失败:', error);
  }
}

/**
 * 清除缓存的IP
 */
export function clearCachedIP() {
  try {
    localStorage.removeItem(CACHE_KEY);
    console.log('[CF-IP-Optimizer] 🗑️ 已清除缓存');
  } catch (error) {
    console.warn('[CF-IP-Optimizer] ⚠️ 清除缓存失败:', error);
  }
}

/**
 * 手动触发IP优选（强制刷新）
 */
export async function refreshBestIP(hostname = 'yoyoapi.5202021.xyz') {
  clearCachedIP();
  return await selectBestCloudflareIP(hostname);
}

/**
 * 获取优选统计信息
 */
export function getOptimizerStats() {
  const cached = getCachedBestIP();
  return {
    enabled: true,
    cachedIP: cached,
    cacheValid: !!cached,
    totalIPs: CF_IPS.length
  };
}
