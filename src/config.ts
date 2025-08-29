import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT ?? "8788", 10),
  env: process.env.NODE_ENV ?? "development",

  // MCP connectivity
  mcpMode: (process.env.MCP_MODE ?? "stdio") as "stdio" | "http",
  mcpStdioCmd: process.env.MCP_STDIO_CMD ?? "python",
  mcpStdioArgs: (process.env.MCP_STDIO_ARGS ?? "").split(/\s+/).filter(Boolean),
  mcpHttpUrl: process.env.MCP_HTTP_URL,

  // LLM provider
  llmProvider: (process.env.LLM_PROVIDER ?? "anthropic") as
    | "anthropic"
    | "mock",
  anthropicKey: process.env.ANTHROPIC_API_KEY,
};
