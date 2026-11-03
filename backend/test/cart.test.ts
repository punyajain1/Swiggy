import { describe, expect, it, vi } from "vitest";
import { CartService, instamartItems } from "../src/cart/cartService.js";
import { DecisionCache } from "../src/engine/decisionCache.js";
import type { CookLine, Decision } from "../src/engine/types.js";
import { foodCartSchema, instamartCartSchema } from "../src/swiggy/schemas.js";
import { makeCook, makeOrder } from "./helpers.js";

const DECISION_ID = "00000000-0000-4000-8000-000000000001";

const line = (ingredient: string, packs: Array<[string, number]>): CookLine => ({
  ingredient,
  need: { qty: 1, unit: "g", display: "1 g" },
  status: "matched",
  packs: packs.map(([spinId, quantity]) => ({ spinId, skuId: `sku_${spinId}`, label: "1 pack", unitPrice: 100, quantity })),
  cost: 100,
  estimated: false,
});

function setup() {
  const base = { dish: "Butter Chicken", servesPerUnit: 2 };
  const v2 = makeOrder({
    id: "r1",
    restaurantName: "Punjabi Tadka",
    estTotal: 722,
    items: [
      { ...base, menuItemId: "m1", name: "Butter Chicken", price: 320, quantity: 2, lineTotal: 640, variantLabel: "Full", variantsV2: [{ group_id: "g1", variation_id: "v2" }] },
    ],
  });
  const legacy = makeOrder({
    id: "r3",
    items: [{ ...base, menuItemId: "m4", name: "Butter Chicken", price: 300, quantity: 4, lineTotal: 1200, variants: [{ group_id: "G", variation_id: "x1" }] }],
  });
  const meal = makeOrder({
    id: "r5",
    restaurantName: "Dhaba",
    items: [
      { ...base, dish: "Dal Makhani", menuItemId: "d1", name: "Dal Makhani", price: 250, quantity: 2, lineTotal: 500 },
      { ...base, dish: "Butter Naan", menuItemId: "n1", name: "Butter Naan", price: 50, quantity: 8, lineTotal: 400 },
    ],
  });
  const cook = makeCook({
    payToday: 455,
    lines: [line("Chicken", [["c1k", 1]]), line("Cream", [["cr", 2]]), line("More chicken", [["c1k", 1]])],
  });
  const decision = { decisionId: DECISION_ID, cook, order: { best: v2, alternatives: [legacy, meal] } } as unknown as Decision;
  const cache = new DecisionCache();
  cache.set(DECISION_ID, { decision, addressId: "addr_1" });

  const api = {
    updateFoodCart: vi.fn(async (_input: { cartItems: Array<{ menu_item_id: string }> }) => foodCartSchema.parse({ data: { items: [] } })),
    getFoodCart: vi.fn(async () =>
      foodCartSchema.parse({
        data: {
          restaurant: { name: "Punjabi Tadka" },
          items: [{ menu_item_id: "m1", name: "Butter Chicken", quantity: 2, final_price: 640, in_stock: true }],
          pricing: { item_total: 640, delivery_charge: 35, taxes_and_charges: 45, to_pay: 720 },
          offers: { coupon_applied: "TRYNEW", coupon_discount: 0 },
        },
      }),
    ),
    updateInstamartCart: vi.fn(async () =>
      instamartCartSchema.parse({
        cartTotalAmount: "380",
        items: [],
        removedOutOfStockItems: [{ spinId: "cr", itemName: "Amul Fresh Cream", quantity: 2 }],
        reducedQuantityItems: [{ spinId: "c1k", itemName: "Chicken", requestedQuantity: 2, cappedQuantity: 1 }],
      }),
    ),
    getInstamartCart: vi.fn(async () =>
      instamartCartSchema.parse({
        cartTotalAmount: "₹400",
        items: [{ spinId: "c1k", skuId: "sku_c1k", itemName: "Chicken", quantity: 1, discountedFinalPrice: 380 }],
        billBreakdown: {
          lineItems: [
            { label: "Item total", value: "₹380" },
            { label: "Handling fee", value: "₹20" },
          ],
          toPay: { label: "To pay", value: "₹400" },
        },
      }),
    ),
  };
  return { api, cart: new CartService({ api, cache }) };
}

