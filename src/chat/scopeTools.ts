import type { ToolCatalogItem } from "../llm/adapter.js";
import { DIAGNOSTIC_TOOLS } from "./constants.js";

export function scopeTools(
  userText: string,
  all: ToolCatalogItem[]
): ToolCatalogItem[] {
  const lower = (userText || "").toLowerCase();
  const byName: Record<string, ToolCatalogItem> = Object.fromEntries(
    all.map((t) => [t.name, t])
  );
  const picks: ToolCatalogItem[] = [];

  // "stamp file/data/upload/hash"
  if (/\bstamp\b.*\b(file|data)\b/.test(lower) && byName["stamp_data"])
    picks.push(byName["stamp_data"]);
  if (/\bupload\b/.test(lower) && byName["stamp_data"])
    picks.push(byName["stamp_data"]);
  if (
    (/\bstamp\b.*\bhash\b/.test(lower) || /\bhash\b/.test(lower)) &&
    byName["stamp_data"]
  )
    picks.push(byName["stamp_data"]);

  // verification intent
  // trigger words: verify, verification, validate, proof, report, check if on-chain/exist(s)
  if (
    (/\bverify|verification|validate|proof|report\b/.test(lower) ||
      /\b(on[-\s]?chain|exists?|existence|confirm)\b/.test(lower)) &&
    byName["verify_data_with_proof"]
  ) {
    picks.push(byName["verify_data_with_proof"]);
  }

  return picks.filter(
    (t, i, arr) => !DIAGNOSTIC_TOOLS.has(t.name) && arr.indexOf(t) === i
  );
}
