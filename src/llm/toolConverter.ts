// src/llm/toolConverters.ts
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

/** Anthropic → OpenAI: { name, description, input_schema } → function.parameters */
export function anthropicToolsToOpenAI(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      // Anthropic uses `input_schema`; OpenAI expects `parameters`
      parameters:
        (t as any).input_schema && typeof (t as any).input_schema === "object"
          ? (t as any).input_schema
          : { type: "object", properties: {}, additionalProperties: false },
    },
  }));
}
