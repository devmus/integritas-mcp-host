// // src/llm/openai.ts
// import OpenAI from "openai";
// import type { ChatMessage, ToolStep } from "../types.js";
// import { anthropicToolsToOpenAI } from "./toolConverter.js";

// type RunnerDeps = {
//   openaiKey: string;
//   model: string;
//   /** Anthropic-style tools (same ones you already build) */
//   tools: any[];
//   callTool: (name: string, args: Record<string, unknown>) => Promise<any>;
// };

// function toOAIMessages(messages: ChatMessage[]) {
//   // assumes messages[].role in {"user","assistant","system"}
//   return messages.map((m) => ({ role: m.role as any, content: m.content }));
// }

// export async function runWithOpenAILLM(
//   messages: ChatMessage[],
//   { openaiKey, model, tools, callTool }: RunnerDeps
// ): Promise<{ text: string; steps: ToolStep[] }> {
//   const client = new OpenAI({ apiKey: openaiKey });
//   const oaiTools = anthropicToolsToOpenAI(tools);

//   const baseMsgs = toOAIMessages(messages);

//   // 1) First call (let the model decide to call tools)
//   const first = await client.chat.completions.create({
//     model,
//     messages: baseMsgs,
//     tools: oaiTools,
//     tool_choice: "auto",
//   });

//   const choice = first.choices[0];
//   const toolCalls = choice.message.tool_calls ?? [];

//   const steps: ToolStep[] = [];

//   // If there are tool calls, execute them and send a follow-up
//   if (toolCalls.length > 0) {
//     // Execute all tools
//     const toolResultsAsMessages = await Promise.all(
//       toolCalls.map(async (tc) => {
//         const name = tc.function.name;
//         const args = safeParseJson(tc.function.arguments ?? "{}");
//         const result = await callTool(name, args);

//         steps.push({ tool: name, args, result });

//         return {
//           role: "tool" as const,
//           tool_call_id: tc.id,
//           content: JSON.stringify(result ?? null),
//         };
//       })
//     );

//     // 2) Second call with tool results to get the final answer
//     const followup = await client.chat.completions.create({
//       model,
//       messages: [
//         ...baseMsgs,
//         choice.message, // the assistant message that requested tools
//         ...toolResultsAsMessages,
//       ],
//     });

//     const finalText = followup.choices[0]?.message?.content ?? "";
//     return { text: finalText, steps };
//   }

//   // No tool calls, just return the text
//   const text = choice.message.content ?? "";
//   return { text, steps };
// }

// function safeParseJson(s: string) {
//   try {
//     return JSON.parse(s || "{}");
//   } catch {
//     return {};
//   }
// }

// src/llm/openai.ts
import OpenAI from "openai";
import type { ChatMessage, ToolStep } from "../types.js";
import { anthropicToolsToOpenAI } from "./toolConverter.js"; // <-- fix import name

type RunnerDeps = {
  openaiKey: string;
  model: string;
  tools: any[]; // Anthropic-style; we convert below
  callTool: (name: string, args: Record<string, unknown>) => Promise<any>;
};

function toOAIMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => ({ role: m.role as any, content: m.content }));
}

export async function runWithOpenAILLM(
  messages: ChatMessage[],
  { openaiKey, model, tools, callTool }: RunnerDeps
): Promise<{ text: string; steps: ToolStep[] }> {
  const client = new OpenAI({ apiKey: openaiKey });

  // Convert Anthropic-style tools to OpenAI tools
  const oaiTools = anthropicToolsToOpenAI(tools);

  const baseMsgs = toOAIMessages(messages);

  // 1) First call (model may request tool(s))
  const first = await client.chat.completions.create({
    model,
    messages: baseMsgs,
    tools: oaiTools,
    tool_choice: "auto",
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
