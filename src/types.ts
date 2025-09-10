import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequestBody = {
  messages: ChatMessage[]; // minimal: last user message is enough
  userId?: string;
  toolArgs?: Record<string, Record<string, unknown>>; // <— add this
};

export type ToolStep = {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  tx_id?: string;
  uid?: string;
};

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Locals {
      mcp: Client;
    }
  }
}
export {};
