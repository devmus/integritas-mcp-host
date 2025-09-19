// src/config.ts
import dotenv from "dotenv";
dotenv.config();

export const config = {
  logLevel: process.env.LOG_LEVEL ?? "info",
  port: parseInt(process.env.PORT ?? "8788", 10),
  env: process.env.NODE_ENV ?? "development",
  allowedCors:
    (process.env.CORS_ORIGINS ?? "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3011",
    "http://localhost:3002"),

  // Pick one: "stdio" | "sse" | "http"
  mcpMode: (process.env.MCP_MODE ?? "stdio") as "stdio" | "sse" | "http",

  // STDIO
  mcpStdioCmd: process.env.MCP_STDIO_CMD ?? "python",
  mcpStdioArgs: (process.env.MCP_STDIO_ARGS ?? "").split(/\s+/).filter(Boolean),
  mcpCwd: process.env.MCP_PY_CWD || "/home/integritas-mcp-server",

  // SSE (point to your /sse endpoint)
  mcpSseUrl: process.env.MCP_SSE_URL, // e.g. http://127.0.0.1:8787/sse

  // Streamable HTTP (point to your /mcp endpoint)
  mcpHttpUrl: process.env.MCP_HTTP_URL, // e.g. http://127.0.0.1:8787/mcp

  // LLM provider
  llmProvider: (process.env.LLM_PROVIDER ?? "anthropic") as
    | "anthropic"
    | "openai"
    | "openrouter"
    | "mock",

  anthropicKey: process.env.ANTHROPIC_API_KEY,
  openaiKey: process.env.OPENAI_API_KEY,
  openRouterKey: process.env.OPENROUTER_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1", // pick default
  openRouterModel: process.env.OPENROUTER_MODEL ?? "gpt-4.1", // pick default
};
