import { describe, expect, it, vi } from "vitest";
import { AuthService, type AuthFn } from "../src/auth/authService.js";
import { MemoryAuthStore } from "../src/auth/authStore.js";
import { SwiggyOAuthProvider } from "../src/auth/oauthProvider.js";
import { testKey } from "./helpers.js";

const NOW = 1_800_000_000_000;

function setup(authImpl?: AuthFn) {
  const store = new MemoryAuthStore();
  const provider = new SwiggyOAuthProvider(store, {
    redirectUrl: "http://localhost:4000/auth/callback",
    encryptionKey: testKey(),
    now: () => NOW,
  });
  const authFn = vi.fn<AuthFn>(authImpl ?? (async () => "AUTHORIZED"));
  const onSessionChange = vi.fn();
  const service = new AuthService(store, provider, {
    serverUrl: "https://mcp.swiggy.com/food",
    authFn,
    now: () => NOW,
    fetchFn: vi.fn(async () => new Response("{}")) as unknown as typeof fetch,
    onSessionChange,
  });
  return { store, provider, service, authFn, onSessionChange };
}

describe("SwiggyOAuthProvider", () => {
  it("stores tokens encrypted and reads them back", async () => {
    const { store, provider } = setup();
    await provider.saveTokens({ access_token: "acc-123", refresh_token: "ref-456", token_type: "Bearer", expires_in: 3600 });
    expect(store.row.accessTokenEnc).not.toContain("acc-123");
    expect(store.row.refreshTokenEnc).not.toContain("ref-456");
    expect(store.row.expiresAt?.getTime()).toBe(NOW + 3_600_000);

    const tokens = await provider.tokens();
    expect(tokens?.access_token).toBe("acc-123");
    expect(tokens?.refresh_token).toBe("ref-456");
    expect(tokens?.expires_in).toBe(3600);
  });

  it("keeps the old refresh token if a refresh response has none", async () => {
    const { provider } = setup();
    await provider.saveTokens({ access_token: "a1", refresh_token: "r1", token_type: "Bearer" });
    await provider.saveTokens({ access_token: "a2", token_type: "Bearer" });
    expect((await provider.tokens())?.refresh_token).toBe("r1");
  });

  it("clears tokens on invalidateCredentials('tokens')", async () => {
    const { provider } = setup();
    await provider.saveTokens({ access_token: "a1", token_type: "Bearer" });
    await provider.invalidateCredentials("tokens");
    expect(await provider.tokens()).toBeUndefined();
  });
});

describe("AuthService", () => {
  it("returns the Swiggy login URL", async () => {
    const { service, provider } = setup(async (p) => {
      await p.state?.();
      p.redirectToAuthorization(new URL("https://mcp.swiggy.com/auth/authorize?x=1"));
      return "REDIRECT";
    });
    const url = await service.startLogin();
    expect(url.toString()).toContain("/auth/authorize");
    expect(provider.pendingAuthorizationUrl).toBeDefined();
  });

  it("rejects a callback whose state doesn't match", async () => {
    const { service, store, authFn } = setup();
    await store.update({ state: "expected-state", stateCreatedAt: new Date(NOW) });
    await expect(service.finishLogin("code", "attacker-state")).rejects.toMatchObject({ status: 400 });
    expect(authFn).not.toHaveBeenCalled();
  });

  it("rejects an expired state", async () => {
    const { service, store } = setup();
    await store.update({ state: "s", stateCreatedAt: new Date(NOW - 11 * 60 * 1000) });
    await expect(service.finishLogin("code", "s")).rejects.toMatchObject({ status: 400 });
  });

  it("exchanges the code when state matches", async () => {
    const { service, store, authFn, onSessionChange } = setup();
    await store.update({ state: "s", stateCreatedAt: new Date(NOW) });
    await service.finishLogin("the-code", "s");
    expect(authFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ authorizationCode: "the-code" }));
    expect(store.row.state).toBeNull();
    expect(onSessionChange).toHaveBeenCalled();
  });

  it("says 'not connected' with no token", async () => {
    const { service } = setup();
    await expect(service.ensureFreshToken()).rejects.toMatchObject({ code: "SWIGGY_NOT_CONNECTED" });
  });

  it("refreshes early when 60 s or less remain", async () => {
    const { service, provider, authFn } = setup();
    await provider.saveTokens({ access_token: "a", refresh_token: "r", token_type: "Bearer", expires_in: 30 });
    await service.ensureFreshToken();
    expect(authFn).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a token with plenty of time left", async () => {
    const { service, provider, authFn } = setup();
    await provider.saveTokens({ access_token: "a", refresh_token: "r", token_type: "Bearer", expires_in: 3600 });
    await service.ensureFreshToken();
    expect(authFn).not.toHaveBeenCalled();
  });

  it("marks the session disconnected when the refresh fails", async () => {
    const { service, provider } = setup(async () => {
      throw new Error("invalid_grant");
    });
    await provider.saveTokens({ access_token: "a", refresh_token: "r", token_type: "Bearer", expires_in: 10 });
    await expect(service.ensureFreshToken()).rejects.toMatchObject({ code: "SWIGGY_RECONNECT" });
    expect(await service.status()).toMatchObject({ connected: false, needsReconnect: true });
    // Later calls fail fast without trying again.
    await expect(service.ensureFreshToken()).rejects.toMatchObject({ code: "SWIGGY_RECONNECT" });
  });

  it("marks the session disconnected when Swiggy wants a fresh login", async () => {
    const { service, provider } = setup(async () => "REDIRECT");
    await provider.saveTokens({ access_token: "a", refresh_token: "r", token_type: "Bearer", expires_in: 10 });
    await expect(service.ensureFreshToken()).rejects.toMatchObject({ code: "SWIGGY_RECONNECT" });
  });

  it("logout clears tokens", async () => {
    const { service, provider } = setup();
    await provider.saveTokens({ access_token: "a", token_type: "Bearer" });
    await service.logout();
    expect(await provider.tokens()).toBeUndefined();
    expect((await service.status()).connected).toBe(false);
  });
});
