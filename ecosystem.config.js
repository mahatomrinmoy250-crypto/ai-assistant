/**
 * PM2 cluster config for production.
 *
 * Architecture:
 *   - 2+ backend instances (WebSocket + HTTP)
 *   - Nginx ip_hash ensures each caller always hits the same instance
 *   - Redis stores cross-server call metadata
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --env production   # zero-downtime reload
 */
module.exports = {
  apps: [
    {
      name: 'voice-api',
      script: 'dist/index.js',
      cwd: './backend',
      instances: 2,           // start with 2; scale up on bigger VMs
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'development',
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        // SERVER_ID is set per-instance via a startup script
        // e.g. SERVER_ID=srv-1 pm2 start ...
      },

      // Graceful shutdown — let active calls finish (up to 30s)
      kill_timeout: 30000,
      listen_timeout: 10000,

      // Logs
      out_file: './logs/voice-api-out.log',
      error_file: './logs/voice-api-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: false,     // keep separate logs per instance
    },
  ],
};
