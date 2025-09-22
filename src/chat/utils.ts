export const clamp = (s: unknown, n = 800) => {
  try {
    const str = typeof s === "string" ? s : JSON.stringify(s);
    return str.length > n ? str.slice(0, n) + "…" : str;
  } catch {
    return String(s).slice(0, n) + "…";
  }
};

export function tryParseJSON<T = any>(s: string): T | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function deepMerge<T>(base: T, extra: Partial<T>): T {
  if (base && extra && typeof base === "object" && typeof extra === "object") {
    const out: any = Array.isArray(base)
      ? [...(base as any)]
      : { ...(base as any) };
    for (const [k, v] of Object.entries(extra)) {
      if (
        v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        out[k] &&
        typeof out[k] === "object"
      ) {
        out[k] = deepMerge(out[k], v as any);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return (extra as T) ?? base;
}
