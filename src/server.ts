// src\server.ts

import express from "express";
import cors from "cors";
import "dotenv/config";
import { httpLogger, log } from "./logger/logger.js";
import { captureResponseBody } from "./middleware/captureResponseBody.js";
import { chatHandler } from "./routes/chat.js";
import { config } from "./config.js";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const app = express();

// CORS
const allowedOrigins = config.allowedCors.split(",").map((s) => s.trim());
app.use(cors({ origin: allowedOrigins }));

// Replace your JSON parser line with this:
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      // keep a small sample for logs; do NOT mutate the stream
      const max = 4096;
      (req as any).raw = {
        bodySample:
          buf.length > max
            ? buf.subarray(0, max).toString("utf8") + "…"
            : buf.toString("utf8"),
      };
    },
  })
);

// ---- Response body capture must be BEFORE httpLogger ----
app.use(captureResponseBody(4096));

// Pino HTTP logging
app.use(httpLogger);

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.post("/chat", chatHandler);

// STDIO env (if needed)
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined)
) as Record<string, string>;

let transport:
  | StdioClientTransport
  | SSEClientTransport
  | StreamableHTTPClientTransport;

const mcpCwd = config.mcpCwd;

if (config.mcpMode === "http") {
  if (!config.mcpHttpUrl)
    throw new Error("MCP_HTTP_URL is required when MCP_MODE=http");
  transport = new StreamableHTTPClientTransport(new URL(config.mcpHttpUrl));
} else if (config.mcpMode === "sse") {
  if (!config.mcpSseUrl)
    throw new Error("MCP_SSE_URL is required when MCP_MODE=sse");
  transport = new SSEClientTransport(new URL(config.mcpSseUrl));
} else {
  // STDIO
  transport = new StdioClientTransport({
    command: config.mcpStdioCmd,
    args: config.mcpStdioArgs.length
      ? config.mcpStdioArgs
      : ["-m", "integritas_mcp_server", "--stdio"],
    cwd: mcpCwd,
    env,
  });
}

const mcpClient = new Client({
  name: "integritas-mcp-host",
  version: "0.1.0",
  requestTimeoutMs: 240_000,
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

// graceful shutdown
const close = async () => {
  try {
    await mcpClient.close();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

app.listen(config.port, () => {
  log.info(
    { port: config.port, mode: config.mcpMode },
    "integritas-mcp-host listening"
  );
});
