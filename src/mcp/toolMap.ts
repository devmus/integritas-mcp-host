export function pluckIdsFromContent(content: any): {
  tx_id?: string;
  uid?: string;
} {
  // MCP tool results are typically: { content: [{ type: "text" | "json", ... }] }
  if (!content || !Array.isArray(content.content)) return {};
  for (const c of content.content) {
    if (c.type === "json" && c.json && typeof c.json === "object") {
      const tx_id = (c.json as any).tx_id ?? (c.json as any).txId;
      const uid = (c.json as any).uid ?? (c.json as any).id;
      if (tx_id || uid) return { tx_id, uid };
    }
    if (c.type === "text" && typeof c.text === "string") {
      try {
        const parsed = JSON.parse(c.text);
        const tx_id = parsed.tx_id ?? parsed.txId;
        const uid = parsed.uid ?? parsed.id;
        if (tx_id || uid) return { tx_id, uid };
      } catch {
        /* ignore */
      }
    }
  }

  return {};
}
