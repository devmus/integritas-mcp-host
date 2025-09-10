// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "integritas-mcp-host",
      cwd: "/home/integritas-mcp-host",
      script: "node",
      args: "dist/server.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      time: true,
      autorestart: true,
      min_uptime: "5s",
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
};
