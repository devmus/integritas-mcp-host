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
import { runWithOpenAILLM } from "../llm/openai.js";
import { runWithOpenRouterLLM } from "../llm/openrouter.js";
import { convertTools } from "../llm/toolConverter.js";

/** Convert MCP tool metadata to Anthropic's tool schema */
async function toolsForAnthropic(mcpClient: any): Promise<Tool[]> {
  const mcpToolsResponse = (await mcpClient.listTools()) || {};
  const toolList = mcpToolsResponse.tools || [];

  // --- BEGIN DEBUG LOGGING ---
  // console.log("--- RAW TOOLS FROM MCP SERVER ---");
  // console.log(JSON.stringify(toolList, null, 2));
  // --- END DEBUG LOGGING ---

  const tools = toolList.map((t: any) => {
    // Use the correct source property: inputSchema
    const schema = t.inputSchema || { type: "object", properties: {} };

    // The actual tool parameters are nested inside a definition,
    // referenced by the 'req' property.
    if (schema.properties?.req?.$ref) {
      const defName = schema.properties.req.$ref.split("/").pop();
      if (defName && schema.$defs?.[defName]) {
        const def = schema.$defs[defName];

        // Now, delete the api_key from the definition's properties
        if (def.properties?.api_key) {
          delete def.properties.api_key;
        }

        // And remove it from the required list, if it exists
        if (def.required) {
          def.required = def.required.filter(
            (prop: string) => prop !== "api_key"
          );
        }
      }
    }

    return {
      name: t.name,
      description: t.description,
      input_schema: schema,
    };
  });

  // --- BEGIN DEBUG LOGGING ---
  // console.log("--- MODIFIED TOOLS SENT TO LLM ---");
  // console.log(JSON.stringify(tools, null, 2));
  // --- END DEBUG LOGGING ---

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

  const convertedTools = convertTools(config.llmProvider, tools);

  let result: { text: string; steps: ToolStep[] };
  if (config.llmProvider === "mock") {
    result = await runWithMockLLM(body.messages, convertedTools, callTool);
  } else if (config.llmProvider === "anthropic") {
    if (!config.anthropicKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });
    }
    result = await runWithAnthropicLLM(body.messages, {
      anthropicKey: config.anthropicKey,
      tools: convertedTools,
      callTool,
    });
  } else if (config.llmProvider === "openai") {
    if (!config.openaiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

    // reuse the Anthropic-style tools and convert inside the runner
    result = await runWithOpenAILLM(body.messages, {
      openaiKey: config.openaiKey,
      model: config.openaiModel,
      tools: convertedTools, // <— anthropic-style tools you already build
      callTool, // <— your existing executor (injects api_key when needed)
    });
  } else if (config.llmProvider === "openrouter") {
    if (!config.openRouterKey) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY missing" });
    }

    // reuse the Anthropic-style tools and convert inside the runner
    result = await runWithOpenRouterLLM(body.messages, {
      openRouterKey: config.openRouterKey,
      model: config.openRouterModel, // pick default
      tools: convertedTools, // <— anthropic-style tools you already build
      callTool, // <— your existing executor (injects api_key when needed)
    });
  } else {
    return res
      .status(400)
      .json({ error: `Unknown LLM_PROVIDER: ${config.llmProvider}` });
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
