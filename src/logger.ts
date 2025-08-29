import pino from "pino";
import { pinoHttp } from "pino-http";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty" }
      : undefined,
});

export const httpLogger = pinoHttp({
  customProps: (req) => ({
    userId: req.headers["x-user-id"] as string | undefined,
    requestId: req.headers["x-request-id"] as string | undefined,
  }),
});
