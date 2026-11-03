import { describe, expect, it } from "vitest";
import { buildFacts, explain, fallbackExplanation, usesOnlyKnownNumbers } from "../src/engine/explain.js";
import { cookScorable, scoreAll, subScores } from "../src/engine/score.js";
import { FakeLlm, makeCook, makeOrder } from "./helpers.js";

const base = { hourlyTimeValue: 200, skillLevel: "average" as const, timeLimitMin: null };

describe("scoreAll", () => {
  it("picks cooking when it is much cheaper and easy", () => {
    const r = scoreAll({
      ...base,
      cook: makeCook({ costPerServing: 130, activeMin: 40, totalMinToEat: 70, difficulty: 2, quality: 0.75 }),
      orders: [makeOrder({ costPerServing: 300, deliveryMin: 35, quality: 0.84 })],
    });
    expect(r.verdict.winner).toBe("cook");
    expect(r.verdict.margin).toBeGreaterThan(0);
  });

  it("switches to ordering when cooking breaks the time limit", () => {
    const cook = makeCook({ costPerServing: 150, activeMin: 50, totalMinToEat: 80, difficulty: 3, quality: 0.75 });
    const orders = [makeOrder({ costPerServing: 260, deliveryMin: 30, quality: 0.84 })];
    expect(scoreAll({ ...base, cook, orders }).verdict.winner).toBe("cook");
    const limited = scoreAll({ ...base, cook, orders, timeLimitMin: 40 });
    expect(limited.verdict.winner).toBe("order");
    expect(limited.verdict.cookBreaksTimeLimit).toBe(true);
    expect(limited.verdict.orderBreaksTimeLimit).toBe(false);
  });

  it("moves cooking up when nearby restaurants are poorly rated", () => {
    const cook = makeCook({ costPerServing: 150, activeMin: 50, totalMinToEat: 80, difficulty: 3, quality: 0.75 });
    const great = scoreAll({ ...base, cook, orders: [makeOrder({ costPerServing: 260, deliveryMin: 30, quality: 0.95 })] });
    const poor = scoreAll({ ...base, cook, orders: [makeOrder({ costPerServing: 260, deliveryMin: 30, quality: 0.6 })] });
    expect(great.verdict.winner).toBe("order");
    expect(poor.verdict.winner).toBe("cook");
  });

  it("values your time with your ₹/hour", () => {
    const cook = makeCook({ costPerServing: 150, activeMin: 50, totalMinToEat: 80, difficulty: 3 });
    const orders = [makeOrder({ costPerServing: 260, deliveryMin: 30, quality: 0.84 })];
    expect(scoreAll({ ...base, hourlyTimeValue: 0, cook, orders }).verdict.winner).toBe("cook");
    expect(scoreAll({ ...base, hourlyTimeValue: 1500, cook, orders }).verdict.winner).toBe("order");
  });

  it("gives a bonus for leftovers", () => {
    const ctx = { minCostPerServing: 130, hourlyTimeValue: 200, timeLimitMin: null };
    const without = subScores(cookScorable(makeCook({ leftoverServings: 0 })), ctx);
    const withTwo = subScores(cookScorable(makeCook({ leftoverServings: 2 })), ctx);
    expect(withTwo.final - without.final).toBeCloseTo(0.1, 2);
  });

  it("ranks restaurants and keeps the top 5", () => {
    const orders = [320, 280, 400, 250, 350, 300, 500].map((cps, i) => makeOrder({ id: `r${i}`, costPerServing: cps }));
    const r = scoreAll({ ...base, cook: null, orders });
    expect(r.ranked).toHaveLength(5);
    expect(r.ranked[0]!.costPerServing).toBe(250);
    expect(r.ranked.map((o) => o.scores!.final)).toEqual([...r.ranked.map((o) => o.scores!.final)].sort((a, b) => b - a));
    expect(r.verdict.winner).toBe("order");
    expect(r.comparison).toEqual([]);
  });

  it("marks the winner of each comparison row", () => {
    const r = scoreAll({
      ...base,
      cook: makeCook({ payToday: 520, costPerServing: 130, activeMin: 40, totalMinToEat: 70, difficulty: 2, quality: 0.75 }),
      orders: [makeOrder({ estTotal: 1200, costPerServing: 300, deliveryMin: 35, quality: 0.84, leftoverServings: 0 })],
    });
    const winners = Object.fromEntries(r.comparison.map((row) => [row.key, row.winner]));
    expect(winners).toEqual({
      payToday: "cook",
      perServing: "cook",
      activeTime: "order",
      readyIn: "order",
      effort: "order",
      leftovers: "tie",
      quality: "order",
    });
    expect(r.comparison.find((row) => row.key === "payToday")?.cook).toBe("₹520 (est.)");
  });
});

describe("explanation", () => {
  const cook = makeCook({ payToday: 520, costPerServing: 130, activeMin: 40, totalMinToEat: 70 });
  const best = makeOrder({ restaurantName: "Punjabi Tadka", estTotal: 1200, costPerServing: 300, deliveryMin: 32, restaurantRating: 4.4 });
  const { verdict } = scoreAll({ ...base, cook, orders: [best] });
  const facts = buildFacts({ dish: "Butter Chicken", servings: 4, hourlyTimeValue: 200, cook, best, verdict });

  it("computes the facts", () => {
    expect(facts.differenceRs).toBe(680);
    expect(facts.cheaper).toBe("cook");
    expect(facts.cook?.yourTimeWorthRs).toBe(133);
  });

  it("accepts text that only uses known numbers", () => {
    expect(usesOnlyKnownNumbers("Cooking saves you ₹680 for 4 people and takes 40 min.", facts)).toBe(true);
    expect(usesOnlyKnownNumbers("Cooking saves you ₹999.", facts)).toBe(false);
  });

  it("writes a second-person template", () => {
    const t = fallbackExplanation(facts);
    expect(t.text).toMatch(/you/i);
    expect(t.text).toContain("₹680");
    expect(t.text).toContain("Punjabi Tadka");
    expect(usesOnlyKnownNumbers(`${t.headline} ${t.text}`, facts)).toBe(true);
  });

  it("sends Groq only the computed facts", async () => {
    const llm = new FakeLlm({ explainVerdict: () => ({ headline: "Cook it tonight", explanation: "You save ₹680." }) });
    const result = await explain(llm, facts);
    expect(result).toEqual({ headline: "Cook it tonight", text: "You save ₹680.", source: "ai" });
    expect(JSON.parse(llm.calls[0]!.user)).toEqual(JSON.parse(JSON.stringify(facts)));
  });

  it("falls back to the template when Groq invents a number", async () => {
    const llm = new FakeLlm({ explainVerdict: () => ({ headline: "Cook", explanation: "You save ₹4,321." }) });
    expect((await explain(llm, facts)).source).toBe("fallback");
  });
});
