/** The fields of the single SwiggyAuth row that the OAuth provider reads and writes. */
export interface AuthRow {
  clientInformation: unknown | null;
  discoveryState: unknown | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenMeta: unknown | null;
  expiresAt: Date | null;
  codeVerifier: string | null;
  state: string | null;
  stateCreatedAt: Date | null;
  disconnectedReason: string | null;
}

export interface AuthStore {
  get(): Promise<AuthRow>;
  update(patch: Partial<AuthRow>): Promise<void>;
}

export const emptyAuthRow = (): AuthRow => ({
  clientInformation: null,
  discoveryState: null,
  accessTokenEnc: null,
  refreshTokenEnc: null,
  tokenMeta: null,
  expiresAt: null,
  codeVerifier: null,
  state: null,
  stateCreatedAt: null,
  disconnectedReason: null,
});

/** In-memory store, used by tests. */
export class MemoryAuthStore implements AuthStore {
  row: AuthRow = emptyAuthRow();
  async get(): Promise<AuthRow> {
    return { ...this.row };
  }
  async update(patch: Partial<AuthRow>): Promise<void> {
    this.row = { ...this.row, ...patch };
  }
}
