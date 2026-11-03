import cors from "cors";
import express, { type Express } from "express";
import type { AuthService } from "./auth/authService.js";
import { correlation, errorHandler } from "./middleware.js";
import { apiRouter, type ApiDeps } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";

export interface AppDeps extends ApiDeps {
  auth: AuthService;
  frontendOrigin: string;
  /** Throws if the database can't be reached. */
  healthCheck: () => Promise<void>;
}

/** Builds the Express app from its dependencies, so tests can pass in fakes. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(correlation);
  app.use(cors({ origin: deps.frontendOrigin, exposedHeaders: ["x-correlation-id"] }));
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", async (_req, res) => {
    try {
      await deps.healthCheck();
      res.json({ status: "ok", db: "ok" });
    } catch {
      res.status(503).json({ status: "degraded", db: "error" });
    }
  });

  app.use("/auth", authRouter({ auth: deps.auth, frontendOrigin: deps.frontendOrigin }));
  app.use("/api", apiRouter(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "No such route" } });
  });
  app.use(errorHandler);
  return app;
}
