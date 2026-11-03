import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { runWithContext } from "./context.js";
import { HttpError } from "./errors.js";
import { logger } from "./logger.js";

const CORRELATION_HEADER = "x-correlation-id";
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Attaches a correlation ID (from the request header if it's safe, else a new UUID) and logs the request. */
export const correlation: RequestHandler = (req, res, next) => {
  const incoming = req.header(CORRELATION_HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  res.locals.correlationId = id;
  const start = Date.now();
  res.on("finish", () => {
    logger.info(
      { correlationId: id, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start },
      "request",
    );
  });
  runWithContext(id, next);
};

/** Turns any thrown error into a JSON body: { error: { code, message, details?, correlationId } }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const correlationId = res.locals.correlationId as string | undefined;
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error({ correlationId, err }, err.message);
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, correlationId } });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Invalid request", details: z.flattenError(err), correlationId },
    });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed JSON body", correlationId } });
    return;
  }
  logger.error({ correlationId, err }, "Unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side.", correlationId } });
};
