import { randomBytes } from "node:crypto";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { decrypt, encrypt } from "../crypto.js";
import type { AuthStore } from "./authStore.js";

interface TokenMeta {
  token_type?: string;
  scope?: string;
  issuer?: string;
}

/**
 * OAuth provider for the MCP SDK, backed by a single database row.
 * - Access and refresh tokens are encrypted before they are stored.
 * - `redirectToAuthorization` records the URL instead of opening a browser; the
 *   login route sends the user's browser there.
 */
export class SwiggyOAuthProvider implements OAuthClientProvider {
  /** Set by the SDK when it needs the user to log in. Read by the login route. */
  pendingAuthorizationUrl: URL | undefined;

  constructor(
    private readonly store: AuthStore,
    private readonly opts: { redirectUrl: string; encryptionKey: string; now?: () => number },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  get redirectUrl(): string {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Cook or Click",
      redirect_uris: [this.opts.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp:tools",
    };
  }

  async state(): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    await this.store.update({ state, stateCreatedAt: new Date(this.now()) });
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const row = await this.store.get();
    return (row.clientInformation as OAuthClientInformationMixed | null) ?? undefined;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.store.update({ clientInformation });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const row = await this.store.get();
    if (!row.accessTokenEnc) return undefined;
    const meta = (row.tokenMeta as TokenMeta | null) ?? {};
    const tokens: OAuthTokens & { issuer?: string } = {
      access_token: decrypt(row.accessTokenEnc, this.opts.encryptionKey),
      token_type: meta.token_type ?? "Bearer",
      ...(row.refreshTokenEnc ? { refresh_token: decrypt(row.refreshTokenEnc, this.opts.encryptionKey) } : {}),
      ...(meta.scope ? { scope: meta.scope } : {}),
      ...(meta.issuer ? { issuer: meta.issuer } : {}),
      ...(row.expiresAt
        ? { expires_in: Math.max(0, Math.floor((row.expiresAt.getTime() - this.now()) / 1000)) }
        : {}),
    };
    return tokens;
  }

  async saveTokens(tokens: OAuthTokens & { issuer?: string }): Promise<void> {
    const key = this.opts.encryptionKey;
    const row = await this.store.get();
    const meta: TokenMeta = {
      token_type: tokens.token_type,
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      ...(tokens.issuer ? { issuer: tokens.issuer } : {}),
    };
    await this.store.update({
      accessTokenEnc: encrypt(tokens.access_token, key),
      // Refresh tokens rotate; keep the old one only if the server didn't send a new one.
      refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token, key) : row.refreshTokenEnc,
      tokenMeta: meta,
      expiresAt: tokens.expires_in ? new Date(this.now() + tokens.expires_in * 1000) : null,
      disconnectedReason: null,
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.pendingAuthorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.update({ codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const row = await this.store.get();
    if (!row.codeVerifier) throw new Error("No PKCE code verifier saved; start the login again.");
    return row.codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.store.update({ discoveryState: state });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const row = await this.store.get();
    return (row.discoveryState as OAuthDiscoveryState | null) ?? undefined;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const clearTokens = { accessTokenEnc: null, refreshTokenEnc: null, tokenMeta: null, expiresAt: null };
    switch (scope) {
      case "all":
        await this.store.update({
          ...clearTokens,
          clientInformation: null,
          discoveryState: null,
          codeVerifier: null,
        });
        break;
      case "client":
        await this.store.update({ clientInformation: null });
        break;
      case "tokens":
        await this.store.update(clearTokens);
        break;
      case "verifier":
        await this.store.update({ codeVerifier: null });
        break;
      case "discovery":
        await this.store.update({ discoveryState: null });
        break;
    }
  }
}
