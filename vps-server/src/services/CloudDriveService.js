const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const CloudDriveLoginExecutor = require('./cloud-drive/CloudDriveLoginExecutor');

/**
 * 中国移动云盘服务
 * 当前阶段提供页面配置、状态查询、短信验证码登录与基础路径校验能力。
 */
class CloudDriveService {
  /**
   * 构造函数
   * 初始化本地状态文件路径，便于在 VPS 侧记录最近一次校验结果。
   */
  constructor() {
    this.stateDir = path.join(process.cwd(), 'data', 'cloud-drive');
    this.stateFile = path.join(this.stateDir, 'state.json');
    this.activeLoginSession = null;
    this.loginExecutor = new CloudDriveLoginExecutor({
      headless: process.env.CLOUD_DRIVE_LOGIN_HEADLESS !== 'false'
    });
    this.ensureStateDirectory();
  }

  /**
   * 确保状态目录存在
   * 避免首次启动时由于目录不存在导致状态写入失败。
   */
  ensureStateDirectory() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /**
   * 获取默认状态
   * @returns {Object} 默认状态对象
   */
  getDefaultState() {
    return {
      account: '',
      authStatus: 'unknown',
      authMessage: '尚未完成云盘登录验证',
      lastValidatedAt: '',
      estimatedExpireAt: '',
      lastSmsRequestedAt: '',
      sessionBundleEncrypted: '',
      lastUpdatedAt: ''
    };
  }

  /**
   * 获取本地加密密钥
   * 优先复用现有服务密钥，避免新增部署时必须补配额外环境变量。
   * @returns {Buffer} 32 字节密钥
   */
  getEncryptionKey() {
    const secret = [
      process.env.CLOUD_DRIVE_SESSION_SECRET,
      process.env.API_SECRET_KEY,
      process.env.VPS_API_KEY,
      process.env.API_KEY,
      'secure-streaming-platform-cloud-drive'
    ].find(Boolean);

    return crypto.createHash('sha256').update(String(secret)).digest();
  }

