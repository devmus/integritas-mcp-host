// import pino from "pino";
// import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
// import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
// import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// const log = pino({ level: process.env.LOG_LEVEL || "info" });

// // Small redactor + truncator to avoid huge logs / secrets
// function scrub(obj: any) {
//   try {
//     const s = JSON.stringify(obj, (_k, v) => {
//       if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "…";
//       return v;
//     });
//     const redacted = s
//       .replace(/x-api-key":"[^"]+"/gi, 'x-api-key":"[REDACTED]"')
//       .replace(/authorization":"[^"]+"/gi, 'authorization":"[REDACTED]"');
//     return JSON.parse(redacted);
//   } catch {
//     return obj;
//   }
// }

// export function createTappedClient(transport:
//   | StdioClientTransport
//   | SSEClientTransport
//   | StreamableHTTPClientTransport
// ) {
//   // Patch transport.write to log outgoing JSON-RPC
//   const anyT = transport as any;
//   const origWrite = anyT.write?.bind(transport);
//   if (origWrite) {
//     anyT.write = (msg: any) => {
//       log.debug({ jsonrpc_out: scrub(msg) }, "MCP -> server");
//       return origWrite(msg);
//     };
//   }

//   const client = new Client({
//     name: "integritas-mcp-host",
//     version: "0.1.0",
//     requestTimeoutMs: 120_000,
//   });

//   // All incoming JSON-RPC messages from Python
//   client.on("message", (msg: any) => {
//     log.debug({ jsonrpc_in: scrub(msg) }, "MCP <- server");
//   });

//   return { client };
// }
