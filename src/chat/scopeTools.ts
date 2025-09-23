// import type { ToolCatalogItem } from "../llm/adapter.js";
// import { DIAGNOSTIC_TOOLS } from "./constants.js";

// export function scopeTools(
//   userText: string,
//   all: ToolCatalogItem[]
// ): ToolCatalogItem[] {
//   const lower = (userText || "").toLowerCase();
//   const byName: Record<string, ToolCatalogItem> = Object.fromEntries(
//     all.map((t) => [t.name, t])
//   );
//   const picks: ToolCatalogItem[] = [];
//   console.log("Looking for tools");

//   // "stamp file/data/upload/hash"
//   if (/\bstamp\b.*\b(file|data)\b/.test(lower) && byName["stamp_data"])
//     picks.push(byName["stamp_data"]);
//   if (/\bupload\b/.test(lower) && byName["stamp_data"])
//     picks.push(byName["stamp_data"]);
//   if (
//     (/\bstamp\b.*\bhash\b/.test(lower) || /\bhash\b/.test(lower)) &&
//     byName["stamp_data"]
//   ) {
//     console.log("Stamp pushed");
//     picks.push(byName["stamp_data"]);
//   }

//   // verification intent
//   // trigger words: verify, verification, validate, proof, report, check if on-chain/exist(s)
//   if (
//     (/\bverify|verification|validate|proof|report\b/.test(lower) ||
//       /\b(on[-\s]?chain|exists?|existence|confirm)\b/.test(lower)) &&
//     byName["verify_data"]
//   ) {
//     console.log("Verify pushed");
//     picks.push(byName["verify_data"]);
//   }

//   console.log("Tools picked!");
//   return picks.filter(
//     (t, i, arr) => !DIAGNOSTIC_TOOLS.has(t.name) && arr.indexOf(t) === i
//   );
// }

import type { ToolCatalogItem } from "../llm/adapter.js";
import { DIAGNOSTIC_TOOLS } from "./constants.js";

export function scopeTools(
  userText: string,
  all: ToolCatalogItem[]
): ToolCatalogItem[] {
  const t = (userText || "").toLowerCase();
  const byName: Record<string, ToolCatalogItem | undefined> =
    Object.fromEntries(all.map((tool) => [tool.name, tool]));

  const picks: ToolCatalogItem[] = [];
  const add = (tool?: ToolCatalogItem) => {
    if (
      tool &&
      !DIAGNOSTIC_TOOLS.has(tool.name) &&
      !picks.some((p) => p.name === tool.name)
    ) {
      picks.push(tool);
    }
  };

  // ---- stamp intent ----
  const stampIntent =
    /\bstamp\b/.test(t) ||
    /\bupload\b/.test(t) ||
    /\bhash\b/.test(t) ||
    /\bstamp\b.*\b(file|data)\b/.test(t) ||
    /\bstamp\b.*\bhash\b/.test(t);

  if (stampIntent) add(byName["stamp_data"]);

  // ---- verify intent ----
  const verifyIntent =
    /\b(?:verify|verification|validate|proof|report)\b/.test(t) ||
    /\b(?:on[-\s]?chain|exists?|existence|confirm)\b/.test(t) ||
    /proof-file|\.json\b/.test(t);

  if (verifyIntent) add(byName["verify_data"]);

  console.log(
    "Tools picked!",
    picks.map((p) => p.name)
  );
  return picks;
}
