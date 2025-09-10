// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "integritas-mcp-host",
      cwd: "/home/integritas-mcp-host",
      script: "dist/server.js", // <-- run the built file
      interpreter: "node", // use Node to run it
      node_args: "--enable-source-maps -r dotenv/config", // mimic your npm start and auto-load .env
      exec_mode: "fork",
      instances: 1,

      time: true,
      autorestart: true,
      min_uptime: "5s",
      restart_delay: 5000,
      max_restarts: 10,

      // optional, but helpful:
      // out_file: "/var/log/integritas-mcp-host/out.log",
      // error_file: "/var/log/integritas-mcp-host/err.log",
      // log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
