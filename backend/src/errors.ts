/** An error with an HTTP status and a stable code that the frontend can branch on. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const errors = {
  notConnected: () =>
    new HttpError(401, "SWIGGY_NOT_CONNECTED", "Connect your Swiggy account first."),
  reconnect: (reason?: string) =>
    new HttpError(401, "SWIGGY_RECONNECT", "Your Swiggy session expired. Reconnect Swiggy.", reason ? { reason } : undefined),
  noAddress: () =>
    new HttpError(409, "NO_ADDRESS", "Pick a delivery address in Settings first."),
  badRequest: (message: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", message, details),
  notFound: (message: string) => new HttpError(404, "NOT_FOUND", message),
  upstream: (service: "swiggy" | "groq", message: string, details?: unknown) =>
    new HttpError(502, service === "swiggy" ? "SWIGGY_ERROR" : "GROQ_ERROR", message, details),
};
