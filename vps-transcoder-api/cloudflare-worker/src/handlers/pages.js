/**
 * 页面处理器 - 提供前端HTML页面
 */

import { validateSession } from './auth.js';

/**
 * 基础HTML模板
 */
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}} - YOYO流媒体平台</title>
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
        <div class="subtitle">安全流媒体播放平台</div>
        {{CONTENT}}
    </div>

    <script>
        {{SCRIPT}}
    </script>
</body>
</html>
`;

/**
 * 登录页面内容
 */
const LOGIN_CONTENT = `
    <div id="login-form">
        <form onsubmit="handleLogin(event)">
            <div style="margin-bottom: 1rem;">
                <input type="text" id="username" placeholder="用户名" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem;">
            </div>
            <div style="margin-bottom: 1.5rem;">
                <input type="password" id="password" placeholder="密码" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem;">
            </div>
            <button type="submit" id="login-btn"
                    style="width: 100%; padding: 0.75rem; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: all 0.3s ease;">
                登录
            </button>
        </form>
        <div id="error-message" style="color: #e74c3c; margin-top: 1rem; display: none;"></div>
    </div>
`;

/**
 * 登录页面脚本
 */
const LOGIN_SCRIPT = `
    async function handleLogin(event) {
        event.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const loginBtn = document.getElementById('login-btn');
        const errorDiv = document.getElementById('error-message');

        // 显示加载状态
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
                // 登录成功，跳转到主页
                window.location.href = '/';
            } else {
                // 显示错误信息
                errorDiv.textContent = data.message || '登录失败，请重试';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            errorDiv.textContent = '网络错误，请检查连接';
            errorDiv.style.display = 'block';
        }

        // 恢复按钮状态
        loginBtn.innerHTML = '登录';
        loginBtn.disabled = false;
    }

    // 回车键提交
    document.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            document.querySelector('form').dispatchEvent(new Event('submit'));
        }
    });
`;

/**
 * 加载中页面内容
 */
const LOADING_CONTENT = `
    <div class="loading" style="margin: 0 auto 1rem;"></div>
    <div class="message">加载中，请稍候...</div>
`;

/**
 * 重定向脚本
 */
const REDIRECT_SCRIPT = `
    // 检查认证状态并重定向
    async function checkAuthAndRedirect() {
        try {
            const response = await fetch('/api/me', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                const user = data.data.user;

                // 根据用户角色跳转到不同页面
                if (user.role === 'admin') {
                    window.location.href = '/admin';
                } else {
                    // 这里应该跳转到实际的前端应用
                    window.location.href = 'https://your-frontend-domain.com';
                }
            } else {
                // 未认证，跳转到登录页
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/login';
        }
    }

    // 页面加载后检查认证
    checkAuthAndRedirect();
`;

/**
 * 管理员页面内容
 */
const ADMIN_CONTENT = `
    <div>
        <h2 style="color: #333; margin-bottom: 1rem;">管理员控制台</h2>
        <div class="loading" style="margin: 0 auto 1rem;"></div>
        <div class="message">正在加载管理界面...</div>
        <div style="margin-top: 2rem;">
            <button onclick="logout()" style="padding: 0.5rem 1rem; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">
                退出登录
            </button>
        </div>
    </div>
`;

/**
 * 管理员页面脚本
 */
const ADMIN_SCRIPT = `
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

    // 这里应该加载实际的管理界面
    setTimeout(() => {
        document.querySelector('.container').innerHTML = \`
            <div class="logo">YOYO</div>
            <div class="subtitle">管理员控制台</div>
            <div style="text-align: left; margin: 2rem 0;">
                <h3 style="color: #333; margin-bottom: 1rem;">快速链接</h3>
                <div style="display: grid; gap: 0.5rem;">
                    <a href="https://your-admin-frontend.com" target="_blank" 
                       style="padding: 0.75rem; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; text-decoration: none; color: #495057; display: block;">
                        📊 流媒体管理界面
                    </a>
                    <a href="/api/admin/status" target="_blank"
                       style="padding: 0.75rem; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; text-decoration: none; color: #495057; display: block;">
                        🔧 系统状态 API
                    </a>
                </div>
            </div>
            <button onclick="logout()" style="width: 100%; padding: 0.75rem; background: #e74c3c; color: white; border: none; border-radius: 8px; cursor: pointer;">
                退出登录
            </button>
        \`;
    }, 2000);
`;

export const handlePages = {
  /**
   * 主页面 - 根据认证状态重定向
   */
  async dashboard(request, env, ctx) {
    return new Response(
      HTML_TEMPLATE
        .replace('{{TITLE}}', '首页')
        .replace('{{CONTENT}}', LOADING_CONTENT)
        .replace('{{SCRIPT}}', REDIRECT_SCRIPT),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );
  },

  /**
   * 登录页面
   */
  async login(request, env, ctx) {
    // 如果用户已经登录，重定向到主页
    const auth = await validateSession(request, env);
    if (auth) {
      return Response.redirect(new URL('/', request.url).toString(), 302);
    }

    return new Response(
      HTML_TEMPLATE
        .replace('{{TITLE}}', '登录')
        .replace('{{CONTENT}}', LOGIN_CONTENT)
        .replace('{{SCRIPT}}', LOGIN_SCRIPT),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
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
      return Response.redirect(new URL('/login', request.url).toString(), 302);
    }

    if (auth.user.role !== 'admin') {
      return new Response(
        HTML_TEMPLATE
          .replace('{{TITLE}}', '访问拒绝')
          .replace('{{CONTENT}}', '<div style="color: #e74c3c;">⚠️ 访问被拒绝：需要管理员权限</div>')
          .replace('{{SCRIPT}}', ''),
        {
          status: 403,
          headers: {
            'Content-Type': 'text/html; charset=utf-8'
          }
        }
      );
    }

    return new Response(
      HTML_TEMPLATE
        .replace('{{TITLE}}', '管理员控制台')
        .replace('{{CONTENT}}', ADMIN_CONTENT)
        .replace('{{SCRIPT}}', ADMIN_SCRIPT),
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
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

    // 简单的静态文件服务（在实际项目中应该使用CDN）
    if (pathname.endsWith('favicon.ico')) {
      // 返回一个简单的favicon
      const faviconSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="6" fill="#667eea"/>
          <text x="16" y="22" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="white">Y</text>
        </svg>
      `;

      return new Response(faviconSvg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400'
        }
      });
    }

    return new Response('Static file not found', { status: 404 });
  }
};
