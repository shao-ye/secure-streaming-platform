var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-eqpmp8/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/router.js
var Router = class {
  static {
    __name(this, "Router");
  }
  constructor() {
    this.routes = [];
  }
  /**
   * 注册GET路由
   */
  get(path, handler) {
    this.routes.push({
      method: "GET",
      path,
      handler,
      regex: this.pathToRegex(path)
    });
  }
  /**
   * 注册POST路由
   */
  post(path, handler) {
    this.routes.push({
      method: "POST",
      path,
      handler,
      regex: this.pathToRegex(path)
    });
  }
  /**
   * 注册PUT路由
   */
  put(path, handler) {
    this.routes.push({
      method: "PUT",
      path,
      handler,
      regex: this.pathToRegex(path)
    });
  }
  /**
   * 注册DELETE路由
   */
  delete(path, handler) {
    this.routes.push({
      method: "DELETE",
      path,
      handler,
      regex: this.pathToRegex(path)
    });
  }
  /**
   * 将路径转换为正则表达式
   */
  pathToRegex(path) {
    const regexPath = path.replace(/:\w+/g, "([^/]+)").replace(/\*/g, "(.*)");
    return new RegExp(`^${regexPath}$`);
  }
  /**
   * 提取路径参数
   */
  extractParams(path, pathname, regex) {
    const matches = pathname.match(regex);
    if (!matches) return {};
    const paramNames = [];
    const paramRegex = /:(\w+)/g;
    let match;
    while ((match = paramRegex.exec(path)) !== null) {
      paramNames.push(match[1]);
    }
    const params = {};
    paramNames.forEach((name, index) => {
      params[name] = matches[index + 1];
    });
    return params;
  }
  /**
   * 处理请求
   */
  async handle(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;
    for (const route of this.routes) {
      if (route.method === method && route.regex.test(pathname)) {
        try {
          const params = this.extractParams(route.path, pathname, route.regex);
          request.params = params;
          request.query = Object.fromEntries(url.searchParams);
          request.pathname = pathname;
          return await route.handler(request, env, ctx);
        } catch (error) {
          console.error(`Route handler error for ${method} ${pathname}:`, error);
          throw error;
        }
      }
    }
    return null;
  }
};

