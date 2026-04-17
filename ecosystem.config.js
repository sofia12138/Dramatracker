/**
 * PM2 进程配置
 * 使用方式：
 *   pm2 start ecosystem.config.js          # 启动
 *   pm2 restart dramatracker               # 重启
 *   pm2 stop dramatracker                  # 停止
 *   pm2 logs dramatracker                  # 查看日志
 *   pm2 save && pm2 startup                # 设置开机自启
 */
module.exports = {
  apps: [
    {
      name: 'dramatracker',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/opt/dramatracker',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // 内存超过 512M 自动重启
      max_memory_restart: '512M',
      // 崩溃自动重启
      autorestart: true,
      restart_delay: 3000,
      // 日志
      error_file: '/var/log/pm2/dramatracker-error.log',
      out_file: '/var/log/pm2/dramatracker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
