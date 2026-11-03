import { describe, expect, it, vi } from "vitest";
import { decide } from "../src/engine/decide.js";
import { DecisionCache } from "../src/engine/decisionCache.js";
import { HttpError } from "../src/errors.js";
import { MemorySettingsStore } from "../src/settings/settings.js";
import { searchMenuSchema, searchProductsSchema } from "../src/swiggy/schemas.js";
import {
  matchDishesHandler,
  mealMenu,
  mealRestaurants,
  menuPage1,
  menuPage2,
  pickProductsHandler,
  recipe,
  restaurantsResponse,
  searchProducts,
} from "./fixtures.js";
import { FakeLlm, settings } from "./helpers.js";

function setup() {
  const api = {
    searchProducts: vi.fn(searchProducts()),
    searchRestaurants: vi.fn(async () => restaurantsResponse()),
    searchMenu: vi.fn(async (_q: string, _a: string, offset?: number, _r?: string) => (offset ? menuPage2() : menuPage1())),
  };
  const llm = new FakeLlm({
    parseIntent: () => ({
      isFoodRequest: true,
      dishes: [{ name: "Butter Chicken", role: "main" }],
      servings: 4,
      timeLimitMin: null,
      notes: null,
    }),
    estimateRecipe: () => recipe,
    pickProducts: pickProductsHandler,
    matchDishes: matchDishesHandler,
    explainVerdict: () => ({ headline: "Your call tonight", explanation: "You can see both sides below." }),
  });
  const cache = new DecisionCache();
  const store = new MemorySettingsStore(settings());
  return { api, llm, cache, deps: { api, llm, cache, settings: store } };
}

describe("decide", () => {
  it("compares cooking with ordering and caches the decision", async () => {
    const { deps, cache } = setup();
    const d = await decide(deps, "butter chicken for 4");

    expect(d.intent.dish).toBe("Butter Chicken");
    expect(d.cook?.payToday).toBe(455);
    expect(d.order?.best).toBeDefined();
    expect(d.order!.alternatives.length).toBeGreaterThan(0);
    expect(d.comparison).toHaveLength(7);
    expect(["cook", "order"]).toContain(d.verdict.winner);
    expect(d.explanation).toEqual({ headline: "Your call tonight", text: "You can see both sides below.", source: "ai" });
    expect(cache.get(d.decisionId)?.addressId).toBe("addr_1");
  });

  it("marks one failed Instamart search as not found instead of failing", async () => {
    const { deps, api } = setup();
    const normal = searchProducts();
    api.searchProducts.mockImplementation(async (q: string) => {
      if (q === "fresh cream") throw new Error("Instamart hiccup");
      return normal(q);
    });
    const d = await decide(deps, "butter chicken for 4");
    expect(d.cook?.notFoundCount).toBe(1);
    expect(d.warnings.join(" ")).toMatch(/wasn't found on Instamart/);
  });

  it("still answers with restaurants when no ingredient can be priced", async () => {
    const { deps, api } = setup();
    api.searchProducts.mockRejectedValue(new Error("Instamart down"));
    const d = await decide(deps, "butter chicken for 4");
    expect(d.cook).toBeNull();
    expect(d.verdict.winner).toBe("order");
    expect(d.comparison).toEqual([]);
    expect(d.warnings.join(" ")).toMatch(/can't be priced/);
  });

  it("compares a whole meal: one recipe for everything, restaurants with every dish", async () => {
    const { deps, api, llm } = setup();
    api.searchRestaurants.mockImplementation(async () => mealRestaurants());
    api.searchMenu.mockImplementation(mealMenu);
    deps.llm = new FakeLlm({
      ...llm.handlersForTest(),
      parseIntent: () => ({
        isFoodRequest: true,
        dishes: [
          { name: "Dal Makhani", role: "main" },
          { name: "Butter Naan", role: "bread" },
        ],
        servings: 4,
        timeLimitMin: 360,
        notes: null,
      }),
    });
    const d = await decide(deps, "dal makhani with butter naan for 4, I've got 6 hours");

    expect(d.intent.dish).toBe("Dal Makhani and Butter Naan");
    const recipeCall = (deps.llm as FakeLlm).calls.find((c) => c.task === "estimateRecipe")!;
    expect(recipeCall.user).toContain("Meal: Dal Makhani (main), Butter Naan (bread)");
    expect(d.order?.best.items.map((l) => l.dish)).toEqual(["Dal Makhani", "Butter Naan"]);
    expect(d.order?.best.missingDishes).toEqual([]);
  });

  it("asks you to reconnect when the Swiggy session is gone", async () => {
    const { deps, api } = setup();
    api.searchMenu.mockRejectedValue(new HttpError(401, "SWIGGY_RECONNECT", "Reconnect"));
    await expect(decide(deps, "butter chicken")).rejects.toMatchObject({ code: "SWIGGY_RECONNECT" });
  });

  it("needs an address", async () => {
    const { deps } = setup();
    await deps.settings.update({ addressId: null });
    await expect(decide(deps, "butter chicken")).rejects.toMatchObject({ code: "NO_ADDRESS" });
  });

  it("says so when neither side finds anything", async () => {
    const { deps, api } = setup();
    api.searchProducts.mockResolvedValue(searchProductsSchema.parse({ products: [] }));
    api.searchMenu.mockResolvedValue(searchMenuSchema.parse({ items: [] }));
    await expect(decide(deps, "unicorn curry")).rejects.toMatchObject({ status: 404, code: "NOTHING_FOUND" });
  });
});
