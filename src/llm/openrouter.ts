// src/llm/openrouter.ts
import OpenAI from "openai";
import type { ChatMessage, ToolStep } from "../types.js";

type RunnerDeps = {
  openRouterKey: string;
  model: string;
  tools: any[]; // Anthropic-style; we convert below
  callTool: (name: string, args: Record<string, unknown>) => Promise<any>;
};

function toOAIMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => ({ role: m.role as any, content: m.content }));
}

export async function runWithOpenRouterLLM(
  messages: ChatMessage[],
  { openRouterKey, model, tools, callTool }: RunnerDeps
): Promise<{ text: string; steps: ToolStep[] }> {
  const client = new OpenAI({
    apiKey: openRouterKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const oaiTools = tools;

  const baseMsgs = toOAIMessages(messages);

  // 1) First call (model may request tool(s))
  const first = await client.chat.completions.create({
    model,
    messages: baseMsgs,
    tools: oaiTools,
    tool_choice: "auto",
    max_tokens: 4096,
  });

  const choice = first.choices[0];
  const toolCalls = choice.message.tool_calls ?? [];
  const steps: ToolStep[] = [];

  if (toolCalls.length > 0) {
    // Execute all tools (narrow to function calls)
    const toolResultsAsMessages = await Promise.all(
      toolCalls.map(async (tc) => {
        if (tc.type !== "function" || !tc.function) {
          // Skip non-function custom tool calls defensively
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify({ skipped: true }),
          };
        }

        const name = tc.function.name;
        const args = safeParseJson(tc.function.arguments ?? "{}");
        const result = await callTool(name, args);

        // If your ToolStep type is { name, args, result }, push that.
        // If it's different, adjust the field names or cast.
        steps.push({ name, args, result } as ToolStep);

        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify(result ?? null),
        };
      })
    );

    // 2) Send tool results back to get the final answer
    const followup = await client.chat.completions.create({
      model,
      messages: [
        ...baseMsgs,
        choice.message, // assistant msg that requested the tools
        ...toolResultsAsMessages,
      ],
    });

    const finalText = followup.choices[0]?.message?.content ?? "";
    return { text: finalText, steps };
  }

  // No tool calls: return text directly
  const text = choice.message.content ?? "";
  return { text, steps };
}

function safeParseJson(s: string) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
