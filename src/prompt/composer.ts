// src/prompt/composer.ts
import type { ToolCatalogItem } from "../llm/adapter.js";

/** Public options you already use */
export type ComposeArgs = {
  userGoal?: string;
  toolsInScope: ToolCatalogItem[];
  outputContract?: string;
  runtimeHints?: string[];
  chainName?: string;
  requireJson?: boolean;
  primaryTools?: string[];
  diagnosticTools?: string[];
  /** New: limit schema preview length (default 800) */
  schemaMaxChars?: number;
};

/* ---------------------------- section helpers ---------------------------- */

function sectionBasePolicy(): string {
  return [
    `You are an MCP host orchestrator. Prefer calling tools over guessing.`,
    `Follow JSON schemas exactly; never invent fields. All timestamps UTC ISO-8601.`,
    `Never fabricate tx_id or uid. If a tool requires an API key and none is available,`,
    `ask the user once to provide it. Keep final user responses concise.`,
  ].join(" ");
}

function sectionGroundingRules(opts: {
  chain: string;
  primary: Set<string>;
  diagnostics: Set<string>;
}): string {
  const { chain, primary, diagnostics } = opts;
  return [
    `GROUNDING RULES:`,
    `- The blockchain used by these tools is "${chain}" only. Do NOT mention Bitcoin or any other chain.`,
    `- Treat these as PRIMARY tools: ${[...primary].join(", ")}.`,
    `- Treat these as DIAGNOSTIC tools: ${[...diagnostics].join(", ")}.`,
    `- Your user-facing summary MUST be based solely on the latest PRIMARY tool_result in this turn.`,
    `- Do NOT include or reference any DIAGNOSTIC results in the user-facing summary (they are for internal decisioning only).`,
    `- If a field is absent, write "not provided" rather than guessing.`,
    `- Do not state “confirmed” or “permanently recorded” unless the tool_result explicitly provides that status.`,
  ].join("\n");
}

function sectionUserGoal(userGoal?: string): string | undefined {
  if (!userGoal) return undefined;
  return `User goal: ${userGoal}`;
}

function stringifySchemaPreview(schema: unknown, max = 800): string {
  try {
    const s = JSON.stringify(schema ?? {});
    return s.length > max ? s.slice(0, max) + " …" : s;
  } catch {
    return "{}";
  }
}

function sectionToolCatalog(
  tools: ToolCatalogItem[],
  schemaMaxChars = 800
): string | undefined {
  if (!tools?.length) return undefined;
  const catalog = tools
    .map((t) => {
      const schemaPreview = stringifySchemaPreview(
        t.input_schema,
        schemaMaxChars
      );
      return `- ${t.name}: ${
        t.description || "(no description)"
      }\n  schema: ${schemaPreview}`;
    })
    .join("\n");
  return `Tools available this turn:\n${catalog}`;
}

function sectionOutputFormatJSON(opts: {
  chain: string;
  primary: Set<string>;
}): string {
  const primaryList = [...opts.primary].join(" | ");
  return [
    `OUTPUT FORMAT (REQUIRED):`,
    `Return a single JSON object:`,
    `{`,
    `  "status": "success" | "error",`,
    `  "action": "<one of ${primaryList} | 'none'>",`,
    `  "chain": "${opts.chain}",`,
    `  "facts": {`,
    `    "hash": "<string | 'not provided'>",`,
    `    "uid": "<string | 'not provided'>",`,
    `    "tx_id": "<string | 'not provided'>",`,
    `    "stamped_at": "<ISO-8601 | 'not provided'>",`,
    `    "message": "<short machine-readable status>"`,
    `  },`,
    `  "user_message": "<one short paragraph, neutral, strictly from the latest PRIMARY tool_result>",`,
    `  "diagnostics_used": "<comma-separated diagnostic tool names only>"`,
    `}`,
    `No extra keys. No prose outside the JSON.`,
  ].join("\n");
}

function sectionOutputContract(outputContract?: string): string | undefined {
  if (!outputContract) return undefined;
  return `Output contract: ${outputContract}`;
}

function sectionRuntimeHints(opts: {
  chain: string;
  hints?: string[];
}): string {
  const baseline = [
    `The chain is "${opts.chain}" only. Never say Bitcoin.`,
    `Base user_message only on the latest PRIMARY tool_result. Ignore DIAGNOSTIC tools in the user_message.`,
  ];
  const all = [...baseline, ...(opts.hints ?? [])];
  return `Runtime hints:\n- ${all.join("\n- ")}`;
}

/* ---------------------------- main composer ----------------------------- */

export function composeSystemPrompt(base?: string, args?: ComposeArgs): string {
  const chain = args?.chainName ?? "Minima";
  const primary = new Set(
    args?.primaryTools ?? [
      "stamp_hash",
      "validate_hash",
      "get_stamp_status",
      "resolve_proof",
    ]
  );
  const diagnostics = new Set(args?.diagnosticTools ?? ["health", "ready"]);
  const requireJson = !!args?.requireJson;

  const parts: Array<string> = [];

  parts.push(sectionBasePolicy());
  parts.push(sectionGroundingRules({ chain, primary, diagnostics }));

  if (base) parts.push(base);

  const ug = sectionUserGoal(args?.userGoal);
  if (ug) parts.push(ug);

  const catalog = sectionToolCatalog(
    args?.toolsInScope ?? [],
    args?.schemaMaxChars
  );
  if (catalog) parts.push(catalog);

  if (requireJson) {
    parts.push(sectionOutputFormatJSON({ chain, primary }));
  } else {
    const oc = sectionOutputContract(args?.outputContract);
    if (oc) parts.push(oc);
  }

  parts.push(sectionRuntimeHints({ chain, hints: args?.runtimeHints }));

  // Join with blank lines between sections for readability
  return parts.join("\n\n");
}
