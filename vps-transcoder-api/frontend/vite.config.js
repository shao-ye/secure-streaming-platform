import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
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
        '/login': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8787',
          changeOrigin: true,
          secure: false,
        },
        '/logout': {
          target: env.VITE_API_BASE_URL || 'http://localhost:8787',
          changeOrigin: true,
          secure: false,
        },
      }
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: mode === 'development',
      minify: mode === 'production' ? 'esbuild' : false,
      rollupOptions: {
        output: {
          manualChunks: {
            'element-plus': ['element-plus'],
            'hls': ['hls.js'],
            'vue-vendor': ['vue', 'vue-router', 'pinia'],
            'utils': ['axios', 'dayjs']
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
