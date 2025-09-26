#!/usr/bin/env node

/**
 * YOYO流媒体平台 - 前端功能验证脚本
 * 自动检查前端项目的各项功能和配置
 */

const fs = require('fs')
const path = require('path')
const { execSync, spawn } = require('child_process')
const http = require('http')

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
}

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  step: (msg) => console.log(`${colors.cyan}🔍${colors.reset} ${msg}`)
}

class FrontendVerifier {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..')
    this.results = {
      passed: 0,
      failed: 0,
      warnings: 0,
      details: []
    }
  }

  // 添加测试结果
  addResult(name, passed, message = '', isWarning = false) {
    if (passed) {
      this.results.passed++
      log.success(`${name}: ${message || '通过'}`)
    } else if (isWarning) {
      this.results.warnings++
      log.warning(`${name}: ${message || '警告'}`)
    } else {
      this.results.failed++
      log.error(`${name}: ${message || '失败'}`)
    }

    this.results.details.push({
      name,
      passed,
      message,
      isWarning
    })
  }

  // 检查Node.js版本
  checkNodeVersion() {
    log.step('检查Node.js版本...')
    try {
      const version = process.version
      const majorVersion = parseInt(version.slice(1).split('.')[0])

      if (majorVersion >= 16) {
        this.addResult('Node.js版本', true, `${version} (>= 16.0.0)`)
      } else {
        this.addResult('Node.js版本', false, `${version} (需要 >= 16.0.0)`)
      }
    } catch (error) {
      this.addResult('Node.js版本', false, error.message)
    }
  }

  // 检查项目文件结构
  checkProjectStructure() {
    log.step('检查项目文件结构...')

    const requiredFiles = [
      'package.json',
      'vite.config.js',
      'src/main.js',
      'src/App.vue',
      'src/router/index.js',
      'src/stores/user.js',
      'src/stores/streams.js',
      'src/utils/axios.js',
      'src/utils/config.js',
      'src/views/Login.vue',
      'src/views/Dashboard.vue',
      'src/views/AdminPanel.vue',
      'src/components/VideoPlayer.vue',
      'src/components/StreamList.vue',
      'src/components/StreamManager.vue',
      'src/components/SystemDiagnostics.vue'
    ]

    const requiredDirs = [
      'src',
      'src/components',
      'src/views',
      'src/stores',
      'src/utils',
      'src/router'
    ]

    // 检查目录
    requiredDirs.forEach(dir => {
      const fullPath = path.join(this.projectRoot, dir)
      if (fs.existsSync(fullPath)) {
        this.addResult(`目录 ${dir}`, true)
      } else {
        this.addResult(`目录 ${dir}`, false, '目录不存在')
      }
    })

    // 检查文件
    requiredFiles.forEach(file => {
      const fullPath = path.join(this.projectRoot, file)
      if (fs.existsSync(fullPath)) {
        this.addResult(`文件 ${file}`, true)
      } else {
        this.addResult(`文件 ${file}`, false, '文件不存在')
      }
    })
  }

  // 检查package.json配置
  checkPackageJson() {
    log.step('检查package.json配置...')

    try {
      const packagePath = path.join(this.projectRoot, 'package.json')
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

      // 检查必要的依赖
      const requiredDeps = {
        'vue': '^3.3.4',
        'vue-router': '^4.2.4',
        'pinia': '^2.1.6',
        'axios': '^1.5.0',
        'element-plus': '^2.3.9',
        'hls.js': '^1.4.10'
      }

      const requiredDevDeps = {
        '@vitejs/plugin-vue': '^4.3.4',
        'vite': '^4.4.9'
      }

      // 检查生产依赖
      Object.entries(requiredDeps).forEach(([dep, version]) => {
        if (packageJson.dependencies && packageJson.dependencies[dep]) {
          this.addResult(`依赖 ${dep}`, true, packageJson.dependencies[dep])
        } else {
          this.addResult(`依赖 ${dep}`, false, '依赖缺失')
        }
      })

      // 检查开发依赖
      Object.entries(requiredDevDeps).forEach(([dep, version]) => {
        if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
          this.addResult(`开发依赖 ${dep}`, true, packageJson.devDependencies[dep])
        } else {
          this.addResult(`开发依赖 ${dep}`, false, '开发依赖缺失')
        }
      })

      // 检查脚本
      const requiredScripts = ['dev', 'build', 'preview']
      requiredScripts.forEach(script => {
        if (packageJson.scripts && packageJson.scripts[script]) {
          this.addResult(`脚本 ${script}`, true, packageJson.scripts[script])
        } else {
          this.addResult(`脚本 ${script}`, false, '脚本缺失')
        }
      })

    } catch (error) {
      this.addResult('package.json解析', false, error.message)
    }
  }

  // 检查环境配置文件
  checkEnvFiles() {
    log.step('检查环境配置文件...')

    const envFiles = [
      '.env.development',
      '.env.production'
    ]

    envFiles.forEach(file => {
      const fullPath = path.join(this.projectRoot, file)
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8')
          const requiredVars = [
            'VITE_API_BASE_URL',
            'VITE_APP_TITLE',
            'VITE_HLS_PROXY_URL',
            'VITE_ENVIRONMENT'
          ]

          let missingVars = []
          requiredVars.forEach(varName => {
            if (!content.includes(varName)) {
              missingVars.push(varName)
            }
          })

          if (missingVars.length === 0) {
            this.addResult(`环境文件 ${file}`, true, '所有必要变量都存在')
          } else {
            this.addResult(`环境文件 ${file}`, false, `缺少变量: ${missingVars.join(', ')}`)
          }
        } catch (error) {
          this.addResult(`环境文件 ${file}`, false, `读取失败: ${error.message}`)
        }
      } else {
        this.addResult(`环境文件 ${file}`, false, '文件不存在')
      }
    })
  }

  // 检查Vite配置
  checkViteConfig() {
    log.step('检查Vite配置...')

    try {
      const configPath = path.join(this.projectRoot, 'vite.config.js')
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8')

        // 检查关键配置
        const checks = [
          { name: 'Vue插件', pattern: /@vitejs\/plugin-vue/ },
          { name: 'Element Plus自动导入', pattern: /ElementPlusResolver/ },
          { name: 'API代理配置', pattern: /['"]\/api['"]/ },
          { name: 'HLS代理配置', pattern: /['"]\/hls['"]/ },
          { name: '环境变量加载', pattern: /loadEnv/ }
        ]

        checks.forEach(check => {
          if (check.pattern.test(content)) {
            this.addResult(`Vite配置 - ${check.name}`, true)
          } else {
            this.addResult(`Vite配置 - ${check.name}`, false, '配置缺失')
          }
        })
      } else {
        this.addResult('Vite配置文件', false, 'vite.config.js不存在')
      }
    } catch (error) {
      this.addResult('Vite配置检查', false, error.message)
    }
  }

  // 检查Vue组件语法
  checkVueComponents() {
    log.step('检查Vue组件语法...')

    const componentFiles = [
      'src/App.vue',
      'src/views/Login.vue',
      'src/views/Dashboard.vue',
      'src/views/AdminPanel.vue',
      'src/components/VideoPlayer.vue',
      'src/components/StreamList.vue'
    ]

    componentFiles.forEach(file => {
      const fullPath = path.join(this.projectRoot, file)
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8')

          // 基本语法检查
          const hasTemplate = content.includes('<template>')
          const hasScript = content.includes('<script')
          const hasStyle = content.includes('<style')

          if (hasTemplate && hasScript) {
            this.addResult(`组件 ${file}`, true, '基本结构正确')
          } else {
            this.addResult(`组件 ${file}`, false, '缺少必要的template或script标签')
          }
        } catch (error) {
          this.addResult(`组件 ${file}`, false, `读取失败: ${error.message}`)
        }
      }
    })
  }

  // 检查依赖安装
  checkDependencies() {
    log.step('检查依赖安装...')

    try {
      const nodeModulesPath = path.join(this.projectRoot, 'node_modules')
      if (fs.existsSync(nodeModulesPath)) {
        this.addResult('node_modules目录', true, '依赖已安装')

        // 检查关键依赖是否存在
        const keyDeps = ['vue', 'element-plus', 'hls.js', 'axios', 'pinia', 'vue-router']
        keyDeps.forEach(dep => {
          const depPath = path.join(nodeModulesPath, dep)
          if (fs.existsSync(depPath)) {
            this.addResult(`已安装 ${dep}`, true)
          } else {
            this.addResult(`已安装 ${dep}`, false, '依赖未安装')
          }
        })
      } else {
        this.addResult('依赖安装', false, 'node_modules目录不存在，请运行 npm install')
      }
    } catch (error) {
      this.addResult('依赖检查', false, error.message)
    }
  }

  // 测试构建
  async testBuild() {
    log.step('测试项目构建...')

    try {
      // 清理之前的构建
      const distPath = path.join(this.projectRoot, 'dist')
      if (fs.existsSync(distPath)) {
        fs.rmSync(distPath, { recursive: true, force: true })
      }

      // 执行构建
      execSync('npm run build', {
        cwd: this.projectRoot,
        stdio: 'pipe',
        timeout: 60000 // 60秒超时
      })

      // 检查构建产物
      if (fs.existsSync(distPath)) {
        const files = fs.readdirSync(distPath)
        if (files.includes('index.html')) {
          this.addResult('项目构建', true, '构建成功，产物正常')
        } else {
          this.addResult('项目构建', false, '构建完成但缺少index.html')
        }
      } else {
        this.addResult('项目构建', false, '构建完成但没有生成dist目录')
      }
    } catch (error) {
      this.addResult('项目构建', false, `构建失败: ${error.message}`)
    }
  }

  // 测试开发服务器
  async testDevServer() {
    log.step('测试开发服务器...')

    return new Promise((resolve) => {
      let serverProcess = null
      let timeout = null

      try {
        // 检查npm是否可用
        try {
          execSync('npm --version', { stdio: 'pipe' })
        } catch (error) {
          this.addResult('开发服务器', false, 'npm命令不可用，请检查Node.js和npm安装')
          resolve()
          return
        }

        // 启动开发服务器
        serverProcess = spawn('npm', ['run', 'dev'], {
          cwd: this.projectRoot,
          stdio: 'pipe',
          shell: true // 在Windows上使用shell
        })

        let serverStarted = false

        // 监听输出
        serverProcess.stdout.on('data', (data) => {
          const output = data.toString()
          console.log('Dev server output:', output) // 调试输出
          if ((output.includes('Local:') || output.includes('localhost')) && (output.includes('8080') || output.includes('5173'))) {
            serverStarted = true

            // 测试HTTP请求
            setTimeout(() => {
              const port = output.includes('8080') ? 8080 : 5173
              const req = http.get(`http://localhost:${port}`, (res) => {
                if (res.statusCode === 200) {
                  this.addResult('开发服务器', true, '服务器启动成功，页面可访问')
                } else {
                  this.addResult('开发服务器', false, `服务器响应异常: ${res.statusCode}`)
                }
                cleanup()
              })

              req.on('error', (error) => {
                this.addResult('开发服务器', false, `连接失败: ${error.message}`)
                cleanup()
              })

              req.setTimeout(5000, () => {
                this.addResult('开发服务器', false, '连接超时')
                cleanup()
              })
            }, 3000) // 增加等待时间
          }
        })

        serverProcess.stderr.on('data', (data) => {
          const error = data.toString()
          console.log('Dev server error:', error) // 调试输出
          if (error.includes('Error') && !error.includes('warning')) {
            this.addResult('开发服务器', false, `启动错误: ${error}`)
            cleanup()
          }
        })

        serverProcess.on('error', (error) => {
          this.addResult('开发服务器', false, `进程启动失败: ${error.message}`)
          cleanup()
        })

        // 设置超时
        timeout = setTimeout(() => {
          if (!serverStarted) {
            this.addResult('开发服务器', false, '启动超时（20秒）')
            cleanup()
          }
        }, 20000) // 增加超时时间

        const cleanup = () => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGTERM')
            // Windows上可能需要强制终止
            setTimeout(() => {
              if (!serverProcess.killed) {
                serverProcess.kill('SIGKILL')
              }
            }, 2000)
            serverProcess = null
          }
          if (timeout) {
            clearTimeout(timeout)
            timeout = null
          }
          resolve()
        }

      } catch (error) {
        this.addResult('开发服务器', false, `启动失败: ${error.message}`)
        resolve()
      }
    })
  }

  // 生成报告
  generateReport() {
    console.log('\n' + '='.repeat(60))
    console.log(`${colors.magenta}📊 YOYO流媒体平台前端验证报告${colors.reset}`)
    console.log('='.repeat(60))

    console.log(`\n${colors.green}✅ 通过: ${this.results.passed}${colors.reset}`)
    console.log(`${colors.red}❌ 失败: ${this.results.failed}${colors.reset}`)
    console.log(`${colors.yellow}⚠ 警告: ${this.results.warnings}${colors.reset}`)

    const total = this.results.passed + this.results.failed + this.results.warnings
    const successRate = total > 0 ? ((this.results.passed / total) * 100).toFixed(1) : 0

    console.log(`\n📈 成功率: ${successRate}%`)

    if (this.results.failed > 0) {
      console.log(`\n${colors.red}❌ 失败项目:${colors.reset}`)
      this.results.details
        .filter(item => !item.passed && !item.isWarning)
        .forEach(item => {
          console.log(`  • ${item.name}: ${item.message}`)
        })
    }

    if (this.results.warnings > 0) {
      console.log(`\n${colors.yellow}⚠ 警告项目:${colors.reset}`)
      this.results.details
        .filter(item => item.isWarning)
        .forEach(item => {
          console.log(`  • ${item.name}: ${item.message}`)
        })
    }

    console.log('\n' + '='.repeat(60))

    if (this.results.failed === 0) {
      console.log(`${colors.green}🎉 恭喜！前端项目验证全部通过！${colors.reset}`)
      console.log(`${colors.cyan}💡 建议下一步：启动后端服务进行集成测试${colors.reset}`)
    } else {
      console.log(`${colors.red}🔧 请修复上述问题后重新验证${colors.reset}`)
    }

    console.log('='.repeat(60) + '\n')
  }

  // 运行所有验证
  async runAll() {
    console.log(`${colors.magenta}🚀 开始YOYO流媒体平台前端功能验证...${colors.reset}\n`)

    // 基础环境检查
    this.checkNodeVersion()
    this.checkProjectStructure()
    this.checkPackageJson()
    this.checkEnvFiles()
    this.checkViteConfig()
    this.checkDependencies()
    this.checkVueComponents()

    // 构建测试
    await this.testBuild()

    // 开发服务器测试
    await this.testDevServer()

    // 生成报告
    this.generateReport()

    // 返回结果
    return this.results.failed === 0
  }
}

// 主函数
async function main() {
  const verifier = new FrontendVerifier()
  const success = await verifier.runAll()
  process.exit(success ? 0 : 1)
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(error => {
    console.error(`${colors.red}❌ 验证过程中发生错误:${colors.reset}`, error)
    process.exit(1)
  })
}

module.exports = FrontendVerifier
