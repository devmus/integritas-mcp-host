import { tryParseJSON } from "./utils.js";
import { PRIMARY_TOOLS } from "./constants.js";

export function finalizeText(result: any, steps: any[]) {
  let finalText = result.text as string | undefined;
  const lastPrimary = [...steps]
    .reverse()
    .find((s) => PRIMARY_TOOLS.has(s.name));
  const obj = tryParseJSON<any>(result.text || "");

  if (obj && typeof obj === "object") {
    obj.chain = "Minima";
    if (lastPrimary && (!obj.action || !PRIMARY_TOOLS.has(obj.action)))
      obj.action = lastPrimary.name;

    // Prefer model-provided message; else synthesize from lastPrimary
    let msg = String(obj.user_message ?? "");
    if (!msg && lastPrimary) {
      const sc = (lastPrimary.result as any)?.structuredContent || {};
      if (
        lastPrimary.name === "stamp_hash" ||
        lastPrimary.name === "stamp_data"
      ) {
        msg = `Hash stamped on Minima. uid=${sc.uid ?? "not provided"}, tx_id=${
          sc.tx_id ?? "not provided"
        }, stamped_at=${sc.stamped_at ?? "not provided"}.`;
      } else if (lastPrimary.name === "verify_data_with_proof") {
        const link = sc.verification_url
          ? ` Report: ${sc.verification_url}`
          : "";
        msg = `Verification: ${sc.summary ?? sc.result ?? "completed"}.${link}`;
      } else {
        msg = `Result on Minima: ${sc.summary ?? "completed"}.`;
      }
    }
    finalText = msg || finalText || "Done.";
  } else if (lastPrimary) {
    const sc = (lastPrimary.result as any)?.structuredContent || {};
    if (
      lastPrimary.name === "stamp_hash" ||
      lastPrimary.name === "stamp_data"
    ) {
      finalText = `Hash stamped on Minima. uid=${
        sc.uid ?? "not provided"
      }, tx_id=${sc.tx_id ?? "not provided"}, stamped_at=${
        sc.stamped_at ?? "not provided"
      }.`;
    } else if (lastPrimary.name === "verify_data_with_proof") {
      const link = sc.verification_url ? ` Report: ${sc.verification_url}` : "";
      finalText = `Verification: ${
        sc.summary ?? sc.result ?? "completed"
      }.${link}`;
    } else {
      finalText = `Result on Minima: ${sc.summary ?? "completed"}.`;
    }
  }

  return finalText ?? "Done.";
}
