// src/llm/providers/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import type { LLMAdapter, RunOptions } from "../adapter.js";
import type { ChatMessage, ToolStep } from "../../types.js";
// Types from Anthropic's messages module (only used for compile-time hints)
import type { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/messages.mjs";

export class AnthropicAdapter implements LLMAdapter {
  constructor(
    private apiKey: string,
    private defaultModel = "claude-3-5-sonnet-20240620"
  ) {}

  private toAnthropicMessages(
    msgs: ChatMessage[]
  ): Array<{ role: "user" | "assistant"; content: string | any[] }> {
    return msgs.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content, // string right now; we'll later also append block arrays
    }));
  }

  // Anthropic requires input_schema with a top-level { type: 'object' }.
  // We coerce any incoming schema into a minimal-compliant InputSchema.
  private toAnthropicInputSchema(raw: unknown): AnthropicTool["input_schema"] {
    const s = (raw && typeof raw === "object" ? (raw as any) : {}) || {};
    const out: AnthropicTool["input_schema"] = {
      type: "object",
    };
    if (s && typeof s === "object") {
      if (s.properties && typeof s.properties === "object") {
        (out as any).properties = s.properties;
      } else {
        (out as any).properties = {};
      }
      if (Array.isArray(s.required)) {
        (out as any).required = s.required;
      }
      if (typeof s.additionalProperties !== "undefined") {
        (out as any).additionalProperties = !!s.additionalProperties;
      } else {
        (out as any).additionalProperties = false;
      }
    } else {
      (out as any).properties = {};
      (out as any).additionalProperties = false;
    }
    return out;
  }

  // Simple type guards so TS lets us access properties safely
  private isTextBlock(b: any): b is { type: "text"; text: string } {
    return b && b.type === "text" && typeof b.text === "string";
  }

  private isToolUseBlock(
    b: any
  ): b is { type: "tool_use"; id: string; name: string; input: any } {
    return (
      b &&
      b.type === "tool_use" &&
      typeof b.name === "string" &&
      typeof b.id === "string"
    );
  }

  async run(messages: ChatMessage[], opts: RunOptions) {
    const client = new Anthropic({ apiKey: this.apiKey });
    const model = opts.model || this.defaultModel;
    const steps: ToolStep[] = [];
    const maxRounds = Math.max(1, opts.maxToolRounds ?? 2);

    // Conform tools to Anthropic's exact Tool type
    const tools: AnthropicTool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: this.toAnthropicInputSchema(t.input_schema),
    }));

    let convo = this.toAnthropicMessages(messages);

    for (let round = 0; round < maxRounds; round++) {
      const resp = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: convo,
        tools,
        system: opts.systemPrompt, // system prompt goes here for Anthropic
      });

      const blocks = resp.content as any[];

      // Check for tool calls
      const toolUses = blocks.filter(this.isToolUseBlock);
      if (!toolUses.length) {
        // No tools: get final text (if present)
        const textBlock = blocks.find(this.isTextBlock);
        const finalText = textBlock?.text ?? "";
        return { text: finalText, steps };
      }

      // Execute tools and respond with tool_result blocks
      const toolResultsMsgs: Array<{
        role: "user";
        content: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
        }>;
      }> = [];

      for (const tu of toolUses) {
        const name = tu.name;
        const args =
          tu.input && typeof tu.input === "object"
            ? (tu.input as Record<string, unknown>)
            : {};
        const result = await opts.callTool(name, args);
        steps.push({ name, args, result } as ToolStep);

        // IMPORTANT: tool results must be sent as role='user' with type='tool_result'
        toolResultsMsgs.push({
          role: "user" as const,
          content: [
            {
              type: "tool_result",
              tool_use_id: tu.id,
              // You can also pass an array of {type:'text', text: '...'} blocks.
              content: JSON.stringify(result ?? null),
            },
          ],
        });
      }

      // Continue the conversation with the tool results
      convo = [...convo, ...toolResultsMsgs];
    }

    return {
      text: "Tool loop limit reached. Please try again or refine the request.",
      steps,
    };
  }
}
