// src\routes\chat.ts

import type { Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { pluckIdsFromContent } from "../mcp/toolMap.js";
import { runWithAnthropicLLM } from "../llm/anthropic.js";
import { runWithMockLLM } from "../llm/mock.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import type { ChatRequestBody, ToolStep } from "../types.js";
import type { Tool } from "../llm/anthropic.js";

/** Convert MCP tool metadata to Anthropic's tool schema */
async function toolsForAnthropic(_mcpClient: any): Promise<Tool[]> {
  // TEMP: bypass reflection while we debug ListTools timeouts
  const tools = [
    {
      name: "health",
      description: "Liveness/readiness check",
      input_schema: {
        type: "object" as const, // <-- literal
        properties: {},
        additionalProperties: false,
      },
    },
    // add others later…
  ] satisfies Tool[]; // <-- type-satisfies
  return tools;
}

export async function chatHandler(req: Request, res: Response) {
  const rid = (req.headers["x-request-id"] as string) || uuid();
  const userId =
    (req.headers["x-user-id"] as string) ||
    (req.body?.userId as string) ||
    "anon";

  const body = req.body as ChatRequestBody;
  if (!body?.messages?.length) {
    return res.status(400).json({ error: "messages[] required" });
  }

  // Optional per-request API key (body wins over header if both present)
  const apiKey =
    (typeof (req.headers["x-api-key"] as string) === "string" &&
      (req.headers["x-api-key"] as string)) ||
    (body as any).apiKey ||
    undefined;

  // Use the already-connected MCP client from app.locals
  const mcpClient = req.app.locals.mcp as any;
  if (!mcpClient) {
    return res.status(500).json({ error: "MCP client not initialized" });
  }

  const tools = await toolsForAnthropic(mcpClient);

  const callTool = async (name: string, args?: Record<string, unknown>) => {
    const a = { ...(args ?? {}) } as any;
    if (apiKey && typeof a.req === "object" && a.req && a.req.api_key == null) {
      // Inject api_key into req for stamping-related tools
      if (
        name === "stamp_hash" ||
        name === "validate_hash" ||
        name === "get_stamp_status" ||
        name === "resolve_proof"
      ) {
        a.req.api_key = apiKey;
      }
    }

    const out = await mcpClient.callTool({ name, arguments: a });

    const ids = pluckIdsFromContent(out);
    log.info(
      { event: "tool_call", userId, requestId: rid, tool: name, ...ids },
      "tool call"
    );
    return out;
  };

  let result: { text: string; steps: ToolStep[] };
  if (config.llmProvider === "mock") {
    result = await runWithMockLLM(body.messages, tools, callTool);
  } else {
    if (!config.anthropicKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });
    }
    result = await runWithAnthropicLLM(body.messages, {
      anthropicKey: config.anthropicKey,
      tools,
      callTool,
    });
  }

  for (const s of result.steps) {
    const ids = pluckIdsFromContent(s.result);
    if (ids.tx_id || ids.uid) Object.assign(s, ids);
  }
  log.info(
    { event: "chat_complete", userId, requestId: rid, steps: result.steps },
    "chat complete"
  );

  return res.json({
    requestId: rid,
    userId,
    finalText: result.text,
    tool_steps: result.steps,
  });
}
