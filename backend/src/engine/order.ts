import { appConfig } from "../config/app.js";
import type { JsonLlm } from "../ai/groq.js";
import { joinNames, matchDishes, type DishMatch, type DishRequest, type DishRole, type MenuItemForLlm } from "../ai/tasks.js";
import { HttpError } from "../errors.js";
import { logger } from "../logger.js";
import type { FoodVariantChoice, SwiggyApi } from "../swiggy/api.js";
import type { MenuItem, Restaurant, SearchRestaurants } from "../swiggy/schemas.js";
import { mapLimit } from "./concurrency.js";
import { orderQuality, parseRatingCount } from "./ratings.js";
import type { OrderLine, OrderOption } from "./types.js";

export interface OrderDeps {
  api: Pick<SwiggyApi, "searchRestaurants" | "searchMenu">;
  llm: JsonLlm;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

interface RestaurantInfo {
  name?: string;
  areaName?: string;
  rating?: number;
  ratingCount?: number;
  ratingCountLabel?: string;
  deliveryMin?: number;
  distanceKm?: number;
  offer?: string;
  status?: string;
}

/** Merges restaurant metadata from search_restaurants' restaurants[] and dishes[] by restaurant id. */
export function indexRestaurants(res: SearchRestaurants | undefined): Map<string, RestaurantInfo> {
  const map = new Map<string, RestaurantInfo>();
  if (!res) return map;
  for (const r of res.restaurants as Restaurant[]) {
    if (!r.id) continue;
    map.set(r.id, {
      name: r.name,
      ...(r.areaName ? { areaName: r.areaName } : {}),
      ...(r.avgRating !== undefined ? { rating: r.avgRating } : {}),
      ...(r.totalRatings ? { ratingCount: parseRatingCount(r.totalRatings), ratingCountLabel: r.totalRatings } : {}),
      ...(r.deliveryTimeMinutes !== undefined ? { deliveryMin: r.deliveryTimeMinutes } : {}),
      ...(r.distanceKm !== undefined ? { distanceKm: r.distanceKm } : {}),
      ...(r.offer ? { offer: r.offer } : {}),
      ...(r.availabilityStatus ? { status: r.availabilityStatus.toUpperCase() } : {}),
    });
  }
  for (const d of res.dishes) {
    if (!d.restaurantId) continue;
    const existing = map.get(d.restaurantId) ?? {};
    map.set(d.restaurantId, {
      ...existing,
      name: existing.name ?? d.restaurantName,
      rating: existing.rating ?? d.restaurantRating,
      deliveryMin: existing.deliveryMin ?? d.deliveryTimeMinutes,
    });
  }
  return map;
}

/** Adds `from` into `into`, keeping values `into` already has. Used to combine one search per dish. */
function mergeRestaurantInfo(into: Map<string, RestaurantInfo>, from: Map<string, RestaurantInfo>): void {
  for (const [id, info] of from) {
    const existing = into.get(id);
    if (!existing) {
      into.set(id, info);
      continue;
    }
    const merged: RestaurantInfo = { ...existing };
    for (const [k, v] of Object.entries(info) as Array<[keyof RestaurantInfo, never]>) {
      if (merged[k] === undefined && v !== undefined) merged[k] = v;
    }
    into.set(id, merged);
  }
}

interface DefaultVariant {
  label?: string;
  price?: number;
  variants?: FoodVariantChoice[];
  variantsV2?: FoodVariantChoice[];
}

const isDefault = (d: number | undefined) => d === 1;
const inStock = (s: number | undefined) => s === undefined || s !== 0;

/** Picks the default variant in the same format the item came with (variations or variantsV2). */
export function defaultVariant(item: MenuItem): DefaultVariant {
  if (item.variantsV2 && item.variantsV2.length > 0) {
    const choices: FoodVariantChoice[] = [];
    const labels: string[] = [];
    let price: number | undefined;
    for (const group of item.variantsV2) {
      const options = group.variations.filter((v) => inStock(v.inStock));
      const pick = options.find((v) => isDefault(v.default)) ?? options[0];
      if (!pick?.id || !group.groupId) continue;
      choices.push({ group_id: group.groupId, variation_id: pick.id });
      if (pick.name) labels.push(pick.name);
      if (pick.price !== undefined && pick.price > 0) price = Math.max(price ?? 0, pick.price);
    }
    return {
      ...(labels.length ? { label: labels.join(", ") } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(choices.length ? { variantsV2: choices } : {}),
    };
  }
  if (item.variations && item.variations.length > 0) {
    const options = item.variations.filter((v) => inStock(v.inStock));
    const pick = options.find((v) => isDefault(v.default)) ?? options[0];
    if (pick?.id && pick.groupId) {
      return {
        ...(pick.name ? { label: pick.name } : {}),
        ...(pick.price !== undefined && pick.price > 0 ? { price: pick.price } : {}),
        variants: [{ group_id: pick.groupId, variation_id: pick.id }],
      };
    }
  }
  return {};
}

const STOP_WORDS = new Set(["and", "with", "the", "of", "in", "a"]);

/** Keyword fallback used when the AI dish match fails. */
export function keywordMatch(dish: string, name: string, variantLabel?: string, role: DishRole = "main"): DishMatch {
  const words = dish
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const hay = `${name} ${variantLabel ?? ""}`.toLowerCase();
  const isDish =
    words.length > 0 &&
    words.every((w) => hay.includes(w)) &&
    !/\b(combo|roll|pizza|burger|wrap|sandwich|thali)\b/.test(hay.replace(dish.toLowerCase(), ""));

  let servesPerUnit: number;
  if (role === "bread") {
    const pieces = /(\d+)\s*(?:pcs?|pieces?)\b/.exec(hay);
    servesPerUnit = pieces ? Number(pieces[1]) * 0.5 : /\bbasket\b/.test(hay) ? 2 : 0.5;
  } else if (role === "side" || role === "dessert" || role === "drink") {
    servesPerUnit = 1;
  } else if (/\bhalf\b|\bmini\b|\bsmall\b/.test(hay)) {
    servesPerUnit = 1;
  } else if (/\bfull\b/.test(hay)) {
    servesPerUnit = 2.5;
  } else if (/\bfamily\b|\blarge\b|\bjumbo\b|\bbucket\b/.test(hay)) {
    servesPerUnit = 4;
  } else {
    servesPerUnit = 1.5;
  }
  return { isDish, servesPerUnit };
}

/**
 * Share of the group's servings one dish has to cover. With two or three curries, people take
 * some of each, so each curry is a smaller portion. Breads, rice and sides are for everyone.
 */
export function portionFactor(role: DishRole, mainCount: number): number {
  if (role !== "main" || mainCount <= 1) return 1;
  return mainCount === 2 ? 0.6 : 0.45;
}

export function foodFees(itemTotal: number) {
  const f = appConfig.fees.food;
  const gst = round2(itemTotal * f.gstRate);
  return { delivery: f.deliveryFee, platform: f.platformFee, gst, total: round2(f.deliveryFee + f.platformFee + gst), estimated: true as const };
}

interface Candidate {
  dishIndex: number;
  item: MenuItem;
  variant: DefaultVariant;
  price: number;
  restaurantId: string;
}

interface Group {
  name?: string;
  /** dish index -> the best line for that dish at this restaurant */
  lines: Map<number, OrderLine>;
}

const passThroughAuth = (err: unknown) => {
  if (err instanceof HttpError && err.status === 401) throw err;
};

/** Search results for one dish across restaurants: first page, plus the next page if there's room. */
async function searchDishItems(deps: OrderDeps, query: string, addressId: string, max: number): Promise<MenuItem[]> {
  const first = await deps.api.searchMenu(query, addressId);
  const items = [...first.items];
  if (first.hasMore && first.nextOffset && items.length < max) {
    try {
      const second = await deps.api.searchMenu(query, addressId, first.nextOffset);
      items.push(...second.items);
    } catch (err) {
      passThroughAuth(err);
      logger.warn({ query, err: (err as Error).message }, "search_menu page 2 failed");
    }
  }
  return items.slice(0, max);
}

const COMBO_WORDS = /\+|\bchoice of\b|\bcombo\b|\bmeal\b|\bthali\b|\bplatter\b|\bwith \d/i;

/**
 * True for combos like "Dal Makhani + Raita + Choice Of Breads" or "Butter Chicken with 2 Paratha Meal".
 * They aren't the dish you asked for, and many need a choice made before Swiggy accepts them in a cart.
 * A combo still counts if you asked for one ("Veg Thali").
 */
export function isCombo(itemName: string, wanted: string): boolean {
  return COMBO_WORDS.test(itemName) && !COMBO_WORDS.test(wanted);
}

/** True when the item has an add-on group you must pick from. The app sends no add-ons, so Swiggy would reject it. */
function needsAddonChoice(item: MenuItem): boolean {
  return (item.addons ?? []).some((g) => (g.minAddons ?? 0) > 0);
}

/** Keeps in-stock, priced items from open restaurants. `onlyRestaurant` is for a search inside one restaurant. */
function toCandidates(
  dishIndex: number,
  wanted: string,
  items: MenuItem[],
  restaurants: Map<string, RestaurantInfo>,
  onlyRestaurant?: string,
): Candidate[] {
  const out: Candidate[] = [];
  for (const item of items) {
    const restaurantId = item.restaurant_id ?? onlyRestaurant;
    if (!item.menu_item_id || !restaurantId || !inStock(item.inStock)) continue;
    if (isCombo(item.name, wanted) || needsAddonChoice(item)) continue;
    if (onlyRestaurant && restaurantId !== onlyRestaurant) continue;
    // Only OPEN restaurants. Unknown status is kept (and flagged) because the searches don't always overlap.
    const status = restaurants.get(restaurantId)?.status;
    if (status && status !== "OPEN") continue;
    const variant = defaultVariant(item);
    const price = item.price && item.price > 0 ? item.price : variant.price;
    if (!price || price <= 0) continue;
    out.push({ dishIndex, item, variant, price, restaurantId });
  }
  return out;
}

/** Asks Groq which candidates really are the wanted dish (falls back to keyword rules per item). */
async function matchAll(deps: OrderDeps, dishes: DishRequest[], candidates: Candidate[]): Promise<DishMatch[]> {
  if (candidates.length === 0) return [];
  const forLlm: MenuItemForLlm[] = candidates.map((c, index) => ({
    index,
    wanted: dishes[c.dishIndex]!.name,
    role: dishes[c.dishIndex]!.role,
    name: c.item.name,
    ...(c.variant.label ? { variant: c.variant.label } : {}),
    ...(c.item.restaurant_name ? { restaurant: c.item.restaurant_name } : {}),
    price: c.price,
  }));
  let matches: Map<number, DishMatch>;
  try {
    matches = await matchDishes(deps.llm, forLlm);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "AI dish match failed; using keyword rules");
    matches = new Map();
  }
  return candidates.map((c, i) => {
    const dish = dishes[c.dishIndex]!;
    return matches.get(i) ?? keywordMatch(dish.name, c.item.name, c.variant.label, dish.role);
  });
}

function makeLine(c: Candidate, m: DishMatch, dishName: string, need: number): OrderLine {
  const servesPerUnit = Math.max(0.2, m.servesPerUnit);
  const quantity = Math.max(1, Math.ceil(need / servesPerUnit - 1e-9));
  const ratingCount = parseRatingCount(c.item.totalRatings);
  return {
    dish: dishName,
    menuItemId: c.item.menu_item_id!,
    name: c.item.name,
    ...(c.variant.label ? { variantLabel: c.variant.label } : {}),
    price: c.price,
    quantity,
    servesPerUnit,
    lineTotal: round2(quantity * c.price),
    ...(c.item.isVeg !== undefined ? { isVeg: c.item.isVeg } : {}),
    ...(c.item.imageUrl ? { imageUrl: c.item.imageUrl } : {}),
    ...(c.item.rating !== undefined && c.item.rating > 0 ? { rating: c.item.rating } : {}),
    ...(ratingCount !== undefined ? { ratingCount } : {}),
    ...(c.item.totalRatings ? { ratingCountLabel: c.item.totalRatings } : {}),
    ...(c.variant.variants ? { variants: c.variant.variants } : {}),
    ...(c.variant.variantsV2 ? { variantsV2: c.variant.variantsV2 } : {}),
  };
}

/**
 * Builds one "Order from outside" option per restaurant. For a meal of several dishes, each
 * option is one restaurant with a line per dish (a Swiggy Food cart holds one restaurant only).
 * Ranking happens later in score.ts, together with the cook option.
 */
export async function buildOrderOptions(
  deps: OrderDeps,
  input: { dishes: DishRequest[]; servings: number; addressId: string },
): Promise<{ options: OrderOption[]; warnings: string[] }> {
  const { dishes, servings, addressId } = input;
  const warnings: string[] = [];
  if (dishes.length === 0) return { options: [], warnings };
  const multi = dishes.length > 1;
  const perDishMax = multi ? appConfig.food.maxMenuItemsPerDish : appConfig.food.maxMenuItems;
  const mainCount = dishes.filter((d) => d.role === "main").length;
  const factors = dishes.map((d) => portionFactor(d.role, mainCount));
  const needs = factors.map((f) => servings * f);

  // 1. Search every dish across restaurants, with restaurant details (ratings, delivery time, open or closed).
  let detailsFailed = false;
  const perDishConcurrency = Math.max(1, Math.floor(appConfig.food.searchConcurrency / 2));
  const searches = await mapLimit(dishes, perDishConcurrency, async (dish) => {
    const [restaurants, items] = await Promise.all([
      deps.api.searchRestaurants(dish.name, addressId).catch((err) => {
        passThroughAuth(err);
        logger.warn({ dish: dish.name, err: (err as Error).message }, "search_restaurants failed");
        detailsFailed = true;
        return undefined;
      }),
      searchDishItems(deps, dish.name, addressId, perDishMax).catch((err) => {
        // With one dish there's nothing to compare without its search; with a meal, the other dishes still count.
        if (!multi) throw err;
        passThroughAuth(err);
        logger.warn({ dish: dish.name, err: (err as Error).message }, "search_menu failed");
        warnings.push(`Couldn't search Swiggy Food for ${dish.name}.`);
        return [] as MenuItem[];
      }),
    ]);
    return { restaurants, items };
  });
  if (detailsFailed) warnings.unshift("Couldn't load some restaurant details (ratings, delivery times); some values are estimated.");

  const restaurants = new Map<string, RestaurantInfo>();
  for (const s of searches) mergeRestaurantInfo(restaurants, indexRestaurants(s.restaurants));

  // 2. Keep items that really are the wanted dish, and the best one per dish per restaurant.
  const groups = new Map<string, Group>();
  const consider = (c: Candidate, m: DishMatch) => {
    if (!m.isDish) return;
    const line = makeLine(c, m, dishes[c.dishIndex]!.name, needs[c.dishIndex]!);
    let group = groups.get(c.restaurantId);
    if (!group) {
      group = { lines: new Map() };
      groups.set(c.restaurantId, group);
    }
    group.name ??= c.item.restaurant_name;
    const current = group.lines.get(c.dishIndex);
    if (
      !current ||
      line.lineTotal < current.lineTotal - 0.01 ||
      (Math.abs(line.lineTotal - current.lineTotal) <= 0.01 && (line.rating ?? 0) > (current.rating ?? 0))
    ) {
      group.lines.set(c.dishIndex, line);
    }
  };

  const candidates = searches.flatMap((s, d) => toCandidates(d, dishes[d]!.name, s.items, restaurants));
  const matches = await matchAll(deps, dishes, candidates);
  candidates.forEach((c, i) => consider(c, matches[i]!));

  // 3. A restaurant found for the curry may also sell the naan without it showing up in the
  //    cross-restaurant search, so look inside the most promising partial restaurants.
  if (multi) {
    const partial = [...groups.entries()]
      .filter(([, g]) => g.lines.size < dishes.length)
      .sort(
        ([idA, a], [idB, b]) =>
          b.lines.size - a.lines.size || (restaurants.get(idB)?.rating ?? 0) - (restaurants.get(idA)?.rating ?? 0),
      )
      .slice(0, appConfig.food.gapFillRestaurants);
    const gaps = partial
      .flatMap(([rid, g]) => dishes.map((_, d) => ({ rid, d })).filter(({ d }) => !g.lines.has(d)))
      .slice(0, appConfig.food.maxGapFillSearches);

    if (gaps.length > 0) {
      const found = await mapLimit(gaps, appConfig.food.searchConcurrency, async ({ rid, d }) => {
        try {
          const res = await deps.api.searchMenu(dishes[d]!.name, addressId, undefined, rid);
          return toCandidates(d, dishes[d]!.name, res.items, restaurants, rid);
        } catch (err) {
          passThroughAuth(err);
          logger.warn({ rid, dish: dishes[d]!.name, err: (err as Error).message }, "Restaurant menu search failed");
          return [] as Candidate[];
        }
      });
      const extra = found.flat();
      const extraMatches = await matchAll(deps, dishes, extra);
      extra.forEach((c, i) => consider(c, extraMatches[i]!));
    }
  }

  // 4. Prefer restaurants with the whole meal. If none has it, show the ones with the most of it.
  let chosen = [...groups.entries()].filter(([, g]) => g.lines.size === dishes.length);
  if (chosen.length === 0 && multi && groups.size > 0) {
    const most = Math.max(...[...groups.values()].map((g) => g.lines.size));
    chosen = [...groups.entries()].filter(([, g]) => g.lines.size === most);
    warnings.push(
      `No open restaurant near you has the whole meal (${joinNames(dishes.map((d) => d.name))}) on Swiggy Food. These restaurants have part of it, and their price only covers what they have.`,
    );
  }

  const options = chosen.map(([restaurantId, group]): OrderOption => {
    const info = restaurants.get(restaurantId);
    const entries = [...group.lines.entries()].sort((a, b) => a[0] - b[0]);
    const lines = entries.map(([, l]) => l);
    const itemTotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const fees = foodFees(itemTotal);
    const estTotal = round2(itemTotal + fees.total);

    // How many people the whole order feeds is set by the dish that runs out first.
    const feeds = Math.min(...entries.map(([d, l]) => (l.quantity * l.servesPerUnit) / factors[d]!));
    const rated = lines.filter((l) => l.rating !== undefined);
    const dishRating = rated.length ? round2(rated.reduce((s, l) => s + l.rating!, 0) / rated.length) : undefined;
    const counts = rated.map((l) => l.ratingCount).filter((n): n is number => n !== undefined);
    const dishRatingCount = counts.length ? Math.min(...counts) : undefined;
    const singleLabel = lines.length === 1 ? lines[0]!.ratingCountLabel : undefined;
    const deliveryKnown = Boolean(info?.deliveryMin && info.deliveryMin > 0);

    return {
      kind: "order",
      id: restaurantId,
      restaurantId,
      restaurantName: group.name ?? info?.name ?? "Restaurant",
      ...(info?.areaName ? { areaName: info.areaName } : {}),
      items: lines,
      missingDishes: dishes.filter((_, d) => !group.lines.has(d)).map((d) => d.name),
      leftoverServings: Math.max(0, round1(feeds - servings)),
      itemTotal,
      fees,
      estTotal,
      costPerServing: round2(estTotal / servings),
      ...(dishRating !== undefined ? { dishRating } : {}),
      ...(dishRatingCount !== undefined ? { dishRatingCount } : {}),
      ...(singleLabel ? { dishRatingCountLabel: singleLabel } : {}),
      ...(info?.rating !== undefined ? { restaurantRating: info.rating } : {}),
      ...(info?.ratingCount !== undefined ? { restaurantRatingCount: info.ratingCount } : {}),
      ...(info?.ratingCountLabel ? { restaurantRatingCountLabel: info.ratingCountLabel } : {}),
      ...(info?.distanceKm !== undefined ? { distanceKm: info.distanceKm } : {}),
      deliveryMin: deliveryKnown ? info!.deliveryMin! : appConfig.food.defaultDeliveryMin,
      deliveryEstimated: !deliveryKnown,
      ...(info?.offer ? { offer: info.offer } : {}),
      availability: info?.status === "OPEN" ? "OPEN" : "UNKNOWN",
      quality: orderQuality({
        ...(dishRating !== undefined ? { dishRating } : {}),
        ...(dishRatingCount !== undefined ? { dishRatingCount } : {}),
        ...(info?.rating !== undefined ? { restaurantRating: info.rating } : {}),
        ...(info?.ratingCount !== undefined ? { restaurantRatingCount: info.ratingCount } : {}),
      }),
      activeMin: appConfig.food.activeMinutesToOrder,
    };
  });

  return { options, warnings };
}
