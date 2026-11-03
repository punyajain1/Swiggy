import type { JsonLlm } from "../ai/groq.js";
import { explainVerdict } from "../ai/tasks.js";
import { logger } from "../logger.js";
import { minutes, rupees } from "./format.js";
import { timeValueRs } from "./score.js";
import type { CookOption, OrderOption, Verdict } from "./types.js";

/** Everything the explanation may mention. All numbers are already rounded for display. */
export interface Facts {
  dish: string;
  servings: number;
  suggestion: "cook" | "order";
  hourlyTimeValueRs: number;
  timeLimitMin: number | null;
  feesEstimated: true;
  cook: {
    payTodayRs: number;
    perServingRs: number;
    activeMin: number;
    readyInMin: number;
    difficultyOutOf5: number;
    yourTimeWorthRs: number;
    ingredientsNotFound: number;
    leftoverServings: number;
    breaksTimeLimit: boolean;
  } | null;
  bestRestaurant: {
    name: string;
    /** What you'd order, e.g. ["2 × Paneer Butter Masala (Full)", "12 × Butter Naan"]. */
    items: string[];
    /** Dishes from the meal this restaurant doesn't have. */
    missingDishes: string[];
    estTotalRs: number;
    perServingRs: number;
    deliveryMin: number;
    deliveryEstimated: boolean;
    dishRating: number | null;
    restaurantRating: number | null;
    ratingCount: string | null;
    distanceKm: number | null;
    offer: string | null;
    breaksTimeLimit: boolean;
  } | null;
  /** Absolute difference between the two "pay today" amounts. */
  differenceRs: number | null;
  cheaper: "cook" | "order" | "same" | null;
}

export function buildFacts(input: {
  dish: string;
  servings: number;
  hourlyTimeValue: number;
  cook: CookOption | null;
  best: OrderOption | undefined;
  verdict: Verdict;
}): Facts {
  const { cook, best } = input;
  const cookPay = cook ? Math.round(cook.payToday) : null;
  const orderPay = best ? Math.round(best.estTotal) : null;
  const difference = cookPay !== null && orderPay !== null ? Math.abs(cookPay - orderPay) : null;
  return {
    dish: input.dish,
    servings: input.servings,
    suggestion: input.verdict.winner,
    hourlyTimeValueRs: input.hourlyTimeValue,
    timeLimitMin: input.verdict.timeLimitMin,
    feesEstimated: true,
    cook: cook
      ? {
          payTodayRs: cookPay!,
          perServingRs: Math.round(cook.costPerServing),
          activeMin: cook.activeMin,
          readyInMin: cook.totalMinToEat,
          difficultyOutOf5: cook.difficulty,
          yourTimeWorthRs: Math.round(timeValueRs(cook.activeMin, input.hourlyTimeValue)),
          ingredientsNotFound: cook.notFoundCount,
          leftoverServings: cook.leftoverServings,
          breaksTimeLimit: input.verdict.cookBreaksTimeLimit,
        }
      : null,
    bestRestaurant: best
      ? {
          name: best.restaurantName,
          items: best.items.map((l) => `${l.quantity} × ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`),
          missingDishes: best.missingDishes,
          estTotalRs: orderPay!,
          perServingRs: Math.round(best.costPerServing),
          deliveryMin: Math.round(best.deliveryMin),
          deliveryEstimated: best.deliveryEstimated,
          dishRating: best.dishRating ?? null,
          restaurantRating: best.restaurantRating ?? null,
          ratingCount: best.restaurantRatingCountLabel ?? best.dishRatingCountLabel ?? null,
          distanceKm: best.distanceKm ?? null,
          offer: best.offer ?? null,
          breaksTimeLimit: input.verdict.orderBreaksTimeLimit,
        }
      : null,
    differenceRs: difference,
    cheaper: cookPay === null || orderPay === null ? null : cookPay === orderPay ? "same" : cookPay < orderPay ? "cook" : "order",
  };
}

