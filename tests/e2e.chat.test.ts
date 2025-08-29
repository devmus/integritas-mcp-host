import { describe, it, expect, beforeAll } from "vitest";
import supertest from "supertest";
import { createServer } from "http";
import express from "express";
import { chatHandler } from "../src/routes/chat.js";
import { httpLogger } from "../src/logger.js";

describe("E2E /chat against live MCP server (mock LLM)", () => {
  let request: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    process.env.LLM_PROVIDER = "mock"; // use mock LLM
    const app = express();
    app.use(express.json());
    app.use(httpLogger);
    app.post("/chat", chatHandler);
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    request = supertest(`http://127.0.0.1:${port}`);
  });

  it("invokes MCP tool via mock LLM directive", async () => {
    // Exercise your 'health' tool or 'validate_hash' (replace args as needed)
    const res = await request
      .post("/chat")
      .set("x-user-id", "tester1")
      .send({
        messages: [
          { role: "user", content: `TOOL health {}` }, // mock LLM format
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeTruthy();
    expect(Array.isArray(res.body.tool_steps)).toBe(true);
    // Should show at least 1 tool step
    expect(res.body.tool_steps.length).toBeGreaterThan(0);
  });
});
