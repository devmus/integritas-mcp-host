// src/host/answerWithResources.ts
import { MCPResourceBridge } from "./mcpResourceBridge.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export type LlmFn = (messages: ChatMessage[]) => Promise<string>;

const SYSTEM_PROMPT = `
You answer questions about this MCP server's capabilities and the Integritas product.
Use the provided MCP resources as ground truth. Do not call tools unless the user
explicitly asks to perform an action.
`.trim();

export async function answerWithResources(
  bridge: MCPResourceBridge,
  userQuestion: string,
  llm: LlmFn,
  forceUris: string[] = [
    "integritas://docs/overview",
    "integritas://docs/tools",
  ]
) {
  const candidates = bridge.pickRelevantFor(userQuestion, 4);
  const uris = Array.from(new Set([...forceUris, ...candidates]));
  const docs = await bridge.readMany(uris);

  const context = docs
    .filter((d) => d.text)
    .map((d) => `### ${d.uri}\n${d.text}`)
    .join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: `MCP Resources:\n\n${context}` },
    { role: "user", content: userQuestion },
  ];

  const answer = await llm(messages);
  return { answer, usedUris: uris };
}