/** Plain template used when Groq is unavailable or its text mentions numbers it wasn't given. */
export function fallbackExplanation(f: Facts): { headline: string; text: string } {
  const c = f.cook;
  const o = f.bestRestaurant;
  const rating = o?.restaurantRating ?? o?.dishRating;
  const ratingText = rating ? ` (${rating.toFixed(1)}★)` : "";
  const people = `${f.servings} ${f.servings === 1 ? "person" : "people"}`;

  if (!o && c) {
    return {
      headline: "Cook it at home",
      text: `No open restaurant near you has ${f.dish} right now. Cooking for ${people} costs you about ${rupees(c.payTodayRs)} and takes about ${minutes(c.activeMin)} of hands-on time.`,
    };
  }
  if (!c && o) {
    return {
      headline: `Order from ${o.name}`,
      text: `We couldn't price the ingredients on Instamart, so ordering is the option we can check. ${o.name}${ratingText} delivers in about ${minutes(o.deliveryMin)} for an estimated ${rupees(o.estTotalRs)}.`,
    };
  }
  if (!c || !o) return { headline: "Here's what we found", text: "Compare the options below." };

  const diff = f.differenceRs ?? 0;
  const timeBit = f.hourlyTimeValueRs > 0
    ? `about ${minutes(c.activeMin)} of your hands-on time (worth about ${rupees(c.yourTimeWorthRs)} at your ${rupees(f.hourlyTimeValueRs)}/hour)`
    : `about ${minutes(c.activeMin)} of your hands-on time`;

  if (f.suggestion === "cook") {
    const money = f.cheaper === "cook" ? `Cooking saves you about ${rupees(diff)} for ${people}` : `Cooking costs about ${rupees(c.payTodayRs)} for ${people}`;
    return {
      headline: f.cheaper === "cook" ? `Cook it tonight and save ${rupees(diff)}` : "Cook it tonight",
      text: `${money}. It takes ${timeBit}, and you can eat in about ${minutes(c.readyInMin)}. Ordering from ${o.name}${ratingText} would get it to you in about ${minutes(o.deliveryMin)} for an estimated ${rupees(o.estTotalRs)}.`,
    };
  }
  const extra = f.cheaper === "order" ? ` and saves you about ${rupees(diff)}` : ` and costs about ${rupees(diff)} more than cooking`;
  const missing = o.missingDishes.length ? ` It doesn't have ${o.missingDishes.join(" or ")}.` : "";
  return {
    headline: `Order from ${o.name}`,
    text: `Ordering from ${o.name}${ratingText} arrives in about ${minutes(o.deliveryMin)}${f.cheaper === "same" ? "" : extra}.${missing} Cooking would cost about ${rupees(c.payTodayRs)}, take ${timeBit}, and you'd eat in about ${minutes(c.readyInMin)}. Fees are estimated.`,
  };
}

function collectNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === "number") {
    out.add(value);
    out.add(Math.round(value));
    out.add(Math.round(value * 10) / 10);
    // Minutes are also written as "1 h 10 min".
    out.add(Math.round(value) % 60);
  } else if (typeof value === "string") {
    for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) collectNumbers(Number(m[0].replace(/,/g, "")), out);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectNumbers(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectNumbers(v, out));
  }
}

/** True if every number of 10 or more in `text` appears in the facts (small counts like "2 people" are allowed). */
export function usesOnlyKnownNumbers(text: string, facts: Facts): boolean {
  const known = new Set<number>();
  collectNumbers(facts, known);
  // Derived values the model may reasonably state.
  if (facts.cook && facts.bestRestaurant) {
    known.add(Math.abs(facts.cook.perServingRs - facts.bestRestaurant.perServingRs));
    known.add(Math.abs(facts.cook.readyInMin - facts.bestRestaurant.deliveryMin));
  }
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (n < 10) continue;
    if (!known.has(n) && !known.has(Math.round(n))) return false;
  }
  return true;
}

/** Groq writes the explanation; the template is used if Groq fails or invents numbers. */
export async function explain(llm: JsonLlm, facts: Facts): Promise<{ headline: string; text: string; source: "ai" | "fallback" }> {
  try {
    const ai = await explainVerdict(llm, facts as unknown as Record<string, unknown>);
    const combined = `${ai.headline} ${ai.explanation}`;
    if (usesOnlyKnownNumbers(combined, facts)) return { headline: ai.headline, text: ai.explanation, source: "ai" };
    logger.warn({ headline: ai.headline }, "AI explanation used numbers outside the facts; using template");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "AI explanation failed; using template");
  }
  return { ...fallbackExplanation(facts), source: "fallback" };
}
