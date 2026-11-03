import { describe, expect, it } from "vitest";
import { choosePacks } from "../src/engine/packs.js";
import { adjustedRating, orderQuality, parseRatingCount } from "../src/engine/ratings.js";
import { formatAmount, packAmountIn, parsePackSize } from "../src/engine/units.js";

describe("parsePackSize", () => {
  it.each([
    ["500 g", { amount: 500, unit: "g" }],
    ["1 kg", { amount: 1000, unit: "g" }],
    ["200 ml", { amount: 200, unit: "ml" }],
    ["1 L", { amount: 1000, unit: "ml" }],
    ["1.5 Litre", { amount: 1500, unit: "ml" }],
    ["6 pcs", { amount: 6, unit: "pcs", pieces: 6 }],
    ["1 bunch", { amount: 100, unit: "g" }],
    ["2 x 200 g", { amount: 400, unit: "g", pieces: 2 }],
    ["Pack of 2 (100 g each)", { amount: 200, unit: "g", pieces: 2 }],
    ["1 pc (approx. 500-600 g)", { amount: 500, unit: "g", pieces: 1 }],
    ["1 dozen", { amount: 12, unit: "pcs", pieces: 12 }],
  ])("%s", (input, expected) => {
    expect(parsePackSize(input)).toEqual(expected);
  });

  it("returns null when there is no size", () => {
    expect(parsePackSize("Assorted")).toBeNull();
    expect(parsePackSize(undefined)).toBeNull();
  });
});

describe("packAmountIn", () => {
  it("treats g and ml as equal", () => {
    expect(packAmountIn({ amount: 200, unit: "ml" }, "g", "fresh cream")).toBe(200);
  });
  it("converts grams to pieces with a known piece weight", () => {
    expect(packAmountIn({ amount: 100, unit: "g" }, "pcs", "garlic")).toBe(20);
  });
  it("returns null when it can't convert", () => {
    expect(packAmountIn({ amount: 100, unit: "g" }, "pcs", "mystery spice")).toBeNull();
  });
});

describe("formatAmount", () => {
  it("formats", () => {
    expect(formatAmount(1500, "g")).toBe("1.5 kg");
    expect(formatAmount(250, "ml")).toBe("250 ml");
    expect(formatAmount(1, "pcs")).toBe("1 pc");
  });
});

describe("choosePacks", () => {
  it("picks an exact match", () => {
    const c = choosePacks(500, [{ size: 500, price: 100 }, { size: 1000, price: 180 }])!;
    expect(c.lines).toEqual([{ index: 0, quantity: 1 }]);
    expect(c.totalCost).toBe(100);
    expect(c.surplus).toBe(0);
  });

  it("combines packs when that is cheapest", () => {
    const c = choosePacks(600, [{ size: 500, price: 100 }, { size: 200, price: 45 }, { size: 1000, price: 250 }])!;
    expect(c.lines).toEqual([{ index: 1, quantity: 3 }]);
    expect(c.totalCost).toBe(135);
  });

  it("prefers one big pack when it's cheaper than two small ones", () => {
    const c = choosePacks(500, [{ size: 450, price: 200 }, { size: 1000, price: 380 }])!;
    expect(c.lines).toEqual([{ index: 1, quantity: 1 }]);
    expect(c.surplus).toBe(500);
  });

  it("respects quantity caps and reports the shortfall", () => {
    const c = choosePacks(1000, [{ size: 200, price: 40, maxQuantity: 2 }, { size: 500, price: 110, maxQuantity: 1 }])!;
    expect(c.surplus).toBeLessThan(0);
    expect(c.lines).toEqual([{ index: 0, quantity: 2 }]);
  });

  it("ignores packs with no size and returns null if none are usable", () => {
    expect(choosePacks(100, [{ size: 0, price: 10 }])).toBeNull();
  });
});

describe("ratings", () => {
  it("parses Swiggy rating counts", () => {
    expect(parseRatingCount("8.2K+ ratings")).toBe(8200);
    expect(parseRatingCount("500+")).toBe(500);
    expect(parseRatingCount("1,234")).toBe(1234);
    expect(parseRatingCount(undefined)).toBeUndefined();
  });

  it("pulls ratings with few votes toward the prior", () => {
    const fewVotes = adjustedRating(4.9, 12)!;
    const manyVotes = adjustedRating(4.4, 8000)!;
    expect(fewVotes).toBeLessThan(manyVotes);
    expect(fewVotes).toBeGreaterThan(4.0);
  });

  it("weights dish 60% and restaurant 40%", () => {
    const q = orderQuality({ dishRating: 5, dishRatingCount: 1e9, restaurantRating: 4, restaurantRatingCount: 1e9 });
    expect(q).toBeCloseTo((0.6 * 5 + 0.4 * 4) / 5, 3);
  });

  it("uses the restaurant rating alone when the dish has none", () => {
    expect(orderQuality({ restaurantRating: 4.5, restaurantRatingCount: 1e9 })).toBeCloseTo(0.9, 3);
  });
});
