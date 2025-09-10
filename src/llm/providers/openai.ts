// src/llm/providers/openai.ts
import OpenAI from "openai";
import type { LLMAdapter, RunOptions, ToolCatalogItem } from "../adapter.js";
import type { ChatMessage, ToolStep } from "../../types.js";

function toOAIChat(msgs: ChatMessage[], systemPrompt?: string) {
  const out: any[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });
  for (const m of msgs) out.push({ role: m.role as any, content: m.content });
  return out;
}

function toOpenAITools(tools: ToolCatalogItem[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema ?? {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  }));
}

export class OpenAIAdapter implements LLMAdapter {
  constructor(private apiKey: string, private defaultModel = "gpt-4.1") {}

  async run(messages: ChatMessage[], opts: RunOptions) {
    const client = new OpenAI({ apiKey: this.apiKey });
    const model = opts.model || this.defaultModel;
    const steps: ToolStep[] = [];
    const maxRounds = Math.max(1, opts.maxToolRounds ?? 2);

    const tools = toOpenAITools(opts.tools);
    let convo = toOAIChat(messages, opts.systemPrompt);

    let lastAssistantMsg: any | undefined;

    for (let round = 0; round < maxRounds; round++) {
      // const first = await client.chat.completions.create({
      //   model,
      //   messages: convo,
      //   tools,
      //   tool_choice: "auto",
      // });

      const first = await client.chat.completions.create({
        model,
        messages: convo,
        tools,
        tool_choice: "auto",
        ...(opts.responseAsJson
          ? { response_format: { type: "json_object" } }
          : {}),
      });

      const choice = first.choices[0];
      lastAssistantMsg = choice.message;
      const toolCalls = lastAssistantMsg?.tool_calls ?? [];

      if (!toolCalls.length) {
        const finalText = lastAssistantMsg?.content ?? "";
        return { text: finalText, steps };
      }

      const toolResultsMsgs = [];
      for (const tc of toolCalls) {
        if (tc.type !== "function" || !tc.function) {
          toolResultsMsgs.push({
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify({ skipped: true }),
          });
          continue;
        }

        const name = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {}
        const result = await opts.callTool(name, args);
        steps.push({ name, args, result } as ToolStep);

        toolResultsMsgs.push({
          role: "tool" as const,
          tool_call_id: tc.id,
          content: JSON.stringify(result ?? null),
        });
      }

      // Follow-up to let the model integrate tool results
      // const follow = await client.chat.completions.create({
      //   model,
      //   messages: [...convo, lastAssistantMsg, ...toolResultsMsgs],
      // });
      const follow = await client.chat.completions.create({
        model,
        messages: [...convo, lastAssistantMsg, ...toolResultsMsgs],
        ...(opts.responseAsJson
          ? { response_format: { type: "json_object" } }
          : {}),
      });

      const followChoice = follow.choices[0];
      const followTools = followChoice.message.tool_calls ?? [];

      if (!followTools.length) {
        const finalText = followChoice.message?.content ?? "";
        return { text: finalText, steps };
      }

      // If it still wants more tools, continue loop:
      convo = [...convo, lastAssistantMsg, ...toolResultsMsgs];
    }

    return {
      text: "Tool loop limit reached. Please try again or refine the request.",
      steps,
    };
  }
}
