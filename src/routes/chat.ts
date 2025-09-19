// src/routes/chat.ts
import type { Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { pluckIdsFromContent } from "../mcp/toolMap.js";
import { config } from "../config.js";
import { log } from "../logger/logger.js";
import type { ChatRequestBody, ToolStep } from "../types.js";

import { composeSystemPrompt } from "../prompt/composer.js";
import type { ToolCatalogItem } from "../llm/adapter.js";
import { AnthropicAdapter } from "../llm/providers/anthropic.js";
import { OpenAIAdapter } from "../llm/providers/openai.js";
import { OpenRouterAdapter } from "../llm/providers/openrouter.js";
import { MockAdapter } from "../llm/providers/mock.js";
import { ensureObjectSchema, stripApiKeyEverywhere } from "../llm/toolUtils.js";

// Tools are disabled for docs answers; satisfy the RunOptions type.
const NOOP_CALL_TOOL = async (
  _name: string,
  _args?: Record<string, unknown>
) => {
  throw new Error("Tool calls are disabled for this turn.");
};

// --- helpers for logging ---
const clamp = (s: unknown, n = 800) => {
  try {
    const str = typeof s === "string" ? s : JSON.stringify(s);
    return str.length > n ? str.slice(0, n) + "…" : str;
  } catch {
    return String(s).slice(0, n) + "…";
  }
};

function isDocsQuestion(text: string) {
  return /what can you do|how.*(work|works)|integritas|capab|tools|help|docs|faq|schema|feature|price|pricing/i.test(
    text || ""
  );
}

type MCPResourceMeta = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

function pickRelevantResources(
  userText: string,
  all: MCPResourceMeta[],
  limit = 4
): string[] {
  const q = (userText || "").toLowerCase();
  const scored = all.map((r) => {
    const hay = `${r.uri} ${r.name ?? ""} ${r.description ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of q.split(/\s+/)) if (w && hay.includes(w)) score += 1;
    // prefer your docs by default
    if (r.uri.startsWith("integritas://docs/")) score += 2;
    return { uri: r.uri, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.uri);
}

async function readResourceText(mcpClient: any, uri: string): Promise<string> {
  const out = await mcpClient.readResource({ uri });
  const first = out?.contents?.[0];
  if (!first) return "";
  if ("text" in first && typeof first.text === "string") return first.text;
  return ""; // ignore binary for this path
}

const summarizeToolResult = (out: any) => {
  // mcpClient.callTool returns { content, isError?, ... } or similar
  // Try to pick structured bits if present
  const sc =
    out?.structuredContent ?? out?.result?.structuredContent ?? undefined;
  const summary =
    sc?.summary ?? out?.summary ?? out?.message ?? out?.error ?? undefined;

  // keep small sample of raw for forensics
  const raw = clamp(out, 600);
  return { summary, raw };
};

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

function scopeTools(
  userText: string,
  all: ToolCatalogItem[]
): ToolCatalogItem[] {
  const lower = (userText || "").toLowerCase();
  const byName: Record<string, ToolCatalogItem> = Object.fromEntries(
    all.map((t) => [t.name, t])
  );

  const picks: ToolCatalogItem[] = [];

  // file/data OR upload (as before)
  if (/\bstamp\b.*\b(file|data)\b/.test(lower) && byName["stamp_data"])
    picks.push(byName["stamp_data"]);
  if (/\bupload\b/.test(lower) && byName["stamp_data"])
    picks.push(byName["stamp_data"]);

  // NEW: "stamp … hash" or just "hash" intent
  if (
    (/\bstamp\b.*\bhash\b/.test(lower) || /\bhash\b/.test(lower)) &&
    byName["stamp_data"]
  ) {
    picks.push(byName["stamp_data"]);
  }

  // Never include diagnostic tools
  return picks.filter(
    (t, i, arr) => !DIAGNOSTIC_TOOLS.has(t.name) && arr.indexOf(t) === i
  );
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

  // right after const toolsInScope = scopeTools(userText, allTools);
  log.info(
    {
      event: "host_checkpoint",
      requestId: rid,
      inScope: toolsInScope.map((t) => t.name),
    },
    "host reached tool scoping"
  );

  // NEW: log what the LLM is allowed to call this turn
  log.debug(
    {
      event: "tools_in_scope",
      requestId: rid,
      names: toolsInScope.map((t) => t.name),
    },
    "tools scoped for turn"
  );

  // NEW: collect per-call traces
  const toolTrace: Array<{
    name: string;
    ms: number;
    args: any;
    ok: boolean;
    result?: any;
    error?: string;
  }> = [];

  // Tool executor with API-key injection for stamping tools
  const toolArgs = body.toolArgs || {};
  if (
    toolArgs.stamp_data?.req &&
    !toolsInScope.find((t) => t.name === "stamp_data")
  ) {
    const extra = allTools.find((t) => t.name === "stamp_data");
    if (extra) toolsInScope.push(extra);
    log.debug({
      event: "tools_in_scope_forced",
      requestId: rid,
      reason: "toolArgs present",
      name: "stamp_data",
    });
  }

  const callTool = async (name: string, args?: Record<string, unknown>) => {
    let merged: any = args ?? {};
    if (toolArgs[name]) merged = deepMerge(merged, toolArgs[name]); // frontend wins
    if (!merged.req) merged.req = {};

    // If file_url is present, drop any stray file_path from model guesses
    if (merged.req.file_url) delete merged.req.file_path;

    if (apiKey && PRIMARY_TOOLS.has(name)) {
      if (merged.req.api_key == null) merged.req.api_key = apiKey;
    }

    // prepare a safely redacted view of what we're sending
    const safeArgs = {
      ...merged,
      req: {
        ...merged.req,
        api_key: merged.req.api_key ? "<redacted>" : undefined,
        file_url: merged.req.file_url ? "<provided>" : undefined,
      },
    };

    log.info(
      { event: "tool_args", tool: name, sending: safeArgs },
      "calling tool"
    );

    const t0 = Date.now();
    try {
      const out = await mcpClient.callTool({ name, arguments: merged });
      const ms = Date.now() - t0;

      const summary = summarizeToolResult(out);
      toolTrace.push({
        name,
        ms,
        args: safeArgs,
        ok: true,
        result: summary,
      });

      log.info(
        {
          event: "tool_result",
          tool: name,
          ms,
          summary: summary.summary,
          sample: summary.raw,
        },
        "tool completed"
      );

      return out;
    } catch (e: any) {
      const ms = Date.now() - t0;
      const errMsg = String(e?.message || e);
      toolTrace.push({ name, ms, args: safeArgs, ok: false, error: errMsg });

      log.error(
        { event: "tool_error", tool: name, ms, error: errMsg },
        "tool failed"
      );
      throw e;
    }
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

  // ⬇️ INSERT THIS BLOCK *HERE* — before systemPrompt / wantStamp / model.run
  if (isDocsQuestion(userText)) {
    // 1) discover resources
    const listed = (await mcpClient.listResources())?.resources ?? [];
    const allRes: MCPResourceMeta[] = listed.map((r: any) => ({
      uri: r.uri as string,
      name: r.name as string | undefined,
      description: r.description as string | undefined,
      mimeType: r.mimeType as string | undefined,
    }));

    // 2) pick relevant + force include overview/tools if present
    const forced = new Set<string>(
      allRes
        .filter(
          (r) =>
            r.uri === "integritas://docs/overview" ||
            r.uri === "integritas://docs/tools"
        )
        .map((r) => r.uri)
    );

    const picks = pickRelevantResources(userText, allRes, 4);
    const uris = Array.from(new Set<string>([...Array.from(forced), ...picks]));

    // 3) read them
    const texts = await Promise.all(
      uris.map((u) => readResourceText(mcpClient, u))
    );
    const contextBlob = uris
      .map((u, i) => `### ${u}\n${texts[i] || "(empty)"}`)
      .join("\n\n");

    // 4) answer with resources only (no tools) — no template backticks to avoid parse issues
    const docsSystemPrompt = [
      "You are answering questions about this MCP server's capabilities and the Integritas product.",
      "Use ONLY the MCP resources provided below as ground truth. Do not call or suggest tools.",
      "Cite the specific resource URI inline like: [source: integritas://docs/overview].",
      "Resources:",
      contextBlob,
    ].join("\n");

    const docsResult = await adapter.run(body.messages, {
      model: undefined,
      tools: [] as ToolCatalogItem[], // <- correctly typed empty list
      systemPrompt: docsSystemPrompt,
      maxToolRounds: 0,
      callTool: NOOP_CALL_TOOL, // <- required by RunOptions
      responseAsJson: false,
    });

    return res.json({
      requestId: rid,
      userId,
      finalText: docsResult.text ?? "Here’s what I found.",
      sources: uris,
      tool_steps: [],
    });
  } // === End docs/resources branch ===

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

  // Fallback: if we *know* what to do, just do it.
  const wantStamp =
    toolsInScope.some((t) => t.name === "stamp_data") &&
    (body.toolArgs?.stamp_data?.req ||
      /\bstamp\b.*\b(hash|file|data)\b/i.test(userText) ||
      /\b[a-f0-9]{64}\b/i.test(userText)); // naive sha256

  if (wantStamp) {
    // Prefer client-provided args; otherwise try to extract a bare hash
    let args = body.toolArgs?.stamp_data ?? { req: {} as any };
    if (!args.req.file_hash) {
      const m = userText.match(/\b[a-f0-9]{64}\b/i);
      if (m) args = { req: { ...args.req, file_hash: m[0].toLowerCase() } };
    }
    const out = await callTool("stamp_data", args);
    return res.json({
      requestId: rid,
      userId,
      finalText: "Stamped (host fallback).",
      tool_steps: [{ name: "stamp_data", result: out }],
    });
  }

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

  // NEW: compact step log
  const compactSteps = result.steps.map((s) => ({
    name: s.name,
    ok: !(s as any).isError,
    uid: (s as any).uid,
    tx_id: (s as any).tx_id,
    // try to pull a tiny summary
    summary:
      (s.result as any)?.structuredContent?.summary ??
      (s.result as any)?.summary ??
      undefined,
    sample: clamp(s.result, 400),
  }));

  log.debug(
    { event: "tool_trace", requestId: rid, trace: toolTrace },
    "per-call tool trace"
  );

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
    { event: "chat_complete", userId, requestId: rid, steps: compactSteps },
    "chat complete"
  );

  return res.json({
    requestId: rid,
    userId,
    finalText,
    tool_steps: result.steps,
  });
}
