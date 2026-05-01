module.exports = {
  apps: [
    {
      name: 'friendscape-next',
      cwd: '/var/www/friendscape-next',
      script: 'npm',
      args: 'run start:prod',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
