const logger = require('../../utils/logger');
const CloudDriveService = require('../CloudDriveService');

/**
 * 139 登录后的入口 URL
 */
const LOGIN_PAGE_URL = 'https://yun.139.com/w/';

/**
 * 139 各类业务接口的完整 URL（sign 绑定在这些 URL 上，需要分别从 SPA 捕获）
 */
const API_ENDPOINTS = {
  personalFileList: 'https://personal-kd-njs.yun.139.com/hcy/file/list',
  queryFamilyCloud: 'https://yun.139.com/orchestration/familyCloud-rebuild/cloudManage/v1.0/queryFamilyCloud',
  queryCloudPhoto: 'https://yun.139.com/orchestration/familyCloud-rebuild/cloudCatalog/v1.0/queryCloudPhoto'
};

/**
 * 云盘目录浏览服务
 *
 * 设计背景：
 *   139 的业务接口都带有动态 mcloud-sign 请求头，由 139 前端 JS 根据 URL、
 *   token、时间戳实时生成。通过实验（scripts/test-cloud-drive-api-fetch-verify.js
 *   与 test-cloud-drive-browse.js）证实不同接口族的 sign 行为不一致：
 *     - /hcy/ 系列（个人网盘）：sign 绑 URL 但不绑 body，可在分钟级内重复使用，
 *       因此可以 "借用 SPA 的 sign" 配合我们自己的 body 调用；
 *     - /orchestration/ 系列（家庭云、相册等）：服务端带 anti-replay，sign 只能
 *       被 SPA 本身使用一次，我们无法代入，只能截获 SPA 自发请求的响应。
 *
 * 因此本服务采用 "双缓存" 方案：
 *   1. 基于 state.json 里已加密保存的 sessionBundle 启动一个常驻 Playwright 浏览器
 *   2. 在 context 初始化阶段注入 XHR hook，同时写入：
 *      - window.__signCache：记录每个 URL 最近一次的请求头（含 mcloud-sign）
 *      - window.__respCache：记录每个 URL 最近一次的成功响应体
 *   3. 让 SPA 加载 "我的文件"/"我的家庭"/"家庭相册" 让两个 cache 都填上对应条目
 *   4. 业务路由：
 *      - browsePersonal：使用 signCache 的头 + 我们构造的新 body 调 /hcy/file/list
 *      - browseFamily / browseFamilyAlbums：直接读 respCache 的缓存响应
 *   5. 请求被拒或 cache miss 时自动 re-bootstrap 并重试
 *
 * 该服务是 VPS 进程级别的单例，由 routes/cloud-drive.js 持有。
 */
class CloudDriveBrowseService {
  /**
   * 构造函数
   * @param {Object} [options] 配置项
   * @param {CloudDriveService} [options.cloudDriveService] 复用已有的 CloudDriveService 实例
   * @param {boolean} [options.headless] 是否 headless 运行浏览器；生产环境建议 true
   * @param {number} [options.navigationTimeout] 单次页面导航超时（毫秒）
   * @param {number} [options.signTtlMs] sign 缓存 TTL（毫秒）；默认 4 分钟，略小于 139 实际过期
   */
  constructor(options = {}) {
    this.cloudDriveService = options.cloudDriveService || new CloudDriveService();
    this.headless = options.headless !== undefined ? options.headless : true;
    this.navigationTimeout = options.navigationTimeout || 30000;
    this.signTtlMs = options.signTtlMs || 4 * 60 * 1000;

    // 保活资源
    this.browser = null;
    this.context = null;
    this.page = null;

    // 初始化状态：避免并发初始化时重复启动浏览器
    this.initializingPromise = null;
    this.ready = false;
    this.lastBootstrapAt = 0;

    // 访问 139 API 的重试次数
    this.maxRetries = 2;

    /**
     * Node 侧的权威 sign 缓存。
     * key 统一为对齐后的绝对 URL（不带 query），value为 { url, headers, capturedAt }。
     * 之所以放 Node 而非仅依赖 window.__signCache，是因为 page.reload() 后
     * addInitScript 会重置 window.__signCache，Node 侧持有后可以同步回 page。
     * @type {Map<string, {url:string, headers:Object, body:string, capturedAt:number}>}
     */
    this.signCache = new Map();

    /**
     * Node 侧的权威 SPA 响应缓存。
     * key 同上。value 为 { body(JSON), capturedAt }。
     * 用于 orchestration 系列接口：这类接口有服务端 anti-replay 保护，无法
     * 使用代入 sign 的方式调用，只能截获 SPA 自发请求的响应。
     * @type {Map<string, {body:Object, capturedAt:number}>}
     */
    this.respCache = new Map();
  }