// src/utils/cors.js
var ALLOWED_ORIGINS = [
  "https://streaming.yourdomain.com",
  "https://admin.yourdomain.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:8787",
  "http://127.0.0.1:8787"
];
function getCorsHeaders(request = null) {
  let origin = "*";
  if (request && request.headers) {
    const requestOrigin = request.headers.get("Origin");
    if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
      origin = requestOrigin;
    } else if (ALLOWED_ORIGINS.length > 0) {
      origin = ALLOWED_ORIGINS[0];
    }
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, CF-Connecting-IP, CF-Ray",
    "Access-Control-Expose-Headers": "Set-Cookie",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    // 24小时
    "Vary": "Origin"
  };
}
__name(getCorsHeaders, "getCorsHeaders");
function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  });
}
__name(handleOptions, "handleOptions");
function createCorsResponse(body, options = {}) {
  const { status = 200, headers = {}, request } = options;
  const corsHeaders = request ? getCorsHeaders(request) : {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...headers
    }
  });
}
__name(createCorsResponse, "createCorsResponse");
function jsonResponse(data, options = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return createCorsResponse(body, options);
}
__name(jsonResponse, "jsonResponse");
function errorResponse(message, code = "ERROR", status = 500, request = null) {
  const errorData = {
    status: "error",
    message,
    code,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  return jsonResponse(errorData, { status, request });
}
__name(errorResponse, "errorResponse");
function successResponse(data, message = "Success", request = null) {
  const responseData = {
    status: "success",
    message,
    data,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  return jsonResponse(responseData, { request });
}
__name(successResponse, "successResponse");

// src/utils/logger.js
function logInfo(env, message, data = {}) {
  const logEntry = {
    level: "INFO",
    message,
    data,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    service: "cloudflare-worker"
  };
  console.log(JSON.stringify(logEntry));
  if (env.ENVIRONMENT === "production") {
  }
}
__name(logInfo, "logInfo");
function logError(env, message, error, data = {}) {
  const logEntry = {
    level: "ERROR",
    message,
    error: {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    },
    data,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    service: "cloudflare-worker"
  };
  console.error(JSON.stringify(logEntry));
  if (env.ENVIRONMENT === "production") {
  }
}
__name(logError, "logError");
function logAuthEvent(env, event, username, request, success = true, extras = {}) {
  const logEntry = {
    level: success ? "INFO" : "WARN",
    type: "AUTH_EVENT",
    event,
    username,
    success,
    ip: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
    cfRay: request.headers.get("CF-Ray"),
    cfCountry: request.headers.get("CF-IPCountry"),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...extras
  };
  console.log(JSON.stringify(logEntry));
}
__name(logAuthEvent, "logAuthEvent");
function logStreamEvent(env, event, streamId, username, request, extras = {}) {
  const logEntry = {
    level: "INFO",
    type: "STREAM_EVENT",
    event,
    streamId,
    username,
    ip: request.headers.get("CF-Connecting-IP"),
    userAgent: request.headers.get("User-Agent"),
    cfRay: request.headers.get("CF-Ray"),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...extras
  };
  console.log(JSON.stringify(logEntry));
}
__name(logStreamEvent, "logStreamEvent");

// src/utils/kv.js
async function getUser(env, username) {
  try {
    const userKey = `user:${username}`;
    const userData = await env.YOYO_USER_DB.get(userKey, "json");
    if (!userData) {
      return null;
    }
    if (!userData.username || !userData.hashedPassword || !userData.salt) {
      logError(env, "Invalid user data structure", new Error("Missing required fields"), { username });
      return null;
    }
    return userData;
  } catch (error) {
    logError(env, "Failed to get user from KV", error, { username });
    return null;
  }
}
__name(getUser, "getUser");
async function createSession(env, sessionId, username, expirationMs = 864e5) {
  try {
    const sessionKey = `session:${sessionId}`;
    const expiresAt = Date.now() + expirationMs;
    const sessionData = {
      sessionId,
      username,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      expiresAt
    };
    const ttlSeconds = Math.floor(expirationMs / 1e3);
    await env.YOYO_USER_DB.put(sessionKey, JSON.stringify(sessionData), {
      expirationTtl: ttlSeconds
    });
    logInfo(env, "Session created", { sessionId, username, expiresAt: new Date(expiresAt).toISOString() });
    return sessionData;
  } catch (error) {
    logError(env, "Failed to create session", error, { sessionId, username });
    throw error;
  }
}
__name(createSession, "createSession");
async function getSession(env, sessionId) {
  try {
    const sessionKey = `session:${sessionId}`;
    const sessionData = await env.YOYO_USER_DB.get(sessionKey, "json");
    if (!sessionData) {
      return null;
    }
    if (sessionData.expiresAt && Date.now() > sessionData.expiresAt) {
      await deleteSession(env, sessionId);
      return null;
    }
    return sessionData;
  } catch (error) {
    logError(env, "Failed to get session from KV", error, { sessionId });
    return null;
  }
}
__name(getSession, "getSession");
async function deleteSession(env, sessionId) {
  try {
    const sessionKey = `session:${sessionId}`;
    await env.YOYO_USER_DB.delete(sessionKey);
    logInfo(env, "Session deleted", { sessionId });
  } catch (error) {
    logError(env, "Failed to delete session", error, { sessionId });
  }
}
__name(deleteSession, "deleteSession");
async function getStreamsConfig(env) {
  try {
    const streamsData = await env.YOYO_USER_DB.get("streams_config", "json");
    return streamsData || [];
  } catch (error) {
    logError(env, "Failed to get streams config from KV", error);
    return [];
  }
}
__name(getStreamsConfig, "getStreamsConfig");
async function setStreamsConfig(env, streamsConfig) {
  try {
    await env.YOYO_USER_DB.put("streams_config", JSON.stringify(streamsConfig));
    logInfo(env, "Streams config saved to KV", { count: streamsConfig.length });
    return streamsConfig;
  } catch (error) {
    logError(env, "Failed to save streams config to KV", error);
    throw error;
  }
}
__name(setStreamsConfig, "setStreamsConfig");
async function addStreamConfig(env, streamConfig) {
  try {
    const streamsConfig = await getStreamsConfig(env);
    if (streamsConfig.find((stream) => stream.id === streamConfig.id)) {
      throw new Error(`Stream with ID '${streamConfig.id}' already exists`);
    }
    const newStream = {
      id: streamConfig.id,
      name: streamConfig.name,
      rtmpUrl: streamConfig.rtmpUrl,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    streamsConfig.push(newStream);
    await setStreamsConfig(env, streamsConfig);
    logInfo(env, "Stream config added", { streamId: streamConfig.id, streamName: streamConfig.name });
    return newStream;
  } catch (error) {
    logError(env, "Failed to add stream config", error, { streamId: streamConfig.id });
    throw error;
  }
}
__name(addStreamConfig, "addStreamConfig");
async function updateStreamConfig(env, streamId, updates) {
  try {
    const streamsConfig = await getStreamsConfig(env);
    const streamIndex = streamsConfig.findIndex((stream) => stream.id === streamId);
    if (streamIndex === -1) {
      throw new Error(`Stream with ID '${streamId}' not found`);
    }
    streamsConfig[streamIndex] = {
      ...streamsConfig[streamIndex],
      ...updates,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await setStreamsConfig(env, streamsConfig);
    logInfo(env, "Stream config updated", { streamId, updates });
    return streamsConfig[streamIndex];
  } catch (error) {
    logError(env, "Failed to update stream config", error, { streamId, updates });
    throw error;
  }
}
__name(updateStreamConfig, "updateStreamConfig");
async function deleteStreamConfig(env, streamId) {
  try {
    const streamsConfig = await getStreamsConfig(env);
    const streamIndex = streamsConfig.findIndex((stream) => stream.id === streamId);
    if (streamIndex === -1) {
      throw new Error(`Stream with ID '${streamId}' not found`);
    }
    const deletedStream = streamsConfig.splice(streamIndex, 1)[0];
    await setStreamsConfig(env, streamsConfig);
    logInfo(env, "Stream config deleted", { streamId, streamName: deletedStream.name });
    return deletedStream;
  } catch (error) {
    logError(env, "Failed to delete stream config", error, { streamId });
    throw error;
  }
}
__name(deleteStreamConfig, "deleteStreamConfig");
async function getStreamConfig(env, streamId) {
  try {
    const streamsConfig = await getStreamsConfig(env);
    return streamsConfig.find((stream) => stream.id === streamId) || null;
  } catch (error) {
    logError(env, "Failed to get stream config", error, { streamId });
    return null;
  }
}
__name(getStreamConfig, "getStreamConfig");

// src/utils/crypto.js
async function simpleHashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(simpleHashPassword, "simpleHashPassword");
async function simpleHashPasswordReverse(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(simpleHashPasswordReverse, "simpleHashPasswordReverse");
async function hashPasswordOnly(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashPasswordOnly, "hashPasswordOnly");
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = encoder.encode(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 1e5,
      hash: "SHA-256"
    },
    key,
    256
    // 32字节 = 256位
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, salt, hashedPassword) {
  console.log("=== PASSWORD VERIFICATION DEBUG ===");
  console.log("Input password:", password);
  console.log("Input salt:", salt);
  console.log("Expected hash:", hashedPassword);
  if (salt === "randomsalt123") {
    console.log("Using simple SHA-256 verification for test data");
    const simpleHash1 = await simpleHashPassword(password, salt);
    console.log("Hash (password + salt):", simpleHash1);
    if (simpleHash1 === hashedPassword) {
      console.log("\u2705 Password verification successful (password + salt)");
      return true;
    }
    const simpleHash2 = await simpleHashPasswordReverse(password, salt);
    console.log("Hash (salt + password):", simpleHash2);
    if (simpleHash2 === hashedPassword) {
      console.log("\u2705 Password verification successful (salt + password)");
      return true;
    }
    const simpleHash3 = await hashPasswordOnly(password);
    console.log("Hash (password only):", simpleHash3);
    if (simpleHash3 === hashedPassword) {
      console.log("\u2705 Password verification successful (password only)");
      return true;
    }
  }
  console.log("Trying PBKDF2 verification");
  const pbkdf2Hash = await hashPassword(password, salt);
  console.log("PBKDF2 hash:", pbkdf2Hash);
  const result = pbkdf2Hash === hashedPassword;
  console.log("PBKDF2 verification result:", result);
  return result;
}
__name(verifyPassword, "verifyPassword");
function generateSessionId() {
  return crypto.randomUUID();
}
__name(generateSessionId, "generateSessionId");
function generateRandomString(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}
__name(generateRandomString, "generateRandomString");

// src/handlers/auth.js
function getSessionIdFromRequest(request) {
  if (!request || !request.headers) {
    return null;
  }
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split("=");
    acc[key] = value;
    return acc;
  }, {});
  return cookies.sessionId;
}
__name(getSessionIdFromRequest, "getSessionIdFromRequest");
async function validateSession(request, env) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    if (!sessionId) {
      return null;
    }
    const session = await getSession(env, sessionId);
    if (!session) {
      return null;
    }
    const user = await getUser(env, session.username);
    if (!user) {
      await deleteSession(env, sessionId);
      return null;
    }
    return {
      session,
      user: {
        username: user.username,
        role: user.role,
        createdAt: user.createdAt
      }
    };
  } catch (error) {
    logError(env, "Session validation failed", error);
    return null;
  }
}
__name(validateSession, "validateSession");
var handleAuth = {
  async login(request, env, ctx) {
    try {
      const startTime = Date.now();
      console.log("=== LOGIN REQUEST DEBUG ===");
      console.log("Request object exists:", !!request);
      console.log("Method:", request?.method);
      console.log("URL:", request?.url);
      if (request && request.headers) {
        try {
          console.log("Headers:", Object.fromEntries(request.headers.entries()));
        } catch (e) {
          console.log("Headers error:", e.message);
          console.log("Headers type:", typeof request.headers);
        }
      } else {
        console.log("Headers: undefined or missing");
      }
      let loginData;
      try {
        if (!request || typeof request.text !== "function") {
          console.log("ERROR: Invalid request object");
          return errorResponse("Invalid request object", "INVALID_REQUEST", 400, request);
        }
        const requestText = await request.text();
        console.log("Raw request body length:", requestText.length);
        console.log("Raw request body:", requestText);
        if (!requestText || requestText.trim() === "") {
          console.log("ERROR: Empty request body");
          return errorResponse("Empty request body", "EMPTY_BODY", 400, request);
        }
        loginData = JSON.parse(requestText);
        console.log("Parsed login data:", loginData);
      } catch (error) {
        console.error("JSON parse error:", error.message);
        console.error("Error stack:", error.stack);
        return errorResponse("Invalid JSON in request body", "INVALID_JSON", 400, request);
      }
      const { username, password } = loginData;
      if (!username || !password) {
        logAuthEvent(env, "login_attempt", username || "unknown", request, false, { reason: "missing_credentials" });
        return errorResponse("Username and password are required", "MISSING_CREDENTIALS", 400, request);
      }
      const user = await getUser(env, username);
      if (!user) {
        logAuthEvent(env, "login_attempt", username, request, false, { reason: "user_not_found" });
        return errorResponse("Invalid username or password", "INVALID_CREDENTIALS", 401, request);
      }
      const isValidPassword = await verifyPassword(password, user.salt, user.hashedPassword);
      if (!isValidPassword) {
        logAuthEvent(env, "login_attempt", username, request, false, { reason: "invalid_password" });
        return errorResponse("Invalid username or password", "INVALID_CREDENTIALS", 401, request);
      }
      const sessionId = generateSessionId();
      const sessionTimeout = parseInt(env.SESSION_TIMEOUT) || 864e5;
      const session = await createSession(env, sessionId, username, sessionTimeout);
      logAuthEvent(env, "login_success", username, request, true, {
        sessionId,
        role: user.role,
        responseTime: Date.now() - startTime
      });
      const responseData = {
        user: {
          username: user.username,
          role: user.role,
          createdAt: user.createdAt
        },
        session: {
          sessionId: session.sessionId,
          expiresAt: new Date(session.expiresAt).toISOString()
        }
      };
      const response = successResponse(responseData, "Login successful", request);
      const cookieValue = `sessionId=${sessionId}; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(sessionTimeout / 1e3)}; Path=/`;
      response.headers.set("Set-Cookie", cookieValue);
      return response;
    } catch (error) {
      logError(env, "Login handler error", error, { url: request.url });
      return errorResponse("Internal server error during login", "LOGIN_ERROR", 500, request);
    }
  },
  async logout(request, env, ctx) {
    try {
      const sessionId = getSessionIdFromRequest(request);
      if (sessionId) {
        const session = await getSession(env, sessionId);
        const username = session?.username || "unknown";
        await deleteSession(env, sessionId);
        logAuthEvent(env, "logout", username, request, true, { sessionId });
      }
      const response = successResponse(null, "Logout successful", request);
      response.headers.set("Set-Cookie", "sessionId=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/");
      return response;
    } catch (error) {
      logError(env, "Logout handler error", error);
      return errorResponse("Internal server error during logout", "LOGOUT_ERROR", 500, request);
    }
  },
  async getCurrentUser(request, env, ctx) {
    try {
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse("Authentication required", "AUTH_REQUIRED", 401, request);
      }
      return successResponse({
        user: auth.user,
        session: {
          sessionId: auth.session.sessionId,
          expiresAt: new Date(auth.session.expiresAt).toISOString()
        }
      }, "User information retrieved", request);
    } catch (error) {
      logError(env, "Get current user handler error", error);
      return errorResponse("Internal server error", "USER_INFO_ERROR", 500, request);
    }
  }
};

