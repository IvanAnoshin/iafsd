module.exports = {
  apps: [
    {
      name: 'friendscape-next',
      cwd: '/var/www/friendscape-next',
      script: 'npm',
      args: 'run start:prod',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },
      max_memory_restart: '768M',
      time: true,
    },
  ],
};
