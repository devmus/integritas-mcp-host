type LLMErrorReason =
  | "rate_limit"
  | "billing"
  | "auth"
  | "service_unavailable"
  | "gateway_timeout"
  | "model_unavailable"
  | "unknown";

type LLMErrorInfo = {
  isLLMTransport: boolean;
  isRateLimit: boolean;
  status?: number;
  retryAfter?: string | number;
  /** Short, user-friendly summary (safe to display) */
  message?: string;
  /** Best-effort classification */
  reason?: LLMErrorReason;
};

export function classifyLLMError(err: unknown): LLMErrorInfo {
  const e = err as any;

  // Pull status from common places and normalize to number | undefined
  const rawStatus = e?.status ?? e?.response?.status ?? e?.cause?.status;
  const status: number | undefined =
    typeof rawStatus === "number"
      ? rawStatus
      : e?.code === "ETIMEDOUT"
      ? 504
      : undefined;

  // Extract server-provided error payload if present
  const data = e?.response?.data ?? e?.error ?? e?.response?.body;
  const dataStr =
    typeof data === "string" ? data : data ? JSON.stringify(data) : "";

  const msg = String(e?.message ?? "");
  const text = (msg + "\n" + dataStr).toLowerCase();

  // Heuristics
  const isGateway504 =
    status === 504 ||
    /504\s+gateway\s+time[- ]?out/i.test(text) ||
    /<title>\s*504\s+gateway/i.test(text);

  const isRateLimit =
    status === 429 ||
    /\brate[- ]?limit\b|\btoo many requests\b|retry-after/.test(text);

  const isServiceUnavailable =
    status === 502 ||
    status === 503 ||
    /bad gateway|service unavailable|upstream timed out|temporarily unavailable/.test(
      text
    );

  const isAuth =
    status === 401 ||
    /unauthorized|invalid api key|api key required|missing api key|forbidden|invalid_auth/.test(
      text
    );

  const isBilling =
    status === 402 ||
    /insufficient credit|insufficient balance|balance is too low|out of credits|billing|payment required/.test(
      text
    );

  const isModelUnavailable =
    status === 404 ||
    /model .* not found|unknown model|unsupported model|model is not available|model .* disabled/.test(
      text
    );

  const isLLMProviderHint =
    /openai|anthropic|vertex|gemini|model api|openrouter|llm/.test(text);

  const isLLMTransport =
    isGateway504 ||
    isRateLimit ||
    isServiceUnavailable ||
    isLLMProviderHint ||
    isAuth ||
    isBilling ||
    isModelUnavailable;

  const retryAfter =
    e?.response?.headers?.["retry-after"] ??
    e?.response?.headers?.["Retry-After"];

  // Build a concise, user-safe message
  let reason: LLMErrorReason = "unknown";
  let message: string | undefined;

  if (isBilling) {
    reason = "billing";
    // Try to pull vendor message (Anthropic/OpenAI/OpenRouter shapes)
    const vendorMsg =
      e?.error?.error?.message ??
      e?.response?.data?.error?.message ??
      e?.response?.data?.message ??
      e?.message;
    message =
      vendorMsg ||
      "Billing/credits issue with the selected model. Please check your plan/credits.";
  } else if (isAuth) {
    reason = "auth";
    message =
      "Authentication failed for the selected provider. Check API key/permissions.";
  } else if (isRateLimit) {
    reason = "rate_limit";
    message = "Rate limit reached. Please try again later.";
    if (retryAfter) message += ` Retry-After: ${retryAfter}`;
  } else if (isGateway504) {
    reason = "gateway_timeout";
    message = "Upstream model gateway timed out.";
  } else if (isServiceUnavailable) {
    reason = "service_unavailable";
    message = "Model service is temporarily unavailable.";
  } else if (isModelUnavailable) {
    reason = "model_unavailable";
    message =
      "The requested model is unavailable or not found for this provider.";
  } else if (isLLMProviderHint) {
    // generic LLM provider error, preserve vendor message if helpful
    reason = "unknown";
    message =
      e?.response?.data?.error?.message ??
      e?.error?.message ??
      e?.message ??
      "LLM provider returned an error.";
  }

  return { isLLMTransport, isRateLimit, status, retryAfter, message, reason };
}
