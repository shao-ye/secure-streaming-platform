module.exports = {
  apps: [
    {
      name: 'vps-transcoder-api',
      script: 'src/app.js',
      instances: 1, // 单实例运行，避免进程管理冲突
      exec_mode: 'cluster',

      // 环境配置
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },

      // 自动重启配置
      watch: false, // 生产环境不监听文件变化
      ignore_watch: [
        'node_modules',
        'logs',
        '/var/www/hls'
      ],

      // 重启策略
      restart_delay: 1000, // 重启延迟1秒
      max_restarts: 10, // 最大重启次数
      min_uptime: '10s', // 最小运行时间

      // 日志配置
      log_type: 'json',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: '/var/log/transcoder/pm2-out.log',
      error_file: '/var/log/transcoder/pm2-error.log',
      log_file: '/var/log/transcoder/pm2-combined.log',

      // 日志轮转
      max_size: '10M',
      retain: 5, // 保留5个日志文件

      // 内存和CPU限制
      max_memory_restart: '500M', // 内存超过500M重启

      // 健康检查
      health_check_grace_period: 3000,
      health_check_fatal_exceptions: true,

      // 进程配置
      kill_timeout: 5000, // 5秒杀死超时
      listen_timeout: 3000, // 3秒监听超时

      // 高级配置
      node_args: [
        '--max-old-space-size=256', // 限制老生代内存为256MB
        '--optimize-for-size' // 优化内存使用
      ],

      // 合并日志
      merge_logs: true,

      // 时间戳
      time: true,

      // 自动保存进程状态
      autorestart: true,

      // cron重启（可选，每天凌晨3点重启）
      // cron_restart: '0 3 * * *'
    },
    // 新增Cloudflare Tunnel服务
    {
      name: 'cloudflare-tunnel',
      script: 'cloudflared',
      args: 'tunnel --config /root/.cloudflared/config.yml run yoyo-streaming',
      cwd: '/root',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/var/log/transcoder/tunnel-error.log',
      out_file: '/var/log/transcoder/tunnel-out.log',
      log_file: '/var/log/transcoder/tunnel-combined.log',
      
      // 重启策略
      restart_delay: 5000, // 隧道重启延迟5秒
      kill_timeout: 10000, // 10秒杀死超时
      
      // 日志配置
      log_type: 'json',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '10M',
      retain: 3,
      merge_logs: true,
      time: true
    }
  ],

  // 部署配置（可选）
  deploy: {
    production: {
      user: 'root',
      host: 'YOUR_SERVER_IP',
      ref: 'origin/main',
      repo: 'YOUR_GIT_REPO',
      path: '/opt/vps-transcoder-api',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'mkdir -p /opt/vps-transcoder-api /var/www/hls /var/log/transcoder'
    }
  }
};
