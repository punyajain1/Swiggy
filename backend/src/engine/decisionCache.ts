import { appConfig } from "../config/app.js";
import type { Decision } from "./types.js";

export interface CachedDecision {
  decision: Decision;
  /** Address the decision was priced for; carts are filled for the same address. */
  addressId: string;
}

/**
 * Keeps recent decisions in memory so "Fill cart" can find the Swiggy IDs.
 * Nothing is written to the database (no decision history).
 */
export class DecisionCache {
  private entries = new Map<string, { value: CachedDecision; expiresAt: number }>();

  constructor(
    private readonly ttlMs = appConfig.decisionCacheTtlMs,
    private readonly maxEntries = 50,
    private readonly now: () => number = Date.now,
  ) {}

  set(id: string, value: CachedDecision): void {
    this.prune();
    this.entries.set(id, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(id: string): CachedDecision | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.value;
  }

  private prune(): void {
    const t = this.now();
    for (const [id, e] of this.entries) if (e.expiresAt <= t) this.entries.delete(id);
  }
}
