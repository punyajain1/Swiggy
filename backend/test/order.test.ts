import { describe, expect, it, vi } from "vitest";
import type { DishRequest } from "../src/ai/tasks.js";
import { HttpError } from "../src/errors.js";
import { buildOrderOptions, isCombo, keywordMatch, portionFactor } from "../src/engine/order.js";
import { searchMenuSchema } from "../src/swiggy/schemas.js";
import { matchDishesHandler, mealMenu, mealRestaurants, menuPage1, menuPage2, restaurantsResponse } from "./fixtures.js";
import { FakeLlm } from "./helpers.js";

function deps(llmFails = false) {
  const api = {
    searchRestaurants: vi.fn(async () => restaurantsResponse()),
    searchMenu: vi.fn(async (_q: string, _a: string, offset?: number, _r?: string) => (offset ? menuPage2() : menuPage1())),
  };
  const llm = new FakeLlm({
    matchDishes: llmFails
      ? () => {
          throw new Error("Groq down");
        }
      : matchDishesHandler,
  });
  return { api, llm };
}

const butterChicken: DishRequest[] = [{ name: "Butter Chicken", role: "main" }];
const input = { dishes: butterChicken, servings: 4, addressId: "addr_1" };

describe("buildOrderOptions (one dish)", () => {
  it("builds one option per open restaurant with prices, ratings and delivery", async () => {
    const { options } = await buildOrderOptions(deps(), input);
    expect(options.map((o) => o.id).sort()).toEqual(["r1", "r3", "r4"]);

    const r1 = options.find((o) => o.id === "r1")!;
    expect(r1.items).toHaveLength(1);
    const line = r1.items[0]!;
    expect(line.menuItemId).toBe("m1");
    expect(line.variantsV2).toEqual([{ group_id: "g1", variation_id: "v2" }]);
    expect(line.variants).toBeUndefined();
    expect(line.variantLabel).toBe("Full");
    expect(line.quantity).toBe(2);
    expect(r1.missingDishes).toEqual([]);
    expect(r1.itemTotal).toBe(640);
    expect(r1.fees).toMatchObject({ delivery: 40, platform: 10, gst: 32, total: 82 });
    expect(r1.estTotal).toBe(722);
    expect(r1.costPerServing).toBe(180.5);
    expect(r1).toMatchObject({
      restaurantRating: 4.4,
      restaurantRatingCount: 8200,
      dishRating: 4.5,
      dishRatingCount: 1200,
      dishRatingCountLabel: "1.2K",
      deliveryMin: 32,
      deliveryEstimated: false,
      distanceKm: 2.1,
      offer: "20% OFF",
      availability: "OPEN",
    });
  });

  it("drops closed restaurants, out-of-stock items and items that aren't the dish", async () => {
    const { options } = await buildOrderOptions(deps(), input);
    expect(options.find((o) => o.id === "r2")).toBeUndefined();
    const r3 = options.find((o) => o.id === "r3")!;
    expect(r3.items[0]!.name).toBe("Butter Chicken");
    expect(r3.items[0]!.variants).toEqual([{ group_id: "G", variation_id: "x1" }]);
    expect(options.some((o) => o.items.some((l) => l.menuItemId === "m5"))).toBe(false);
  });

  it("loads the second page of search_menu and never searches inside a restaurant", async () => {
    const d = deps();
    await buildOrderOptions(d, input);
    expect(d.api.searchMenu).toHaveBeenCalledTimes(2);
    expect(d.api.searchMenu).toHaveBeenLastCalledWith("Butter Chicken", "addr_1", 20);
  });

  it("labels missing delivery times as estimated", async () => {
    const { options } = await buildOrderOptions(deps(), input);
    expect(options.find((o) => o.id === "r4")).toMatchObject({ deliveryMin: 35, deliveryEstimated: true, availability: "UNKNOWN" });
  });

  it("uses keyword rules when the AI match fails", async () => {
    const { options } = await buildOrderOptions(deps(true), input);
    expect(options.some((o) => o.items.some((l) => l.name.includes("Pizza")))).toBe(false);
    // "Full" -> serves 2.5, so 2 units for 4 people; "Regular" -> 1.5, so 3 units.
    expect(options.find((o) => o.id === "r1")?.items[0]?.quantity).toBe(2);
    expect(options.find((o) => o.id === "r3")?.items[0]?.quantity).toBe(3);
  });

  it("still works when search_restaurants fails", async () => {
    const d = deps();
    d.api.searchRestaurants.mockRejectedValueOnce(new Error("boom"));
    const { options, warnings } = await buildOrderOptions(d, input);
    expect(options.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/restaurant details/);
  });

  it("passes session errors through", async () => {
    const d = deps();
    d.api.searchRestaurants.mockRejectedValueOnce(new HttpError(401, "SWIGGY_RECONNECT", "reconnect"));
    await expect(buildOrderOptions(d, input)).rejects.toMatchObject({ status: 401 });
  });
});

