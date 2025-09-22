import { deepMerge, clamp } from "./utils.js";
import { PRIMARY_TOOLS } from "./constants.js";
import { log } from "../logger/logger.js";

export type ToolTrace = {
  name: string;
  ms: number;
  args: any;
  ok: boolean;
  result?: any;
  error?: string;
};

const summarizeToolResult = (out: any) => {
  const sc =
    out?.structuredContent ?? out?.result?.structuredContent ?? undefined;
  const summary =
    sc?.summary ?? out?.summary ?? out?.message ?? out?.error ?? undefined;
  return { summary, raw: clamp(out, 600) };
};

export function createToolCaller(
  mcpClient: any,
  apiKey: string | undefined,
  toolArgs: Record<string, any> | undefined
) {
  const trace: ToolTrace[] = [];

  const callTool = async (name: string, args?: Record<string, unknown>) => {
    let merged: any = args ?? {};
    if (toolArgs?.[name]) merged = deepMerge(merged, toolArgs[name]); // frontend wins
    if (!merged.req) merged.req = {};

    // If file_url is present, drop stray file_path
    if (merged.req.file_url) delete merged.req.file_path;

    if (apiKey && PRIMARY_TOOLS.has(name)) {
      if (merged.req.api_key == null) merged.req.api_key = apiKey;
    }

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
      trace.push({ name, ms, args: safeArgs, ok: true, result: summary });

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
      trace.push({ name, ms, args: safeArgs, ok: false, error: errMsg });
      log.error(
        { event: "tool_error", tool: name, ms, error: errMsg },
        "tool failed"
      );
      throw e;
    }
  };

  return { callTool, trace };
}
