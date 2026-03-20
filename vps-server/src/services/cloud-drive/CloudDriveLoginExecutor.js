const { setTimeout: delay } = require('timers/promises');

/**
 * 中国移动云盘短信登录执行器
 * 负责通过 Playwright 驱动官方 Web 登录页，完成获取验证码与提交验证码的浏览器自动化。
 */
class CloudDriveLoginExecutor {
  /**
   * 构造函数
   * @param {Object} options 执行器配置
   */
  constructor(options = {}) {
    this.loginUrl = options.loginUrl || 'https://yun.139.com/w/#/';
    this.headless = options.headless !== false;
    this.navigationTimeout = options.navigationTimeout || 30000;
  }

  /**
   * 加载 Playwright 模块
   * 通过延迟 require 避免在依赖尚未安装时让整个服务启动失败。
   * @returns {{ chromium: import('playwright').chromium }} Playwright 导出对象
   */
  loadPlaywright() {
    try {
      return require('playwright');
    } catch (error) {
      throw new Error('Playwright 依赖未安装，请在 VPS 端执行 npm install 后重试云盘登录');
    }
  }

  /**
   * 创建短信登录会话
   * 会话在“获取验证码”后保持打开，供后续验证码提交继续复用同一浏览器上下文。
   * @param {string} account 手机号
   * @returns {Promise<Object>} 登录会话对象
   */
  async createSmsSession(account) {
    const { chromium } = this.loadPlaywright();
    const browser = await chromium.launch({ headless: this.headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(this.loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.navigationTimeout
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await this.ensureSmsLoginTab(page);
    await this.fillPhoneNumber(page, account);
    await this.ensureAgreementAccepted(page);

    return {
      browser,
      context,
      page,
      account,
      createdAt: Date.now()
    };
  }

  /**
   * 切换到短信登录页签
   * 页面默认通常已位于短信登录，但这里仍显式处理，减少后续选择器抖动。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<void>}
   */
  async ensureSmsLoginTab(page) {
    const smsTab = page.getByText('短信登录', { exact: true }).first();
    if (await smsTab.isVisible().catch(() => false)) {
      await smsTab.click().catch(() => {});
    }

    await this.getVisiblePhoneInput(page).waitFor({
      state: 'visible',
      timeout: 10000
    });
  }

  /**
   * 获取当前可见的手机号输入框
   * 139 登录页存在多个同 placeholder 输入框时，必须只选择当前真正可见的那个，避免 strict mode 报错。
   * @param {import('playwright').Page} page 页面对象
   * @returns {import('playwright').Locator} 手机号输入框定位器
   */
  getVisiblePhoneInput(page) {
    return page.locator('input[placeholder="请输入手机号"]:visible').first();
  }

  /**
   * 填充手机号
   * @param {import('playwright').Page} page 页面对象
   * @param {string} account 手机号
   * @returns {Promise<void>}
   */
  async fillPhoneNumber(page, account) {
    const phoneInput = this.getVisiblePhoneInput(page);
    await phoneInput.click();
    await phoneInput.fill('');
    await phoneInput.fill(account);
  }

  /**
   * 获取当前可见的验证码输入框
   * 139 登录页同样可能渲染多个验证码输入框副本，这里统一只操作当前可见元素。
   * @param {import('playwright').Page} page 页面对象
   * @returns {import('playwright').Locator} 验证码输入框定位器
   */
  getVisibleSmsCodeInput(page) {
    return page.locator('input[placeholder="请输入验证码"]:visible').first();
  }

  /**
   * 勾选协议确认
   * 该页面在不同版本下可能使用原生 checkbox 或自绘勾选框。
   * 这里优先尝试点击可见 checkbox，若未找到则保持兼容，不强制报错。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<void>}
   */
  async ensureAgreementAccepted(page) {
    await page.evaluate(() => {
      /**
       * 中文说明：优先处理原生 checkbox，避免按钮因未勾选协议而不可点击。
       * 若页面使用的是自绘组件而非原生 input，这里保持静默，由后续点击结果判断。
       */
      const checkboxList = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const visibleCheckbox = checkboxList.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (visibleCheckbox && !visibleCheckbox.checked) {
        visibleCheckbox.click();
      }
    }).catch(() => {});
  }

  /**
   * 请求发送短信验证码
   * @param {string} account 手机号
   * @returns {Promise<{session: Object, message: string}>} 会话与提示文案
   */
  async requestSmsCode(account) {
    const session = await this.createSmsSession(account);

    try {
      const sendButton = session.page.getByText('获取验证码', { exact: true }).first();
      await sendButton.click({ timeout: 10000 });
      await delay(2000);

      const analysisResult = await this.analyzeSmsRequestResult(session.page);
      if (!analysisResult.success) {
        await this.disposeSession(session);
        throw new Error(analysisResult.message);
      }

      return {
        session,
        message: analysisResult.message
      };
    } catch (error) {
      await this.disposeSession(session).catch(() => {});
      throw error;
    }
  }

  /**
   * 分析短信请求结果
   * 通过页面文案和按钮状态判断是否已经进入验证码倒计时阶段。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<{success: boolean, message: string}>} 分析结果
   */
  async analyzeSmsRequestResult(page) {
    const pageText = await this.readVisiblePageText(page);
    const buttonText = await this.readSmsButtonText(page);
    const pageErrorMessage = this.extractKnownErrorMessage(pageText);

    if (pageErrorMessage) {
      return {
        success: false,
        message: pageErrorMessage
      };
    }

    if (/\b\d+\s*s\b/i.test(buttonText) || /\d+秒/.test(buttonText) || /重新获取|重新发送/.test(pageText)) {
      return {
        success: true,
        message: '验证码已发送，请输入短信验证码完成登录'
      };
    }

    if (/验证码已发送|短信已发送|发送成功/.test(pageText)) {
      return {
        success: true,
        message: '验证码已发送，请输入短信验证码完成登录'
      };
    }

    return {
      success: true,
      message: '已触发验证码发送，请留意手机短信'
    };
  }

  /**
   * 提交短信验证码执行登录
   * @param {Object} session 登录会话
   * @param {string} smsCode 验证码
   * @returns {Promise<{sessionBundle: Object, message: string}>} 登录结果
   */
  async submitSmsCode(session, smsCode) {
    const { page, context } = session;
    await this.ensureSmsLoginTab(page);
    await this.ensureAgreementAccepted(page);

    const codeInput = this.getVisibleSmsCodeInput(page);
    await codeInput.click();
    await codeInput.fill('');
    await codeInput.fill(smsCode);

    const loginButton = page.getByText('登录/注册', { exact: true }).first();
    await loginButton.click({ timeout: 10000 });

    const loginResult = await this.waitForLoginSuccess(page);
    if (!loginResult.success) {
      throw new Error(loginResult.message);
    }

    const sessionBundle = await this.captureSessionBundle(context, page);
    return {
      sessionBundle,
      message: '云盘登录验证成功'
    };
  }

  /**
   * 等待登录完成
   * 成功标志优先判断 URL 跳转和“我的文件/我的家庭”等登录后内容。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<{success: boolean, message: string}>} 登录结果
   */
  async waitForLoginSuccess(page) {
    try {
      await Promise.race([
        page.waitForURL((url) => /#\/(index|familycloud)/.test(url.href), { timeout: 15000 }),
        page.getByText('我的文件', { exact: true }).waitFor({ state: 'visible', timeout: 15000 }),
        page.getByText('我的家庭', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
      ]);

      return {
        success: true,
        message: '登录成功'
      };
    } catch (error) {
      const pageText = await this.readVisiblePageText(page);
      return {
        success: false,
        message: this.extractKnownErrorMessage(pageText) || '验证码登录未成功，请检查验证码后重试'
      };
    }
  }

  /**
   * 抓取当前会话包
   * 保存 cookies、localStorage、sessionStorage，供后续上传能力复用登录态。
   * @param {import('playwright').BrowserContext} context 浏览器上下文
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<Object>} 会话包
   */
  async captureSessionBundle(context, page) {
    const cookies = await context.cookies();
    const localStorageData = await page.evaluate(() => {
      const result = {};
      for (const key of Object.keys(window.localStorage)) {
        result[key] = window.localStorage.getItem(key);
      }
      return result;
    });
    const sessionStorageData = await page.evaluate(() => {
      const result = {};
      for (const key of Object.keys(window.sessionStorage)) {
        result[key] = window.sessionStorage.getItem(key);
      }
      return result;
    });

    return {
      pageUrl: page.url(),
      capturedAt: new Date().toISOString(),
      cookies,
      localStorage: localStorageData,
      sessionStorage: sessionStorageData
    };
  }

  /**
   * 读取当前页面可见文本
   * 统一用于判断页面错误提示和登录结果。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<string>} 页面可见文本
   */
  async readVisiblePageText(page) {
    const bodyLocator = page.locator('body');
    const rawText = await bodyLocator.innerText().catch(async () => bodyLocator.textContent());
    return (rawText || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * 读取获取验证码按钮当前文案
   * 不同页面版本下按钮会切换成倒计时文本，用于辅助判断短信是否成功发送。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<string>} 按钮文案
   */
  async readSmsButtonText(page) {
    return page.evaluate(() => {
      const allText = Array.from(document.querySelectorAll('button, div, span'))
        .map((element) => (element.textContent || '').trim())
        .filter(Boolean);

      return allText.find((text) => /获取验证码|重新获取|重新发送|\d+\s*s|\d+秒/i.test(text)) || '';
    }).catch(() => '');
  }

  /**
   * 提取已知错误信息
   * 将官网页面上的常见提示归一成适合后台直接展示的中文文案。
   * @param {string} pageText 页面文本
   * @returns {string} 错误文案，未匹配时返回空字符串
   */
  extractKnownErrorMessage(pageText) {
    const knownPatterns = [
      /请输入手机号/,
      /请输入正确的手机号/,
      /手机号格式不正确/,
      /验证码错误/,
      /验证码不正确/,
      /验证码已过期/,
      /验证码失效/,
      /验证码发送过于频繁/,
      /操作过于频繁/,
      /系统繁忙/,
      /网络异常/,
      /请稍后再试/
    ];

    const matchedPattern = knownPatterns.find((pattern) => pattern.test(pageText));
    if (!matchedPattern) {
      return '';
    }

    const matchedText = pageText.match(matchedPattern);
    return matchedText?.[0] || '云盘登录执行失败';
  }

  /**
   * 释放登录会话
   * @param {Object|null} session 登录会话
   * @returns {Promise<void>}
   */
  async disposeSession(session) {
    if (!session?.browser) {
      return;
    }

    await session.browser.close().catch(() => {});
  }
}

module.exports = CloudDriveLoginExecutor;
