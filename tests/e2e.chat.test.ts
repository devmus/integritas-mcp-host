// ✅ Set env before importing anything that reads it
process.env.LLM_PROVIDER = "mock";

import { describe, it, expect, beforeAll } from "vitest";
import supertest from "supertest";
import { createServer } from "http";
import express from "express";
import { httpLogger } from "../src/logger.js";

// Dynamic import AFTER env set, so config.llmProvider === "mock"
let chatHandler: typeof import("../src/routes/chat.js")["chatHandler"];

function fakeMcp() {
  return {
    async listTools() {
      return {
        tools: [
          {
            name: "health",
            description: "Health",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };
    },
    async callTool({ name }: { name: string; arguments: any }) {
      if (name === "health") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ok",
                summary: "MCP server is alive",
                pid: 123,
                uptime_s: 1,
                version: "test",
              }),
            },
          ],
          isError: false,
        };
      }
      return { content: [{ type: "text", text: "{}" }], isError: false };
    },
  };
}

describe("E2E /chat against fake MCP (mock LLM)", () => {
  let request: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    // import after env is set
    ({ chatHandler } = await import("../src/routes/chat.js"));

    const app = express();
    app.use(express.json());
    app.use(httpLogger);

    // 🔑 Provide an MCP client for the handler
    (app as any).locals.mcp = fakeMcp();

    app.post("/chat", chatHandler);
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    request = supertest(`http://127.0.0.1:${port}`);
  });

  it("invokes MCP tool via mock LLM directive", async () => {
    const res = await request
      .post("/chat")
      .set("x-user-id", "tester1")
      .send({
        messages: [{ role: "user", content: "TOOL health {}" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeTruthy();
    expect(Array.isArray(res.body.tool_steps)).toBe(true);
    expect(res.body.tool_steps.length).toBeGreaterThan(0);
    expect(res.body.tool_steps[0].name).toBe("health");
  });
});
