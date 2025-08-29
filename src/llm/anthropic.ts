// src\llm\anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";
import type { ChatMessage, ToolStep } from "../types.js";
export type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";

type RunnerDeps = {
  anthropicKey: string;
  tools: Tool[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<any>;
};

function toArgsObj(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export async function runWithAnthropicLLM(
  messages: ChatMessage[],
  { anthropicKey, tools, callTool }: RunnerDeps
): Promise<{ text: string; steps: ToolStep[] }> {
  const client = new Anthropic({ apiKey: anthropicKey });

  const anthroMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const steps: ToolStep[] = [];

  let resp = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    messages: anthroMessages,
    tools,
  });

  // Tool-use loop (max 5)
  for (let i = 0; i < 5; i++) {
    const toolUses = resp.content.filter((c) => c.type === "tool_use");
    if (toolUses.length === 0) break;

    for (const tu of toolUses) {
      const args = toArgsObj((tu as any).input);
      const step: ToolStep = { name: (tu as any).name, args };
      const result = await callTool(step.name, args);
      step.result = result;
      steps.push(step);

      // Feed tool result back
      anthroMessages.push({
        role: "assistant",
        content: resp.content as any,
      });
      anthroMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: (tu as any).id,
            content: result.content,
          } as any,
        ] as any,
      });

      resp = await client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        messages: anthroMessages,
        tools,
      });
    }
  }

  const finalText = resp.content
    .filter((c) => c.type === "text")
    .map((t: any) => t.text)
    .join("\n");

  return { text: finalText, steps };
}
