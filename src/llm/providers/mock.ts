// src/llm/providers/mock.ts
import type { ChatMessage, ToolStep } from "../../types.js";
import type { LLMAdapter, RunOptions } from "../adapter.js";

export class MockAdapter implements LLMAdapter {
  public readonly name = "mock";

  async run(
    messages: ChatMessage[],
    opts: RunOptions
  ): Promise<{ text: string; steps: ToolStep[] }> {
    const last =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const steps: ToolStep[] = [];

    // Super simple convention for tests:
    // If user says: TOOL name {"arg":"value"}  => call it directly.
    const m = last.match(/^TOOL\s+(\w+)\s+(.*)$/i);
    if (m) {
      const name = m[1];
      let args: unknown = {};
      try {
        args = JSON.parse(m[2]);
      } catch {}
      const obj =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const result = await opts.callTool(name, obj);
      steps.push({ name, args: obj, result });
      return { text: "ok", steps };
    }

    return { text: "mock response (no tool invoked)", steps };
  }
}