describe("CartService.fillFood", () => {
  it("sends the item in the variantsV2 format it came with and returns the real bill", async () => {
    const { api, cart } = setup();
    const result = await cart.fillFood(DECISION_ID, "r1");
    expect(api.updateFoodCart).toHaveBeenCalledWith({
      restaurantId: "r1",
      restaurantName: "Punjabi Tadka",
      addressId: "addr_1",
      cartItems: [{ menu_item_id: "m1", quantity: 2, variantsV2: [{ group_id: "g1", variation_id: "v2" }], addons: [] }],
    });
    expect(api.getFoodCart).toHaveBeenCalledWith("addr_1", "Punjabi Tadka");
    expect(result).toMatchObject({ kind: "food", toPay: 720, estimate: 722, difference: -2 });
    // coupon_discount 0 means "suggested", not applied.
    expect(result.coupon).toBeNull();
  });

  it("uses the legacy variants format for legacy items", async () => {
    const { api, cart } = setup();
    await cart.fillFood(DECISION_ID, "r3");
    const cartItems = (api.updateFoodCart.mock.calls[0] as unknown as [{ cartItems: unknown[] }])[0].cartItems;
    expect(cartItems).toEqual([{ menu_item_id: "m4", quantity: 4, variants: [{ group_id: "G", variation_id: "x1" }], addons: [] }]);
  });

  it("adds every dish of a meal and flags one Swiggy dropped", async () => {
    const { api, cart } = setup();
    api.getFoodCart.mockResolvedValueOnce(
      foodCartSchema.parse({
        data: {
          items: [{ menu_item_id: "d1", name: "Dal Makhani", quantity: 2, final_price: 500 }],
          pricing: { item_total: 500, delivery_charge: 30, taxes_and_charges: 25, to_pay: 555 },
        },
      }),
    );
    const result = await cart.fillFood(DECISION_ID, "r5");
    const cartItems = (api.updateFoodCart.mock.calls[0] as unknown as [{ cartItems: unknown[] }])[0].cartItems;
    expect(cartItems).toEqual([
      { menu_item_id: "d1", quantity: 2, addons: [] },
      { menu_item_id: "n1", quantity: 8, addons: [] },
    ]);
    expect(result.warnings).toContain("Butter Naan couldn't be added to the cart.");
  });

  it("when Swiggy rejects the whole meal, adds dishes one at a time and keeps the ones it accepts", async () => {
    const { api, cart } = setup();
    // Swiggy rejects any cart containing the naan (n1), and leaves the cart empty.
    let current: Array<{ menu_item_id: string }> = [];
    api.updateFoodCart.mockImplementation(async (input: { cartItems: Array<{ menu_item_id: string }> }) => {
      current = input.cartItems.some((i) => i.menu_item_id === "n1") ? [] : input.cartItems;
      return foodCartSchema.parse({ data: { items: [] }, statusMessage: "CART" });
    });
    api.getFoodCart.mockImplementation(async () =>
      foodCartSchema.parse({
        data: {
          items: current.map((i) => ({ menu_item_id: i.menu_item_id, name: "Dal Makhani", quantity: 2, final_price: 500 })),
          pricing: { item_total: 500, delivery_charge: 30, taxes_and_charges: 25, to_pay: 555 },
        },
        statusMessage: "CART",
      }),
    );

    const result = await cart.fillFood(DECISION_ID, "r5");
    expect(result.items.map((i) => i.name)).toEqual(["Dal Makhani"]);
    expect(result.toPay).toBe(555);
    expect(result.warnings.join(" ")).toMatch(/Swiggy wouldn't add Butter Naan/);
    // The final cart holds the accepted dish, not the failed attempt's empty cart.
    expect(current).toEqual([{ menu_item_id: "d1", quantity: 2, addons: [] }]);
  });

  it("explains the failure when Swiggy rejects everything, without its bare status code", async () => {
    const { api, cart } = setup();
    api.updateFoodCart.mockResolvedValue(foodCartSchema.parse({ data: { items: [] }, statusMessage: "CART" }));
    api.getFoodCart.mockResolvedValue(foodCartSchema.parse({ data: { items: [] }, statusMessage: "CART" }));
    const err = (await cart.fillFood(DECISION_ID, "r5").catch((e: Error) => e)) as Error;
    expect(err).toMatchObject({ code: "CART_EMPTY" });
    expect(err.message).toMatch(/may need a choice/);
    expect(err.message).not.toMatch(/ CART$/);
  });

  it("reports an applied coupon only when it discounts", async () => {
    const { api, cart } = setup();
    api.getFoodCart.mockResolvedValueOnce(
      foodCartSchema.parse({
        data: {
          items: [{ menu_item_id: "m1", name: "Butter Chicken", quantity: 2 }],
          pricing: { item_total: 640, delivery_charge: 0, taxes_and_charges: 45, to_pay: 585 },
          offers: { coupon_applied: "SAVE100", coupon_discount: 100 },
        },
      }),
    );
    const result = await cart.fillFood(DECISION_ID, "r1");
    expect(result.coupon).toEqual({ code: "SAVE100", discount: 100 });
  });

  it("errors when Swiggy leaves the cart empty", async () => {
    const { api, cart } = setup();
    api.getFoodCart.mockResolvedValueOnce(foodCartSchema.parse({ data: { items: [] }, statusMessage: "Item unavailable" }));
    await expect(cart.fillFood(DECISION_ID, "r1")).rejects.toMatchObject({ code: "CART_EMPTY" });
  });

  it("rejects unknown restaurants and expired decisions", async () => {
    const { cart } = setup();
    await expect(cart.fillFood(DECISION_ID, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(cart.fillFood("00000000-0000-4000-8000-000000000999", "r1")).rejects.toMatchObject({ status: 410 });
  });
});

describe("CartService.fillInstamart", () => {
  it("merges repeated SKUs", () => {
    const cook = makeCook({ lines: [line("A", [["x", 1]]), line("B", [["x", 2], ["y", 1]])] });
    expect(instamartItems(cook)).toEqual([
      { spinId: "x", skuId: "sku_x", quantity: 3 },
      { spinId: "y", skuId: "sku_y", quantity: 1 },
    ]);
  });

  it("fills the cart and surfaces out-of-stock and capped items", async () => {
    const { api, cart } = setup();
    const result = await cart.fillInstamart(DECISION_ID);
    expect(api.updateInstamartCart).toHaveBeenCalledWith("addr_1", [
      { spinId: "c1k", skuId: "sku_c1k", quantity: 2 },
      { spinId: "cr", skuId: "sku_cr", quantity: 2 },
    ]);
    expect(result.toPay).toBe(400);
    expect(result.estimate).toBe(455);
    expect(result.difference).toBe(-55);
    expect(result.bill).toEqual([
      { label: "Item total", value: "₹380" },
      { label: "Handling fee", value: "₹20" },
    ]);
    expect(result.warnings.join(" ")).toMatch(/Amul Fresh Cream was out of stock/);
    expect(result.warnings.join(" ")).toMatch(/allows 1 instead of 2/);
  });
});
