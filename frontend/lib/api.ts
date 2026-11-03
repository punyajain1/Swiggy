import axios, { isAxiosError } from "axios";
import type { SideQuest } from "./sidequest-types";
import type { Address, AuthStatus, CartResult, Decision, Settings } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const http = axios.create({
  baseURL: API_URL,
  // A decision makes several Swiggy and Groq calls; give it time.
  timeout: 120_000,
  headers: { "Content-Type": "application/json" },
});

/** An error from the backend, with the stable code it sent (e.g. SWIGGY_RECONNECT, NO_ADDRESS). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function toApiError(err: unknown): ApiError {
  if (isAxiosError(err)) {
    const body = (err.response?.data as { error?: { code?: string; message?: string } } | undefined)?.error;
    if (body?.message) return new ApiError(body.message, body.code ?? "ERROR", err.response?.status);
    if (err.code === "ECONNABORTED") return new ApiError("That took too long. Try again.", "TIMEOUT");
    if (!err.response) return new ApiError(`Can't reach the backend at ${API_URL}. Is it running?`, "NETWORK");
    return new ApiError(err.message, "ERROR", err.response.status);
  }
  return new ApiError(err instanceof Error ? err.message : "Something went wrong.", "ERROR");
}

async function call<T>(request: Promise<{ data: T }>): Promise<T> {
  try {
    return (await request).data;
  } catch (err) {
    throw toApiError(err);
  }
}

export const api = {
  authStatus: () => call<AuthStatus>(http.get("/auth/status")),
  /** Full-page navigation target: the backend redirects to Swiggy's phone + OTP login. */
  loginUrl: () => `${API_URL}/auth/login?redirect=1`,
  logout: () => call<{ ok: boolean }>(http.post("/auth/logout")),
  getSettings: () => call<Settings>(http.get("/api/settings")),
  saveSettings: (patch: Partial<Settings>) => call<Settings>(http.put("/api/settings", patch)),
  getAddresses: () => call<{ addresses: Address[]; defaultAddressId: string | null }>(http.get("/api/addresses")),
  decide: (text: string) => call<Decision>(http.post("/api/decide", { text })),
  fillFoodCart: (decisionId: string, restaurantOptionId: string) =>
    call<CartResult>(http.post("/api/cart/food", { decisionId, restaurantOptionId })),
  fillInstamartCart: (decisionId: string) => call<CartResult>(http.post("/api/cart/instamart", { decisionId })),
  sidequest: (text: string) => call<SideQuest>(http.post("/api/sidequest", { text })),
};

/** True when the user has to (re)connect Swiggy before trying again. */
export function isSessionError(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "SWIGGY_NOT_CONNECTED" || err.code === "SWIGGY_RECONNECT");
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
