import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with a correlation ID that every log line and MCP call inside it can read. */
export function runWithContext<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

export function correlationId(): string {
  return storage.getStore()?.correlationId ?? randomUUID();
}
