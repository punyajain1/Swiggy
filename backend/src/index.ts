import "dotenv/config";
import { GroqClient } from "./ai/groq.js";
import { createApp } from "./app.js";
import { AuthService } from "./auth/authService.js";
import { SwiggyOAuthProvider } from "./auth/oauthProvider.js";
import { PrismaAuthStore } from "./auth/prismaAuthStore.js";
import { CartService } from "./cart/cartService.js";
import { env } from "./config/env.js";
import { disconnectPrisma, prisma } from "./db/prisma.js";
import { DecisionCache } from "./engine/decisionCache.js";
import { logger } from "./logger.js";
import { PrismaSettingsStore } from "./settings/prismaSettingsStore.js";
import { SwiggyApi } from "./swiggy/api.js";
import { McpClientManager } from "./swiggy/mcpClient.js";
import { createRateLimitedFetch } from "./swiggy/retryingFetch.js";

const config = env();

const authStore = new PrismaAuthStore();
const provider = new SwiggyOAuthProvider(authStore, {
  redirectUrl: config.SWIGGY_REDIRECT_URL,
  encryptionKey: config.TOKEN_ENC_KEY,
});
const mcp = new McpClientManager({
  urls: {
    food: config.SWIGGY_FOOD_URL,
    im: config.SWIGGY_IM_URL,
    dineout: config.SWIGGY_DINEOUT_URL,
    scenes: config.SWIGGY_SCENES_URL,
  },
  authProvider: provider,
  fetch: createRateLimitedFetch(),
});
const auth = new AuthService(authStore, provider, {
  serverUrl: config.SWIGGY_FOOD_URL,
  // Connections are rebuilt after login/logout so they pick up the new session.
  onSessionChange: () => mcp.reset(),
});
const api = new SwiggyApi({ transport: mcp, session: auth });
const cache = new DecisionCache();

const app = createApp({
  auth,
  api,
  llm: new GroqClient({ apiKey: config.GROQ_API_KEY, model: config.GROQ_MODEL }),
  settings: new PrismaSettingsStore(),
  cache,
  cart: new CartService({ api, cache }),
  tools: mcp,
  enableDebug: config.NODE_ENV !== "production",
  frontendOrigin: config.FRONTEND_ORIGIN,
  healthCheck: async () => {
    await prisma().$queryRaw`SELECT 1`;
  },
});

const server = app.listen(config.PORT, () => {
  logger.info(`Cook or Click API on http://localhost:${config.PORT} (Groq model ${config.GROQ_MODEL})`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  server.close();
  await mcp.reset().catch(() => undefined);
  await disconnectPrisma().catch(() => undefined);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
