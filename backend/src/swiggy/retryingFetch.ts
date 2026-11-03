import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Wraps fetch so a 429 waits for Retry-After and tries again, within a total budget.
 * The MCP SDK hides response headers from callers, so 429 handling has to live here.
 */
export function createRateLimitedFetch(opts: {
  baseFetch?: FetchLike;
  budgetMs?: number;
  maxAttempts?: number;
  defaultRetryAfterMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
} = {}): FetchLike {
  const baseFetch = opts.baseFetch ?? fetch;
  const budgetMs = opts.budgetMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const defaultWait = opts.defaultRetryAfterMs ?? 5_000;
  const sleepFn = opts.sleepFn ?? sleep;
  const now = opts.now ?? Date.now;

  return async (url, init) => {
    const start = now();
    for (let attempt = 1; ; attempt++) {
      const res = await baseFetch(url, init);
      if (res.status !== 429 || attempt >= maxAttempts) return res;
      const wait = parseRetryAfter(res.headers.get("retry-after")) ?? defaultWait;
      if (now() - start + wait > budgetMs) return res;
      await res.body?.cancel().catch(() => undefined);
      await sleepFn(wait);
    }
  };
}
