module.exports = {
  apps: [
    {
      name: 'friendscape-next-staging',
      cwd: '/var/www/friendscape-next-staging',
      script: 'npm',
      args: 'run start:prod',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        APP_RELEASE_CHANNEL: 'staging',
        PORT: 3001,
        HOST: '0.0.0.0',
      },
      max_memory_restart: '768M',
      time: true,
    },
  ],
};
