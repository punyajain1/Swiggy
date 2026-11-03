import { appConfig } from "../config/app.js";
import type { SkillLevel } from "../settings/settings.js";
import { minutes, rupees, servingsLabel } from "./format.js";
import type { ComparisonRow, CookOption, OrderOption, Side, SubScores, Verdict } from "./types.js";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The numbers scoring needs from either option. */
export interface Scorable {
  costPerServing: number;
  activeMin: number;
  /** Minutes from now until the food is ready to eat. */
  readyInMin: number;
  /** 0..1, higher is less effort. */
  effort: number;
  quality: number;
  leftoverServings: number;
  /** Share of the requested dishes this option includes (1 = the whole meal). */
  completeness: number;
}

export function cookScorable(c: CookOption): Scorable {
  return {
    costPerServing: c.costPerServing,
    activeMin: c.activeMin,
    readyInMin: c.totalMinToEat,
    effort: 1 - (c.difficulty - 1) / 4,
    quality: c.quality,
    leftoverServings: c.leftoverServings,
    completeness: 1,
  };
}

export function orderScorable(o: OrderOption): Scorable {
  const wanted = o.items.length + o.missingDishes.length;
  return {
    costPerServing: o.costPerServing,
    activeMin: o.activeMin,
    readyInMin: o.deliveryMin,
    effort: 1,
    quality: o.quality,
    leftoverServings: o.leftoverServings,
    completeness: wanted > 0 ? o.items.length / wanted : 1,
  };
}

export interface ScoreContext {
  minCostPerServing: number;
  hourlyTimeValue: number;
  timeLimitMin: number | null;
}

/** What your hands-on time is worth, in rupees. */
export function timeValueRs(activeMin: number, hourlyTimeValue: number): number {
  return (activeMin / 60) * hourlyTimeValue;
}

/**
 * Sub-scores (0..1) and the final score:
 *   final = 0.4·money + 0.35·(0.7·time + 0.3·effort) + 0.25·quality + 0.1·leftovers
 * Weights live in config/app.ts.
 */
export function subScores(s: Scorable, ctx: ScoreContext): SubScores {
  const c = appConfig.score;
  const money = s.costPerServing > 0 ? clamp01(ctx.minCostPerServing / s.costPerServing) : 1;
  const activeScore = 1 - clamp01(timeValueRs(s.activeMin, ctx.hourlyTimeValue) / c.timeValueCap);
  const readyScore = 1 - clamp01(s.readyInMin / c.maxMinutes);
  let time = c.activeTimeShare * activeScore + (1 - c.activeTimeShare) * readyScore;
  if (ctx.timeLimitMin && s.readyInMin > ctx.timeLimitMin) time *= c.timeLimitPenalty;
  const effort = clamp01(s.effort);
  const quality = clamp01(s.quality);
  const leftovers = clamp01(s.leftoverServings / c.fullLeftoverServings);
  const raw =
    c.money * money + c.timeEffort * (c.timeShare * time + c.effortShare * effort) + c.quality * quality + c.leftovers * leftovers;
  // An order missing part of the meal looks cheaper than it is, so it loses up to half its score.
  const final = raw * (1 - c.missingDishPenalty * (1 - clamp01(s.completeness)));
  return { money: r3(money), time: r3(time), effort: r3(effort), quality: r3(quality), leftovers: r3(leftovers), final: r3(final) };
}

/** Lower value wins; values within `tolerance` (relative) are a tie. */
function lowerWins(cook: number, order: number, tolerance = 0.02): Side | "tie" {
  const scale = Math.max(Math.abs(cook), Math.abs(order), 1);
  if (Math.abs(cook - order) / scale <= tolerance) return "tie";
  return cook < order ? "cook" : "order";
}

function higherWins(cook: number, order: number, absTolerance: number): Side | "tie" {
  if (Math.abs(cook - order) <= absTolerance) return "tie";
  return cook > order ? "cook" : "order";
}

function starsLabel(o: OrderOption): string {
  const parts: string[] = [];
  const what = o.items.length > 1 ? "dishes (avg)" : "dish";
  if (o.dishRating) parts.push(`${o.dishRating.toFixed(1)}★ ${what}${o.dishRatingCountLabel ? ` (${o.dishRatingCountLabel})` : ""}`);
  if (o.restaurantRating)
    parts.push(`${o.restaurantRating.toFixed(1)}★ restaurant${o.restaurantRatingCountLabel ? ` (${o.restaurantRatingCountLabel})` : ""}`);
  return parts.length ? parts.join(" · ") : "No ratings yet";
}

function cookLeftoversLabel(c: CookOption): string {
  const parts: string[] = [];
  if (c.leftoverServings > 0) parts.push(servingsLabel(c.leftoverServings));
  const surplus = c.lines.filter((l) => l.surplus).slice(0, 3);
  for (const l of surplus) parts.push(`${l.surplus!.display} ${l.ingredient.toLowerCase()}`);
  return parts.length ? parts.join(", ") : "None";
}

