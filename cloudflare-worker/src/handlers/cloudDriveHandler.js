/**
 * 中国移动云盘配置与登录状态处理器
 * 负责转发 Workers 管理接口到 VPS，并维护系统设置中的 cloudDrive 嵌套结构。
 */

const SYSTEM_CONFIG_KEY = 'system:cleanup:config';

/**
 * 获取默认的中国移动云盘配置
 * @returns {Object} 默认配置对象
 */
function getDefaultCloudDriveConfig() {
  return {
    enabled: false,
    provider: 'cmcc139',
    loginMode: 'sms',
    account: '',
    accountMasked: '',
    savePassword: false,
    passwordEncrypted: '',
    sessionBundleEncrypted: '',
    authStatus: 'unknown',
    authMessage: '',
    lastValidatedAt: '',
    estimatedExpireAt: '',
    lastValidator: '',
    updatedAt: '',
    updatedBy: ''
  };
}

/**
 * 获取默认的系统清理配置
 * @returns {Object} 默认系统配置对象
 */
function getDefaultSystemConfig() {
  return {
    enabled: true,
    retentionDays: 2,
    segmentEnabled: false,
    segmentDuration: 60,
    recoveryScanHours: 48,
    cloudDrive: getDefaultCloudDriveConfig(),
    updatedAt: ''
  };
}

/**
 * 手机号脱敏
 * @param {string} account - 手机号
 * @returns {string} 脱敏后的手机号
 */
function maskAccount(account) {
  if (typeof account !== 'string') {
    return '';
  }

  const normalizedAccount = account.trim();
  if (!/^\d{11}$/.test(normalizedAccount)) {
    return normalizedAccount;
  }

  return `${normalizedAccount.slice(0, 3)}****${normalizedAccount.slice(-4)}`;
}

/**
 * 读取当前系统配置，并补齐默认字段
 * @param {Object} env - Workers 环境变量
 * @returns {Promise<Object>} 补齐后的系统配置
 */
async function readSystemConfig(env) {
  const rawConfig = await env.YOYO_USER_DB.get(SYSTEM_CONFIG_KEY);
  const defaultConfig = getDefaultSystemConfig();

  if (!rawConfig) {
    return defaultConfig;
  }

  const parsedConfig = JSON.parse(rawConfig);
  return {
    ...defaultConfig,
    ...parsedConfig,
    cloudDrive: {
      ...defaultConfig.cloudDrive,
      ...(parsedConfig.cloudDrive || {})
    }
  };
}

/**
 * 将系统配置写回 KV
 * @param {Object} env - Workers 环境变量
 * @param {Object} config - 待保存配置
 * @returns {Promise<void>}
 */
async function writeSystemConfig(env, config) {
  await env.YOYO_USER_DB.put(SYSTEM_CONFIG_KEY, JSON.stringify(config));
}

/**
 * 对 cloudDrive 配置做脱敏，避免敏感字段直接返回前端
 * @param {Object} cloudDriveConfig - 原始云盘配置
 * @returns {Object} 脱敏后的配置
 */
function sanitizeCloudDriveConfig(cloudDriveConfig) {
  const mergedConfig = {
    ...getDefaultCloudDriveConfig(),
    ...(cloudDriveConfig || {})
  };

  return {
    ...mergedConfig,
    accountMasked: maskAccount(mergedConfig.account),
    passwordEncrypted: mergedConfig.passwordEncrypted ? '***' : '',
    sessionBundleEncrypted: mergedConfig.sessionBundleEncrypted ? '***' : ''
  };
}

/**
 * 从请求中提取当前登录用户名
 * @param {Object} env - Workers 环境变量
 * @param {Request} request - 当前请求对象
 * @returns {Promise<string>} 用户名
 */
async function getUsernameFromRequest(env, request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = Object.fromEntries(
    cookieHeader
      .split(';')
      .map(cookieItem => cookieItem.trim())
      .filter(Boolean)
      .map(cookieItem => {
        const separatorIndex = cookieItem.indexOf('=');
        if (separatorIndex === -1) {
          return [cookieItem, ''];
        }

        return [
          cookieItem.slice(0, separatorIndex),
          cookieItem.slice(separatorIndex + 1)
        ];
      })
  );

  const sessionToken = cookies.session_token;
  if (!sessionToken) {
    return 'unknown';
  }

  try {
    const session = await env.YOYO_USER_DB.get(`SESSION:${sessionToken}`, { type: 'json' });
    return session?.username || 'unknown';
  } catch (error) {
    console.error('获取当前登录用户失败:', error);
    return 'unknown';
  }
}

/**
 * 调用 VPS 云盘接口
 * @param {Object} env - Workers 环境变量
 * @param {string} endpoint - 云盘接口路径
 * @param {string} method - HTTP 方法
 * @param {Object|null} body - 请求体
 * @returns {Promise<{statusCode: number, payload: Object}>} VPS 响应
 */
async function callVpsCloudDrive(env, endpoint, method = 'GET', body = null) {
  const requestOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.VPS_API_KEY
    }
  };

  if (body) {
    requestOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`${env.VPS_API_URL}/api/cloud-drive${endpoint}`, requestOptions);
  const payload = await response.json().catch(() => ({
    status: 'error',
    message: 'VPS 返回了无法解析的响应'
  }));

  return {
    statusCode: response.status,
    payload
  };
}

/**
 * 处理发送短信验证码请求
 * @param {Object} env - Workers 环境变量
 * @param {Request} request - 当前请求对象
 * @returns {Promise<Response>} HTTP 响应
 */
