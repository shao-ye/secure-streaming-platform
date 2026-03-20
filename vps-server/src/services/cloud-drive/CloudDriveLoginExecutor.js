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

    await this.navigateToLoginPage(page);

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
   * 导航到 139 登录页并等待关键登录表单可用
   * 官网首屏偶发较慢，直接等待 domcontentloaded 容易超时；这里改为更早的 commit 级别导航，
   * 再以手机号输入框可见作为真正可操作的页面就绪信号，并在失败时自动重试。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<void>}
   */
  async navigateToLoginPage(page) {
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await page.goto(this.loginUrl, {
          waitUntil: 'commit',
          timeout: Math.max(this.navigationTimeout, 45000)
        });

        await this.getVisiblePhoneInput(page).waitFor({
          state: 'visible',
          timeout: 20000
        });

        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        return;
      } catch (error) {
        lastError = error;

        /**
         * 中文说明：部分情况下 goto 超时后页面资源仍在继续加载。
         * 这里额外检查一次表单是否已经可见，避免把实际可用的页面误判为失败。
         */
        const phoneInputVisible = await this.getVisiblePhoneInput(page)
          .isVisible()
          .catch(() => false);
        if (phoneInputVisible) {
          return;
        }

        if (attempt < 2) {
          await delay(1500);
        }
      }
    }

    throw lastError || new Error('打开中国移动云盘登录页失败');
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
        return;
      }

      /**
       * 中文说明：139 登录页当前使用的是自绘协议勾选区，不一定存在原生 checkbox。
       * 这里补充点击可见的协议勾选容器或其图片节点，尽量在发送短信前完成勾选。
       */
      const customAgreementCandidates = Array.from(document.querySelectorAll(
        '.check-img-wrap.code-sms-check-img-wrap, .code-sms-check-img-wrap, .check-img-wrap, .default_box_tips img'
      ));
      const visibleAgreementElement = customAgreementCandidates.find((element) => {
        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && computedStyle.display !== 'none'
          && computedStyle.visibility !== 'hidden';
      });

      if (visibleAgreementElement) {
        visibleAgreementElement.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      }
    }).catch(() => {});
  }

  /**
   * 处理官网“勾选并获取验证码”提示弹窗
   * 某些页面版本不会直接勾选协议，而是在点击获取验证码后弹出确认层。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<boolean>} 是否检测并处理了该提示弹窗
   */
  async resolveAgreementPrompt(page) {
    const confirmLocator = page.getByText(/勾选并获取验证码/, { exact: false }).first();
    if (await confirmLocator.isVisible().catch(() => false)) {
      await confirmLocator.click({ timeout: 5000 }).catch(() => {});
      await delay(1500);
      return true;
    }

    return false;
  }

  /**
   * 判断协议确认提示是否仍然可见
   * 该提示存在时说明官网尚未真正进入发送验证码阶段。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<boolean>} 是否存在协议提示
   */
  async hasAgreementPrompt(page) {
    const promptLocator = page.getByText(/获取验证码前请勾选同意|请勾选同意相关协议政策/, { exact: false }).first();
    return promptLocator.isVisible().catch(() => false);
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
      await delay(1200);
      await this.resolveAgreementPrompt(session.page);
      await delay(800);

      const sliderResult = await this.tryCompleteSliderVerification(session.page);
      if (!sliderResult.success) {
        await this.disposeSession(session);
        throw new Error(sliderResult.message);
      }

      await delay(1800);

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
    if (await this.hasAgreementPrompt(page)) {
      return {
        success: false,
        message: '官网要求先勾选用户协议后才能发送验证码'
      };
    }

    if (await this.hasSliderVerification(page)) {
      return {
        success: false,
        message: '官网短信发送被滑块验证拦截，请稍后重试'
      };
    }

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
      success: false,
      message: '未检测到验证码发送成功，请检查官网页面提示后重试'
    };
  }

  /**
   * 检测当前页面是否出现滑块验证层
   * 139 官网会在发送验证码前弹出拼图滑块验证，若不先通过，短信不会真正发送。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<boolean>} 是否存在滑块验证
   */
  async hasSliderVerification(page) {
    const sliderLocator = page.locator('.verify-move-block').first();
    if (await sliderLocator.isVisible().catch(() => false)) {
      return true;
    }

    const sliderTextLocator = page.getByText(/拖动滑块完成拼图|失败次数超过限制|请控制拼图块对齐缺口/, { exact: false }).first();
    return sliderTextLocator.isVisible().catch(() => false);
  }

  /**
   * 计算滑块拼图目标距离
   * 通过比较背景图与拼图块图像的像素相似度，估算缺口所在的横向位置。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<Object|null>} 拖拽方案，无法解析时返回 null
   */
  async buildSliderDragPlan(page) {
    return page.evaluate(() => {
      const panelImg = document.querySelector('.verify-img-panel img');
      const subImg = document.querySelector('.verify-sub-block img');
      const subBlock = document.querySelector('.verify-sub-block');
      const barArea = document.querySelector('.verify-bar-area');

      if (!panelImg || !subImg || !subBlock || !barArea) {
        return null;
      }

      const toImageData = (imageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = imageElement.naturalWidth;
        canvas.height = imageElement.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(imageElement, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };

      const panelData = toImageData(panelImg);
      const subData = toImageData(subImg);
      const panelWidth = panelData.width;
      const panelHeight = panelData.height;
      const subWidth = subData.width;
      const subHeight = subData.height;

      let bestX = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      let sampledPixels = 0;

      for (let offsetX = 0; offsetX <= panelWidth - subWidth; offsetX += 1) {
        let score = 0;
        let count = 0;

        for (let y = 0; y < Math.min(panelHeight, subHeight); y += 2) {
          for (let x = 0; x < subWidth; x += 2) {
            const subIndex = (y * subWidth + x) * 4;
            const alpha = subData.data[subIndex + 3];
            if (alpha < 200) {
              continue;
            }

            const panelIndex = (y * panelWidth + offsetX + x) * 4;
            const dr = panelData.data[panelIndex] - subData.data[subIndex];
            const dg = panelData.data[panelIndex + 1] - subData.data[subIndex + 1];
            const db = panelData.data[panelIndex + 2] - subData.data[subIndex + 2];
            score += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
            count += 1;
          }
        }

        if (count > 0) {
          const normalizedScore = score / count;
          if (normalizedScore < bestScore) {
            bestScore = normalizedScore;
            bestX = offsetX;
            sampledPixels = count;
          }
        }
      }

      const panelRect = panelImg.getBoundingClientRect();
      const barRect = barArea.getBoundingClientRect();
      const subLeft = parseFloat(window.getComputedStyle(subBlock).left || '0') || 0;
      const displayScale = panelRect.width / panelImg.naturalWidth;
      const targetDisplayX = bestX * displayScale;
      const dragDistance = targetDisplayX - subLeft + 2;

      return {
        bestX,
        bestScore,
        sampledPixels,
        displayScale,
        subLeft,
        targetDisplayX,
        dragDistance,
        barWidth: barRect.width
      };
    }).catch(() => null);
  }

  /**
   * 尝试自动完成官网滑块验证
   * 这里使用图像匹配得到目标距离，再通过鼠标轨迹模拟拖动。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<{success: boolean, message: string}>} 处理结果
   */
  async tryCompleteSliderVerification(page) {
    if (!await this.hasSliderVerification(page)) {
      return {
        success: true,
        message: ''
      };
    }

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const dragPlan = await this.buildSliderDragPlan(page);
      if (!dragPlan) {
        return {
          success: false,
          message: '检测到官网滑块验证，但未能解析拼图图片'
        };
      }

      const moveBlock = page.locator('.verify-move-block').first();
      const boundingBox = await moveBlock.boundingBox().catch(() => null);
      if (!boundingBox) {
        return {
          success: false,
          message: '检测到官网滑块验证，但未能定位拖拽按钮'
        };
      }

      const startX = boundingBox.x + (boundingBox.width / 2);
      const startY = boundingBox.y + (boundingBox.height / 2);
      const safeDistance = Math.min(
        Math.max(dragPlan.dragDistance, 20),
        Math.max(dragPlan.barWidth - 25, 20)
      );

      await page.mouse.move(startX, startY);
      await page.mouse.down();

      /**
       * 中文说明：采用前快后慢并带轻微抖动的拖动轨迹，尽量贴近真人操作，降低滑块风控误判概率。
       */
      const steps = 24;
      for (let stepIndex = 1; stepIndex <= steps; stepIndex += 1) {
        const progress = stepIndex / steps;
        const easedProgress = 1 - ((1 - progress) * (1 - progress));
        const currentX = startX + (safeDistance * easedProgress);
        const currentY = startY + ((stepIndex % 2 === 0) ? 0.5 : -0.5);
        await page.mouse.move(currentX, currentY, { steps: 1 });
        await delay(18 + Math.floor(Math.random() * 12));
      }

      await page.mouse.move(startX + safeDistance + 3, startY, { steps: 1 }).catch(() => {});
      await delay(60);
      await page.mouse.move(startX + safeDistance, startY, { steps: 1 }).catch(() => {});
      await page.mouse.up();
      await delay(1800);

      if (!await this.hasSliderVerification(page)) {
        return {
          success: true,
          message: ''
        };
      }

      const pageText = await this.readVisiblePageText(page);
      if (/失败次数超过限制/.test(pageText)) {
        return {
          success: false,
          message: '官网滑块验证失败次数超过限制，请稍后重试'
        };
      }

      if (attempt < 2) {
        const refreshButton = page.getByText('刷新', { exact: true }).first();
        if (await refreshButton.isVisible().catch(() => false)) {
          await refreshButton.click().catch(() => {});
          await delay(1000);
        }
      }
    }

    return {
      success: false,
      message: '未能通过官网滑块验证，请稍后重试'
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
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(element);
          return {
            text: (element.textContent || '').trim(),
            visible: rect.width > 0
              && rect.height > 0
              && computedStyle.display !== 'none'
              && computedStyle.visibility !== 'hidden'
          };
        })
        .filter((item) => item.visible)
        .map((item) => item.text)
        .filter(Boolean);

      return allText.find((text) => /^(获取验证码|重新获取|重新发送|\d+\s*s|\d+秒)$/i.test(text)) || '';
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
      /请勾选同意相关协议政策/,
      /获取验证码前请勾选同意/,
      /拖动滑块完成拼图/,
      /请控制拼图块对齐缺口/,
      /失败次数超过限制/,
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
