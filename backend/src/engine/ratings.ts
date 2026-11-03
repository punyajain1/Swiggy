import { appConfig } from "../config/app.js";

/**
 * Parses Swiggy rating counts such as "1.2K+ ratings", "500+", "12", "2.3k" into a number.
 * Returns undefined when there is no count.
 */
export function parseRatingCount(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  const m = /(\d+(?:\.\d+)?)\s*([kKlLmM])?/.exec(value.replace(/,/g, ""));
  if (!m) return undefined;
  const base = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  const mult = suffix === "k" ? 1_000 : suffix === "l" ? 100_000 : suffix === "m" ? 1_000_000 : 1;
  return Math.round(base * mult);
}

/**
 * Bayesian-adjusted rating: (R·v + C·m) / (v + m).
 * A 4.9 from 12 ratings is pulled toward C much more than a 4.4 from 8,000.
 * If the count is unknown, the rating and the prior get equal weight.
 */
export function adjustedRating(
  rating: number | undefined,
  count: number | undefined,
  prior: number = appConfig.ratings.priorMean,
  weight: number = appConfig.ratings.priorWeight,
): number | undefined {
  if (rating === undefined || !(rating > 0)) return undefined;
  const v = count ?? weight;
  return (rating * v + prior * weight) / (v + weight);
}

/**
 * Quality of an order option on a 0..1 scale:
 * 60% adjusted dish rating + 40% adjusted restaurant rating, or whichever exists.
 */
export function orderQuality(input: {
  dishRating?: number;
  dishRatingCount?: number;
  restaurantRating?: number;
  restaurantRatingCount?: number;
}): number {
  const dish = adjustedRating(input.dishRating, input.dishRatingCount);
  const rest = adjustedRating(input.restaurantRating, input.restaurantRatingCount);
  const { dishWeight, restaurantWeight, priorMean } = appConfig.ratings;
  let stars: number;
  if (dish !== undefined && rest !== undefined) stars = dishWeight * dish + restaurantWeight * rest;
  else stars = dish ?? rest ?? priorMean;
  return Math.min(1, Math.max(0, stars / 5));
}
