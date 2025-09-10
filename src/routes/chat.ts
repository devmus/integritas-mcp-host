// src/routes/chat.ts
import type { Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { pluckIdsFromContent } from "../mcp/toolMap.js";
import { config } from "../config.js";
import { log } from "../logger.js";
import type { ChatRequestBody, ToolStep } from "../types.js";

import { composeSystemPrompt } from "../prompt/composer.js";
import type { ToolCatalogItem } from "../llm/adapter.js";
import { AnthropicAdapter } from "../llm/providers/anthropic.js";
import { OpenAIAdapter } from "../llm/providers/openai.js";
import { OpenRouterAdapter } from "../llm/providers/openrouter.js";
import { MockAdapter } from "../llm/providers/mock.js";
import { ensureObjectSchema, stripApiKeyEverywhere } from "../llm/toolUtils.js";

function deepMerge<T>(base: T, extra: Partial<T>): T {
  if (base && extra && typeof base === "object" && typeof extra === "object") {
    const out: any = Array.isArray(base)
      ? [...(base as any)]
      : { ...(base as any) };
    for (const [k, v] of Object.entries(extra)) {
      if (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        out[k] &&
        typeof out[k] === "object"
      ) {
        out[k] = deepMerge(out[k], v as any);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return (extra as T) ?? base;
}

/** Primary vs diagnostic tools */
const DIAGNOSTIC_TOOLS = new Set(["health", "ready"]);
const PRIMARY_TOOLS = new Set([
  // "stamp_hash",
  // "validate_hash",
  // "get_stamp_status",
  // "resolve_proof",
  "stamp_data",
]);

/** Build Anthropic-style tool catalog from MCP and strip api_key fields */
async function toolsFromMCP(mcpClient: any): Promise<ToolCatalogItem[]> {
  const mcpToolsResponse = (await mcpClient.listTools()) || {};
  const toolList = mcpToolsResponse.tools || [];

  return toolList.map((t: any) => {
    const raw = t.inputSchema ?? {};
    const stripped = stripApiKeyEverywhere(raw);
    const schema = ensureObjectSchema(stripped);

    return {
      name: t.name,
      description: t.description,
      input_schema: schema,
    } as ToolCatalogItem;
  });
}

/** Scope tools to the user's last message; never expose diagnostics */
function scopeTools(
  userText: string,
  all: ToolCatalogItem[]
): ToolCatalogItem[] {
  const lower = (userText || "").toLowerCase();
  const byName: Record<string, ToolCatalogItem> = Object.fromEntries(
    all.map((t) => [t.name, t])
  );

  const picks: ToolCatalogItem[] = [];

  // if (/\bstamp|\btimestamp|\banchor\b/.test(lower) && byName["stamp_hash"]) {
  //   picks.push(byName["stamp_hash"]);
  // }
  // if (/\bvalidate|\bverify\b/.test(lower) && byName["validate_hash"]) {
  //   picks.push(byName["validate_hash"]);
  // }
  // if (/\bstatus|\btx\b|\buid\b/.test(lower) && byName["get_stamp_status"]) {
  //   picks.push(byName["get_stamp_status"]);
  // }
  // if (/\bproof|\bresolve\b/.test(lower) && byName["resolve_proof"]) {
  //   picks.push(byName["resolve_proof"]);
  // }

  // Heuristics for file-based stamping
  if (/\bstamp\b.*\b(file|data)\b/.test(lower) && byName["stamp_data"])
    picks.push(byName["stamp_data"]);
  if (/\bupload\b/.test(lower) && byName["stamp_data"])
    picks.push(byName["stamp_data"]);

  // Fallback: if nothing matched, allow validate + stamp
  // if (!picks.length) {
  //   if (byName["validate_hash"]) picks.push(byName["validate_hash"]);
  //   if (byName["stamp_hash"]) picks.push(byName["stamp_hash"]);
  // }

  // Never include diagnostic tools
  return picks.filter((t) => !DIAGNOSTIC_TOOLS.has(t.name));
}

/** Safe JSON parse */
function tryParseJSON<T = any>(s: string): T | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
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

  // Optional per-request API key (body wins over header)
  const apiKey =
    (typeof (req.headers["x-api-key"] as string) === "string" &&
      (req.headers["x-api-key"] as string)) ||
    (body as any).apiKey ||
    undefined;

  // Already-connected MCP client
  const mcpClient = req.app.locals.mcp as any;
  if (!mcpClient) {
    return res.status(500).json({ error: "MCP client not initialized" });
  }

  // Build tools and scope to this turn
  const allTools = await toolsFromMCP(mcpClient);
  const userText = body.messages.at(-1)?.content ?? "";
  const toolsInScope = scopeTools(userText, allTools);

  // Tool executor with API-key injection for stamping tools
  const toolArgs = body.toolArgs || {};

  const callTool = async (name: string, args?: Record<string, unknown>) => {
    let merged: any = args ?? {};
    if (toolArgs[name]) merged = deepMerge(merged, toolArgs[name]); // frontend wins
    if (!merged.req) merged.req = {};

    // If file_url is present, drop any stray file_path from model guesses
    if (merged.req.file_url) delete merged.req.file_path;

    if (apiKey && PRIMARY_TOOLS.has(name)) {
      if (merged.req.api_key == null) merged.req.api_key = apiKey;
    }

    // log the exact payload we send to MCP (with secrets redacted)
    log.info(
      {
        event: "tool_args",
        tool: name,
        sending: {
          ...merged,
          req: {
            ...merged.req,
            api_key: "<redacted>",
            file_url: merged.req.file_url ? "<provided>" : undefined,
          },
        },
      },
      "calling tool"
    );

    return await mcpClient.callTool({ name, arguments: merged });
  };

  // Pick adapter
  let adapter:
    | AnthropicAdapter
    | OpenAIAdapter
    | OpenRouterAdapter
    | MockAdapter;

  if (config.llmProvider === "anthropic") {
    if (!config.anthropicKey)
      return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });
    adapter = new AnthropicAdapter(
      config.anthropicKey,
      "claude-3-5-sonnet-20240620"
    );
  } else if (config.llmProvider === "openai") {
    if (!config.openaiKey)
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    adapter = new OpenAIAdapter(config.openaiKey, config.openaiModel);
  } else if (config.llmProvider === "openrouter") {
    if (!config.openRouterKey)
      return res.status(500).json({ error: "OPENROUTER_API_KEY missing" });
    adapter = new OpenRouterAdapter(
      config.openRouterKey,
      config.openRouterModel
    );
  } else if (config.llmProvider === "mock") {
    adapter = new MockAdapter();
  } else {
    return res
      .status(400)
      .json({ error: `Unknown LLM_PROVIDER: ${config.llmProvider}` });
  }

  // Compose a strict system prompt (JSON contract + ignore diagnostics)
  const systemPrompt = composeSystemPrompt(`Be precise, neutral, and terse.`, {
    userGoal: userText.slice(0, 240),
    toolsInScope,
    chainName: "Minima",
    requireJson: true,
    primaryTools: [...PRIMARY_TOOLS],
    diagnosticTools: [...DIAGNOSTIC_TOOLS],
    runtimeHints: [
      `If validate_hash is 404, do not claim existence.`,
      `Normalize hashes to lowercase hex.`,
    ],
  });

  // Run model
  const result = await adapter.run(body.messages, {
    model: undefined,
    tools: toolsInScope,
    systemPrompt,
    maxToolRounds: 3,
    callTool,
    responseAsJson: true, // OpenAI/OpenRouter JSON mode; Anthropic follows prompt instructions
  });

  // Attach ids on steps for logs/response
  for (const s of result.steps) {
    const ids = pluckIdsFromContent(s.result);
    if (ids.tx_id || ids.uid) Object.assign(s, ids);
  }

  // Host-side final rendering: use ONLY the last PRIMARY tool step
  const lastPrimary = [...result.steps]
    .reverse()
    .find((s) => PRIMARY_TOOLS.has(s.name));
  let finalText = result.text;

  // Prefer JSON the model returned (OpenAI/OpenRouter with JSON mode)
  const obj = tryParseJSON<any>(result.text || "");
  if (obj && typeof obj === "object") {
    // Force chain + action to be primary (if we have one)
    obj.chain = "Minima";
    if (lastPrimary && (!obj.action || !PRIMARY_TOOLS.has(obj.action))) {
      obj.action = lastPrimary.name;
    }

    // If user_message references diagnostics, rebuild it
    const mentionsDiag =
      typeof obj.user_message === "string" &&
      /(?:\bhealth\b|\bready\b)/i.test(obj.user_message);

    if (!lastPrimary || mentionsDiag) {
      const facts = obj.facts || {};
      if (obj.action === "stamp_hash") {
        obj.user_message = `Hash stamped on Minima. uid=${
          facts.uid ?? "not provided"
        }, tx_id=${facts.tx_id ?? "not provided"}, stamped_at=${
          facts.stamped_at ?? "not provided"
        }.`;
      } else {
        obj.user_message = `Result on Minima: ${
          facts.message ?? "not provided"
        }.`;
      }
    }

    finalText = String(obj.user_message ?? finalText ?? "");
  } else if (lastPrimary) {
    // Non-JSON or Anthropic not following JSON strictly: render from last primary step
    const sc = (lastPrimary.result as any)?.structuredContent || {};
    const uid = sc.uid ?? "not provided";
    const stamped_at = sc.stamped_at ?? "not provided";
    const tx_id = sc.tx_id ?? "not provided";
    if (lastPrimary.name === "stamp_hash") {
      finalText = `Hash stamped on Minima. uid=${uid}, tx_id=${tx_id}, stamped_at=${stamped_at}.`;
    } else {
      finalText = `Result on Minima: ${sc.summary ?? "completed"}.`;
    }
  }

  log.info(
    { event: "chat_complete", userId, requestId: rid, steps: result.steps },
    "chat complete"
  );

  return res.json({
    requestId: rid,
    userId,
    finalText,
    tool_steps: result.steps,
  });
}
