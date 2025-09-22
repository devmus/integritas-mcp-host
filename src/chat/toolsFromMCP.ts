import type { ToolCatalogItem } from "../llm/adapter.js";
import { stripApiKeyEverywhere, ensureObjectSchema } from "../llm/toolUtils.js";

export async function toolsFromMCP(mcpClient: any): Promise<ToolCatalogItem[]> {
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
