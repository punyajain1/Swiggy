import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { correlationId } from "../context.js";
import { errors, HttpError } from "../errors.js";
import { logger } from "../logger.js";
import type { SwiggyServer, ToolTransport } from "./mcpClient.js";
import { sleep } from "./retryingFetch.js";

/**
 * The only tools this app may call. Order placement and payment tools
 * (place_food_order, checkout, confirm_order, ...) are deliberately absent:
 * the app fills carts and the user places the order in the Swiggy app.
 */
export const ALLOWED_TOOLS: Record<SwiggyServer, ReadonlySet<string>> = {
  food: new Set(["get_addresses", "search_restaurants", "search_menu", "update_food_cart", "get_food_cart"]),
  im: new Set(["get_addresses", "search_products", "update_cart", "get_cart"]),
  // SideQuest only reads Dineout and Scenes. Booking, cart and payment tools stay out on purpose.
  dineout: new Set(["search_restaurants_dineout", "get_available_slots"]),
  scenes: new Set(["discover_events", "get_events_collection", "search_events", "get_event_details", "list_event_shows"]),
};

export interface SessionControl {
  forceRefresh(): Promise<void>;
  markDisconnected(reason: string): Promise<void>;
}

export interface CallToolDeps {
  transport: ToolTransport;
  session: SessionControl;
  budgetMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

/** A tool that ran but reported failure (`success: false` or `isError`). Not retried. */
export class SwiggyToolError extends HttpError {
  constructor(tool: string, message: string) {
    super(502, "SWIGGY_TOOL_ERROR", `Swiggy ${tool}: ${message}`);
  }
}

const JSONRPC_AUTH = -32001;
const JSONRPC_INTERNAL = -32603;

type Classified = "auth_http" | "auth_rpc" | "retryable" | "rate_limited" | "fatal";

export function classifyError(err: unknown): Classified {
  if (err instanceof UnauthorizedError) return "auth_http";
  if (err instanceof StreamableHTTPError) {
    const status = err.code ?? 0;
    if (status === 401) return "auth_http";
    if (status === 429) return "rate_limited";
    if (status >= 500 && status < 600) return "retryable";
    return "fatal";
  }
  if (err instanceof McpError) {
    // The SDK reports its own request timeout with the same code (-32001) that Swiggy uses for
    // auth failures, so the message tells them apart.
    if (err.code === JSONRPC_AUTH) return /timed out/i.test(err.message) ? "retryable" : "auth_rpc";
    if (err.code === JSONRPC_INTERNAL) return "retryable";
    return "fatal";
  }
  // fetch() network failures surface as TypeError ("fetch failed") or AbortError/timeouts.
  if (err instanceof TypeError || (err as Error)?.name === "AbortError" || (err as Error)?.name === "TimeoutError") {
    return "retryable";
  }
  return "fatal";
}

function textOf(result: CallToolResult): string {
  return (result.content ?? [])
    .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n");
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  message?: string;
  error?: { message?: string } | string;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && "success" in value;
}

/**
 * Extracts `data` from a tool result. Swiggy wraps payloads as
 * `{ success, data, message }`; it may arrive as structuredContent or as JSON text.
 */
export function unwrapToolResult(tool: string, result: CallToolResult): unknown {
  const text = textOf(result);
  const candidates = [result.structuredContent, tryJson(text)];
  const envelope = candidates.find(isEnvelope);

  if (result.isError || envelope?.success === false) {
    const errMsg =
      (typeof envelope?.error === "string" ? envelope.error : envelope?.error?.message) ??
      envelope?.message ??
      (text || "the tool reported an error");
    throw new SwiggyToolError(tool, errMsg);
  }
  if (envelope) return envelope.data ?? {};
  if (result.structuredContent) return result.structuredContent;
  const parsed = tryJson(text);
  if (parsed !== undefined) return parsed;
  throw new SwiggyToolError(tool, "returned a response this app can't read");
}

/**
 * Calls a Swiggy MCP tool with the error handling the Swiggy docs ask for:
 * - auth failure: refresh the token once, then ask the user to reconnect
 * - 429: already retried after Retry-After by the fetch layer; reported if still limited
 * - 5xx / network / JSON-RPC -32603: exponential backoff (500, 1000, 2000, 4000 ms + jitter) within 30 s
 * - anything else: fails fast
 */
export async function callTool<S extends z.ZodType>(
  deps: CallToolDeps,
  server: SwiggyServer,
  tool: string,
  args: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  return invoke(deps, server, tool, args, (result) => {
    const parsed = schema.safeParse(unwrapToolResult(tool, result));
    if (!parsed.success) {
      logger.warn({ tool, server, correlationId: correlationId(), issues: parsed.error.issues.slice(0, 5) }, "Unexpected Swiggy response shape");
      throw new SwiggyToolError(tool, "returned data in an unexpected shape");
    }
    return parsed.data;
  });
}

/** The text of a tool result, with an error result turned into a thrown SwiggyToolError. */
export function textOrThrow(tool: string, result: CallToolResult): string {
  const text = textOf(result);
  if (result.isError) throw new SwiggyToolError(tool, text || "the tool reported an error");
  return text;
}

/**
 * Like callTool, for tools that answer in text only. Swiggy's Dineout search and slot tools return
 * `structuredContent: {}` and put the data in a numbered text list, so the structured path would
 * read them as empty. `parse` gets the text and throws SwiggyToolError if it can't read it.
 * Same auth, retry and rate-limit handling as callTool.
 */
export async function callToolText<T>(
  deps: CallToolDeps,
  server: SwiggyServer,
  tool: string,
  args: Record<string, unknown>,
  parse: (text: string) => T,
): Promise<T> {
  return invoke(deps, server, tool, args, (result) => parse(textOrThrow(tool, result)));
}

async function invoke<T>(
  deps: CallToolDeps,
  server: SwiggyServer,
  tool: string,
  args: Record<string, unknown>,
  handle: (result: CallToolResult) => T,
): Promise<T> {
  if (!ALLOWED_TOOLS[server].has(tool)) {
    throw new Error(`Tool "${tool}" on "${server}" is not allowed in this app`);
  }
  const sleepFn = deps.sleepFn ?? sleep;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const budgetMs = deps.budgetMs ?? 30_000;
  const cid = correlationId();
  const start = now();
  let refreshed = false;

  for (let attempt = 1; ; attempt++) {
    const t0 = now();
    try {
      const result = await deps.transport.callTool(server, tool, args);
      const value = handle(result);
      logger.info({ event: "mcp_tool_call", tool, server, correlationId: cid, durationMs: now() - t0, status: "ok", attempt });
      return value;
    } catch (err) {
      const kind = err instanceof HttpError ? "fatal" : classifyError(err);
      logger.warn({
        event: "mcp_tool_call",
        tool,
        server,
        correlationId: cid,
        durationMs: now() - t0,
        status: "error",
        kind,
        attempt,
        message: (err as Error).message,
      });

      if (kind === "auth_rpc" && !refreshed) {
        refreshed = true;
        await deps.session.forceRefresh();
        continue;
      }
      if (kind === "auth_http" || kind === "auth_rpc") {
        // The SDK transport already tried a refresh on HTTP 401 before throwing.
        await deps.session.markDisconnected("unauthorized");
        throw errors.reconnect("unauthorized");
      }
      if (kind === "rate_limited") {
        throw new HttpError(503, "SWIGGY_RATE_LIMITED", "Swiggy is busy right now. Try again in a minute.");
      }
      if (kind === "retryable") {
        const base = 500 * 2 ** (attempt - 1);
        const wait = base + random() * base * 0.3;
        if (attempt < 5 && now() - start + wait <= budgetMs) {
          await sleepFn(wait);
          continue;
        }
        throw errors.upstream("swiggy", `Swiggy ${tool} is not responding. Try again shortly.`);
      }
      if (err instanceof HttpError) throw err;
      throw errors.upstream("swiggy", `Swiggy ${tool} failed: ${(err as Error).message}`);
    }
  }
}