// src/handlers/streams.js
async function callTranscoderAPI(env, endpoint, method = "GET", data = null) {
  try {
    const vpsApiUrl = env.VPS_API_URL || "http://your-vps-ip:3000";
    const apiKey = env.VPS_API_KEY;
    if (!apiKey) {
      throw new Error("VPS API key not configured");
    }
    const url = `${vpsApiUrl}/api/${endpoint}`;
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "User-Agent": "Cloudflare-Worker/1.0"
      }
    };
    if (data && (method === "POST" || method === "PUT")) {
      options.body = JSON.stringify(data);
    }
    logInfo(env, "Calling VPS transcoder API", {
      url,
      method,
      endpoint,
      hasData: !!data
    });
    const response = await fetch(url, options);
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Invalid JSON response from VPS API: ${responseText}`);
    }
    if (!response.ok) {
      throw new Error(`VPS API error (${response.status}): ${responseData.message || responseText}`);
    }
    logInfo(env, "VPS transcoder API call successful", {
      endpoint,
      method,
      status: response.status,
      responseStatus: responseData.status
    });
    return responseData;
  } catch (error) {
    logError(env, "VPS transcoder API call failed", error, { endpoint, method });
    throw error;
  }
}
__name(callTranscoderAPI, "callTranscoderAPI");
async function checkVpsHealth(env) {
  try {
    const vpsApiUrl = env.VPS_API_URL || "http://your-vps-ip:3000";
    const apiKey = env.VPS_API_KEY;
    if (!apiKey) {
      return { available: false, error: "VPS API key not configured" };
    }
    const response = await fetch(`${vpsApiUrl}/api/health`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "User-Agent": "Cloudflare-Worker-Health/1.0"
      },
      signal: AbortSignal.timeout(5e3)
      // 5秒超时
    });
    if (response.ok) {
      const data = await response.json();
      return { available: true, data };
    } else {
      return { available: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    return { available: false, error: error.message };
  }
}
__name(checkVpsHealth, "checkVpsHealth");
var handleStreams = {
  /**
   * 获取所有可用的流列表（用户视图）
   */
  async getStreams(request, env, ctx) {
    try {
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse("Authentication required", "AUTH_REQUIRED", 401, request);
      }
      const streamsConfig = await getStreamsConfig(env);
      const publicStreams = streamsConfig.map((stream) => ({
        id: stream.id,
        name: stream.name,
        createdAt: stream.createdAt
      }));
      logInfo(env, "Streams list retrieved", {
        username: auth.user.username,
        streamsCount: publicStreams.length
      });
      return successResponse({
        streams: publicStreams,
        count: publicStreams.length
      }, "Streams retrieved successfully", request);
    } catch (error) {
      logError(env, "Get streams handler error", error);
      return errorResponse("Failed to retrieve streams", "STREAMS_ERROR", 500, request);
    }
  },
  /**
   * 请求播放指定流
   */
  async playStream(request, env, ctx) {
    try {
      const startTime = Date.now();
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse("Authentication required", "AUTH_REQUIRED", 401, request);
      }
      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse("Stream ID is required", "MISSING_STREAM_ID", 400, request);
      }
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, "STREAM_NOT_FOUND", 404, request);
      }
      logStreamEvent(env, "play_request", streamId, auth.user.username, request);
      try {
        const vpsHealth = await checkVpsHealth(env);
        if (!vpsHealth.available) {
          return errorResponse("VPS server is not available", "VPS_UNAVAILABLE", 503, request);
        }
        const transcoderResponse = await callTranscoderAPI(env, "start-stream", "POST", {
          streamId: streamConfig.id,
          rtmpUrl: streamConfig.rtmpUrl
        });
        const responseTime = Date.now() - startTime;
        logStreamEvent(env, "play_success", streamId, auth.user.username, request, {
          responseTime: `${responseTime}ms`,
          processId: transcoderResponse.data?.processId
        });
        const hlsUrl = `/hls/${streamId}/stream.m3u8`;
        return successResponse({
          streamId,
          streamName: streamConfig.name,
          hlsUrl,
          transcoderInfo: {
            processId: transcoderResponse.data?.processId,
            status: transcoderResponse.status
          },
          responseTime
        }, `Stream '${streamConfig.name}' started successfully`, request);
      } catch (transcoderError) {
        logStreamEvent(env, "play_failed", streamId, auth.user.username, request, {
          error: transcoderError.message,
          responseTime: Date.now() - startTime
        });
        if (transcoderError.message.includes("timeout")) {
          return errorResponse(
            "Stream startup timeout. Please try again.",
            "STREAM_TIMEOUT",
            504,
            request
          );
        } else if (transcoderError.message.includes("Connection")) {
          return errorResponse(
            "Unable to connect to stream source. Please check the stream configuration.",
            "STREAM_CONNECTION_ERROR",
            502,
            request
          );
        } else {
          return errorResponse(
            `Failed to start stream: ${transcoderError.message}`,
            "STREAM_START_ERROR",
            500,
            request
          );
        }
      }
    } catch (error) {
      logError(env, "Play stream handler error", error, { streamId: request.params?.id });
      return errorResponse("Failed to start stream playback", "PLAY_ERROR", 500, request);
    }
  },
  /**
   * 停止指定流（可选功能）
   */
  async stopStream(request, env, ctx) {
    try {
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse("Authentication required", "AUTH_REQUIRED", 401, request);
      }
      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse("Stream ID is required", "MISSING_STREAM_ID", 400, request);
      }
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, "STREAM_NOT_FOUND", 404, request);
      }
      logStreamEvent(env, "stop_request", streamId, auth.user.username, request);
      try {
        const vpsHealth = await checkVpsHealth(env);
        if (!vpsHealth.available) {
          return errorResponse("VPS server is not available", "VPS_UNAVAILABLE", 503, request);
        }
        const transcoderResponse = await callTranscoderAPI(env, "stop-stream", "POST", {
          streamId
        });
        logStreamEvent(env, "stop_success", streamId, auth.user.username, request, {
          processId: transcoderResponse.data?.processId
        });
        return successResponse({
          streamId,
          streamName: streamConfig.name,
          transcoderInfo: {
            processId: transcoderResponse.data?.processId,
            status: transcoderResponse.status
          }
        }, `Stream '${streamConfig.name}' stopped successfully`, request);
      } catch (transcoderError) {
        logStreamEvent(env, "stop_failed", streamId, auth.user.username, request, {
          error: transcoderError.message
        });
        return errorResponse(
          `Failed to stop stream: ${transcoderError.message}`,
          "STREAM_STOP_ERROR",
          500,
          request
        );
      }
    } catch (error) {
      logError(env, "Stop stream handler error", error, { streamId: request.params?.id });
      return errorResponse("Failed to stop stream", "STOP_ERROR", 500, request);
    }
  }
};

// src/utils/cache.js
var memoryCache = /* @__PURE__ */ new Map();
function clearCache(key = null) {
  try {
    if (key) {
      memoryCache.delete(key);
    } else {
      memoryCache.clear();
    }
    return true;
  } catch (error) {
    console.error("Cache clear error:", error);
    return false;
  }
}
__name(clearCache, "clearCache");
function getCacheStats() {
  const stats = {
    totalItems: memoryCache.size,
    items: []
  };
  for (const [key, item] of memoryCache.entries()) {
    const age = Date.now() - item.timestamp;
    const remaining = Math.max(0, item.ttl - age);
    stats.items.push({
      key,
      age: `${Math.round(age / 1e3)}s`,
      remaining: `${Math.round(remaining / 1e3)}s`,
      expired: remaining <= 0
    });
  }
  return stats;
}
__name(getCacheStats, "getCacheStats");

// src/handlers/admin.js
async function requireAdmin(request, env) {
  const auth = await validateSession(request, env);
  if (!auth) {
    return { error: errorResponse("Authentication required", "AUTH_REQUIRED", 401, request) };
  }
  if (auth.user.role !== "admin") {
    return { error: errorResponse("Admin privileges required", "ADMIN_REQUIRED", 403, request) };
  }
  return { auth };
}
__name(requireAdmin, "requireAdmin");
function validateStreamData(data, isUpdate = false) {
  const errors = [];
  if (!isUpdate && (!data.id || typeof data.id !== "string")) {
    errors.push("Stream ID is required and must be a string");
  }
  if (data.id && !/^[a-zA-Z0-9_-]+$/.test(data.id)) {
    errors.push("Stream ID can only contain letters, numbers, underscores and hyphens");
  }
  if (!data.name || typeof data.name !== "string") {
    errors.push("Stream name is required and must be a string");
  }
  if (data.name && data.name.trim().length === 0) {
    errors.push("Stream name cannot be empty");
  }
  if (!data.rtmpUrl || typeof data.rtmpUrl !== "string") {
    errors.push("RTMP URL is required and must be a string");
  }
  if (data.rtmpUrl && !data.rtmpUrl.startsWith("rtmp://") && !data.rtmpUrl.startsWith("rtmps://")) {
    errors.push("RTMP URL must start with rtmp:// or rtmps://");
  }
  return errors;
}
__name(validateStreamData, "validateStreamData");
async function getVpsStatus(env) {
  try {
    const vpsApiUrl = env.VPS_API_URL || "http://your-vps-ip:3000";
    const apiKey = env.VPS_API_KEY;
    if (!apiKey) {
      return { error: "VPS API key not configured" };
    }
    const response = await fetch(`${vpsApiUrl}/api/status`, {
      headers: {
        "X-API-Key": apiKey,
        "User-Agent": "Cloudflare-Worker-Admin/1.0"
      },
      timeout: 1e4
      // 10秒超时
    });
    if (!response.ok) {
      return { error: `VPS API error: ${response.status}` };
    }
    const data = await response.json();
    return { data };
  } catch (error) {
    return { error: error.message };
  }
}
__name(getVpsStatus, "getVpsStatus");
var handleAdmin = {
  /**
   * 获取所有流配置（管理员视图 - 包含敏感信息）
   */
  async getStreams(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;
      const streamsConfig = await getStreamsConfig(env);
      logInfo(env, "Admin retrieved streams config", {
        username: auth.user.username,
        streamsCount: streamsConfig.length
      });
      return successResponse({
        streams: streamsConfig,
        count: streamsConfig.length
      }, "Streams configuration retrieved successfully", request);
    } catch (error) {
      logError(env, "Admin get streams handler error", error);
      return errorResponse("Failed to retrieve streams configuration", "ADMIN_STREAMS_ERROR", 500, request);
    }
  },
  /**
   * 创建新的流配置
   */
  async createStream(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;
      let streamData;
      try {
        streamData = await request.json();
      } catch (error2) {
        return errorResponse("Invalid JSON in request body", "INVALID_JSON", 400, request);
      }
      const validationErrors = validateStreamData(streamData);
      if (validationErrors.length > 0) {
        return errorResponse(
          `Validation errors: ${validationErrors.join(", ")}`,
          "VALIDATION_ERROR",
          400,
          request
        );
      }
      if (!streamData.id) {
        streamData.id = `stream_${generateRandomString(8).toLowerCase()}`;
      }
      try {
        const newStream = await addStreamConfig(env, {
          id: streamData.id,
          name: streamData.name.trim(),
          rtmpUrl: streamData.rtmpUrl.trim()
        });
        logInfo(env, "Admin created new stream", {
          username: auth.user.username,
          streamId: newStream.id,
          streamName: newStream.name
        });
        return successResponse(newStream, "Stream created successfully", request);
      } catch (kvError) {
        if (kvError.message.includes("already exists")) {
          return errorResponse(
            `Stream with ID '${streamData.id}' already exists`,
            "STREAM_EXISTS",
            409,
            request
          );
        }
        throw kvError;
      }
    } catch (error) {
      logError(env, "Admin create stream handler error", error);
      return errorResponse("Failed to create stream", "ADMIN_CREATE_ERROR", 500, request);
    }
  },
  /**
   * 更新流配置
   */
  async updateStream(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;
      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse("Stream ID is required", "MISSING_STREAM_ID", 400, request);
      }
      let updateData;
      try {
        updateData = await request.json();
      } catch (error2) {
        return errorResponse("Invalid JSON in request body", "INVALID_JSON", 400, request);
      }
      const validationErrors = validateStreamData(updateData, true);
      if (validationErrors.length > 0) {
        return errorResponse(
          `Validation errors: ${validationErrors.join(", ")}`,
          "VALIDATION_ERROR",
          400,
          request
        );
      }
      try {
        const { id, ...updates } = updateData;
        if (updates.name) updates.name = updates.name.trim();
        if (updates.rtmpUrl) updates.rtmpUrl = updates.rtmpUrl.trim();
        const updatedStream = await updateStreamConfig(env, streamId, updates);
        logInfo(env, "Admin updated stream", {
          username: auth.user.username,
          streamId,
          updates: Object.keys(updates)
        });
        return successResponse(updatedStream, "Stream updated successfully", request);
      } catch (kvError) {
        if (kvError.message.includes("not found")) {
          return errorResponse(
            `Stream with ID '${streamId}' not found`,
            "STREAM_NOT_FOUND",
            404,
            request
          );
        }
        throw kvError;
      }
    } catch (error) {
      logError(env, "Admin update stream handler error", error);
      return errorResponse("Failed to update stream", "ADMIN_UPDATE_ERROR", 500, request);
    }
  },
  /**
   * 删除流配置
   */
  async deleteStream(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;
      const { id: streamId } = request.params;
      if (!streamId) {
        return errorResponse("Stream ID is required", "MISSING_STREAM_ID", 400, request);
      }
      try {
        const deletedStream = await deleteStreamConfig(env, streamId);
        logInfo(env, "Admin deleted stream", {
          username: auth.user.username,
          streamId,
          streamName: deletedStream.name
        });
        return successResponse({
          deleted: deletedStream
        }, "Stream deleted successfully", request);
      } catch (kvError) {
        if (kvError.message.includes("not found")) {
          return errorResponse(
            `Stream with ID '${streamId}' not found`,
            "STREAM_NOT_FOUND",
            404,
            request
          );
        }
        throw kvError;
      }
    } catch (error) {
      logError(env, "Admin delete stream handler error", error);
      return errorResponse("Failed to delete stream", "ADMIN_DELETE_ERROR", 500, request);
    }
  },
  /**
   * 获取系统状态信息
   */
  async getSystemStatus(request, env, ctx) {
    try {
      const { auth, error } = await requireAdmin(request, env);
      if (error) return error;
      const streamsConfig = await getStreamsConfig(env);
      const vpsStatus = await getVpsStatus(env);
      const systemStatus = {
        cloudflare: {
          worker: {
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            environment: env.ENVIRONMENT || "unknown"
          },
          kv: {
            streamsCount: streamsConfig.length,
            available: true
            // 如果能读取到配置就说明KV可用
          }
        },
        vps: vpsStatus.data || {
          error: vpsStatus.error,
          available: false
        },
        streams: {
          configured: streamsConfig.length,
          configList: streamsConfig.map((s) => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt
          }))
        }
      };
      logInfo(env, "Admin retrieved system status", {
        username: auth.user.username,
        vpsAvailable: !vpsStatus.error,
        streamsCount: streamsConfig.length
      });
      return successResponse(systemStatus, "System status retrieved successfully", request);
    } catch (error) {
      logError(env, "Admin get system status handler error", error);
      return errorResponse("Failed to retrieve system status", "ADMIN_STATUS_ERROR", 500, request);
    }
  },
  // 获取缓存统计信息
  async getCacheStats(request, env, ctx) {
    try {
      console.log("Admin get cache stats request");
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }
      const cacheStats = getCacheStats();
      return successResponse({
        cache: cacheStats,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }, "Cache statistics retrieved successfully", request);
    } catch (error) {
      console.error("Admin get cache stats error:", error);
      logError(env, "Admin get cache stats handler error", error);
      return errorResponse("Failed to retrieve cache statistics", "ADMIN_CACHE_STATS_ERROR", 500, request);
    }
  },
  // 清理缓存
  async clearCache(request, env, ctx) {
    try {
      console.log("Admin clear cache request");
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }
      const clearedCount = clearCache();
      return successResponse({
        cleared: true,
        clearedItems: clearedCount,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }, "Cache cleared successfully", request);
    } catch (error) {
      console.error("Admin clear cache error:", error);
      logError(env, "Admin clear cache handler error", error);
      return errorResponse("Failed to clear cache", "ADMIN_CACHE_CLEAR_ERROR", 500, request);
    }
  },
  // 重载流配置
  async reloadStreamsConfig(request, env, ctx) {
    try {
      console.log("Admin reload streams config request");
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }
      clearCache("streams:");
      clearCache("stream:");
      const streams = await getStreamsConfig(env);
      return successResponse({
        reloaded: true,
        streamsCount: streams.length,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }, "Streams configuration reloaded successfully", request);
    } catch (error) {
      console.error("Admin reload streams config error:", error);
      logError(env, "Admin reload streams config handler error", error);
      return errorResponse("Failed to reload streams configuration", "ADMIN_STREAMS_RELOAD_ERROR", 500, request);
    }
  },
  // 获取系统诊断信息
  async getSystemDiagnostics(request, env, ctx) {
    try {
      console.log("Admin get system diagnostics request");
      const startTime = Date.now();
      const authResult = await requireAdmin(request, env);
      if (authResult.error) {
        return authResult.error;
      }
      const diagnostics = {
        worker: {
          version: "1.0.0",
          environment: env.ENVIRONMENT || "development",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          uptime: Date.now() - startTime
        },
        kv: {
          available: false,
          namespace: "YOYO_USER_DB",
          testResult: null
        },
        vps: {
          available: false,
          url: env.VPS_API_URL || "not configured",
          testResult: null
        },
        cache: getCacheStats(),
        performance: {
          diagnosticsTime: null
        }
      };
      try {
        await env.YOYO_USER_DB.put("health_check", "ok", { expirationTtl: 60 });
        const testValue = await env.YOYO_USER_DB.get("health_check");
        diagnostics.kv.available = testValue === "ok";
        diagnostics.kv.testResult = "success";
      } catch (kvError) {
        console.error("KV health check failed:", kvError);
        diagnostics.kv.testResult = kvError.message;
      }
      if (env.VPS_API_URL) {
        try {
          const vpsResponse = await fetch(`${env.VPS_API_URL}/health`, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${env.VPS_API_KEY}`,
              "Content-Type": "application/json"
            },
            signal: AbortSignal.timeout(5e3)
          });
          diagnostics.vps.available = vpsResponse.ok;
          diagnostics.vps.testResult = vpsResponse.ok ? "success" : `HTTP ${vpsResponse.status}`;
        } catch (vpsError) {
          console.error("VPS health check failed:", vpsError);
          diagnostics.vps.testResult = vpsError.message;
        }
      }
      diagnostics.performance.diagnosticsTime = Date.now() - startTime;
      return successResponse(diagnostics, "System diagnostics completed successfully", request);
    } catch (error) {
      console.error("Admin get system diagnostics error:", error);
      logError(env, "Admin get system diagnostics handler error", error);
      return errorResponse("Failed to retrieve system diagnostics", "ADMIN_DIAGNOSTICS_ERROR", 500, request);
    }
  }
};

