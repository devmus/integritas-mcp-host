import type { Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { log } from "../logger/logger.js";
import { composeSystemPrompt } from "../prompt/composer.js";
import type { ToolCatalogItem } from "../llm/adapter.js";
import { DIAGNOSTIC_TOOLS, PRIMARY_TOOLS } from "../chat/constants.js";
import { toolsFromMCP } from "../chat/toolsFromMCP.js";
import { scopeTools } from "../chat/scopeTools.js";
import {
  isDocsQuestion,
  pickRelevantResources,
  listResourcesAsText,
} from "../chat/resources.js";
import { createToolCaller } from "../chat/toolCaller.js";
import { chooseAdapter, type LLMChoice } from "../llm/chooseAdapter.js";
import { classifyLLMError } from "../chat/classifyLLMError.js";
import { z } from "zod";
import type { ChatMessage } from "../types.js";

// helper to normalize/whitelist incoming messages
function toChatMessages(raw: any[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of raw ?? []) {
    const role = m?.role;
    if (role !== "user" && role !== "assistant" && role !== "system") continue; // drop "tool" etc.
    const content =
      typeof m?.content === "string" ? m.content : String(m?.content ?? "");
    out.push({ role, content });
  }
  // ensure at least one user message (adapter safety)
  if (out.length === 0) out.push({ role: "user", content: "Hello" });
  return out;
}

/** Small link shape sent to the client for buttons */
type ChatLink = { rel?: string; href: string; label?: string };

/** Extract links[] from a tool result envelope */
function extractLinksFromResult(result: any): ChatLink[] {
  const links = result?.structuredContent?.links;
  return Array.isArray(links)
    ? links.filter((l) => l && typeof l.href === "string")
    : [];
}

/** Compute final chat text: prefer free text, else last envelope summary */
function finalizeTextFromSteps(result: any): string {
  if (typeof result?.text === "string" && result.text.trim()) {
    return result.text.trim();
  }
  const fromSteps =
    [...(result?.steps ?? [])]
      .reverse()
      .map(
        (s: any) => s?.result?.structuredContent?.summary ?? s?.result?.summary
      )
      .find((t: any) => typeof t === "string" && t.trim()) || "";
  return fromSteps || "Done.";
}

/* --------------------------- Validation schema --------------------------- */

const LLMChoiceSchema = z
  .object({
    provider: z.enum(["anthropic", "openai", "openrouter", "mock"]).optional(),
    model: z.string().min(1).optional(),
  })
  .optional();

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(), // was z.any()
});

const ChatBodySchema = z.object({
  messages: z.array(MessageSchema).min(1),
  toolArgs: z.record(z.any()).optional(),
  llm: LLMChoiceSchema,
});

/* -------------------------------- Handler -------------------------------- */

