import type { Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { pluckIdsFromContent } from "../mcp/toolMap.js";
import { config } from "../config.js";
import { log } from "../logger/logger.js";
import type { ChatRequestBody } from "../types.js";

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
import { chooseAdapter } from "../llm/chooseAdapter.js";
import { clamp, tryParseJSON } from "../chat/utils.js";
import { finalizeText } from "../chat/render.js";

type MCPResourceMeta = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export async function chatHandler(req: Request, res: Response) {
  const rid = (req.headers["x-request-id"] as string) || uuid();
  const userId =
    (req.headers["x-user-id"] as string) ||
    (req.body?.userId as string) ||
    "anon";
  const body = req.body as ChatRequestBody;
  if (!body?.messages?.length)
    return res.status(400).json({ error: "messages[] required" });

  // Optional per-request API key
  const apiKey =
    (typeof (req.headers["x-api-key"] as string) === "string" &&
      (req.headers["x-api-key"] as string)) ||
    (body as any).apiKey ||
    undefined;

  const mcpClient = req.app.locals.mcp as any;
  if (!mcpClient)
    return res.status(500).json({ error: "MCP client not initialized" });

  // Discover tools + scope
  const allTools = await toolsFromMCP(mcpClient);
  const userText = body.messages.at(-1)?.content ?? "";
  const toolsInScope = scopeTools(userText, allTools);

  log.info(
    {
      event: "host_checkpoint",
      requestId: rid,
      inScope: toolsInScope.map((t) => t.name),
    },
    "host reached tool scoping"
  );
  log.debug(
    {
      event: "tools_in_scope",
      requestId: rid,
      names: toolsInScope.map((t) => t.name),
    },
    "tools scoped for turn"
  );

  // Docs-only branch (no tools)
  if (isDocsQuestion(userText)) {
    const listed = (await mcpClient.listResources())?.resources ?? [];
    const allRes: MCPResourceMeta[] = listed.map((r: any) => ({
      uri: String(r.uri),
      name: typeof r.name === "string" ? r.name : undefined,
      description:
        typeof r.description === "string" ? r.description : undefined,
      mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined,
    }));

    // force include overview/tools if present
    const forced = new Set<string>(
      allRes
        .filter(
          (r: MCPResourceMeta) =>
            r.uri === "integritas://docs/overview" ||
            r.uri === "integritas://docs/tools"
        )
        .map((r: MCPResourceMeta) => r.uri)
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

    const adapter = chooseAdapter();
    const docsResult = await adapter.run(body.messages, {
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
      sources: uris,
      tool_steps: [],
    });
  }

  // Prepare tool caller (with API-key injection + tracing)
  const { callTool, trace } = createToolCaller(
    mcpClient,
    apiKey,
    body.toolArgs || {}
  );

  // Host fallback: stamp directly if obvious
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
    return res.json({
      requestId: rid,
      userId,
      finalText: "Stamped (host fallback).",
      tool_steps: [{ name: "stamp_data", result: out }],
    });
  }

  // Host fallback: verify directly if obvious

  if (body.toolArgs?.verify_data_with_proof?.req) {
    const out = await callTool(
      "verify_data_with_proof",
      body.toolArgs.verify_data_with_proof
    );
    return res.json({
      requestId: rid,
      userId,
      finalText: "Verification completed (host fallback).",
      tool_steps: [{ name: "verify_data_with_proof", result: out }],
    });
  }

  const toolArgs = body.toolArgs || {};

  // Force-scope stamp if args present (existing)
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

  // Force-scope verify if args present
  if (
    toolArgs.verify_data_with_proof?.req &&
    !toolsInScope.find((t) => t.name === "verify_data_with_proof")
  ) {
    const extra = allTools.find((t) => t.name === "verify_data_with_proof");
    if (extra) toolsInScope.push(extra);
    log.debug({
      event: "tools_in_scope_forced",
      requestId: rid,
      reason: "toolArgs present",
      name: "verify_data_with_proof",
    });
  }

  // Run model with scoped tools
  const adapter = chooseAdapter();
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

  const result = await adapter.run(body.messages, {
    model: undefined,
    tools: toolsInScope,
    systemPrompt,
    maxToolRounds: 3,
    callTool,
    responseAsJson: true,
  });

  // Decorate steps a bit for UI + logs
  for (const s of result.steps) {
    const ids = pluckIdsFromContent(s.result);
    if (ids.tx_id || ids.uid) Object.assign(s, ids);
  }

  const compactSteps = result.steps.map((s) => ({
    name: s.name,
    ok: !(s as any).isError,
    uid: (s as any).uid,
    tx_id: (s as any).tx_id,
    summary:
      (s.result as any)?.structuredContent?.summary ??
      (s.result as any)?.summary ??
      undefined,
    sample: clamp(s.result, 400),
  }));

  log.debug(
    { event: "tool_trace", requestId: rid, trace },
    "per-call tool trace"
  );

  // Final text (prefer model JSON; else last primary step)
  // let finalText = result.text;
  // const obj = tryParseJSON<any>(result.text || "");
  // if (obj && typeof obj === "object") {
  //   obj.chain = "Minima";
  //   const lastPrimary = [...result.steps]
  //     .reverse()
  //     .find((s) => PRIMARY_TOOLS.has(s.name));
  //   if (lastPrimary && (!obj.action || !PRIMARY_TOOLS.has(obj.action)))
  //     obj.action = lastPrimary.name;
  //   finalText = String(obj.user_message ?? finalText ?? "");
  // } else {
  //   const lastPrimary = [...result.steps]
  //     .reverse()
  //     .find((s) => PRIMARY_TOOLS.has(s.name));
  //   if (lastPrimary) {
  //     const sc = (lastPrimary.result as any)?.structuredContent || {};
  //     finalText =
  //       lastPrimary.name === "stamp_hash"
  //         ? `Hash stamped on Minima. uid=${sc.uid ?? "not provided"}, tx_id=${
  //             sc.tx_id ?? "not provided"
  //           }, stamped_at=${sc.stamped_at ?? "not provided"}.`
  //         : `Result on Minima: ${sc.summary ?? "completed"}.`;
  //   }
  // }

  // Final text (prefer model JSON; else last primary step)
  const finalText = finalizeText(result, result.steps);

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