async function handleSendSms(env, request) {
  const body = await request.json();
  const account = typeof body.account === 'string' ? body.account.trim() : '';

  if (!/^\d{11}$/.test(account)) {
    return new Response(JSON.stringify({
      status: 'error',
      message: '请输入有效的 11 位手机号'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const username = await getUsernameFromRequest(env, request);
  const { statusCode, payload } = await callVpsCloudDrive(env, '/send-sms', 'POST', { account });

  if (statusCode >= 400 || payload.status !== 'success') {
    return new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const systemConfig = await readSystemConfig(env);
  systemConfig.cloudDrive = {
    ...systemConfig.cloudDrive,
    enabled: systemConfig.cloudDrive.enabled === true,
    provider: 'cmcc139',
    loginMode: 'sms',
    account,
    accountMasked: maskAccount(account),
    authStatus: payload.data?.authStatus || systemConfig.cloudDrive.authStatus || 'unknown',
    authMessage: payload.data?.authMessage || payload.message || '',
    updatedAt: new Date().toISOString(),
    updatedBy: username
  };

  await writeSystemConfig(env, systemConfig);

  return new Response(JSON.stringify({
    status: 'success',
    message: payload.message || '验证码请求已发送',
    data: {
      ...(payload.data || {}),
      cloudDrive: sanitizeCloudDriveConfig(systemConfig.cloudDrive)
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 处理云盘登录验证请求
 * @param {Object} env - Workers 环境变量
 * @param {Request} request - 当前请求对象
 * @returns {Promise<Response>} HTTP 响应
 */
async function handleValidateLogin(env, request) {
  const body = await request.json();
  const username = await getUsernameFromRequest(env, request);
  const { statusCode, payload } = await callVpsCloudDrive(env, '/login/validate', 'POST', body);

  if (statusCode >= 400 || payload.status !== 'success') {
    return new Response(JSON.stringify(payload), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const systemConfig = await readSystemConfig(env);
  const currentCloudDriveConfig = systemConfig.cloudDrive || getDefaultCloudDriveConfig();
  const responseCloudDriveConfig = payload.data?.cloudDrive || {};

  systemConfig.cloudDrive = {
    ...currentCloudDriveConfig,
    ...responseCloudDriveConfig,
    provider: 'cmcc139',
    loginMode: 'sms',
    account: responseCloudDriveConfig.account || currentCloudDriveConfig.account,
    accountMasked: maskAccount(responseCloudDriveConfig.account || currentCloudDriveConfig.account),
    updatedAt: new Date().toISOString(),
    updatedBy: username,
    lastValidator: username
  };

  await writeSystemConfig(env, systemConfig);

  return new Response(JSON.stringify({
    status: 'success',
    message: payload.message || '登录状态已更新',
    data: {
      cloudDrive: sanitizeCloudDriveConfig(systemConfig.cloudDrive)
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 查询当前云盘登录状态
 * @param {Object} env - Workers 环境变量
 * @returns {Promise<Response>} HTTP 响应
 */
async function handleAuthStatus(env) {
  const systemConfig = await readSystemConfig(env);

  try {
    const { statusCode, payload } = await callVpsCloudDrive(env, '/auth-status');
    if (statusCode === 200 && payload.status === 'success' && payload.data) {
      systemConfig.cloudDrive = {
        ...systemConfig.cloudDrive,
        ...payload.data,
        provider: 'cmcc139',
        loginMode: 'sms',
        updatedAt: new Date().toISOString()
      };

      await writeSystemConfig(env, systemConfig);
    }
  } catch (error) {
    console.error('同步 VPS 云盘状态失败:', error);
  }

  return new Response(JSON.stringify({
    status: 'success',
    data: sanitizeCloudDriveConfig(systemConfig.cloudDrive)
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 处理目标路径校验请求
 * @param {Object} env - Workers 环境变量
 * @param {Request} request - 当前请求对象
 * @returns {Promise<Response>} HTTP 响应
 */
async function handleValidateTarget(env, request) {
  const body = await request.json();
  const systemConfig = await readSystemConfig(env);
  const { statusCode, payload } = await callVpsCloudDrive(env, '/validate-target', 'POST', {
    ...body,
    cloudDrive: systemConfig.cloudDrive
  });

  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * 云盘 API 统一处理入口
 * @param {Request} request - 当前请求对象
 * @param {Object} env - Workers 环境变量
 * @returns {Promise<Response>} HTTP 响应
 */
async function handleCloudDriveRequest(request, env) {
  const pathname = new URL(request.url).pathname;
  const method = request.method;

  if (pathname === '/api/admin/cloud-drive/send-sms' && method === 'POST') {
    return handleSendSms(env, request);
  }

  if (pathname === '/api/admin/cloud-drive/login/validate' && method === 'POST') {
    return handleValidateLogin(env, request);
  }

  if (pathname === '/api/admin/cloud-drive/auth-status' && method === 'GET') {
    return handleAuthStatus(env);
  }

  if (pathname === '/api/admin/cloud-drive/validate-target' && method === 'POST') {
    return handleValidateTarget(env, request);
  }

  return new Response(JSON.stringify({
    status: 'error',
    message: 'Cloud drive API endpoint not found'
  }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

export {
  getDefaultCloudDriveConfig,
  getDefaultSystemConfig,
  sanitizeCloudDriveConfig,
  handleCloudDriveRequest
};