  /**
   * 加密会话文本
   * 使用 AES-256-GCM 存储登录会话，避免敏感 cookies 以明文落盘。
   * @param {string} plainText 原始文本
   * @returns {string} 加密后的 Base64 文本
   */
  encryptText(plainText) {
    if (!plainText) {
      return '';
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const encryptedBuffer = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encryptedBuffer]).toString('base64');
  }

  /**
   * 解密会话文本
   * @param {string} encryptedText 加密文本
   * @returns {string} 解密后的原始文本
   */
  decryptText(encryptedText) {
    if (!encryptedText) {
      return '';
    }

    const payloadBuffer = Buffer.from(encryptedText, 'base64');
    const iv = payloadBuffer.subarray(0, 12);
    const authTag = payloadBuffer.subarray(12, 28);
    const encryptedBuffer = payloadBuffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final()
    ]).toString('utf8');
  }

  /**
   * 安全释放当前待验证登录会话
   * 每次重新发送验证码前都应关闭上一个浏览器上下文，避免串号或资源泄漏。
   * @returns {Promise<void>}
   */
  async clearActiveLoginSession() {
    if (!this.activeLoginSession) {
      return;
    }

    await this.loginExecutor.disposeSession(this.activeLoginSession).catch((error) => {
      logger.warn('释放云盘登录会话失败', { error: error.message });
    });
    this.activeLoginSession = null;
  }

  /**
   * 加载本地状态
   * @returns {Object} 当前状态
   */
  loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return this.getDefaultState();
      }

      const rawContent = fs.readFileSync(this.stateFile, 'utf-8');
      if (!rawContent.trim()) {
        return this.getDefaultState();
      }

      return {
        ...this.getDefaultState(),
        ...JSON.parse(rawContent)
      };
    } catch (error) {
      logger.warn('加载云盘状态失败，回退默认值', { error: error.message });
      return this.getDefaultState();
    }
  }

  /**
   * 保存本地状态
   * @param {Object} nextState - 待保存状态
   * @returns {Object} 保存后的状态
   */
  saveState(nextState) {
    const finalState = {
      ...this.getDefaultState(),
      ...nextState,
      lastUpdatedAt: new Date().toISOString()
    };

    fs.writeFileSync(this.stateFile, JSON.stringify(finalState, null, 2), 'utf-8');
    return finalState;
  }

  /**
   * 手机号脱敏
   * @param {string} account - 原始手机号
   * @returns {string} 脱敏后的手机号
   */
  maskAccount(account) {
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
   * 获取当前云盘登录状态
   * @returns {Object} 状态信息
   */
  getAuthStatus() {
    const state = this.loadState();

    return {
      status: 'success',
      data: {
        account: state.account,
        accountMasked: this.maskAccount(state.account),
        authStatus: state.authStatus,
        authMessage: state.authMessage,
        lastValidatedAt: state.lastValidatedAt,
        estimatedExpireAt: state.estimatedExpireAt,
        lastSmsRequestedAt: state.lastSmsRequestedAt,
        hasSessionBundle: Boolean(state.sessionBundleEncrypted)
      }
    };
  }

  /**
   * 请求发送短信验证码
   * @param {Object} payload - 请求参数
   * @returns {Promise<Object>} 接口返回内容
   */
  async sendSms(payload) {
    const account = typeof payload.account === 'string' ? payload.account.trim() : '';
    if (!/^\d{11}$/.test(account)) {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '请输入有效的 11 位手机号'
        }
      };
    }

    try {
      await this.clearActiveLoginSession();
      const { session, message } = await this.loginExecutor.requestSmsCode(account);
      this.activeLoginSession = session;

      const nextState = this.saveState({
        ...this.loadState(),
        account,
        authStatus: 'unknown',
        authMessage: message,
        lastSmsRequestedAt: new Date().toISOString()
      });

      return {
        statusCode: 200,
        payload: {
          status: 'success',
          message,
          data: {
            account: nextState.account,
            accountMasked: this.maskAccount(nextState.account),
            authStatus: nextState.authStatus,
            authMessage: nextState.authMessage,
            lastSmsRequestedAt: nextState.lastSmsRequestedAt
          }
        }
      };
    } catch (error) {
      logger.error('请求云盘短信验证码失败', { error: error.message });
      const nextState = this.saveState({
        ...this.loadState(),
        account,
        authStatus: 'invalid',
        authMessage: error.message
      });

      return {
        statusCode: 500,
        payload: {
          status: 'error',
          message: error.message,
          data: {
            account: nextState.account,
            accountMasked: this.maskAccount(nextState.account),
            authStatus: nextState.authStatus,
            authMessage: nextState.authMessage,
            lastSmsRequestedAt: nextState.lastSmsRequestedAt
          }
        }
      };
    }
  }

  /**
   * 构造预计过期时间
   * 当前先按 7 天有效期展示，后续接入真实探测后再改为按服务端校验结果回填。
   * @returns {string} ISO 时间字符串
   */
  buildEstimatedExpireAt() {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  /**
   * 生成脱敏后的云盘会话摘要
   * 仅返回后续排障需要的存在性信息，不直接暴露 cookies/localStorage 具体内容。
   * @param {Object} sessionBundle 原始会话包
   * @returns {Object} 摘要信息
   */
  buildSessionBundleSummary(sessionBundle) {
    const cookies = Array.isArray(sessionBundle?.cookies) ? sessionBundle.cookies : [];
    const localStorageKeys = Object.keys(sessionBundle?.localStorage || {});
    const sessionStorageKeys = Object.keys(sessionBundle?.sessionStorage || {});

    return {
      cookieCount: cookies.length,
      hasAuthorizationCookie: cookies.some((item) => ['authorization', 'auth_token', 'token'].includes(item.name)),
      localStorageKeys,
      sessionStorageKeys,
      capturedAt: sessionBundle?.capturedAt || ''
    };
  }

  /**
   * 构造会话登录成功时的状态对象
   * @param {string} account 手机号
   * @param {Object} sessionBundle 原始会话包
   * @returns {Object} 待保存状态
   */
  buildLoggedInState(account, sessionBundle) {
    return {
      ...this.loadState(),
      account,
      authStatus: 'valid',
      authMessage: '云盘登录有效',
      lastValidatedAt: new Date().toISOString(),
      estimatedExpireAt: this.buildEstimatedExpireAt(),
      sessionBundleEncrypted: this.encryptText(JSON.stringify(sessionBundle))
    };
  }

  /**
   * 读取会话包摘要
   * @returns {Object} 脱敏后的会话摘要
   */
  readSessionBundleSummary() {
    try {
      const state = this.loadState();
      if (!state.sessionBundleEncrypted) {
        return {
          cookieCount: 0,
          hasAuthorizationCookie: false,
          localStorageKeys: [],
          sessionStorageKeys: [],
          capturedAt: ''
        };
      }

      const sessionBundle = JSON.parse(this.decryptText(state.sessionBundleEncrypted));
      return this.buildSessionBundleSummary(sessionBundle);
    } catch (error) {
      logger.warn('读取云盘会话摘要失败', { error: error.message });
      return {
        cookieCount: 0,
        hasAuthorizationCookie: false,
        localStorageKeys: [],
        sessionStorageKeys: [],
        capturedAt: ''
      };
    }
  }

  /**
   * 执行短信登录验证
   * @param {Object} payload - 登录参数
   * @returns {Promise<Object>} 接口返回内容
   */
  async validateLogin(payload) {
    const account = typeof payload.account === 'string' ? payload.account.trim() : '';
    const smsCode = typeof payload.smsCode === 'string' ? payload.smsCode.trim() : '';

    if (!/^\d{11}$/.test(account)) {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '请输入有效的 11 位手机号'
        }
      };
    }

    if (!smsCode) {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '请输入短信验证码'
        }
      };
    }

    if (!this.activeLoginSession || this.activeLoginSession.account !== account) {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '未找到待验证的短信登录会话，请重新获取验证码'
        }
      };
    }

    try {
      const { sessionBundle, message } = await this.loginExecutor.submitSmsCode(this.activeLoginSession, smsCode);
      const nextState = this.saveState(this.buildLoggedInState(account, sessionBundle));
      const sessionSummary = this.buildSessionBundleSummary(sessionBundle);
      await this.clearActiveLoginSession();

      return {
        statusCode: 200,
        payload: {
          status: 'success',
          message,
          data: {
            cloudDrive: {
              account: nextState.account,
              accountMasked: this.maskAccount(nextState.account),
              authStatus: nextState.authStatus,
              authMessage: nextState.authMessage,
              lastValidatedAt: nextState.lastValidatedAt,
              estimatedExpireAt: nextState.estimatedExpireAt,
              sessionBundleSummary: sessionSummary
            }
          }
        }
      };
    } catch (error) {
      logger.error('执行云盘短信登录验证失败', { error: error.message });
      const nextState = this.saveState({
        ...this.loadState(),
        account,
        authStatus: 'invalid',
        authMessage: error.message,
        lastValidatedAt: new Date().toISOString()
      });

      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: error.message,
          data: {
            cloudDrive: {
              account: nextState.account,
              accountMasked: this.maskAccount(nextState.account),
              authStatus: nextState.authStatus,
              authMessage: nextState.authMessage,
              lastValidatedAt: nextState.lastValidatedAt,
              estimatedExpireAt: nextState.estimatedExpireAt,
              sessionBundleSummary: this.readSessionBundleSummary()
            }
          }
        }
      };
    }
  }

  /**
   * 校验上传目标
   * 当前阶段对默认文件目录执行基础格式校验，并明确说明尚未完成远端可写性验证。
   * @param {Object} payload - 校验参数
   * @returns {Object} 接口返回内容
   */
  validateTarget(payload) {
    const destinationType = payload.destinationType || 'cloudFile';
    const selectorMode = payload.selectorMode || 'manual';
    const manualPath = typeof payload.manualPath === 'string' ? payload.manualPath.trim() : '';

    if (destinationType !== 'cloudFile') {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '当前版本仅支持默认文件目录的手动路径校验'
        }
      };
    }

    if (selectorMode !== 'manual') {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '当前版本仅支持手动路径模式'
        }
      };
    }

    if (!manualPath) {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '请输入需要校验的目标路径'
        }
      };
    }

    /**
     * 这里先做基础格式校验，不伪造远端目录写权限校验结果。
     * 等后续 139 登录会话执行器接入后，再补充真实目录存在性与写入能力验证。
     */
    const normalizedPath = manualPath.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!normalizedPath.startsWith('/')) {
      return {
        statusCode: 400,
        payload: {
          status: 'error',
          message: '默认文件目录路径必须以 / 开头'
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        status: 'success',
        message: '已通过基础路径格式校验，远端目录可写性校验待登录执行器接入后补充',
        data: {
          valid: true,
          checkMode: 'syntax_only',
          destinationType,
          selectorMode,
          manualPath,
          resolvedPath: `默认文件目录 / ${normalizedPath.replace(/^\//, '')}`,
          catalogId: '',
          targetName: path.posix.basename(normalizedPath) || normalizedPath
        }
      }
    };
  }
}

module.exports = CloudDriveService;
