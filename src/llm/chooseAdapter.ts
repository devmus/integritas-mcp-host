// import { config } from "../config.js";
// import { AnthropicAdapter } from "./providers/anthropic.js";
// import { OpenAIAdapter } from "./providers/openai.js";
// import { OpenRouterAdapter } from "./providers/openrouter.js";
// import { MockAdapter } from "./providers/mock.js";

// export function chooseAdapter() {
//   if (config.llmProvider === "anthropic") {
//     if (!config.anthropicKey) throw new Error("ANTHROPIC_API_KEY missing");
//     return new AnthropicAdapter(
//       config.anthropicKey,
//       "claude-3-5-sonnet-20240620"
//     );
//   }
//   if (config.llmProvider === "openai") {
//     if (!config.openaiKey) throw new Error("OPENAI_API_KEY missing");
//     return new OpenAIAdapter(config.openaiKey, config.openaiModel);
//   }
//   if (config.llmProvider === "openrouter") {
//     if (!config.openRouterKey) throw new Error("OPENROUTER_API_KEY missing");
//     return new OpenRouterAdapter(config.openRouterKey, config.openRouterModel);
//   }
//   if (config.llmProvider === "mock") return new MockAdapter();
//   throw new Error(`Unknown LLM_PROVIDER: ${config.llmProvider}`);
// }

// src/llm/chooseAdapter.ts
import { config } from "../config.js";
import { AnthropicAdapter } from "./providers/anthropic.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { OpenRouterAdapter } from "./providers/openrouter.js";
import { MockAdapter } from "./providers/mock.js";

export type LLMProvider = "anthropic" | "openai" | "openrouter" | "mock";

export type LLMChoice = {
  provider?: LLMProvider; // optional, falls back to config.llmProvider
  model?: string; // optional, falls back to config defaults
};

const allowedModels = {
  allowedAnthropicModels: [
    "claude-3-5-sonnet-20240620",
    "claude-3-5-haiku-20241022",
  ],
  allowedOpenAIModels: ["gpt-4o-mini", "gpt-4.1-mini"],
  allowedOpenRouterModels: [
    "google/gemma-2-9b-it:free",
    "openai/gpt-4o-mini",
    "deepseek/deepseek-chat-v3.1:free",
  ],
};

const DEFAULTS = {
  anthropic: config.anthropicModel ?? "claude-3-5-sonnet-20240620",
  openai: config.openaiModel ?? "gpt-4o-mini",
  openrouter: config.openRouterModel ?? "deepseek/deepseek-chat-v3.1:free",
  mock: "mock",
} as const;

// (optional) harden with a server-side allowlist
const ALLOWED: Partial<Record<LLMProvider, string[]>> = {
  anthropic: allowedModels.allowedAnthropicModels,
  openai: allowedModels.allowedOpenAIModels,
  openrouter: allowedModels.allowedOpenRouterModels,
  // mock has no restriction
};

function assertAllowed(provider: LLMProvider, model: string) {
  const list = ALLOWED[provider];
  if (list && !list.includes(model)) {
    throw new Error(`Model not allowed for ${provider}: ${model}`);
  }
}

export function chooseAdapter(choice?: LLMChoice) {
  const provider: LLMProvider = (choice?.provider ??
    config.llmProvider) as LLMProvider;

  if (provider === "anthropic") {
    if (!config.anthropicKey) throw new Error("ANTHROPIC_API_KEY missing");
    const model = choice?.model ?? DEFAULTS.anthropic;
    assertAllowed("anthropic", model);
    return new AnthropicAdapter(config.anthropicKey, model);
  }

  if (provider === "openai") {
    if (!config.openaiKey) throw new Error("OPENAI_API_KEY missing");
    const model = choice?.model ?? DEFAULTS.openai;
    assertAllowed("openai", model);
    return new OpenAIAdapter(config.openaiKey, model);
  }

  if (provider === "openrouter") {
    if (!config.openRouterKey) throw new Error("OPENROUTER_API_KEY missing");
    const model = choice?.model ?? DEFAULTS.openrouter;
    assertAllowed("openrouter", model);
    return new OpenRouterAdapter(config.openRouterKey, model);
  }

  if (provider === "mock") {
    return new MockAdapter();
  }

  throw new Error(`Unknown LLM provider: ${String(provider)}`);
}
