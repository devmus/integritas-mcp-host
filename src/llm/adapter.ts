// src/llm/adapter.ts
import type { ChatMessage, ToolStep } from "../types.js";

export type ToolCatalogItem = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

export type RunOptions = {
  model?: string;
  tools: ToolCatalogItem[];
  systemPrompt?: string;
  maxToolRounds?: number;
  callTool: (name: string, args: Record<string, unknown>) => Promise<any>;
  responseAsJson?: boolean; // NEW
};

export interface LLMAdapter {
  run(
    messages: ChatMessage[],
    opts: RunOptions
  ): Promise<{ text: string; steps: ToolStep[] }>;
}
