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
   * 2026-04 抓取确认 139 登录页协议勾选 DOM 如下：
   *   <div class="bottom-tip-text code-sms-bottom-tip">
   *     <div class="default_box_check_tip" style="display:none;">请勾选同意相关协议政策</div>
   *     <div class="check-img-wrap code-sms-check-img-wrap">
   *       <img src="data:image/png;base64,..." />   ← Vue 通过替换 src 表现勾选状态
   *     </div>
   *     <p> 我已阅读并同意 ... </p>
   *   </div>
   *
   * 关键点：Vue 的 click 监听挂在 <img> 上，`dispatchEvent(new MouseEvent('click'))`
   * 合成事件无法触发 Vue 的响应式更新，必须使用 Playwright 真实鼠标点击，
   * 并以 <img> 的 src 属性前后变化作为勾选是否成功的判定。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<void>}
   */
  async ensureAgreementAccepted(page) {
    // 策略 1：Playwright 真实鼠标点击 <img>，这是 Vue 实际绑定 click 的目标
    const imgLocator = page.locator('.code-sms-check-img-wrap img').first();
    const imgVisible = await imgLocator.isVisible().catch(() => false);
    if (imgVisible) {
      const srcBefore = await imgLocator.getAttribute('src').catch(() => null);
      await imgLocator.click({ timeout: 3000 }).catch(() => {});
      await delay(300);
      const srcAfter = await imgLocator.getAttribute('src').catch(() => null);
      // src 变化 → Vue 响应式已触发，勾选状态已切换，直接返回
      if (srcBefore && srcAfter && srcBefore !== srcAfter) {
        return;
      }
    }

    // 策略 2：兜底点击外层容器，应对 img 被层叠遮挡或未完全渲染的场景
    const wrapLocator = page.locator('.check-img-wrap.code-sms-check-img-wrap, .code-sms-check-img-wrap').first();
    if (await wrapLocator.isVisible().catch(() => false)) {
      await wrapLocator.click({ timeout: 3000 }).catch(() => {});
      await delay(300);
    }

    // 策略 3：进程内 evaluate 兜底，兼容旧版本或极端 DOM（原生 checkbox / 其他自绘样式）
    await page.evaluate(() => {
      // 兼容原生 checkbox
      const checkboxList = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const visibleCheckbox = checkboxList.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (visibleCheckbox && !visibleCheckbox.checked) {
        visibleCheckbox.click();
        return;
      }

      // 兼容自绘勾选区，采用 mousedown → mouseup → click 完整事件链，提高命中率
      const customCandidates = Array.from(document.querySelectorAll(
        '.check-img-wrap.code-sms-check-img-wrap, .code-sms-check-img-wrap, .check-img-wrap, .default_box_tips img'
      ));
      const visibleCandidate = customCandidates.find((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      });
      if (visibleCandidate) {
        ['mousedown', 'mouseup', 'click'].forEach((type) => {
          visibleCandidate.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        });
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
   * 计算滑块验证码原始坐标与拖拽距离
   * 中文说明：优先排除左侧当前拼图块区域，再基于背景缺口边缘匹配得到 rawX。
   * @param {import('playwright').Page} page 页面对象
   * @returns {Promise<Object|null>} 验证方案，无法解析时返回 null
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

      const panelRect = panelImg.getBoundingClientRect();
      const barRect = barArea.getBoundingClientRect();
      const subLeft = parseFloat(window.getComputedStyle(subBlock).left || '0') || 0;
      const displayScale = panelRect.width / panelImg.naturalWidth;
      const currentPieceNaturalX = subLeft / displayScale;
      const ignoreBefore = Math.min(
        Math.max(0, Math.floor(currentPieceNaturalX + (subWidth * 0.8))),
        Math.max(panelWidth - subWidth, 0)
      );

      let restrictedBestX = ignoreBefore;
      let restrictedBestScore = Number.POSITIVE_INFINITY;

      for (let offsetX = ignoreBefore; offsetX <= panelWidth - subWidth; offsetX += 1) {
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
          if (normalizedScore < restrictedBestScore) {
            restrictedBestScore = normalizedScore;
            restrictedBestX = offsetX;
          }
        }
      }

      const subEdge = new Float32Array(subWidth * subHeight);
      for (let y = 1; y < subHeight - 1; y += 1) {
        for (let x = 1; x < subWidth - 1; x += 1) {
          const index = (y * subWidth + x) * 4;
          const alpha = subData.data[index + 3];
          if (alpha < 30) {
            continue;
          }

          const leftAlphaIndex = (y * subWidth + (x - 1)) * 4 + 3;
          const rightAlphaIndex = (y * subWidth + (x + 1)) * 4 + 3;
          const upAlphaIndex = ((y - 1) * subWidth + x) * 4 + 3;
          const downAlphaIndex = ((y + 1) * subWidth + x) * 4 + 3;
          subEdge[(y * subWidth) + x] = Math.abs(subData.data[leftAlphaIndex] - subData.data[rightAlphaIndex])
            + Math.abs(subData.data[upAlphaIndex] - subData.data[downAlphaIndex]);
        }
      }

      const panelGray = new Float32Array(panelWidth * panelHeight);
      for (let y = 0; y < panelHeight; y += 1) {
        for (let x = 0; x < panelWidth; x += 1) {
          const index = (y * panelWidth + x) * 4;
          panelGray[(y * panelWidth) + x] = (panelData.data[index] * 0.299)
            + (panelData.data[index + 1] * 0.587)
            + (panelData.data[index + 2] * 0.114);
        }
      }

      let edgeBestX = ignoreBefore;
      let edgeBestScore = Number.NEGATIVE_INFINITY;

      for (let offsetX = ignoreBefore; offsetX <= panelWidth - subWidth; offsetX += 1) {
        let score = 0;
        let count = 0;

        for (let y = 1; y < Math.min(panelHeight, subHeight) - 1; y += 2) {
          for (let x = 1; x < subWidth - 1; x += 2) {
            const mask = subEdge[(y * subWidth) + x];
            if (mask < 50) {
              continue;
            }

            const index = (y * panelWidth) + offsetX + x;
            const gradientX = Math.abs(panelGray[index - 1] - panelGray[index + 1]);
            const gradientY = Math.abs(panelGray[index - panelWidth] - panelGray[index + panelWidth]);
            score += (gradientX + gradientY) * mask;
            count += 1;
          }
        }

        if (count > 0) {
          const normalizedScore = score / count;
          if (normalizedScore > edgeBestScore) {
            edgeBestScore = normalizedScore;
            edgeBestX = offsetX;
          }
        }
      }

      const rawX = Number.isFinite(edgeBestScore) ? edgeBestX : restrictedBestX;
      const targetDisplayX = rawX * displayScale;
      const dragDistance = targetDisplayX - subLeft;

      return {
        rawX,
        edgeMatchX: edgeBestX,
        edgeMatchScore: edgeBestScore,
        restrictedMatchX: restrictedBestX,
        restrictedMatchScore: restrictedBestScore,
        currentPieceNaturalX,
        ignoreBefore,
        displayScale,
        subLeft,
        targetDisplayX,
        dragDistance,
        barWidth: barRect.width
      };
    }).catch(() => null);
  }

  /**
   * 通过官网页面 Vue 实例直接提交滑块验证码
   * 中文说明：官网会先将原始坐标写入 puzzleVerfyCode，再调用 getSmsCode。
   * 这里直接复用官网运行时逻辑，避免纯拖拽带来的误差。
   * @param {import('playwright').Page} page 页面对象
   * @param {Object} verificationPlan 滑块验证方案
   * @returns {Promise<{attempted: boolean, success: boolean, verifyResCode: string, getCodeText: string, error: string}>} 提交结果
   */
  async submitSliderVerificationByVue(page, verificationPlan) {
    return page.evaluate(async ({ rawX }) => {
      const loginVm = document.querySelector('.login-base')?.__vue__;
      if (!loginVm || typeof loginVm.getSmsCode !== 'function') {
        return {
          attempted: false,
          success: false,
          verifyResCode: '',
          getCodeText: '',
          error: '官网登录实例不可用'
        };
      }

      const visiblePhoneInput = Array.from(document.querySelectorAll('input[placeholder="请输入手机号"]'))
        .find((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const phoneValue = typeof visiblePhoneInput?.value === 'string' ? visiblePhoneInput.value.trim() : '';
      if (phoneValue) {
        loginVm.mobileNumber = phoneValue;
      }

      loginVm.checkFlag = true;
      loginVm.showVerifyImg = true;
      loginVm.verifyResCode = '';
      loginVm.puzzleVerfyCode = rawX;

      try {
        await Promise.resolve(loginVm.getSmsCode());
      } catch (error) {
        return {
          attempted: true,
          success: false,
          verifyResCode: loginVm.verifyResCode || '',
          getCodeText: loginVm.getCodeText || '',
          error: String(error)
        };
      }

      return {
        attempted: true,
        success: loginVm.verifyResCode === '0000',
        verifyResCode: loginVm.verifyResCode || '',
        getCodeText: loginVm.getCodeText || '',
        error: ''
      };
    }, {
      rawX: verificationPlan.rawX
    }).catch(() => ({
      attempted: false,
      success: false,
      verifyResCode: '',
      getCodeText: '',
      error: '执行官网滑块实例失败'
    }));
  }

  /**
   * 使用鼠标拖拽作为官网滑块验证的兜底方案
   * 中文说明：仅在官网运行时实例不可用时启用，避免同一会话重复试错。
   * @param {import('playwright').Page} page 页面对象
   * @param {Object} verificationPlan 滑块验证方案
   * @returns {Promise<{success: boolean, message: string}>} 拖拽结果
   */
  async performSliderDragFallback(page, verificationPlan) {
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
      Math.max(verificationPlan.dragDistance, 20),
      Math.max(verificationPlan.barWidth - 25, 20)
    );

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await delay(240 + Math.floor(Math.random() * 120));

    /**
     * 中文说明：兜底拖拽继续沿用慢速、减速、微抖动与尾部回拉轨迹，尽量贴近真人行为。
     */
    const steps = 42;
    for (let stepIndex = 1; stepIndex <= steps; stepIndex += 1) {
      const progress = stepIndex / steps;
      const easedProgress = 1 - ((1 - progress) * (1 - progress));
      const currentX = startX + (safeDistance * easedProgress);
      const currentY = startY + ((stepIndex % 3 === 0) ? 0.8 : ((stepIndex % 2 === 0) ? 0.2 : -0.4));
      await page.mouse.move(currentX, currentY, { steps: 1 });
      await delay(28 + Math.floor(Math.random() * 18));
    }

    await page.mouse.move(startX + safeDistance + 6, startY + 0.3, { steps: 1 }).catch(() => {});
    await delay(90 + Math.floor(Math.random() * 50));
    await page.mouse.move(startX + safeDistance + 2, startY - 0.2, { steps: 1 }).catch(() => {});
    await delay(70 + Math.floor(Math.random() * 40));
    await page.mouse.move(startX + safeDistance, startY, { steps: 1 }).catch(() => {});
    await page.mouse.up();
    await delay(2200);

    if (!await this.hasSliderVerification(page)) {
      return {
        success: true,
        message: ''
      };
    }

    return {
      success: false,
      message: '官网滑块验证未通过'
    };
  }

  /**
   * 尝试自动完成官网滑块验证
   * 中文说明：优先使用官网自身的 puzzleVerfyCode 提交逻辑，只有实例不可用时才退回拖拽。
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

    const verificationPlan = await this.buildSliderDragPlan(page);
    if (!verificationPlan) {
      return {
        success: false,
        message: '检测到官网滑块验证，但未能解析拼图图片'
      };
    }

    const directResult = await this.submitSliderVerificationByVue(page, verificationPlan);
    await delay(1800);

    let fallbackResult = null;
    if (!directResult.attempted) {
      fallbackResult = await this.performSliderDragFallback(page, verificationPlan);
      if (fallbackResult.success) {
        return fallbackResult;
      }
    }

    const pageText = await this.readVisiblePageText(page);
    const buttonText = await this.readSmsButtonText(page);
    if (
      directResult.success
      || /验证码已发送|短信已发送|发送成功/.test(pageText)
      || /\b\d+\s*s\b/i.test(buttonText)
      || /\d+秒/.test(buttonText)
      || /\d+\s*s后重试/i.test(buttonText)
      || /\d+s后重试/.test(pageText)
    ) {
      return {
        success: true,
        message: ''
      };
    }

    if (/失败次数超过限制/.test(pageText) || directResult.verifyResCode === '200059553') {
      return {
        success: false,
        message: '官网滑块验证失败次数超过限制，请稍后重试'
      };
    }

    const knownMessage = this.extractKnownErrorMessage(pageText);
    if (knownMessage) {
      return {
        success: false,
        message: knownMessage
      };
    }

    if (fallbackResult?.message) {
      return {
        success: false,
        message: fallbackResult.message
      };
    }

    if (directResult.error) {
      return {
        success: false,
        message: directResult.error
      };
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

    let loginResult = await this.waitForLoginSuccess(page);

    /**
     * 兼容场景：若 ensureAgreementAccepted 在登录前未能真正勾上协议（例如 <img>
     * 瞬间被遮挡），139 会在点击登录后弹出“请勾选同意相关协议政策”提示。
     * 此时重新勾选并再点一次登录按钮，最多补偿一次，避免用户重发短信。
     */
    if (!loginResult.success && await this.hasAgreementPrompt(page)) {
      await this.ensureAgreementAccepted(page);
      await delay(600);
      await loginButton.click({ timeout: 10000 }).catch(() => {});
      loginResult = await this.waitForLoginSuccess(page);
    }

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