const difficultyWords = ["", "very easy", "easy", "moderate", "tricky", "hard"];

/** The rows of the "see it yourself" table, each with its winner. */
export function buildComparison(cook: CookOption, order: OrderOption, skillLevel: SkillLevel): ComparisonRow[] {
  const est = " (est.)";
  const without = order.missingDishes.length ? `, without ${order.missingDishes.join(", ")}` : "";
  return [
    {
      key: "payToday",
      label: "You pay today",
      cook: `${rupees(cook.payToday)}${est}`,
      order: `${rupees(order.estTotal)} (est.${without})`,
      winner: lowerWins(cook.payToday, order.estTotal),
    },
    {
      key: "perServing",
      label: "Per serving",
      cook: rupees(cook.costPerServing),
      order: rupees(order.costPerServing),
      winner: lowerWins(cook.costPerServing, order.costPerServing),
    },
    {
      key: "activeTime",
      label: "Your active time",
      cook: minutes(cook.activeMin),
      order: minutes(order.activeMin),
      winner: lowerWins(cook.activeMin, order.activeMin, 0.05),
    },
    {
      key: "readyIn",
      label: "Ready to eat in",
      cook: `~${minutes(cook.totalMinToEat)}`,
      order: `~${minutes(order.deliveryMin)}${order.deliveryEstimated ? est : ""}`,
      winner: lowerWins(cook.totalMinToEat, order.deliveryMin, 0.05),
    },
    {
      key: "effort",
      label: "Effort",
      cook: `${cook.difficulty}/5 (${difficultyWords[cook.difficulty] ?? "moderate"})`,
      order: "Minimal",
      winner: cook.difficulty <= 1 ? "tie" : "order",
    },
    {
      key: "leftovers",
      label: "Leftovers",
      cook: cookLeftoversLabel(cook),
      order: order.leftoverServings > 0 ? servingsLabel(order.leftoverServings) : "None",
      winner: higherWins(cook.leftoverServings, order.leftoverServings, 0.25),
    },
    {
      key: "quality",
      label: "Quality",
      cook: `Depends on you (skill: ${skillLevel})`,
      order: starsLabel(order),
      winner: higherWins(cook.quality, order.quality, 0.03),
    },
  ];
}

export interface ScoreInput {
  cook: CookOption | null;
  orders: OrderOption[];
  hourlyTimeValue: number;
  skillLevel: SkillLevel;
  timeLimitMin: number | null;
}

export interface ScoreResult {
  cook: CookOption | null;
  /** Best first, at most `maxRestaurantOptions`. */
  ranked: OrderOption[];
  verdict: Verdict;
  comparison: ComparisonRow[];
}

/** Scores the cook option and every restaurant, ranks restaurants, and picks the winner. */
export function scoreAll(input: ScoreInput): ScoreResult {
  const all = [...(input.cook ? [cookScorable(input.cook)] : []), ...input.orders.map(orderScorable)];
  if (all.length === 0) throw new Error("Nothing to score");
  // Partial orders are cheap because they're missing food; they don't set the "cheapest" benchmark.
  const complete = all.filter((s) => s.completeness >= 1);
  const positive = (complete.length ? complete : all).map((s) => s.costPerServing).filter((n) => n > 0);
  const ctx: ScoreContext = {
    minCostPerServing: positive.length ? Math.min(...positive) : 0,
    hourlyTimeValue: input.hourlyTimeValue,
    timeLimitMin: input.timeLimitMin,
  };

  const cook = input.cook ? { ...input.cook, scores: subScores(cookScorable(input.cook), ctx) } : null;
  const ranked = input.orders
    .map((o) => ({ ...o, scores: subScores(orderScorable(o), ctx) }))
    .sort((a, b) => b.scores.final - a.scores.final || a.costPerServing - b.costPerServing)
    .slice(0, appConfig.food.maxRestaurantOptions);
  const best = ranked[0];

  const cookScore = cook?.scores.final ?? null;
  const orderScore = best?.scores.final ?? null;
  const winner: Side =
    cookScore === null ? "order" : orderScore === null ? "cook" : cookScore >= orderScore ? "cook" : "order";
  const limit = input.timeLimitMin;

  return {
    cook,
    ranked,
    verdict: {
      winner,
      margin: cookScore !== null && orderScore !== null ? r3(Math.abs(cookScore - orderScore)) : 1,
      cookScore: cookScore ?? 0,
      orderScore,
      timeLimitMin: limit,
      cookBreaksTimeLimit: Boolean(limit && cook && cook.totalMinToEat > limit),
      orderBreaksTimeLimit: Boolean(limit && best && best.deliveryMin > limit),
    },
    comparison: cook && best ? buildComparison(cook, best, input.skillLevel) : [],
  };
}
