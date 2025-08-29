// import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
// import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages.mjs";
// import { config } from "../config.js";
// import { log } from "../logger.js";
// import { z } from "zod";

// type MCPTool = {
//   name: string;
//   description?: string;
//   inputSchema?: unknown;
// };

// export class MCPHostClient {
//   private client: Client | null = null;
//   private ready = false;

//   async connect(): Promise<void> {
//     if (this.ready && this.client) return;

//     const client = new Client({
//       name: "integritas-mcp-host",
//       version: "0.1.0",
//     });

//     if (config.mcpMode === "http") {
//       if (!config.mcpHttpUrl)
//         throw new Error("MCP_HTTP_URL is required for http mode");
//       const transport = new StreamableHTTPClientTransport(
//         new URL(config.mcpHttpUrl)
//       );
//       await client.connect(transport);
//       log.info(
//         { transport: "http", url: config.mcpHttpUrl },
//         "MCP client connected"
//       );
//     } else {
//       const transport = new StdioClientTransport({
//         command: config.mcpStdioCmd,
//         args: config.mcpStdioArgs,
//       });
//       await client.connect(transport);
//       log.info(
//         {
//           transport: "stdio",
//           cmd: config.mcpStdioCmd,
//           args: config.mcpStdioArgs,
//         },
//         "MCP client connected"
//       );
//     }

//     this.client = client;
//     this.ready = true;
//   }

//   async listTools(): Promise<MCPTool[]> {
//     if (!this.client) throw new Error("MCP not connected");
//     const res = await this.client.listTools();
//     return res.tools as unknown as MCPTool[];
//   }

//   /** Convert MCP tools to Anthropic tool spec */
//   async toolsForAnthropic(): Promise<AnthropicTool[]> {
//     const tools = await this.listTools();
//     return tools.map((t) => ({
//       name: t.name,
//       description: t.description ?? "",
//       // MCP TS SDK exposes Zod schemas; Anthropic expects a JSON schema-ish shape.
//       input_schema: (t as any).inputSchema ?? {
//         type: "object",
//         properties: {},
//       },
//     })) as AnthropicTool[];
//   }

//   async callTool(name: string, args?: Record<string, unknown>) {
//     if (!this.client) throw new Error("MCP not connected");
//     return this.client.callTool({ name, arguments: args });
//   }
// }
