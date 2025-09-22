type MCPResourceMeta = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export function isDocsQuestion(text: string) {
  return /what can you do|how.*(work|works)|integritas|capab|tools|help|docs|faq|schema|feature|price|pricing/i.test(
    text || ""
  );
}

export function pickRelevantResources(
  userText: string,
  all: MCPResourceMeta[],
  limit = 4
): string[] {
  const q = (userText || "").toLowerCase();
  const scored = all.map((r) => {
    const hay = `${r.uri} ${r.name ?? ""} ${r.description ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of q.split(/\s+/)) if (w && hay.includes(w)) score += 1;
    if (r.uri.startsWith("integritas://docs/")) score += 2; // prefer your docs
    return { uri: r.uri, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.uri);
}

export async function listResourcesAsText(
  mcpClient: any,
  uris: string[]
): Promise<string> {
  const texts = await Promise.all(
    uris.map(async (uri) => {
      const out = await mcpClient.readResource({ uri });
      const first = out?.contents?.[0];
      const txt =
        first && "text" in first && typeof first.text === "string"
          ? first.text
          : "";
      return `### ${uri}\n${txt || "(empty)"}`;
    })
  );
  return texts.join("\n\n");
}
