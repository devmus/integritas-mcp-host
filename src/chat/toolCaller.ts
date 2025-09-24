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

    // log.info(
    //   { event: "tool_args", tool: name, sending: safeArgs },
    //   "calling tool"
    // );
    console.log("Tool caller starting...");

    const t0 = Date.now();
    try {
      // NEW: explicit per-call timeout + reset on progress (if your server emits progress)
      const out = await mcpClient.callTool(
        { name, arguments: merged },
        /* result schema */ undefined,
        /* request options */ {
          timeout: 120_000, // 2 minutes (SDKs report this as e.data.timeout)
          timeoutMs: 120_000, // for older builds that expect timeoutMs
          resetTimeoutOnProgress: true, // keep alive if the server streams progress
        }
      );

      const ms = Date.now() - t0;
      const summary = summarizeToolResult(out);
      trace.push({ name, ms, args: safeArgs, ok: true, result: summary });
      console.log("Tool caller completed");
      return out;
    } catch (e: any) {
      const ms = Date.now() - t0;
      const errMsg = String(e?.message || e);
      const code = e?.code ?? e?.data?.code;
      const timeoutMs: number | undefined = e?.data?.timeout;

      if (code === -32001 || /request timed out/i.test(errMsg)) {
        const effective = timeoutMs ?? 120_000; // reflect our per-call timeout
        const friendly = {
          isError: true,
          structuredContent: {
            summary: `The "${name}" tool timed out after ${Math.round(
              effective / 1000
            )}s.`,
          },
          summary: `The "${name}" tool timed out after ${Math.round(
            effective / 1000
          )}s.`,
          error: { code: -32001, timeout_ms: effective },
        };
        const summary = summarizeToolResult(friendly);
        trace.push({
          name,
          ms,
          args: safeArgs,
          ok: false,
          result: summary,
          error: errMsg,
        });
        console.log("Tool caller timeout");
        return friendly; // do not throw; let the UI render
      }

      trace.push({ name, ms, args: safeArgs, ok: false, error: errMsg });
      console.log("Tool caller error");
      throw e;
    }
  };

  return { callTool, trace };
}