describe("buildOrderOptions (a meal)", () => {
  const meal: DishRequest[] = [
    { name: "Dal Makhani", role: "main" },
    { name: "Butter Naan", role: "bread" },
  ];
  const mealInput = { dishes: meal, servings: 4, addressId: "addr_1" };

  function mealDeps() {
    return {
      api: { searchRestaurants: vi.fn(async () => mealRestaurants()), searchMenu: vi.fn(mealMenu) },
      llm: new FakeLlm({ matchDishes: matchDishesHandler }),
    };
  }

  it("only offers restaurants that have the whole meal, one line per dish", async () => {
    const d = mealDeps();
    const { options, warnings } = await buildOrderOptions(d, mealInput);
    expect(options.map((o) => o.id).sort()).toEqual(["rA", "rB"]);
    expect(warnings).toEqual([]);

    const dhaba = options.find((o) => o.id === "rA")!;
    expect(dhaba.items.map((l) => [l.dish, l.menuItemId, l.quantity])).toEqual([
      ["Dal Makhani", "aD", 2],
      ["Butter Naan", "aN", 8],
    ]);
    expect(dhaba.itemTotal).toBe(2 * 240 + 8 * 50);
    expect(dhaba.missingDishes).toEqual([]);
    expect(dhaba.leftoverServings).toBe(0);
  });

  it("searches inside a restaurant to find a dish the cross-restaurant search missed", async () => {
    const d = mealDeps();
    const { options } = await buildOrderOptions(d, mealInput);
    expect(d.api.searchMenu).toHaveBeenCalledWith("Butter Naan", "addr_1", undefined, "rB");
    expect(options.find((o) => o.id === "rB")!.items.map((l) => l.menuItemId)).toEqual(["bD", "bN"]);
  });

  it("falls back to partial restaurants, with what's missing, when none has the whole meal", async () => {
    const d = mealDeps();
    d.api.searchMenu.mockImplementation(async (q: string, a: string, o?: number, r?: string) =>
      // Nobody has naan inside their own menu, and Dhaba's naan isn't listed.
      r ? mealMenu(q, a, o, "none") : q === "Butter Naan" ? mealMenu(q, a).then((m) => ({ ...m, items: m.items.filter((i) => i.restaurant_id === "rC") })) : mealMenu(q, a),
    );
    const { options, warnings } = await buildOrderOptions(d, mealInput);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.missingDishes.length === 1)).toBe(true);
    expect(options.find((o) => o.id === "rA")?.missingDishes).toEqual(["Butter Naan"]);
    expect(warnings.join(" ")).toMatch(/whole meal/);
  });

  it("keeps going when one dish's search fails", async () => {
    const d = mealDeps();
    d.api.searchMenu.mockImplementation(async (q: string, a: string, o?: number, r?: string) => {
      if (q === "Butter Naan" && !r) throw new Error("Swiggy hiccup");
      return mealMenu(q, a, o, r);
    });
    const { options, warnings } = await buildOrderOptions(d, mealInput);
    expect(warnings.join(" ")).toMatch(/Couldn't search Swiggy Food for Butter Naan/);
    // Curry Hub's naan is still found by searching inside its menu.
    expect(options.find((o) => o.id === "rB")?.missingDishes).toEqual([]);
  });
});

describe("isCombo", () => {
  it("skips combos and meals unless you asked for one", () => {
    expect(isCombo("Dal Makhani[300ML]+Boondi Raita[125ML]+Choice Of Breads", "Dal Makhani")).toBe(true);
    expect(isCombo("Butter Chicken with 2 Flaky Paratha Meal", "Butter Chicken")).toBe(true);
    expect(isCombo("Veg Thali", "Veg Thali")).toBe(false);
    expect(isCombo("Dal Makhani", "Dal Makhani")).toBe(false);
    expect(isCombo("Butter Naan", "Butter Naan")).toBe(false);
  });

  it("leaves combos out of the restaurant options", async () => {
    const d = deps();
    d.api.searchMenu.mockImplementation(async () =>
      searchMenuSchema.parse({
        items: [
          { name: "Butter Chicken + Naan Combo", price: 199, menu_item_id: "c1", restaurant_id: "r1", restaurant_name: "Punjabi Tadka" },
          { name: "Butter Chicken", price: 320, menu_item_id: "m1", restaurant_id: "r1", restaurant_name: "Punjabi Tadka" },
        ],
      }),
    );
    const { options } = await buildOrderOptions(d, input);
    expect(options.find((o) => o.id === "r1")?.items[0]?.menuItemId).toBe("m1");
  });
});

describe("portionFactor", () => {
  it("shrinks each curry when there are several, but not breads", () => {
    expect(portionFactor("main", 1)).toBe(1);
    expect(portionFactor("main", 2)).toBe(0.6);
    expect(portionFactor("main", 3)).toBe(0.45);
    expect(portionFactor("bread", 2)).toBe(1);
  });
});

describe("keywordMatch", () => {
  it("matches the dish and rejects other formats", () => {
    expect(keywordMatch("Butter Chicken", "Butter Chicken Boneless").isDish).toBe(true);
    expect(keywordMatch("Butter Chicken", "Butter Chicken Roll").isDish).toBe(false);
    expect(keywordMatch("Butter Chicken", "Paneer Butter Masala").isDish).toBe(false);
    expect(keywordMatch("Butter Chicken", "Butter Chicken", "Half").servesPerUnit).toBe(1);
  });

  it("counts bread pieces", () => {
    expect(keywordMatch("Butter Naan", "Butter Naan", undefined, "bread").servesPerUnit).toBe(0.5);
    expect(keywordMatch("Butter Naan", "Butter Naan (2 pcs)", undefined, "bread").servesPerUnit).toBe(1);
  });
});