  /**
   * 懒加载 playwright 模块（测试时可被 monkey-patch 成使用系统 Chrome）
   * @returns {Object} { chromium, ... }
   */
  loadPlaywright() {
    // eslint-disable-next-line global-require
    return require('playwright');
  }

  /**
   * 从 state.json 加载并解密出完整 sessionBundle
   * @returns {Promise<Object>} 包含 cookies / localStorage / sessionStorage 的会话包
   */
  async loadSessionBundle() {
    const state = this.cloudDriveService.loadState();
    if (!state.sessionBundleEncrypted) {
      throw new Error('云盘尚未登录，请先完成短信验证码登录');
    }
    return JSON.parse(this.cloudDriveService.decryptText(state.sessionBundleEncrypted));
  }

  /**
   * 把 sessionBundle 转成 Playwright 的 storageState
   * @param {Object} bundle
   * @returns {Object}
   */
  buildStorageState(bundle) {
    const cookies = (bundle.cookies || []).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: typeof c.expires === 'number' ? c.expires : -1,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'
    }));
    const localStorageKV = Object.entries(bundle.localStorage || {})
      .map(([name, value]) => ({ name, value: String(value) }));
    return {
      cookies,
      origins: [{ origin: 'https://yun.139.com', localStorage: localStorageKV }]
    };
  }

  /**
   * 确保浏览器已启动、已登录、已至少 bootstrap 过一次 sign
   * 并发调用会自动合并到同一个初始化 Promise
   */
  async ensureReady() {
    if (this.ready && this.page && !this.page.isClosed()) {
      return;
    }
    if (this.initializingPromise) {
      return this.initializingPromise;
    }
    this.initializingPromise = (async () => {
      try {
        await this.dispose(); // 清理可能存在的旧资源
        await this.startBrowser();
        await this.bootstrapSigns({ force: true });
        this.ready = true;
      } finally {
        this.initializingPromise = null;
      }
    })();
    return this.initializingPromise;
  }

  /**
   * 启动浏览器并完成登录态恢复与 XHR hook 注入
   */
  async startBrowser() {
    const bundle = await this.loadSessionBundle();
    const storageState = this.buildStorageState(bundle);
    const sessionStorageKV = Object.entries(bundle.sessionStorage || {})
      .map(([name, value]) => ({ name, value: String(value) }));

    const { chromium } = this.loadPlaywright();

    const launchOptions = { headless: this.headless };
    if (this.headless) {
      launchOptions.args = ['--no-sandbox', '--disable-dev-shm-usage'];
    }
    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext({ storageState });

    /**
     * 注入 XHR hook：
     *   - window.__signCache[urlWithoutQuery] = { url, headers, capturedAt }
     *   - window.__callWithBorrowedSign(targetUrl, body) 在 page 里用借用 sign 发请求
     */
    await this.context.addInitScript(() => {
      window.__signCache = {};
      window.__respCache = {};
      window.__capturedCount = 0;

      const OriginalXHR = window.XMLHttpRequest;
      const origOpen = OriginalXHR.prototype.open;
      const origSetHeader = OriginalXHR.prototype.setRequestHeader;
      const origSend = OriginalXHR.prototype.send;

      /**
       * 将相对 URL 归一化为绝对 URL（用于 cache key 一致）
       */
      function absolutize(url) {
        try {
          return new URL(url, window.location.origin).href;
        } catch (err) {
          return String(url);
        }
      }

      OriginalXHR.prototype.open = function (method, url, ...rest) {
        this.__method = method;
        // 保留原始 URL 以保证 send 行为不变；另外存一份绝对 URL 用作 key
        this.__url = url;
        this.__absUrl = absolutize(url);
        this.__headers = {};
        return origOpen.call(this, method, url, ...rest);
      };

      OriginalXHR.prototype.setRequestHeader = function (name, value) {
        this.__headers = this.__headers || {};
        this.__headers[name] = value;
        return origSetHeader.call(this, name, value);
      };

      OriginalXHR.prototype.send = function (body) {
        const absUrl = this.__absUrl;
        try {
          if (absUrl && this.__headers && this.__headers['mcloud-sign']) {
            const key = String(absUrl).split('?')[0];
            let rawBody = '';
            if (typeof body === 'string') rawBody = body;
            else if (body && typeof body.toString === 'function') rawBody = String(body);
            window.__signCache[key] = {
              url: absUrl,
              headers: { ...this.__headers },
              body: rawBody,
              capturedAt: Date.now()
            };
            window.__capturedCount = (window.__capturedCount || 0) + 1;
          }
        } catch (err) { /* swallow */ }

        // 额外：监听响应，把 SPA 成功响应缓存下来给 orchestration 类接口使用
        if (absUrl) {
          const xhr = this;
          this.addEventListener('load', function () {
            try {
              if (xhr.status === 200 && typeof xhr.responseText === 'string' && xhr.responseText.length > 0) {
                const parsed = JSON.parse(xhr.responseText);
                const key = String(absUrl).split('?')[0];
                window.__respCache[key] = { body: parsed, capturedAt: Date.now() };
              }
            } catch (err) { /* non-json or error */ }
          });
        }

        return origSend.call(this, body);
      };

      /**
       * 在浏览器里用缓存的 sign 头调用 139 API
       * @param {string} targetUrl 目标完整 URL（不带 query）
       * @param {Object} body 业务请求体
       * @returns {Promise<{status:number, body:Object|null, raw:string|null, error?:string}>}
       */
      window.__callWithBorrowedSign = async function (targetUrl, body) {
        const absTarget = absolutize(targetUrl);
        const cacheKey = String(absTarget).split('?')[0];
        const cap = window.__signCache[cacheKey];
        if (!cap) {
          return { status: -1, body: null, raw: null, error: 'no cached sign for ' + cacheKey };
        }
        try {
          const res = await fetch(absTarget, {
            method: 'POST',
            credentials: 'include',
            headers: cap.headers,
            body: JSON.stringify(body || {})
          });
          const text = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch { /* not json */ }
          return { status: res.status, body: parsed, raw: parsed ? null : text.slice(0, 500) };
        } catch (err) {
          return { status: -2, body: null, raw: null, error: String(err && err.message || err) };
        }
      };

      /**
       * 重放 SPA 当时发过的原始 body，对 sign 绑 body 的接口有效
       * @param {string} targetUrl
       * @returns {Promise<{status:number, body:Object|null, raw:string|null, error?:string}>}
       */
      window.__replayBorrowedSign = async function (targetUrl) {
        const absTarget = absolutize(targetUrl);
        const cacheKey = String(absTarget).split('?')[0];
        const cap = window.__signCache[cacheKey];
        if (!cap) {
          return { status: -1, body: null, raw: null, error: 'no cached sign for ' + cacheKey };
        }
        try {
          const res = await fetch(absTarget, {
            method: 'POST',
            credentials: 'include',
            headers: cap.headers,
            body: cap.body || '{}'
          });
          const text = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch { /* not json */ }
          return { status: res.status, body: parsed, raw: parsed ? null : text.slice(0, 500) };
        } catch (err) {
          return { status: -2, body: null, raw: null, error: String(err && err.message || err) };
        }
      };
    });

    this.page = await this.context.newPage();

    await this.page.goto(LOGIN_PAGE_URL, {
      waitUntil: 'commit',
      timeout: this.navigationTimeout
    }).catch(() => { /* 静态资源卡住不影响业务 */ });

    // sessionStorage 必须同域 navigate 后才能 set
    if (sessionStorageKV.length > 0) {
      await this.page.evaluate((kv) => {
        kv.forEach(({ name, value }) => {
          try { window.sessionStorage.setItem(name, value); } catch { /* ignore */ }
        });
      }, sessionStorageKV).catch(() => {});
    }

    logger.info('[cloud-drive-browse] browser started, page loaded');
  }

  /**
   * 把 Node 侧的权威 signCache 注入到当前 page 的 window.__signCache
   * 用于 page.reload 或刚开始时，让浏览器内 __callWithBorrowedSign 能立即命中历史 sign
   */
  async syncSignCacheToPage() {
    if (!this.page || this.page.isClosed() || this.signCache.size === 0) return;
    const entries = Array.from(this.signCache.entries()).map(([key, value]) => [key, value]);
    await this.page.evaluate((list) => {
      window.__signCache = window.__signCache || {};
      for (const [k, v] of list) {
        window.__signCache[k] = v;
      }
    }, entries).catch(() => {});
  }

  /**
   * 把浏览器内新捉获的 sign 同步回 Node 侧权威缓存
   * 每次 bootstrap 、 callApi 的成功结束都应调一下
   */
  async syncSignCacheFromPage() {
    if (!this.page || this.page.isClosed()) return;
    const pageCache = await this.page.evaluate(() => {
      const result = {};
      try {
        const c = window.__signCache || {};
        for (const k of Object.keys(c)) result[k] = c[k];
      } catch { /* ignore */ }
      return result;
    }).catch(() => ({}));
    for (const [key, value] of Object.entries(pageCache || {})) {
      this.signCache.set(key, value);
    }
  }

  /**
   * 把浏览器内的 SPA 响应缓存同步回 Node 侧
   */
  async syncRespCacheFromPage() {
    if (!this.page || this.page.isClosed()) return;
    const pageCache = await this.page.evaluate(() => {
      const result = {};
      try {
        const c = window.__respCache || {};
        for (const k of Object.keys(c)) result[k] = c[k];
      } catch { /* ignore */ }
      return result;
    }).catch(() => ({}));
    for (const [key, value] of Object.entries(pageCache || {})) {
      this.respCache.set(key, value);
    }
  }

  /**
   * 触发 SPA 访问必要的子模块，让它自发请求各 API，从而 hook 到最新 sign
   * @param {Object} [options]
   * @param {boolean} [options.force] 是否忽略 TTL 强制重新触发
   */
  async bootstrapSigns({ force = false } = {}) {
    if (!force && Date.now() - this.lastBootstrapAt < this.signTtlMs) {
      return;
    }
    if (!this.page || this.page.isClosed()) {
      throw new Error('浏览器页面未就绪');
    }

    logger.info('[cloud-drive-browse] bootstrapping signs ...');

    // 个人网盘根目录会在首屏自动请求
    await this.page.reload({
      waitUntil: 'commit',
      timeout: this.navigationTimeout
    }).catch(() => {});
    // reload 后 window.__signCache 被清空，先把历史 sign 推回去，后面满足 waitFor 导致 fallback
    await this.syncSignCacheToPage();
    await this.waitForSignFor(API_ENDPOINTS.personalFileList, 10000);

    // SPA 默认加载后的 tab 可能已经就是“家庭相册”，因此先等一会再检查是否已有响应
    await this.sleep(3000);
    await this.syncRespCacheFromPage();

    const hasCloudPhoto = this.respCache.has(API_ENDPOINTS.queryCloudPhoto);
    if (!hasCloudPhoto) {
      // 默认 tab 不是家庭相册，手动点击
      const clickedFamily = await this.clickMenuItem('我的家庭');
      if (clickedFamily) {
        await this.sleep(2000);
        await this.clickMenuItem('家庭相册');
        await this.waitForSignFor(API_ENDPOINTS.queryFamilyCloud, 8000);
        await this.waitForSignFor(API_ENDPOINTS.queryCloudPhoto, 8000);
        await this.sleep(1500);
      } else {
        logger.warn('[cloud-drive-browse] "我的家庭" menu not found, family API sign may be missing');
      }
    }

    // 把浏览器捕获到的所有 sign 和响应合并到 Node 侧权威缓存
    await this.syncSignCacheFromPage();
    await this.syncRespCacheFromPage();

    const signKeys = Array.from(this.signCache.keys());
    const respKeys = Array.from(this.respCache.keys());
    logger.info('[cloud-drive-browse] bootstrap done', {
      signCount: signKeys.length,
      respCount: respKeys.length,
      hasPersonalSign: this.signCache.has(API_ENDPOINTS.personalFileList),
      hasFamilyResp: this.respCache.has(API_ENDPOINTS.queryFamilyCloud),
      hasPhotoResp: this.respCache.has(API_ENDPOINTS.queryCloudPhoto)
    });

    this.lastBootstrapAt = Date.now();
  }

  /**
   * 读取 SPA 自发请求的缓存响应（orchestration 类接口专用）
   * 若缓存中无对应 URL，会触发 bootstrap 再试一次
   * @param {string} url 目标 URL
   * @returns {Promise<Object|null>} SPA 返回的业务 body；仍无时返回 null
   */
  async getCachedResponse(url) {
    await this.ensureReady();
    const key = url.split('?')[0];
    if (!this.respCache.has(key)) {
      await this.bootstrapSigns({ force: true });
    }
    const cached = this.respCache.get(key);
    if (!cached) return null;
    return cached.body;
  }

  /**
   * 通过可见文字点击 139 侧栏菜单，适配 SPA 里没 href 的 <li>
   * @param {string} text 完整匹配的可见文字
   * @returns {Promise<boolean>} 是否点击成功
   */
  async clickMenuItem(text) {
    return this.page.evaluate((keyword) => {
      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden';
      }
      const all = Array.from(document.querySelectorAll('li, a, span, div'));
      // 策略 1：精确文字匹配
      for (const el of all) {
        if (!isVisible(el)) continue;
        const t = (el.innerText || el.textContent || '').trim();
        if (t === keyword) {
          el.click();
          return true;
        }
      }
      // 策略 2：宽松匹配 —— 包含关键字、且子节点较少（避免选中过大容器）
      for (const el of all) {
        if (!isVisible(el)) continue;
        const t = (el.innerText || el.textContent || '').trim();
        if (!t) continue;
        const first = t.split(/\s|\n/)[0];
        if (first === keyword && el.children.length < 20) {
          el.click();
          return true;
        }
      }
      return false;
    }, text).catch(() => false);
  }

  /**
   * 等待指定 URL 的 sign 被 hook 记入缓存
   * @param {string} urlKey 完整 URL（不含 query）
   * @param {number} timeoutMs
   * @returns {Promise<boolean>}
   */
  async waitForSignFor(urlKey, timeoutMs = 10000) {
    // Node 侧历史缓存中已有则直接返回
    if (this.signCache.has(urlKey)) return true;
    const startAt = Date.now();
    while (Date.now() - startAt < timeoutMs) {
      const has = await this.page.evaluate(
        (k) => !!(window.__signCache && window.__signCache[k]),
        urlKey
      ).catch(() => false);
      if (has) return true;
      await this.sleep(400);
    }
    logger.warn('[cloud-drive-browse] sign wait timeout', { urlKey, timeoutMs });
    return false;
  }

  /**
   * 简短延迟工具
   * @param {number} ms
   */
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 通用的借用 sign + 新 body 调用 139 API
   * 失败（包括 sign 过期）时自动 re-bootstrap 并重试，最多 maxRetries 次
   * @param {string} url 目标 URL
   * @param {Object} body 请求体
   * @returns {Promise<Object>} { status, body, raw, error }
   */
  async callApi(url, body) {
    await this.ensureReady();

    const cacheKey = url.split('?')[0];
    if (!this.signCache.has(cacheKey)) {
      await this.bootstrapSigns({ force: true });
    }
    // 每次 callApi 前把 Node 权威缓存推回 page，确保 window.__signCache 最新
    await this.syncSignCacheToPage();

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      const res = await this.page.evaluate(
        (args) => window.__callWithBorrowedSign(args.url, args.body),
        { url, body }
      ).catch((err) => ({ status: -4, body: null, raw: null, error: err && err.message || String(err) }));

      // sign 被拒：重新 bootstrap 并重试
      const isSignRejected = res && res.body
        && (res.body.code === '1010010014' || res.body.code === '1010010015'
          || /签名校验失败|sign/i.test(res.body.message || ''));
      if (isSignRejected && attempt <= this.maxRetries) {
        logger.warn('[cloud-drive-browse] sign rejected, re-bootstrap', { url, attempt, code: res.body.code });
        await this.bootstrapSigns({ force: true });
        await this.syncSignCacheToPage();
        continue;
      }
      // 缓存缺失：bootstrap 后再试一次
      if (res && res.status === -1 && attempt <= this.maxRetries) {
        await this.bootstrapSigns({ force: true });
        await this.syncSignCacheToPage();
        continue;
      }
      // 成功请求后把 page 新捉到的 sign 同步到 Node（未来请求可复用）
      if (res && res.status === 200) {
        await this.syncSignCacheFromPage();
      }
      return res;
    }

    return { status: -5, body: null, raw: null, error: 'exhausted retries' };
  }

  /**
   * 从 sessionBundle 拿 userDomainId（家庭云类接口参数必填）
   * @returns {Promise<string>}
   */
  async getUserDomainId() {
    const bundle = await this.loadSessionBundle();
    const udCookie = (bundle.cookies || []).find((c) => c.name === 'ud_id');
    if (udCookie && udCookie.value) return String(udCookie.value);
    throw new Error('无法从 sessionBundle 获取 userDomainId，请确认登录是否完整');
  }

  // ============================== 业务方法 ==============================

  /**
   * 列出个人网盘某目录下的直接子项
   * @param {Object} [options]
   * @param {string} [options.parentFileId] 父目录 fileId；"/" 表示根目录
   * @param {number} [options.pageSize] 分页大小，10~100
   * @param {string|null} [options.pageCursor] 分页游标
   * @returns {Promise<{items:Array, hasMore:boolean, nextCursor:string|null}>}
   */
  async browsePersonal({ parentFileId = '/', pageSize = 50, pageCursor = null } = {}) {
    const res = await this.callApi(API_ENDPOINTS.personalFileList, {
      pageInfo: { pageSize, pageCursor },
      orderBy: 'updated_at',
      orderDirection: 'DESC',
      parentFileId,
      imageThumbnailStyleList: ['Small', 'Large']
    });
    if (res.status !== 200 || !res.body || !res.body.success) {
      throw new Error(`列出个人网盘目录失败: ${JSON.stringify(res.body || res)}`);
    }
    const items = res.body.data?.items || [];
    return {
      items: items.map((x) => ({
        id: x.fileId,
        parentId: x.parentFileId,
        name: x.name,
        type: x.type,
        size: x.size,
        createdAt: x.createdAt,
        updatedAt: x.updatedAt,
        systemDir: !!x.systemDir
      })),
      hasMore: !!res.body.data?.pageInfo?.pageCursor,
      nextCursor: res.body.data?.pageInfo?.pageCursor || null
    };
  }

  /**
   * 列出当前账号所属家庭列表
   * orchestration 接口服务端 anti-replay，因此直接读取 SPA 自发请求的响应
   * @returns {Promise<{families: Array}>}
   */
  async browseFamily() {
    const body = await this.getCachedResponse(API_ENDPOINTS.queryFamilyCloud);
    if (!body || !body.success) {
      throw new Error(`列出家庭列表失败：${body ? JSON.stringify(body) : '无缓存响应'}`);
    }
    const list = body.data?.familyCloudList || [];
    return {
      families: list.map((f) => ({
        id: f.cloudID,
        name: f.cloudName,
        desc: f.cloudDesc,
        createdAt: f.createTime,
        updatedAt: f.lastUpdateTime
      }))
    };
  }

  /**
   * 列出指定家庭下的相册
   * @param {Object} params
   * @param {string} params.cloudId 家庭 ID
   * @returns {Promise<{albums: Array}>}
   */
  async browseFamilyAlbums({ cloudId } = {}) {
    if (!cloudId) {
      throw new Error('cloudId 不能为空');
    }
    // SPA bootstrap 时自发的 queryCloudPhoto 请求，传的 cloudID 就是用户当前家庭。
    // 若传入的 cloudId 与缓存不一致，需要重新触发 SPA（跳转到对应家庭 tab）；
    // 当前 MVP 假定账号只有 1 个家庭，后续再扩展。
    const body = await this.getCachedResponse(API_ENDPOINTS.queryCloudPhoto);
    if (!body || !body.success) {
      throw new Error(`列出家庭相册失败：${body ? JSON.stringify(body) : '无缓存响应'}`);
    }
    const list = body.data?.cloudPhotoList || [];
    return {
      albums: list.map((p) => ({
        id: p.photoID,
        name: p.photoName,
        cloudId: p.cloudID,
        createdAt: p.createTime,
        updatedAt: p.lastUpdateTime,
        cover: p.photoCoverURL
      }))
    };
  }

  // ============================== 生命周期 ==============================

  /**
   * 关闭浏览器并释放资源
   */
  async dispose() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close().catch(() => {});
      }
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
      this.ready = false;
    }
  }
}

module.exports = CloudDriveBrowseService;