// src/handlers/proxy.js
var CACHE_HEADERS = {
  m3u8: {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
  },
  ts: {
    "Cache-Control": "public, max-age=3600",
    "Expires": new Date(Date.now() + 36e5).toUTCString()
  }
};
var handleProxy = {
  /**
   * 代理HLS文件请求到VPS服务器
   */
  async hlsFile(request, env, ctx) {
    try {
      const startTime = Date.now();
      const auth = await validateSession(request, env);
      if (!auth) {
        return errorResponse("Authentication required to access streams", "AUTH_REQUIRED", 401, request);
      }
      const { streamId, file } = request.params;
      if (!streamId || !file) {
        return errorResponse("Stream ID and file name are required", "MISSING_PARAMS", 400, request);
      }
      const streamConfig = await getStreamConfig(env, streamId);
      if (!streamConfig) {
        return errorResponse(`Stream '${streamId}' not found`, "STREAM_NOT_FOUND", 404, request);
      }
      const fileExtension = file.split(".").pop()?.toLowerCase();
      if (!["m3u8", "ts"].includes(fileExtension)) {
        return errorResponse("Invalid file type", "INVALID_FILE_TYPE", 400, request);
      }
      const vpsBaseUrl = env.VPS_HLS_URL || `http://${env.VPS_IP || "your-vps-ip"}:8080`;
      const hlsFileUrl = `${vpsBaseUrl}/hls/${streamId}/${file}`;
      try {
        const vpsResponse = await fetch(hlsFileUrl, {
          method: request.method,
          headers: {
            "User-Agent": "Cloudflare-Worker-HLS-Proxy/1.0",
            "Accept": request.headers.get("Accept") || "*/*",
            "Accept-Encoding": request.headers.get("Accept-Encoding") || "gzip, deflate",
            "Range": request.headers.get("Range")
            // 支持Range请求
          },
          // 设置超时
          signal: AbortSignal.timeout(1e4)
          // 10秒超时
        });
        if (!vpsResponse.ok) {
          if (vpsResponse.status === 404) {
            return new Response("Stream file not available yet. Please try again in a moment.", {
              status: 202,
              // 202 Accepted - 表示正在处理
              headers: {
                "Content-Type": "text/plain",
                "Retry-After": "2"
                // 建议2秒后重试
              }
            });
          }
          return new Response(`Upstream server error: ${vpsResponse.status}`, {
            status: vpsResponse.status,
            headers: {
              "Content-Type": "text/plain"
            }
          });
        }
        const responseBody = await vpsResponse.arrayBuffer();
        const responseHeaders = {
          "Content-Type": vpsResponse.headers.get("Content-Type") || (fileExtension === "m3u8" ? "application/vnd.apple.mpegurl" : "video/mp2t"),
          "Content-Length": vpsResponse.headers.get("Content-Length"),
          "Last-Modified": vpsResponse.headers.get("Last-Modified"),
          "ETag": vpsResponse.headers.get("ETag"),
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Accept-Encoding",
          "Access-Control-Expose-Headers": "Accept-Ranges, Content-Encoding, Content-Length, Content-Range",
          // 根据文件类型设置缓存策略
          ...CACHE_HEADERS[fileExtension]
        };
        Object.keys(responseHeaders).forEach((key) => {
          if (responseHeaders[key] === null || responseHeaders[key] === void 0) {
            delete responseHeaders[key];
          }
        });
        if (request.headers.get("Range") && vpsResponse.headers.get("Content-Range")) {
          responseHeaders["Content-Range"] = vpsResponse.headers.get("Content-Range");
          responseHeaders["Accept-Ranges"] = "bytes";
        }
        const responseTime = Date.now() - startTime;
        if (fileExtension === "m3u8") {
          logInfo(env, "HLS file proxied successfully", {
            streamId,
            file,
            username: auth.user.username,
            responseTime: `${responseTime}ms`,
            fileSize: responseBody.byteLength,
            clientIp: request.headers.get("CF-Connecting-IP")
          });
        }
        return new Response(responseBody, {
          status: vpsResponse.status,
          headers: responseHeaders
        });
      } catch (fetchError) {
        logError(env, "HLS file proxy fetch error", fetchError, {
          streamId,
          file,
          username: auth.user.username,
          hlsFileUrl,
          responseTime: Date.now() - startTime
        });
        if (fetchError.name === "TimeoutError") {
          return new Response("Stream server timeout. Please try again.", {
            status: 504,
            headers: {
              "Content-Type": "text/plain",
              "Retry-After": "5"
            }
          });
        }
        return new Response("Failed to fetch stream data from server", {
          status: 502,
          headers: {
            "Content-Type": "text/plain"
          }
        });
      }
    } catch (error) {
      logError(env, "HLS proxy handler error", error, {
        streamId: request.params?.streamId,
        file: request.params?.file,
        url: request.url
      });
      return errorResponse("Internal server error during stream proxy", "PROXY_ERROR", 500, request);
    }
  }
};

