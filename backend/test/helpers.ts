import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { JsonCompletionOptions, JsonLlm } from "../src/ai/groq.js";
import type { CookOption, OrderOption } from "../src/engine/types.js";
import { defaultSettings, type UserSettings } from "../src/settings/settings.js";

export const testKey = () => randomBytes(32).toString("base64");

type Handler = (opts: JsonCompletionOptions<z.ZodType>) => unknown;

/** Fake Groq: returns canned JSON per task and validates it with the real schema. */
export class FakeLlm implements JsonLlm {
  calls: Array<{ task: string; system: string; user: string }> = [];
  constructor(private readonly handlers: Record<string, Handler>) {}

  /** The canned handlers, so a test can copy them and override one. */
  handlersForTest(): Record<string, Handler> {
    return { ...this.handlers };
  }

  async json<S extends z.ZodType>(opts: JsonCompletionOptions<S>): Promise<z.infer<S>> {
    this.calls.push({ task: opts.task, system: opts.system, user: opts.user });
    const handler = this.handlers[opts.task];
    if (!handler) throw new Error(`FakeLlm: no handler for ${opts.task}`);
    const value = await handler(opts as unknown as JsonCompletionOptions<z.ZodType>);
    return opts.schema.parse(value) as z.infer<S>;
  }
}

export const settings = (patch: Partial<UserSettings> = {}): UserSettings => ({
  ...defaultSettings,
  addressId: "addr_1",
  addressLine: "12 MG Road",
  ...patch,
});

export function makeCook(patch: Partial<CookOption> = {}): CookOption {
  return {
    kind: "cook",
    lines: [],
    staples: [],
    subtotal: 500,
    fees: { handling: 10, delivery: 0, total: 10, estimated: true },
    payToday: 520,
    costPerServing: 130,
    servings: 4,
    yieldServings: 4,
    leftoverServings: 0,
    prepMin: 20,
    cookMin: 35,
    activeMin: 40,
    groceryDeliveryMin: 15,
    totalMinToEat: 70,
    difficulty: 2,
    quality: 0.75,
    steps: ["Cook it"],
    notFoundCount: 0,
    ...patch,
  };
}

export function makeOrder(patch: Partial<OrderOption> = {}): OrderOption {
  const id = patch.id ?? "r1";
  return {
    kind: "order",
    id,
    restaurantId: id,
    restaurantName: `Restaurant ${id}`,
    items: [
      { dish: "Butter Chicken", menuItemId: `m_${id}`, name: "Butter Chicken", price: 300, quantity: 4, servesPerUnit: 1, lineTotal: 1200 },
    ],
    missingDishes: [],
    leftoverServings: 0,
    itemTotal: 1200,
    fees: { delivery: 40, platform: 10, gst: 60, total: 110, estimated: true },
    estTotal: 1200,
    costPerServing: 300,
    restaurantRating: 4.2,
    deliveryMin: 35,
    deliveryEstimated: false,
    availability: "OPEN",
    quality: 0.84,
    activeMin: 5,
    ...patch,
  };
}

/** Wraps a payload the way Swiggy MCP tools return it. */
export const toolResult = (data: unknown) => ({
  content: [{ type: "text" as const, text: "summary for chat" }],
  structuredContent: { success: true, data },
});
