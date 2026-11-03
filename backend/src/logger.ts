import pino from "pino";

const isDev = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

/**
 * App logger. Token-bearing fields are redacted, so even an accidental log of a
 * token object or auth header never reaches the output.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: [
      "access_token",
      "refresh_token",
      "*.access_token",
      "*.refresh_token",
      "tokens",
      "*.tokens",
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "authorization",
      "code_verifier",
      "*.code_verifier",
    ],
    censor: "[redacted]",
  },
  ...(isDev ? { transport: { target: "pino-pretty", options: { colorize: true, singleLine: true } } } : {}),
});
