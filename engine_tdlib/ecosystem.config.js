module.exports = {
  apps: [
    {
      name: '神探-登录',
      script: '/home/hjroot/shentanbot/engine/venv/bin/python3',
      args: '/home/hjroot/shentanbot/engine_tdlib/login_service.py',
      cwd: '/home/hjroot/shentanbot/engine_tdlib',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        LOGIN_SERVICE_PORT: 7002,
        PYTHONUNBUFFERED: "1"
      }
    },
    {
      name: '神探-引擎-主控',
      script: '/home/hjroot/shentanbot/engine/venv/bin/python3',
      args: '/home/hjroot/shentanbot/engine_tdlib/main.py --master',
      cwd: '/home/hjroot/shentanbot/engine_tdlib',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
