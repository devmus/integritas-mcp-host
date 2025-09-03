// src/llm/toolConverter.ts
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages.mjs";

/** OpenAI tools schema (Chat Completions) */
type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
};

function anthropicToOpenAI(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters:
        (t as any).input_schema && typeof (t as any).input_schema === "object"
          ? (t as any).input_schema
          : { type: "object", properties: {}, additionalProperties: false },
    },
  }));
}

function anthropicToOpenRouter(tools: AnthropicTool[]): OpenAITool[] {
  return anthropicToOpenAI(tools);
}

function anthropicToAnthropic(tools: AnthropicTool[]): AnthropicTool[] {
  return tools;
}

export function convertTools(
  provider: "anthropic" | "openai" | "openrouter" | "mock",
  tools: AnthropicTool[]
): any[] {
  switch (provider) {
    case "anthropic":
      return anthropicToAnthropic(tools);
    case "openai":
      return anthropicToOpenAI(tools);
    case "openrouter":
      return anthropicToOpenRouter(tools);
    case "mock":
      return anthropicToAnthropic(tools);
    default:
      return [];
  }
}