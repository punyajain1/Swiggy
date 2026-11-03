import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { JsonLlm } from "../ai/groq.js";
import type { AuthService } from "../auth/authService.js";
import type { CartService } from "../cart/cartService.js";
import { decide } from "../engine/decide.js";
import type { DecisionCache } from "../engine/decisionCache.js";
import { errors } from "../errors.js";
import { settingsUpdateSchema, type SettingsStore } from "../settings/settings.js";
import { planSideQuest } from "../sidequest/sidequest.js";
import type { SwiggyApi } from "../swiggy/api.js";
import { swiggyServers, type SwiggyServer } from "../swiggy/mcpClient.js";

export interface ApiDeps {
  auth: AuthService;
  api: SwiggyApi;
  llm: JsonLlm;
  settings: SettingsStore;
  cache: DecisionCache;
  cart: CartService;
  tools?: { listTools(server: SwiggyServer): Promise<Array<{ name: string; inputSchema: unknown }>> };
  enableDebug: boolean;
  decideRateLimit?: { windowMs: number; limit: number };
  sidequestRateLimit?: { windowMs: number; limit: number };
  /** Clock for SideQuest's evening window. Tests pin it. */
  now?: () => number;
}

const decideBody = z.object({ text: z.string().trim().min(2).max(300) });
const sidequestBody = z.object({ text: z.string().trim().min(5).max(400) });
const foodCartBody = z.object({ decisionId: z.uuid(), restaurantOptionId: z.string().min(1).max(100) });
const instamartCartBody = z.object({ decisionId: z.uuid() });
const debugSearchQuery = z.object({
  server: z.enum(["food", "restaurants", "im"]),
  q: z.string().trim().min(1).max(100),
});

/** /api/*: settings, addresses, decisions and carts. */
export function apiRouter(deps: ApiDeps): Router {
  const router = Router();

  /** Every Swiggy-backed route: must be connected; refreshes the token early when 60 s or less remain. */
  const requireSwiggy: RequestHandler = async (_req, _res, next) => {
    await deps.auth.ensureFreshToken();
    next();
  };

  const limiter = (opts: { windowMs: number; limit: number } | undefined, message: string) =>
    rateLimit({
      windowMs: opts?.windowMs ?? 60_000,
      limit: opts?.limit ?? 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message } });
      },
    });
  const decideLimiter = limiter(deps.decideRateLimit, "Too many comparisons in a short time. Wait a minute and try again.");
  const sidequestLimiter = limiter(deps.sidequestRateLimit, "Too many quests in a short time. Wait a minute and try again.");

  router.get("/settings", async (_req, res) => {
    res.json(await deps.settings.get());
  });

  router.put("/settings", async (req, res) => {
    const patch = settingsUpdateSchema.parse(req.body);
    res.json(await deps.settings.update(patch));
  });

  router.get("/addresses", requireSwiggy, async (_req, res) => {
    const result = await deps.api.getAddresses();
    res.json({
      addresses: result.addresses.map((a) => ({
        id: a.id,
        label: a.addressTag ?? a.addressCategory ?? "Address",
        line: a.addressLine ?? "",
      })),
      defaultAddressId: result.resolution?.defaultAddressId ?? null,
    });
  });

  router.post("/decide", decideLimiter, requireSwiggy, async (req, res) => {
    const { text } = decideBody.parse(req.body);
    res.json(await decide(deps, text));
  });

  router.post("/sidequest", sidequestLimiter, requireSwiggy, async (req, res) => {
    const { text } = sidequestBody.parse(req.body);
    res.json(await planSideQuest({ api: deps.api, llm: deps.llm, settings: deps.settings, now: deps.now }, text));
  });

  router.post("/cart/food", requireSwiggy, async (req, res) => {
    const body = foodCartBody.parse(req.body);
    res.json(await deps.cart.fillFood(body.decisionId, body.restaurantOptionId));
  });

  router.post("/cart/instamart", requireSwiggy, async (req, res) => {
    const body = instamartCartBody.parse(req.body);
    res.json(await deps.cart.fillInstamart(body.decisionId));
  });

  if (deps.enableDebug) {
    router.get("/debug/addresses", requireSwiggy, async (_req, res) => {
      res.json(await deps.api.getAddresses());
    });

    router.get("/debug/search", requireSwiggy, async (req, res) => {
      const q = debugSearchQuery.parse(req.query);
      const settings = await deps.settings.get();
      if (!settings.addressId) throw errors.noAddress();
      const result =
        q.server === "food"
          ? await deps.api.searchMenu(q.q, settings.addressId)
          : q.server === "restaurants"
            ? await deps.api.searchRestaurants(q.q, settings.addressId)
            : await deps.api.searchProducts(q.q, settings.addressId);
      res.json(result);
    });

    // Shows each tool's live input schema, to check argument names against the docs.
    router.get("/debug/tools", requireSwiggy, async (req, res) => {
      const server = z.enum(swiggyServers).parse(req.query.server);
      if (!deps.tools) throw errors.notFound("Tool listing is not available");
      res.json(await deps.tools.listTools(server));
    });
  }

  return router;
}
