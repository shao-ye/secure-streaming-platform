/**
 * 简单的路由器实现
 */

export class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * 注册GET路由
   */
  get(path, handler) {
    this.routes.push({
      method: 'GET',
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
      method: 'POST',
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
      method: 'PUT',
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
      method: 'DELETE',
      path,
      handler,
      regex: this.pathToRegex(path)
    });
  }

  /**
   * 将路径转换为正则表达式
   */
  pathToRegex(path) {
    // 处理参数占位符，如 :id -> ([^/]+)
    const regexPath = path
      .replace(/:\w+/g, '([^/]+)')  // 参数占位符
      .replace(/\*/g, '(.*)');      // 通配符

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

    // 查找匹配的路由
    for (const route of this.routes) {
      if (route.method === method && route.regex.test(pathname)) {
        try {
          // 提取路径参数
          const params = this.extractParams(route.path, pathname, route.regex);

          // 将参数和查询字符串添加到request对象上，而不是创建新对象
          request.params = params;
          request.query = Object.fromEntries(url.searchParams);
          request.pathname = pathname;

          // 调用处理器，传递原始request对象
          return await route.handler(request, env, ctx);
        } catch (error) {
          console.error(`Route handler error for ${method} ${pathname}:`, error);
          throw error;
        }
      }
    }

    // 没有找到匹配的路由
    return null;
  }
}
