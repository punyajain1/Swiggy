import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ALLOWED_TOOLS, callTool, unwrapToolResult, type CallToolDeps } from "../src/swiggy/callTool.js";
import type { ToolTransport } from "../src/swiggy/mcpClient.js";
import { createRateLimitedFetch, parseRetryAfter } from "../src/swiggy/retryingFetch.js";
import { addressesSchema } from "../src/swiggy/schemas.js";
import { toolResult } from "./helpers.js";

const schema = z.looseObject({ ok: z.boolean() });

function deps(responses: Array<CallToolResult | Error>, extra: Partial<CallToolDeps> = {}) {
  let t = 0;
  const waits: number[] = [];
  const transport: ToolTransport = {
    callTool: vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const session = { forceRefresh: vi.fn(async () => {}), markDisconnected: vi.fn(async () => {}) };
  const d: CallToolDeps = {
    transport,
    session,
    now: () => t,
    sleepFn: async (ms) => {
      waits.push(ms);
      t += ms;
    },
    random: () => 0,
    ...extra,
  };
  return { d, transport, session, waits };
}

describe("unwrapToolResult", () => {
  it("reads the envelope from structuredContent", () => {
    expect(unwrapToolResult("t", toolResult({ ok: true }) as CallToolResult)).toEqual({ ok: true });
  });

  it("reads the envelope from JSON text", () => {
    const r = { content: [{ type: "text", text: JSON.stringify({ success: true, data: { ok: true } }) }] } as CallToolResult;
    expect(unwrapToolResult("t", r)).toEqual({ ok: true });
  });

  it("throws the tool's error message on success: false", () => {
    const r = { content: [], structuredContent: { success: false, error: { message: "Restaurant closed" } } } as CallToolResult;
    expect(() => unwrapToolResult("t", r)).toThrow(/Restaurant closed/);
  });

  it("parses a saved get_addresses payload", () => {
    const data = unwrapToolResult(
      "get_addresses",
      toolResult({
        addresses: [{ id: "a1", addressLine: "12 MG Road", phoneNumber: "x", addressTag: "Home" }],
        pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1, hasMore: false },
        resolution: { defaultAddressId: "a1", resolutionSource: "ranked_saved_address", needsUserClarification: false, candidateAddressIds: ["a1"] },
      }) as CallToolResult,
    );
    const parsed = addressesSchema.parse(data);
    expect(parsed.addresses[0]?.addressTag).toBe("Home");
    expect(parsed.resolution?.defaultAddressId).toBe("a1");
  });
});

describe("callTool retries", () => {
  it("refreshes once on JSON-RPC -32001, then succeeds", async () => {
    const { d, session } = deps([new McpError(-32001, "unauthorized"), toolResult({ ok: true }) as CallToolResult]);
    await expect(callTool(d, "food", "get_addresses", {}, schema)).resolves.toEqual({ ok: true });
    expect(session.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it("asks to reconnect when auth still fails", async () => {
    const { d, session } = deps([new McpError(-32001, "unauthorized"), new McpError(-32001, "unauthorized")]);
    await expect(callTool(d, "food", "get_addresses", {}, schema)).rejects.toMatchObject({ code: "SWIGGY_RECONNECT" });
    expect(session.markDisconnected).toHaveBeenCalled();
  });

  it("asks to reconnect on HTTP 401 (the SDK already tried to refresh)", async () => {
    const { d } = deps([new UnauthorizedError()]);
    await expect(callTool(d, "food", "get_addresses", {}, schema)).rejects.toMatchObject({ status: 401 });
  });

  it("backs off 500/1000/2000/4000 ms on 5xx, then gives up", async () => {
    const err = () => new StreamableHTTPError(503, "down");
    const { d, transport, waits } = deps([err(), err(), err(), err(), err()]);
    await expect(callTool(d, "food", "search_menu", {}, schema)).rejects.toMatchObject({ code: "SWIGGY_ERROR" });
    expect(waits).toEqual([500, 1000, 2000, 4000]);
    expect(transport.callTool).toHaveBeenCalledTimes(5);
  });

  it("stops early when the time budget runs out", async () => {
    const err = () => new StreamableHTTPError(500, "down");
    const { d, transport } = deps([err(), err(), err(), err(), err()], { budgetMs: 2000 });
    await expect(callTool(d, "food", "search_menu", {}, schema)).rejects.toThrow();
    expect(transport.callTool).toHaveBeenCalledTimes(3);
  });

  it("retries network errors", async () => {
    const { d } = deps([new TypeError("fetch failed"), toolResult({ ok: true }) as CallToolResult]);
    await expect(callTool(d, "im", "search_products", {}, schema)).resolves.toEqual({ ok: true });
  });

  it("does not retry a 4xx", async () => {
    const { d, transport } = deps([new StreamableHTTPError(400, "bad"), toolResult({ ok: true }) as CallToolResult]);
    await expect(callTool(d, "food", "search_menu", {}, schema)).rejects.toThrow();
    expect(transport.callTool).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with the wrong shape", async () => {
    const { d } = deps([toolResult({ ok: "yes" }) as CallToolResult]);
    await expect(callTool(d, "food", "search_menu", {}, schema)).rejects.toMatchObject({ code: "SWIGGY_TOOL_ERROR" });
  });
});

describe("order placement guard", () => {
  it.each(["place_food_order", "checkout", "confirm_order", "check_payment_status"])("never allows %s", async (tool) => {
    expect(ALLOWED_TOOLS.food.has(tool)).toBe(false);
    expect(ALLOWED_TOOLS.im.has(tool)).toBe(false);
    const { d, transport } = deps([toolResult({ ok: true }) as CallToolResult]);
    await expect(callTool(d, "food", tool, {}, schema)).rejects.toThrow(/not allowed/);
    await expect(callTool(d, "im", tool, {}, schema)).rejects.toThrow(/not allowed/);
    expect(transport.callTool).not.toHaveBeenCalled();
  });
});

describe("429 handling", () => {
  it("parses Retry-After", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("waits for Retry-After and tries again", async () => {
    const waits: number[] = [];
    const baseFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const f = createRateLimitedFetch({ baseFetch, sleepFn: async (ms) => void waits.push(ms) });
    const res = await f("https://mcp.swiggy.com/food");
    expect(res.status).toBe(200);
    expect(waits).toEqual([2000]);
  });

  it("gives up when Retry-After exceeds the budget", async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "60" } }));
    const f = createRateLimitedFetch({ baseFetch, sleepFn: async () => {} });
    expect((await f("https://mcp.swiggy.com/food")).status).toBe(429);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});
