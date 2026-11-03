import { timingSafeEqual } from "node:crypto";
import { auth as sdkAuth } from "@modelcontextprotocol/sdk/client/auth.js";
import { errors } from "../errors.js";
import { logger } from "../logger.js";
import type { AuthStore } from "./authStore.js";
import type { SwiggyOAuthProvider } from "./oauthProvider.js";

const STATE_TTL_MS = 10 * 60 * 1000;
/** Refresh proactively when this little time is left on the access token. */
export const REFRESH_LEEWAY_MS = 60 * 1000;

export type AuthFn = typeof sdkAuth;

export interface AuthStatus {
  connected: boolean;
  needsReconnect: boolean;
  expiresAt: string | null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Login, callback, refresh and logout for the single Swiggy account. */
export class AuthService {
  private refreshing: Promise<void> | undefined;
  private readonly authFn: AuthFn;
  private readonly now: () => number;

  constructor(
    private readonly store: AuthStore,
    readonly provider: SwiggyOAuthProvider,
    private readonly opts: {
      /** Any Swiggy MCP server URL; both servers share one authorization server. */
      serverUrl: string;
      authFn?: AuthFn;
      now?: () => number;
      fetchFn?: typeof fetch;
      onSessionChange?: () => void | Promise<void>;
    },
  ) {
    this.authFn = opts.authFn ?? sdkAuth;
    this.now = opts.now ?? Date.now;
  }

  async status(): Promise<AuthStatus> {
    const row = await this.store.get();
    const hasToken = Boolean(row.accessTokenEnc);
    return {
      connected: hasToken && !row.disconnectedReason,
      needsReconnect: Boolean(row.disconnectedReason),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }

  /** Clears any old tokens and returns the Swiggy URL where the user logs in with phone + OTP. */
  async startLogin(): Promise<URL> {
    await this.provider.invalidateCredentials("tokens");
    await this.provider.invalidateCredentials("verifier");
    this.provider.pendingAuthorizationUrl = undefined;
    const result = await this.authFn(this.provider, { serverUrl: this.opts.serverUrl });
    const url = this.provider.pendingAuthorizationUrl;
    if (result !== "REDIRECT" || !url) throw new Error("Swiggy did not return a login URL");
    return url;
  }

  /** Handles the OAuth callback: checks `state`, exchanges the code, and stores the tokens. */
  async finishLogin(code: string, state: string): Promise<void> {
    const row = await this.store.get();
    const expired = !row.stateCreatedAt || this.now() - row.stateCreatedAt.getTime() > STATE_TTL_MS;
    if (!row.state || expired || !safeEqual(row.state, state)) {
      throw errors.badRequest("Login link is invalid or expired. Start the Swiggy login again.");
    }
    // Clear state first so a code can't be replayed through this callback.
    await this.store.update({ state: null, stateCreatedAt: null });
    const result = await this.authFn(this.provider, { serverUrl: this.opts.serverUrl, authorizationCode: code });
    if (result !== "AUTHORIZED") throw errors.upstream("swiggy", "Swiggy did not accept the login code.");
    await this.store.update({ codeVerifier: null, disconnectedReason: null });
    await this.opts.onSessionChange?.();
  }

  /** Throws a typed error if not connected; refreshes the token when 60s or less remain. */
  async ensureFreshToken(): Promise<void> {
    const row = await this.store.get();
    if (row.disconnectedReason) throw errors.reconnect(row.disconnectedReason);
    if (!row.accessTokenEnc) throw errors.notConnected();
    if (row.expiresAt && row.expiresAt.getTime() - this.now() <= REFRESH_LEEWAY_MS) {
      await this.forceRefresh();
    }
  }

  /** Exchanges the refresh token for a new access token. Concurrent callers share one refresh. */
  async forceRefresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const before = await this.store.get();
    if (!before.refreshTokenEnc) {
      await this.markDisconnected("no_refresh_token");
      throw errors.reconnect("no_refresh_token");
    }
    let result: string;
    try {
      // With a refresh token stored, the SDK refreshes. If the refresh token is rejected
      // (invalid_grant), the SDK clears tokens and falls back to a new login: "REDIRECT".
      result = await this.authFn(this.provider, { serverUrl: this.opts.serverUrl });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Swiggy token refresh failed");
      await this.markDisconnected("refresh_failed");
      throw errors.reconnect("refresh_failed");
    }
    if (result !== "AUTHORIZED") {
      await this.markDisconnected("refresh_rejected");
      throw errors.reconnect("refresh_rejected");
    }
    logger.info("Swiggy access token refreshed");
  }

  async markDisconnected(reason: string): Promise<void> {
    await this.store.update({ disconnectedReason: reason });
    await this.opts.onSessionChange?.();
  }

  /** Revokes the Swiggy session (best effort) and clears local tokens. */
  async logout(): Promise<void> {
    const tokens = await this.provider.tokens().catch(() => undefined);
    if (tokens?.access_token) {
      const fetchFn = this.opts.fetchFn ?? fetch;
      const logoutUrl = new URL("/auth/logout", this.opts.serverUrl);
      await fetchFn(logoutUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(5000),
      }).catch((err: unknown) => logger.warn({ err: (err as Error).message }, "Swiggy logout call failed"));
    }
    await this.provider.invalidateCredentials("tokens");
    await this.store.update({ codeVerifier: null, state: null, stateCreatedAt: null, disconnectedReason: null });
    await this.opts.onSessionChange?.();
  }
}
