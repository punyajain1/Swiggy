import { describe, expect, it, vi } from "vitest";
import { buildCookOption } from "../src/engine/cook.js";
import { pickProductsHandler, recipe, searchProducts } from "./fixtures.js";
import { FakeLlm, settings } from "./helpers.js";

function deps(catalog?: Record<string, unknown>) {
  const api = { searchProducts: vi.fn(searchProducts(catalog)) };
  const llm = new FakeLlm({ pickProducts: pickProductsHandler });
  return { api, llm };
}

describe("buildCookOption", () => {
  it("prices ingredients from Instamart, skipping staples", async () => {
    const d = deps();
    const cook = await buildCookOption(d, { dish: "Butter Chicken", servings: 4, recipe, settings: settings(), addressId: "addr_1" });

    expect(d.api.searchProducts).toHaveBeenCalledTimes(2);
    expect(d.api.searchProducts).not.toHaveBeenCalledWith("salt", "addr_1");
    expect(cook.staples).toEqual([{ ingredient: "Salt", display: "10 g" }]);

    const chicken = cook.lines.find((l) => l.ingredient === "Chicken")!;
    // The out-of-stock 500 g pack is ignored; one 1 kg pack (₹380) beats two 450 g packs (₹400).
    expect(chicken.product?.name).toBe("Fresh Chicken Boneless");
    expect(chicken.packs).toEqual([expect.objectContaining({ spinId: "c1k", skuId: "sku_c1k", quantity: 1, unitPrice: 380 })]);
    expect(chicken.surplus?.display).toBe("500 g");

    expect(cook.subtotal).toBe(445);
    expect(cook.fees).toMatchObject({ handling: 10, delivery: 0 });
    expect(cook.payToday).toBe(455);
    expect(cook.costPerServing).toBe(113.75);
    expect(cook.groceryDeliveryMin).toBe(12);
    expect(cook.activeMin).toBe(40);
    expect(cook.totalMinToEat).toBe(12 + 20 + 35);
    expect(cook.notFoundCount).toBe(0);
  });

  it("buys staples too when the staples preference is off", async () => {
    const d = deps();
    const cook = await buildCookOption(d, {
      dish: "Butter Chicken",
      servings: 4,
      recipe,
      settings: settings({ hasBasicStaples: false }),
      addressId: "addr_1",
    });
    expect(d.api.searchProducts).toHaveBeenCalledWith("salt", "addr_1");
    expect(cook.staples).toEqual([]);
    expect(cook.lines.find((l) => l.ingredient === "Salt")?.cost).toBe(28);
    expect(cook.subtotal).toBe(473);
  });

  it("flags ingredients Instamart doesn't have", async () => {
    const d = deps({ "boneless chicken": { products: [] }, "fresh cream": { products: [] } });
    const cook = await buildCookOption(d, { dish: "Butter Chicken", servings: 4, recipe, settings: settings(), addressId: "addr_1" });
    expect(cook.notFoundCount).toBe(2);
    expect(cook.lines.every((l) => l.status === "not_found" && l.estimated)).toBe(true);
  });

  it("adds a small-order delivery fee under ₹199", async () => {
    const d = deps({ "fresh cream": { products: [{ displayName: "Cream", variations: [{ spinId: "x", skuId: "y", quantityDescription: "200 ml", price: { offerPrice: 65 }, isInStockAndAvailable: true }] }] } });
    const oneItem = { ...recipe, ingredients: [recipe.ingredients[1]!] };
    const cook = await buildCookOption(d, { dish: "Butter Chicken", servings: 2, recipe: oneItem, settings: settings(), addressId: "addr_1" });
    expect(cook.fees).toMatchObject({ handling: 10, delivery: 30, total: 40 });
  });

  it("slows active time for beginners", async () => {
    const d = deps();
    const cook = await buildCookOption(d, {
      dish: "Butter Chicken",
      servings: 4,
      recipe,
      settings: settings({ skillLevel: "beginner" }),
      addressId: "addr_1",
    });
    expect(cook.activeMin).toBe(52);
    expect(cook.quality).toBe(0.6);
  });

  it("falls back to name matching when the AI pick fails", async () => {
    const api = { searchProducts: vi.fn(searchProducts()) };
    const llm = new FakeLlm({
      pickProducts: () => {
        throw new Error("Groq down");
      },
    });
    const cook = await buildCookOption({ api, llm }, { dish: "Butter Chicken", servings: 4, recipe, settings: settings(), addressId: "addr_1" });
    // "Fresh Chicken Boneless" contains "boneless"; "Chicken Masala" also contains "chicken" and comes first,
    // so the fallback is weaker than the AI pick, but every ingredient still gets a product.
    expect(cook.lines.every((l) => l.status === "matched")).toBe(true);
  });
});
