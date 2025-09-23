type LLMErrorInfo = {
  isLLMTransport: boolean;
  isRateLimit: boolean;
  status?: number;
  retryAfter?: string | number;
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

  const msg = String(e?.message ?? "");
  const body = typeof e?.response?.data === "string" ? e.response.data : "";
  const text = (msg + "\n" + body).toLowerCase();

  const isGateway504 =
    status === 504 ||
    /504\s+gateway\s+time[- ]?out/i.test(text) ||
    /<title>\s*504\s+gateway/i.test(text);

  const isRateLimit =
    status === 429 ||
    /\brate[- ]?limit\b|\btoo many requests\b|retry-after/i.test(text);

  const isServiceUnavailable =
    status === 502 ||
    status === 503 ||
    /bad gateway|service unavailable/i.test(text);

  const isLLMProviderHint =
    /openai|anthropic|vertex|gemini|model api|llm/i.test(text);

  const isLLMTransport =
    isGateway504 || isRateLimit || isServiceUnavailable || isLLMProviderHint;

  const retryAfter =
    e?.response?.headers?.["retry-after"] ??
    e?.response?.headers?.["Retry-After"];

  return { isLLMTransport, isRateLimit, status, retryAfter };
}
