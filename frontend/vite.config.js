import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig(({ command, mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
        imports: ['vue', 'vue-router', 'pinia'],
        dts: true,
      }),
      Components({
        resolvers: [ElementPlusResolver()],
        dts: true,
      }),
      /**
       * PWA 配置:让 Chrome(Android)提供「安装此应用」入口(WebAPK)
       *
       * 直播平台缓存策略的关键约束:
       * 1. /hls/ 的 m3u8/ts 分片是实时内容,绝对不能被 Service Worker 缓存,
       *    否则会拿到过期分片导致播放卡死 → NetworkOnly
       * 2. /api/ 是认证/业务请求,同样不缓存 → NetworkOnly
       * 3. version.json 用于版本探测,必须每次拉最新 → NetworkOnly
       * 4. 只预缓存构建产物(js/css/html/图标),SPA 导航回退到 index.html
       */
      VitePWA({
        registerType: 'autoUpdate', // 有新版本时自动更新 Service Worker
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'YOYO流媒体平台',
          short_name: 'YOYO',
          description: 'YOYO 幼儿园直播/录制流媒体平台',
          lang: 'zh-CN',
          theme_color: '#409eff',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            // maskable 图标:安卓自适应图标(圆形/圆角方形)裁剪时不丢失内容
            { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // 只预缓存静态构建产物,不包含 json(version.json 需实时获取)
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // SPA 路由回退,但 API 与 HLS 路径不走回退
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/hls\//],
          // 运行时请求策略:API、HLS、版本探测一律直连网络,不缓存
          runtimeCaching: [
            {
              urlPattern: /\/(api|hls)\//,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/version\.json/,
              handler: 'NetworkOnly',
            },
          ],
          // 预缓存单文件上限 3MB(element-plus 分包后足够)
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // 新 SW 安装后立即接管页面,配合 autoUpdate 实现无感更新
          skipWaiting: true,
          clientsClaim: true,
          // 清理旧版本 workbox 留下的过期缓存
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    define: {
      // 将环境变量注入到应用中
      __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION || '1.0.0'),
      __APP_TITLE__: JSON.stringify(env.VITE_APP_TITLE || 'YOYO流媒体平台'),
    },
    server: {
      port: 8080,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8787',
          changeOrigin: true,
          secure: false,
          configure: (proxy, options) => {
            proxy.on('error', (err, req, res) => {
              console.log('Proxy error:', err)
            })
            proxy.on('proxyReq', (proxyReq, req, res) => {
              console.log('Sending Request to the Target:', req.method, req.url)
            })
            proxy.on('proxyRes', (proxyRes, req, res) => {
              console.log('Received Response from the Target:', proxyRes.statusCode, req.url)
            })
          },
        },
        '/hls': {
          target: env.VITE_HLS_PROXY_URL || 'http://localhost:8787',
          changeOrigin: true,
          secure: false,
        },
        // 移除 /login 和 /logout 代理配置，避免与前端路由冲突
        // 这些路径应该由 Vue Router 处理，而不是代理到后端
      }
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: mode === 'development',
      minify: mode === 'production' ? 'esbuild' : false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // 更安全的代码分割策略
            if (id.includes('node_modules')) {
              if (id.includes('element-plus')) {
                return 'element-plus'
              }
              if (id.includes('hls.js')) {
                return 'hls'
              }
              if (id.includes('vue') || id.includes('pinia') || id.includes('@vue')) {
                return 'vue-vendor'
              }
              if (id.includes('axios') || id.includes('dayjs')) {
                return 'utils'
              }
              return 'vendor'
            }
          }
        }
      },
      chunkSizeWarningLimit: 1000,
    },
    optimizeDeps: {
      include: ['element-plus', 'hls.js', 'vue', 'vue-router', 'pinia', 'axios', 'dayjs']
    }
  }
})
