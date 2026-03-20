const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * 中国移动云盘服务
 * 当前阶段先提供页面配置、状态查询、基础路径校验等能力。
 * 真实短信验证码自动化登录执行器将在后续接入。
 */
class CloudDriveService {
  /**
   * 构造函数
   * 初始化本地状态文件路径，便于在 VPS 侧记录最近一次校验结果。
   */
  constructor() {
    this.stateDir = path.join(process.cwd(), 'data', 'cloud-drive');
    this.stateFile = path.join(this.stateDir, 'state.json');
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
      lastUpdatedAt: ''
    };
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
        lastSmsRequestedAt: state.lastSmsRequestedAt
      }
    };
  }

  /**
   * 请求发送短信验证码
   * 当前版本仅记录请求并返回明确的未完成说明，避免伪造成功状态。
   * @param {Object} payload - 请求参数
   * @returns {Object} 接口返回内容
   */
  sendSms(payload) {
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

    const nextState = this.saveState({
      ...this.loadState(),
      account,
      authStatus: 'unknown',
      authMessage: '短信验证码自动化执行器尚未接入，当前版本已保存手机号与登录流程骨架',
      lastSmsRequestedAt: new Date().toISOString()
    });

    return {
      statusCode: 501,
      payload: {
        status: 'error',
        message: '短信验证码自动化执行器尚未接入，当前版本已保存手机号与登录流程骨架',
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

  /**
   * 执行短信登录验证
   * 当前阶段不伪造真实登录结果，直接返回待实现说明。
   * @param {Object} payload - 登录参数
   * @returns {Object} 接口返回内容
   */
  validateLogin(payload) {
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

    const nextState = this.saveState({
      ...this.loadState(),
      account,
      authStatus: 'unknown',
      authMessage: '短信登录自动化执行器尚未接入，当前版本仅完成配置页、状态流和接口骨架',
      lastValidatedAt: new Date().toISOString()
    });

    return {
      statusCode: 501,
      payload: {
        status: 'error',
        message: '短信登录自动化执行器尚未接入，当前版本仅完成配置页、状态流和接口骨架',
        data: {
          cloudDrive: {
            account: nextState.account,
            accountMasked: this.maskAccount(nextState.account),
            authStatus: nextState.authStatus,
            authMessage: nextState.authMessage,
            lastValidatedAt: nextState.lastValidatedAt,
            estimatedExpireAt: nextState.estimatedExpireAt
          }
        }
      }
    };
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