// src/handlers/pages.js
var HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}} - YOYO\u6D41\u5A92\u4F53\u5E73\u53F0</title>
    <link rel="icon" type="image/x-icon" href="/static/favicon.ico">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .container {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            padding: 2rem;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            max-width: 400px;
            width: 90%;
            text-align: center;
        }

        .logo {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 0.5rem;
        }

        .subtitle {
            color: #666;
            margin-bottom: 2rem;
            font-size: 0.9rem;
        }

        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid #f3f3f3;
            border-top: 2px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .message {
            color: #666;
            margin-top: 1rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">YOYO</div>
        <div class="subtitle">\u5B89\u5168\u6D41\u5A92\u4F53\u64AD\u653E\u5E73\u53F0</div>
        {{CONTENT}}
    </div>

    <script>
        {{SCRIPT}}
    <\/script>
</body>
</html>
`;
var LOGIN_CONTENT = `
    <div id="login-form">
        <form onsubmit="handleLogin(event)">
            <div style="margin-bottom: 1rem;">
                <input type="text" id="username" placeholder="\u7528\u6237\u540D" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem;">
            </div>
            <div style="margin-bottom: 1.5rem;">
                <input type="password" id="password" placeholder="\u5BC6\u7801" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem;">
            </div>
            <button type="submit" id="login-btn"
                    style="width: 100%; padding: 0.75rem; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: all 0.3s ease;">
                \u767B\u5F55
            </button>
        </form>
        <div id="error-message" style="color: #e74c3c; margin-top: 1rem; display: none;"></div>
    </div>
`;
var LOGIN_SCRIPT = `
    async function handleLogin(event) {
        event.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const loginBtn = document.getElementById('login-btn');
        const errorDiv = document.getElementById('error-message');

        // \u663E\u793A\u52A0\u8F7D\u72B6\u6001
        loginBtn.innerHTML = '<div class="loading"></div>';
        loginBtn.disabled = true;
        errorDiv.style.display = 'none';

        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });

            const data = await response.json();

            if (response.ok) {
                // \u767B\u5F55\u6210\u529F\uFF0C\u8DF3\u8F6C\u5230\u4E3B\u9875
                window.location.href = '/';
            } else {
                // \u663E\u793A\u9519\u8BEF\u4FE1\u606F
                errorDiv.textContent = data.message || '\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            errorDiv.textContent = '\u7F51\u7EDC\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u8FDE\u63A5';
            errorDiv.style.display = 'block';
        }

        // \u6062\u590D\u6309\u94AE\u72B6\u6001
        loginBtn.innerHTML = '\u767B\u5F55';
        loginBtn.disabled = false;
    }

    // \u56DE\u8F66\u952E\u63D0\u4EA4
    document.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            document.querySelector('form').dispatchEvent(new Event('submit'));
        }
    });
