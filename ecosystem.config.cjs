module.exports = {
  apps: [
    {
      name: 'snmp-router',
      script: 'dist/index.js',
      max_memory_restart: '128M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

