import { z } from "zod";

const base64Key32 = z
  .string()
  .min(1, "TOKEN_ENC_KEY is required")
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "TOKEN_ENC_KEY must be 32 bytes encoded as base64 (openssl rand -base64 32)",
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  TOKEN_ENC_KEY: base64Key32,
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.url().default("http://localhost:3000"),
  SWIGGY_REDIRECT_URL: z.url().default("http://localhost:4000/auth/callback"),
  SWIGGY_FOOD_URL: z.url().default("https://mcp.swiggy.com/food"),
  SWIGGY_IM_URL: z.url().default("https://mcp.swiggy.com/im"),
  SWIGGY_DINEOUT_URL: z.url().default("https://mcp.swiggy.com/dineout"),
  SWIGGY_SCENES_URL: z.url().default("https://mcp.swiggy.com/scenes"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

/** Parses and validates environment variables. Throws a readable error listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily validated env, so tests can import modules without a full .env. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
