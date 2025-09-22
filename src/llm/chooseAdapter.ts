import { config } from "../config.js";
import { AnthropicAdapter } from "./providers/anthropic.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { OpenRouterAdapter } from "./providers/openrouter.js";
import { MockAdapter } from "./providers/mock.js";

export function chooseAdapter() {
  if (config.llmProvider === "anthropic") {
    if (!config.anthropicKey) throw new Error("ANTHROPIC_API_KEY missing");
    return new AnthropicAdapter(
      config.anthropicKey,
      "claude-3-5-sonnet-20240620"
    );
  }
  if (config.llmProvider === "openai") {
    if (!config.openaiKey) throw new Error("OPENAI_API_KEY missing");
    return new OpenAIAdapter(config.openaiKey, config.openaiModel);
  }
  if (config.llmProvider === "openrouter") {
    if (!config.openRouterKey) throw new Error("OPENROUTER_API_KEY missing");
    return new OpenRouterAdapter(config.openRouterKey, config.openRouterModel);
  }
  if (config.llmProvider === "mock") return new MockAdapter();
  throw new Error(`Unknown LLM_PROVIDER: ${config.llmProvider}`);
}