`;
var LOADING_CONTENT = `
    <div class="loading" style="margin: 0 auto 1rem;"></div>
    <div class="message">\u52A0\u8F7D\u4E2D\uFF0C\u8BF7\u7A0D\u5019...</div>
`;
var REDIRECT_SCRIPT = `
    // \u68C0\u67E5\u8BA4\u8BC1\u72B6\u6001\u5E76\u91CD\u5B9A\u5411
    async function checkAuthAndRedirect() {
        try {
            const response = await fetch('/api/me', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                const user = data.data.user;

                // \u6839\u636E\u7528\u6237\u89D2\u8272\u8DF3\u8F6C\u5230\u4E0D\u540C\u9875\u9762
                if (user.role === 'admin') {
                    window.location.href = '/admin';
                } else {
                    // \u8FD9\u91CC\u5E94\u8BE5\u8DF3\u8F6C\u5230\u5B9E\u9645\u7684\u524D\u7AEF\u5E94\u7528
                    window.location.href = 'https://your-frontend-domain.com';
                }
            } else {
                // \u672A\u8BA4\u8BC1\uFF0C\u8DF3\u8F6C\u5230\u767B\u5F55\u9875
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/login';
        }
    }

    // \u9875\u9762\u52A0\u8F7D\u540E\u68C0\u67E5\u8BA4\u8BC1
    checkAuthAndRedirect();
`;
var ADMIN_CONTENT = `
    <div>
        <h2 style="color: #333; margin-bottom: 1rem;">\u7BA1\u7406\u5458\u63A7\u5236\u53F0</h2>
        <div class="loading" style="margin: 0 auto 1rem;"></div>
        <div class="message">\u6B63\u5728\u52A0\u8F7D\u7BA1\u7406\u754C\u9762...</div>
        <div style="margin-top: 2rem;">
            <button onclick="logout()" style="padding: 0.5rem 1rem; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">
                \u9000\u51FA\u767B\u5F55
            </button>
        </div>
    </div>
`;
var ADMIN_SCRIPT = `
    async function logout() {
        try {
            await fetch('/logout', {
                method: 'POST',
                credentials: 'include'
            });
            window.location.href = '/login';
        } catch (error) {
            console.error('Logout failed:', error);
        }
    }

    // \u8FD9\u91CC\u5E94\u8BE5\u52A0\u8F7D\u5B9E\u9645\u7684\u7BA1\u7406\u754C\u9762
    setTimeout(() => {
        document.querySelector('.container').innerHTML = \`
            <div class="logo">YOYO</div>
            <div class="subtitle">\u7BA1\u7406\u5458\u63A7\u5236\u53F0</div>
            <div style="text-align: left; margin: 2rem 0;">
                <h3 style="color: #333; margin-bottom: 1rem;">\u5FEB\u901F\u94FE\u63A5</h3>
                <div style="display: grid; gap: 0.5rem;">
                    <a href="https://your-admin-frontend.com" target="_blank" 
                       style="padding: 0.75rem; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; text-decoration: none; color: #495057; display: block;">
                        \u{1F4CA} \u6D41\u5A92\u4F53\u7BA1\u7406\u754C\u9762
                    </a>
                    <a href="/api/admin/status" target="_blank"
                       style="padding: 0.75rem; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; text-decoration: none; color: #495057; display: block;">
                        \u{1F527} \u7CFB\u7EDF\u72B6\u6001 API
                    </a>
                </div>
            </div>
            <button onclick="logout()" style="width: 100%; padding: 0.75rem; background: #e74c3c; color: white; border: none; border-radius: 8px; cursor: pointer;">
                \u9000\u51FA\u767B\u5F55
            </button>
        \`;
    }, 2000);
`;
var handlePages = {
  /**
   * 主页面 - 根据认证状态重定向
   */
  async dashboard(request, env, ctx) {
    return new Response(
      HTML_TEMPLATE.replace("{{TITLE}}", "\u9996\u9875").replace("{{CONTENT}}", LOADING_CONTENT).replace("{{SCRIPT}}", REDIRECT_SCRIPT),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      }
    );
  },
  /**
   * 登录页面
   */
  async login(request, env, ctx) {
    const auth = await validateSession(request, env);
    if (auth) {
      return Response.redirect(new URL("/", request.url).toString(), 302);
    }
    return new Response(
      HTML_TEMPLATE.replace("{{TITLE}}", "\u767B\u5F55").replace("{{CONTENT}}", LOGIN_CONTENT).replace("{{SCRIPT}}", LOGIN_SCRIPT),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      }
    );
  },
  /**
   * 管理员页面
   */
  async admin(request, env, ctx) {
    const auth = await validateSession(request, env);
    if (!auth) {
      return Response.redirect(new URL("/login", request.url).toString(), 302);
    }
    if (auth.user.role !== "admin") {
      return new Response(
        HTML_TEMPLATE.replace("{{TITLE}}", "\u8BBF\u95EE\u62D2\u7EDD").replace("{{CONTENT}}", '<div style="color: #e74c3c;">\u26A0\uFE0F \u8BBF\u95EE\u88AB\u62D2\u7EDD\uFF1A\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650</div>').replace("{{SCRIPT}}", ""),
        {
          status: 403,
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        }
      );
    }
    return new Response(
      HTML_TEMPLATE.replace("{{TITLE}}", "\u7BA1\u7406\u5458\u63A7\u5236\u53F0").replace("{{CONTENT}}", ADMIN_CONTENT).replace("{{SCRIPT}}", ADMIN_SCRIPT),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      }
    );
  },
  /**
   * 静态资源处理（如果需要）
   */
  async static(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname.endsWith("favicon.ico")) {
      const faviconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="6" fill="#667eea"/>
          <text x="16" y="22" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="white">Y</text>
        </svg>
      `;
      return new Response(faviconSvg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }
    return new Response("Static file not found", { status: 404 });
  }
};

// src/index.js
var src_default = {
  async fetch(request, env, ctx) {
    try {
      const router = new Router();
      if (request.method === "OPTIONS") {
        return handleOptions(request);
      }
      router.get("/", (req, env2, ctx2) => handlePages.dashboard(req, env2, ctx2));
      router.get("/login", (req, env2, ctx2) => handlePages.login(req, env2, ctx2));
      router.get("/admin", (req, env2, ctx2) => handlePages.admin(req, env2, ctx2));
      router.post("/login", (req, env2, ctx2) => handleAuth.login(req, env2, ctx2));
      router.post("/logout", (req, env2, ctx2) => handleAuth.logout(req, env2, ctx2));
      router.get("/api/me", (req, env2, ctx2) => handleAuth.getCurrentUser(req, env2, ctx2));
      router.get("/api/status", (req, env2, ctx2) => {
        return new Response(
          JSON.stringify({
            status: "ok",
            message: "YOYO Streaming Platform API is running",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            version: "1.0.0"
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      });
      router.get("/api/streams", (req, env2, ctx2) => handleStreams.getStreams(req, env2, ctx2));
      router.post("/api/play/:id", (req, env2, ctx2) => handleStreams.playStream(req, env2, ctx2));
      router.post("/api/stop/:id", (req, env2, ctx2) => handleStreams.stopStream(req, env2, ctx2));
      router.get("/api/stream/:id/status", (req, env2, ctx2) => handleStreams.getStreamStatus(req, env2, ctx2));
      router.get("/api/streams/status", (req, env2, ctx2) => handleStreams.getAllStreamsStatus(req, env2, ctx2));
      router.get("/api/admin/streams", (req, env2, ctx2) => handleAdmin.getStreams(req, env2, ctx2));
      router.post("/api/admin/streams", (req, env2, ctx2) => handleAdmin.createStream(req, env2, ctx2));
      router.put("/api/admin/streams/:id", (req, env2, ctx2) => handleAdmin.updateStream(req, env2, ctx2));
      router.delete("/api/admin/streams/:id", (req, env2, ctx2) => handleAdmin.deleteStream(req, env2, ctx2));
      router.get("/api/admin/status", (req, env2, ctx2) => handleAdmin.getSystemStatus(req, env2, ctx2));
      router.get("/api/admin/cache/stats", (req, env2, ctx2) => handleAdmin.getCacheStats(req, env2, ctx2));
      router.post("/api/admin/cache/clear", (req, env2, ctx2) => handleAdmin.clearCache(req, env2, ctx2));
      router.post("/api/admin/streams/reload", (req, env2, ctx2) => handleAdmin.reloadStreamsConfig(req, env2, ctx2));
      router.get("/api/admin/diagnostics", (req, env2, ctx2) => handleAdmin.getSystemDiagnostics(req, env2, ctx2));
      router.get("/hls/:streamId/:file", (req, env2, ctx2) => handleProxy.hlsFile(req, env2, ctx2));
      router.get("/static/*", (req, env2, ctx2) => handlePages.static(req, env2, ctx2));
      const response = await router.handle(request, env, ctx);
      if (response) {
        return response;
      }
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Endpoint not found",
          path: new URL(request.url).pathname
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    } catch (error) {
      await logError(env, "Global error handler", error, {
        url: request.url,
        method: request.method,
        userAgent: request.headers.get("User-Agent"),
        cfRay: request.headers.get("CF-Ray"),
        cfConnectingIp: request.headers.get("CF-Connecting-IP")
      });
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Internal server error",
          code: "INTERNAL_ERROR",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }
  },
  // 定时任务处理器（可选）
  async scheduled(controller, env, ctx) {
    try {
      console.log("Running scheduled task: cleanup expired sessions");
    } catch (error) {
      await logError(env, "Scheduled task error", error);
    }
  }
};

// ../../../../../../Program Files/nodejs/node_global/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../../Program Files/nodejs/node_global/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-eqpmp8/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../../../Program Files/nodejs/node_global/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-eqpmp8/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
