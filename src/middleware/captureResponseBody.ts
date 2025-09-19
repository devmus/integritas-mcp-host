// src/middleware/captureResponseBody.ts
import type { Request, Response, NextFunction } from "express";

/**
 * Captures up to `maxBytes` of the response body into (res as any)._bodySample
 * so pino-http can include it in the serialized "res".
 */
export function captureResponseBody(maxBytes = 4096) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const origSend = res.send.bind(res);
    res.send = (body?: any) => {
      try {
        const buf = Buffer.isBuffer(body)
          ? body
          : Buffer.from(String(body ?? ""));
        (res as any)._bodySample = buf.slice(0, maxBytes).toString();
      } catch {
        // swallow
      }
      return origSend(body);
    };
    next();
  };
}
