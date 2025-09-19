// src/host/mcpResourceBridge.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export class MCPResourceBridge {
  private client?: Client;
  private resources: {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
  }[] = [];
  private ready = false;

  /** Windows-friendly: spawn python -m integritas_mcp_server.cli stdio */
  async connectStdioPython() {
    const transport = new StdioClientTransport({
      command: process.env.MCP_PYTHON_CMD ?? "python",
      args: ["-m", "integritas_mcp_server.cli", "stdio"],
    });
    this.client = new Client({ name: "integritas-host", version: "1.0.0" });
    await this.client.connect(transport);
    await this.refreshResourceList();
    this.ready = true;
  }

  // If you prefer uv on non-Windows:
  async connectStdioUv() {
    const transport = new StdioClientTransport({
      command: "uv",
      args: ["run", "integritas-mcp", "stdio"],
    });
    this.client = new Client({ name: "integritas-host", version: "1.0.0" });
    await this.client.connect(transport);
    await this.refreshResourceList();
    this.ready = true;
  }

  // async connectHttp(baseUrl: string) {
  //   const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
  //   this.client = new Client({ name: "integritas-host", version: "1.0.0" });
  //   await this.client.connect(transport);
  //   await this.refreshResourceList();
  //   this.ready = true;
  // }

  private ensure() {
    if (!this.client || !this.ready)
      throw new Error("MCP client not connected");
  }

  async refreshResourceList() {
    if (!this.client) throw new Error("MCP client not constructed yet");
    const list = await this.client.listResources();
    this.resources = list.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  listAll() {
    return this.resources;
  }

  async read(uri: string) {
    this.ensure();
    const out = await this.client!.readResource({ uri });
    const c = out.contents?.[0];
    return {
      uri,
      text: (c && "text" in c ? (c.text as string) : undefined) ?? undefined,
      mimeType: c?.mimeType,
    };
  }

  async readMany(uris: string[]) {
    return Promise.all(uris.map((u) => this.read(u)));
  }

  pickRelevantFor(query: string, limit = 4) {
    const q = query.toLowerCase();
    const scored = this.resources.map((r) => {
      const hay = `${r.uri} ${r.name ?? ""} ${
        r.description ?? ""
      }`.toLowerCase();
      let score = 0;
      for (const t of q.split(/\s+/)) if (hay.includes(t)) score += 1;
      if (r.uri.startsWith("integritas://docs/")) score += 2;
      return { uri: r.uri, score };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.uri);
  }
}
