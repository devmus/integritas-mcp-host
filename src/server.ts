// src\server.ts

import express from "express";
import { httpLogger, log } from "./logger.js";
import { chatHandler } from "./routes/chat.js";
import { config } from "./config.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import cors from "cors";

// ...
const app = express();

// configure cors
// Define your frontend's origin
const allowedOrigins = ["http://localhost:3000"];

const options = {
  origin: allowedOrigins,
};
// Use the CORS middleware
app.use(cors(options));

app.use(express.json({ limit: "1mb" }));
app.use(httpLogger);

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.post("/chat", chatHandler);

// make env a Record<string,string>
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined)
) as Record<string, string>;

const transport = new StdioClientTransport({
  command:
    "D:\\Programmering\\Minima\\Projects\\integritas-mcp-server\\.venv\\Scripts\\python.exe",
  args: ["-m", "integritas_mcp_server", "--stdio"], // <-- flag, not subcommand
  cwd: "D:\\Programmering\\Minima\\Projects\\integritas-mcp-server",
  env,
});

const mcpClient = new Client({
  name: "integritas-mcp-host",
  version: "0.1.0",
  requestTimeoutMs: 120_000, // give us breathing room while debugging
});

await mcpClient.connect(transport);
app.locals.mcp = mcpClient;

app.get("/_tools", async (_req, res) => {
  try {
    const mcp = app.locals.mcp as Client;
    const raw = await mcp.listTools(); // <-- use listTools()
    res.json(raw);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/_tool/health", async (_req, res) => {
  try {
    const mcp = app.locals.mcp as Client;
    const out = await mcp.callTool({
      // <-- object form
      name: "health",
      arguments: {}, // no args
    });
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(config.port, () => {
  log.info(
    { port: config.port, mode: config.mcpMode },
    "integritas-mcp-host listening"
  );
});