export async function chatHandler(req: Request, res: Response) {
  const rid = (req.headers["x-request-id"] as string) || uuid();
  const userId =
    (req.headers["x-user-id"] as string) ||
    (req.body?.userId as string) ||
    "anon";

  // Validate body
  const parsed = ChatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid body", issues: parsed.error.format() });
  }
  const body = parsed.data;

  const chatMessages = toChatMessages(body.messages);

  // Choose adapter from per-request llm (with allowlist + key checks)
  let adapter;
  try {
    adapter = chooseAdapter(body.llm as LLMChoice);
  } catch (e: any) {
    return res.status(400).json({
      error: "LLM_SELECTION_FAILED",
      message: e?.message ?? "Invalid LLM selection",
    });
  }

  // Per-request upstream API key (forwarded to MCP tools)
  const apiKey =
    (typeof (req.headers["x-api-key"] as string) === "string" &&
      (req.headers["x-api-key"] as string)) ||
    (req.body as any).apiKey ||
    undefined;

  const mcpClient = req.app.locals.mcp as any;
  if (!mcpClient) {
    return res.status(500).json({ error: "MCP client not initialized" });
  }

  // Discover tools and scope them to the user's last message
  const allTools = await toolsFromMCP(mcpClient);
  const userText = chatMessages.at(-1)?.content ?? "";
  const toolsInScope = scopeTools(userText, allTools);

  /* -------------------------- Docs-only fast path -------------------------- */

  if (isDocsQuestion(userText)) {
    const listed = (await mcpClient.listResources())?.resources ?? [];
    const allRes = listed.map((r: any) => ({
      uri: String(r.uri),
      name: typeof r.name === "string" ? r.name : undefined,
      description:
        typeof r.description === "string" ? r.description : undefined,
      mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined,
    }));

    // Force include overview/tools if present
    const forced = new Set<string>(
      allRes
        .filter(
          (r: any) =>
            r.uri === "integritas://docs/overview" ||
            r.uri === "integritas://docs/tools"
        )
        .map((r: any) => r.uri)
    );
    const picks = pickRelevantResources(userText, allRes, 4);
    const uris = Array.from(new Set<string>([...Array.from(forced), ...picks]));
    const contextBlob = await listResourcesAsText(mcpClient, uris);

    const docsSystemPrompt = [
      "You are answering questions about this MCP server's capabilities and the Integritas product.",
      "Use ONLY the MCP resources provided below as ground truth. Do not call or suggest tools.",
      "Cite the specific resource URI inline like: [source: integritas://docs/overview].",
      "Resources:",
      contextBlob,
    ].join("\n");

    try {
      const docsResult = await adapter.run(chatMessages, {
        model: undefined,
        tools: [] as ToolCatalogItem[],
        systemPrompt: docsSystemPrompt,
        maxToolRounds: 0,
        callTool: async () => {
          throw new Error("Tool calls are disabled for this turn.");
        },
        responseAsJson: false,
      });

      return res.json({
        requestId: rid,
        userId,
        finalText: docsResult.text ?? "Here’s what I found.",
        links: [],
        sources: uris,
        tool_steps: [],
      });
    } catch (err: any) {
      const info = classifyLLMError(err);
      if (info.isLLMTransport) {
        const msg =
          (info as any).message ??
          (info.isRateLimit
            ? `Model is rate limited${
                info.retryAfter ? ` (retry after ~${info.retryAfter}s)` : ""
              }.`
            : `Model backend is unavailable${
                info.status ? ` (HTTP ${info.status})` : ""
              }.`);
        return res.json({
          requestId: rid,
          userId,
          finalText: msg,
          links: [],
          tool_steps: [],
        });
      }
      throw err; // non-LLM error: surface it (use your global error handler)
    }
  }

  /* --------------------------- Tool execution path --------------------------- */

  // Prepare tool caller (inject API key + capture trace)
  const { callTool, trace } = createToolCaller(
    mcpClient,
    apiKey,
    body.toolArgs || {}
  );

  // Host fallbacks: directly execute common intents without LLM round-trips

  // A) STAMP fallback
  const wantStamp =
    toolsInScope.some((t) => t.name === "stamp_data") &&
    (body.toolArgs?.stamp_data?.req ||
      /\bstamp\b.*\b(hash|file|data)\b/i.test(userText) ||
      /\b[a-f0-9]{64}\b/i.test(userText));

  if (wantStamp) {
    let args = body.toolArgs?.stamp_data ?? { req: {} as any };
    if (!args.req.file_hash) {
      const m = userText.match(/\b[a-f0-9]{64}\b/i);
      if (m) args = { req: { ...args.req, file_hash: m[0].toLowerCase() } };
    }
    const out = await callTool("stamp_data", args);
    const text =
      out?.structuredContent?.summary ?? out?.summary ?? "Stamp complete.";
    const links = extractLinksFromResult(out);

    return res.json({
      requestId: rid,
      userId,
      finalText: text,
      links,
      tool_steps: [{ name: "stamp_data", result: out }],
    });
  }

  // B) VERIFY fallback (explicit args present)
  if (body.toolArgs?.verify_data?.req) {
    const out = await callTool("verify_data", body.toolArgs.verify_data);
    const text =
      out?.structuredContent?.summary ??
      out?.summary ??
      "Verification complete.";
    const links = extractLinksFromResult(out);

    return res.json({
      requestId: rid,
      userId,
      finalText: text,
      links,
      tool_steps: [{ name: "verify_data", result: out }],
    });
  }

  // Ensure requested tools are scopped if args mentioned
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
  if (
    toolArgs.verify_data?.req &&
    !toolsInScope.find((t) => t.name === "verify_data")
  ) {
    const extra = allTools.find((t) => t.name === "verify_data");
    if (extra) toolsInScope.push(extra);
    log.debug({
      event: "tools_in_scope_forced",
      requestId: rid,
      reason: "toolArgs present",
      name: "verify_data",
    });
  }

  const systemPrompt = composeSystemPrompt(`Be precise, neutral, and terse.`, {
    userGoal: userText.slice(0, 240),
    toolsInScope,
    chainName: "Minima",
    requireJson: true,
    primaryTools: Array.from(PRIMARY_TOOLS),
    diagnosticTools: Array.from(DIAGNOSTIC_TOOLS),
    runtimeHints: [
      `If validate_hash is 404, do not claim existence.`,
      `Normalize hashes to lowercase hex.`,
    ],
  });

  try {
    // Let the LLM decide tool usage within the scoped list
    const result = await adapter.run(chatMessages, {
      model: undefined,
      tools: toolsInScope,
      systemPrompt,
      maxToolRounds: 3,
      callTool,
      responseAsJson: true,
    });

    log.debug(
      { event: "tool_trace", requestId: rid, trace },
      "per-call tool trace"
    );

    // Final plain text and links for the client
    const finalText = finalizeTextFromSteps(result);
    const links = (result.steps ?? [])
      .flatMap((s: any) => extractLinksFromResult(s.result))
      .slice(0, 5);

    return res.json({
      requestId: rid,
      userId,
      finalText,
      links,
      tool_steps: result.steps,
    });
  } catch (err: any) {
    const info = classifyLLMError(err);

    if (info.isLLMTransport) {
      const msg =
        (info as any).message ??
        (info.isRateLimit
          ? `Model is rate limited${
              info.retryAfter ? ` (retry after ~${info.retryAfter}s)` : ""
            }.`
          : `Model backend is unavailable${
              info.status ? ` (HTTP ${info.status})` : ""
            }.`);
      // Return 200 so UI can render a friendly message
      return res.json({
        requestId: rid,
        userId,
        finalText: msg,
        links: [],
        tool_steps: [],
      });
    }

    throw err; // Non-transport exceptions should be visible in your logs/monitoring
  }
}
