import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/authService.js";
import { HttpError } from "../errors.js";
import { logger } from "../logger.js";

const callbackQuery = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(500).optional(),
});

/** /auth/*: Swiggy login (OAuth 2.1 + PKCE), callback, status and logout. */
export function authRouter(deps: { auth: AuthService; frontendOrigin: string }): Router {
  const router = Router();

  router.get("/status", async (_req, res) => {
    res.json(await deps.auth.status());
  });

  // ?redirect=1 sends the browser straight to Swiggy's phone + OTP page.
  router.get("/login", async (req, res) => {
    const url = await deps.auth.startLogin();
    if (req.query.redirect === "1") res.redirect(url.toString());
    else res.json({ url: url.toString() });
  });

  router.get("/callback", async (req, res) => {
    const back = new URL("/settings", deps.frontendOrigin);
    const parsed = callbackQuery.safeParse(req.query);
    const q = parsed.success ? parsed.data : {};
    if (!q.code || !q.state) {
      back.searchParams.set("authError", q.error_description ?? q.error ?? "Swiggy login was cancelled.");
      res.redirect(back.toString());
      return;
    }
    try {
      await deps.auth.finishLogin(q.code, q.state);
      back.searchParams.set("connected", "1");
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Swiggy login callback failed");
      back.searchParams.set("authError", err instanceof HttpError ? err.message : "Swiggy login failed. Try again.");
    }
    res.redirect(back.toString());
  });

  router.post("/logout", async (_req, res) => {
    await deps.auth.logout();
    res.json({ ok: true });
  });

  return router;
}
