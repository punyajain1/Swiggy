import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService, type AuthFn } from "../src/auth/authService.js";
import { MemoryAuthStore } from "../src/auth/authStore.js";
import { SwiggyOAuthProvider } from "../src/auth/oauthProvider.js";
import { CartService } from "../src/cart/cartService.js";
import { DecisionCache } from "../src/engine/decisionCache.js";
import { MemorySettingsStore } from "../src/settings/settings.js";
import type { SwiggyApi } from "../src/swiggy/api.js";
import { addressesSchema } from "../src/swiggy/schemas.js";
import { FakeLlm, testKey } from "./helpers.js";

async function build(opts: { connected?: boolean; healthy?: boolean; limit?: number } = {}) {
  const store = new MemoryAuthStore();
  const provider = new SwiggyOAuthProvider(store, { redirectUrl: "http://localhost:4000/auth/callback", encryptionKey: testKey() });
  const auth = new AuthService(store, provider, {
    serverUrl: "https://mcp.swiggy.com/food",
    authFn: vi.fn<AuthFn>(async () => "AUTHORIZED"),
    fetchFn: vi.fn(async () => new Response("{}")) as unknown as typeof fetch,
  });
  if (opts.connected) {
    await provider.saveTokens({ access_token: "a", refresh_token: "r", token_type: "Bearer", expires_in: 3600 });
  }
  const settings = new MemorySettingsStore();
  const api = {
    getAddresses: vi.fn(async () =>
      addressesSchema.parse({
        addresses: [{ id: "a1", addressLine: "12 MG Road, Bengaluru", addressTag: "Home" }],
        resolution: { defaultAddressId: "a1" },
      }),
    ),
  } as unknown as SwiggyApi;
  const cache = new DecisionCache();
  const app = createApp({
    auth,
    api,
    llm: new FakeLlm({}),
    settings,
    cache,
    cart: new CartService({ api, cache }),
    enableDebug: false,
    frontendOrigin: "http://localhost:3000",
    healthCheck: async () => {
      if (opts.healthy === false) throw new Error("db down");
    },
    decideRateLimit: { windowMs: 60_000, limit: opts.limit ?? 100 },
  });
  return { app, store, settings };
}

describe("GET /health", () => {
  it("reports the database", async () => {
    const { app } = await build();
    expect((await request(app).get("/health")).body).toEqual({ status: "ok", db: "ok" });
  });
  it("returns 503 when the database is down", async () => {
    const { app } = await build({ healthy: false });
    expect((await request(app).get("/health")).status).toBe(503);
  });
});

describe("settings", () => {
  it("validates and saves preferences", async () => {
    const { app } = await build();
    const bad = await request(app).put("/api/settings").send({ defaultServings: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_REQUEST");

    const unknown = await request(app).put("/api/settings").send({ isAdmin: true });
    expect(unknown.status).toBe(400);

    const ok = await request(app).put("/api/settings").send({ defaultServings: 4, skillLevel: "confident", hasBasicStaples: false });
    expect(ok.status).toBe(200);
    const saved = await request(app).get("/api/settings");
    expect(saved.body).toMatchObject({ defaultServings: 4, skillLevel: "confident", hasBasicStaples: false });
  });

  it("rejects malformed JSON", async () => {
    const { app } = await build();
    const res = await request(app).put("/api/settings").set("Content-Type", "application/json").send("{oops");
    expect(res.status).toBe(400);
  });
});

describe("Swiggy-backed routes", () => {
  it("require a connected account", async () => {
    const { app } = await build();
    const res = await request(app).post("/api/decide").send({ text: "butter chicken" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SWIGGY_NOT_CONNECTED");
  });

  it("require an address before deciding", async () => {
    const { app } = await build({ connected: true });
    const res = await request(app).post("/api/decide").send({ text: "butter chicken" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_ADDRESS");
  });

  it("rate-limit /api/decide", async () => {
    const { app } = await build({ connected: true, limit: 2 });
    await request(app).post("/api/decide").send({ text: "butter chicken" });
    await request(app).post("/api/decide").send({ text: "butter chicken" });
    const third = await request(app).post("/api/decide").send({ text: "butter chicken" });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("protect /api/sidequest the same way", async () => {
    const { app } = await build();
    const res = await request(app).post("/api/sidequest").send({ text: "evening in Delhi" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SWIGGY_NOT_CONNECTED");

    const connected = await build({ connected: true });
    expect((await request(connected.app).post("/api/sidequest").send({ text: "x" })).status).toBe(400);
    const noAddress = await request(connected.app).post("/api/sidequest").send({ text: "evening in Delhi" });
    expect(noAddress.status).toBe(409);
    expect(noAddress.body.error.code).toBe("NO_ADDRESS");
  });

  it("rate-limit /api/sidequest separately from /api/decide", async () => {
    const { app } = await build({ connected: true });
    // decide's limit is 100 in tests; sidequest's own default is 10 per minute.
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await request(app).post("/api/sidequest").send({ text: "evening in Delhi" })).status;
    expect(last).toBe(429);
  });

  it("list addresses", async () => {
    const { app } = await build({ connected: true });
    const res = await request(app).get("/api/addresses");
    expect(res.body).toEqual({
      addresses: [{ id: "a1", label: "Home", line: "12 MG Road, Bengaluru" }],
      defaultAddressId: "a1",
    });
  });

  it("validate cart requests", async () => {
    const { app } = await build({ connected: true });
    const res = await request(app).post("/api/cart/food").send({ decisionId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });
});

describe("OAuth callback", () => {
  it("sends you back to settings with an error when state doesn't match", async () => {
    const { app, store } = await build();
    await store.update({ state: "real", stateCreatedAt: new Date() });
    const res = await request(app).get("/auth/callback?code=abc&state=forged");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^http:\/\/localhost:3000\/settings\?authError=/);
  });

  it("handles a cancelled login", async () => {
    const { app } = await build();
    const res = await request(app).get("/auth/callback?error=access_denied");
    expect(res.headers.location).toContain("authError=access_denied");
  });

  it("connects when state matches", async () => {
    const { app, store } = await build();
    await store.update({ state: "real", stateCreatedAt: new Date() });
    const res = await request(app).get("/auth/callback?code=abc&state=real");
    expect(res.headers.location).toBe("http://localhost:3000/settings?connected=1");
  });
});
