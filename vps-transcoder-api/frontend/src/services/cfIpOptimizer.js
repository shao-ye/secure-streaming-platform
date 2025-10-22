/**
 * Cloudflare IP优选器 - 前端版本（简化版）
 * 
 * 注意：由于浏览器HTTPS限制，无法直接用IP测试SSL连接
 * 策略：使用预设的优质IP列表，随机选择或按地区优先
 */

// Cloudflare优质IP池（国内优化，按优先级排序）
const CF_IPS = {
  // 香港节点 - 优先级最高（国内访问最快）
  hk: [
    '104.16.123.96',
    '172.67.134.52',
    '104.21.48.200'
  ],
  // 新加坡节点 - 优先级高
  sg: [
    '104.18.32.167',
    '172.67.182.83'
  ],
  // 日本节点 - 优先级中
  jp: [
    '104.19.176.21',
    '172.67.199.47'
  ],
  // 美国节点 - 优先级低（备用）
  us: [
    '104.17.224.244',
    '172.67.161.92'
  ]
};

const CACHE_KEY = 'cf_best_ip_cache';
const CACHE_DURATION = 15 * 60 * 1000; // 15分钟缓存

/**
 * 测试域名连通性和延迟
 * 注意：这里测试的是域名，不是单个IP
 */
async function testDomainLatency(hostname) {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`https://${hostname}/health?t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const latency = Math.round(performance.now() - startTime);
      console.log(`[CF-IP] ✅ 域名延迟: ${latency}ms`);
      return { latency, success: true };
    }
    
    return { latency: 9999, success: false };
  } catch (error) {
    clearTimeout(timeoutId);
    console.log(`[CF-IP] ❌ 域名测试失败: ${error.message}`);
    return { latency: 9999, success: false };
  }
}

/**
 * 智能选择Cloudflare IP
 * 策略：
 * 1. 先测试域名延迟
 * 2. 如果延迟<200ms，不启用IP优选（Cloudflare自动路由已足够好）
 * 3. 如果延迟>200ms，从优质IP列表中选择（按地区优先级）
 */
export async function selectBestCloudflareIP(hostname = 'yoyoapi.5202021.xyz') {
  console.log('[CF-IP-Optimizer] 🔍 开始智能优选...');
  
  // 1. 检查缓存
  const cached = getCachedBestIP();
  if (cached) {
    console.log(`[CF-IP-Optimizer] 📦 使用缓存IP: ${cached}`);
    return cached;
  }
  
  // 2. 测试域名延迟
  const domainTest = await testDomainLatency(hostname);
  
  if (!domainTest.success) {
    console.warn('[CF-IP-Optimizer] ❌ 域名无法访问，网络异常');
    return null;
  }
  
  console.log(`[CF-IP-Optimizer] 📊 当前延迟: ${domainTest.latency}ms`);
  
  // 3. 判断是否需要IP优选
  if (domainTest.latency < 200) {
    console.log('[CF-IP-Optimizer] ✅ 延迟正常，无需IP优选');
    return null; // 不使用IP，让Cloudflare自动路由
  }
  
  console.log('[CF-IP-Optimizer] 🚀 延迟较高，启用IP优选');
  
  // 4. 按优先级选择IP（香港 > 新加坡 > 日本 > 美国）
  const allIPs = [
    ...CF_IPS.hk,
    ...CF_IPS.sg,
    ...CF_IPS.jp,
    ...CF_IPS.us
  ];
  
  // 随机选择一个IP（避免所有用户使用同一个IP）
  const selectedIP = allIPs[Math.floor(Math.random() * allIPs.length)];
  
  console.log(`[CF-IP-Optimizer] 🏆 选择IP: ${selectedIP}`);
  
  // 5. 缓存选择的IP
  cacheBestIP(selectedIP);
  
  return selectedIP;
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
