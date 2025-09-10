// src/logger.ts
import * as pinoNS from "pino";
import * as pinoHttpNS from "pino-http";

// Get callable functions regardless of ESM/CJS typing
const pino = (pinoNS as any).default ?? (pinoNS as any);
const pinoHttp = (pinoHttpNS as any).default ?? (pinoHttpNS as any);

// Type alias from pino-http
type PinoHttpOptions = import("pino-http").Options;

// src/logger.ts
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "integritas-mcp-host" },
  messageKey: "msg",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-api-key']",
      // add any others you might pass through:
      "req.headers['x-openai-api-key']",
      "req.headers['x-anthropic-api-key']",
      "req.headers['x-openrouter-api-key']",
      "req.body.apiKey", // if you forward apiKey in the body
    ],
    remove: true,
  },
});

// Build options with explicit type so TS chooses the options overload
const httpOptions: PinoHttpOptions = {
  logger: log as any, // pino-http v8 expects Logger<Levels>; this cast is fine
  autoLogging: {
    // more portable than ignorePaths across versions
    ignore: (req) => {
      const url = req.url || "";
      return url === "/health" || url === "/_tools";
    },
  },
  customLogLevel: (res, err) => {
    if (err) return "error";
    const code = res.statusCode ?? 0; // guard 'possibly undefined'
    if (code >= 500) return "error";
    if (code >= 400) return "warn";
    return "info";
  },
  serializers: {
    req(req) {
      return { method: req.method, url: req.url };
    },
    res(res) {
      return { statusCode: res.statusCode ?? 0 };
    },
  },
};

export const httpLogger = pinoHttp(httpOptions);
