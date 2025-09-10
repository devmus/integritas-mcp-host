import { describe, it, expect } from "vitest";
import { composeSystemPrompt } from "../../src/prompt/composer";

function tool(
  name: string,
  description = "desc",
  schema: any = { type: "object", properties: {} }
) {
  // Keep this shape in sync with ToolCatalogItem enough for our tests
  return { name, description, input_schema: schema } as any;
}

describe("composeSystemPrompt", () => {
  it("includes base policy, grounding rules, user goal, and runtime hints", () => {
    const prompt = composeSystemPrompt("BASE TEXT", {
      chainName: "Minima",
      userGoal: "Stamp this hash",
      toolsInScope: [],
      runtimeHints: ["Normalize hashes to lowercase hex."],
    });

    expect(prompt).toContain("You are an MCP host orchestrator");
    expect(prompt).toContain(
      'The blockchain used by these tools is "Minima" only.'
    );
    expect(prompt).toContain("User goal: Stamp this hash");
    expect(prompt).toContain("BASE TEXT");
    expect(prompt).toContain("Runtime hints:");
    expect(prompt).toContain("Normalize hashes to lowercase hex.");
    // default baseline hint
    expect(prompt).toContain('The chain is "Minima" only. Never say Bitcoin.');
  });

  it("renders tools catalog with schema preview and truncation", () => {
    const bigSchema = { foo: "x".repeat(2000) };
    const prompt = composeSystemPrompt(undefined, {
      chainName: "Minima",
      toolsInScope: [
        tool("stamp_hash", "stamp it", bigSchema),
        tool("health", "diag"),
      ],
      schemaMaxChars: 40, // force truncation
    });

    expect(prompt).toContain("Tools available this turn:");
    expect(prompt).toContain("- stamp_hash: stamp it");
    expect(prompt).toContain("- health: diag");
    // should contain truncated preview with ellipsis
    expect(prompt).toMatch(/schema: .* …/);
  });

  it("enforces JSON output when requireJson=true", () => {
    const prompt = composeSystemPrompt(undefined, {
      chainName: "Minima",
      toolsInScope: [tool("stamp_hash")],
      requireJson: true,
      primaryTools: ["stamp_hash"],
      diagnosticTools: ["health", "ready"],
    });

    expect(prompt).toContain("OUTPUT FORMAT (REQUIRED)");
    expect(prompt).toContain('"status": "success" | "error"');
    expect(prompt).toContain('"action": "<one of stamp_hash | \'none\'>"');
    expect(prompt).toContain('"chain": "Minima"');
    expect(prompt).toContain('"facts": {');
    expect(prompt).toContain('"user_message": "<one short paragraph');
    // wording bug fixed: diagnostics_used refers to diagnostic tools
    expect(prompt).toContain(
      '"diagnostics_used": "<comma-separated diagnostic tool names only>"'
    );
    // Output contract must NOT be included when requireJson = true
    expect(prompt).not.toContain("Output contract:");
  });

  it("uses outputContract when requireJson=false", () => {
    const prompt = composeSystemPrompt(undefined, {
      chainName: "Minima",
      toolsInScope: [],
      requireJson: false,
      outputContract: "Return a concise bullet summary.",
    });

    expect(prompt).toContain(
      "Output contract: Return a concise bullet summary."
    );
    expect(prompt).not.toContain("OUTPUT FORMAT (REQUIRED)");
  });

  it("marks primary vs diagnostic tools and prohibits other chains", () => {
    const prompt = composeSystemPrompt(undefined, {
      chainName: "Minima",
      toolsInScope: [],
      primaryTools: ["stamp_hash", "validate_hash"],
      diagnosticTools: ["health", "ready"],
    });

    expect(prompt).toContain(
      "Treat these as PRIMARY tools: stamp_hash, validate_hash."
    );
    expect(prompt).toContain("Treat these as DIAGNOSTIC tools: health, ready.");
    // Anti-hallucination rule
    expect(prompt).toMatch(/Do NOT mention Bitcoin or any other chain/i);
  });

  it("reinforces basing user_message only on latest PRIMARY tool result", () => {
    const prompt = composeSystemPrompt(undefined, {
      chainName: "Minima",
      toolsInScope: [],
    });

    expect(prompt).toMatch(
      /user-facing summary MUST be based solely on the latest PRIMARY tool_result/i
    );
    expect(prompt).toMatch(/Ignore DIAGNOSTIC tools in the user_message/i);
  });
});
