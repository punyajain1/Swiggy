import { appConfig } from "../config/app.js";
import type { JsonLlm } from "../ai/groq.js";
import { pickProducts, type ProductCandidateForLlm, type Recipe, type RecipeIngredient } from "../ai/tasks.js";
import { HttpError } from "../errors.js";
import { logger } from "../logger.js";
import type { UserSettings } from "../settings/settings.js";
import type { SwiggyApi } from "../swiggy/api.js";
import type { Product, ProductVariation } from "../swiggy/schemas.js";
import { mapLimit } from "./concurrency.js";
import { choosePacks } from "./packs.js";
import type { CookLine, CookOption, CookPack } from "./types.js";
import { formatAmount, packAmountIn, parsePackSize } from "./units.js";

export interface CookDeps {
  api: Pick<SwiggyApi, "searchProducts">;
  llm: JsonLlm;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function priceOf(v: ProductVariation): number | undefined {
  const p = v.price?.offerPrice ?? v.price?.mrp;
  return p !== undefined && p > 0 ? p : undefined;
}

function inStockVariations(p: Product): ProductVariation[] {
  return p.variations.filter((v) => v.isInStockAndAvailable !== false && priceOf(v) !== undefined);
}

/** Converts an Instamart SLA like {value:"12", unit:"MINS"} to minutes. */
function slaMinutes(v: ProductVariation): number | undefined {
  const value = Number(v.sla?.value);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = (v.sla?.unit ?? "min").toLowerCase();
  return unit.startsWith("h") ? value * 60 : value;
}

/** Cheap fallback when the AI pick fails: first candidate whose name contains the ingredient's words. */
function heuristicPick(ingredient: RecipeIngredient, candidates: Product[]): number | null {
  const words = `${ingredient.name} ${ingredient.searchQuery}`
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2);
  const idx = candidates.findIndex((c) => words.some((w) => c.displayName.toLowerCase().includes(w)));
  return idx >= 0 ? idx : candidates.length > 0 ? 0 : null;
}

function buildLine(ingredient: RecipeIngredient, product: Product | undefined): { line: CookLine; sla?: number } {
  const need = { qty: ingredient.qty, unit: ingredient.unit, display: formatAmount(ingredient.qty, ingredient.unit) };
  const fallback = appConfig.cook.fallbackIngredientCost;

  if (!product) {
    return {
      line: {
        ingredient: ingredient.name,
        need,
        status: "not_found",
        packs: [],
        cost: fallback,
        estimated: true,
        note: "Not found on Instamart near you; cost is a rough estimate.",
      },
    };
  }

  const variations = inStockVariations(product);
  const productInfo = {
    name: product.displayName,
    ...(product.brand ? { brand: product.brand } : {}),
    ...(variations[0]?.imageUrl ? { imageUrl: variations[0].imageUrl } : {}),
  };
  const sizes = variations.map((v) => {
    const pack = parsePackSize(v.quantityDescription);
    return pack ? packAmountIn(pack, ingredient.unit, ingredient.name) : null;
  });
  const sized = variations
    .map((v, i) => ({ v, size: sizes[i] }))
    .filter((x): x is { v: ProductVariation; size: number } => typeof x.size === "number" && x.size > 0);

  const toPack = (v: ProductVariation, quantity: number): CookPack => ({
    spinId: v.spinId,
    skuId: v.skuId,
    label: v.quantityDescription ?? v.displayName ?? "1 pack",
    unitPrice: priceOf(v)!,
    ...(v.price?.mrp ? { mrp: v.price.mrp } : {}),
    quantity,
  });

  const choice = choosePacks(
    ingredient.qty,
    sized.map((x) => ({ size: x.size, price: priceOf(x.v)!, ...(x.v.maxQuantity ? { maxQuantity: x.v.maxQuantity } : {}) })),
  );

  if (choice && choice.lines.length > 0) {
    const packs = choice.lines.map((l) => toPack(sized[l.index]!.v, l.quantity));
    const slas = choice.lines.map((l) => slaMinutes(sized[l.index]!.v)).filter((n): n is number => n !== undefined);
    const surplus = choice.surplus > 0.0001 ? choice.surplus : 0;
    return {
      line: {
        ingredient: ingredient.name,
        need,
        status: "matched",
        product: productInfo,
        packs,
        cost: round2(choice.totalCost),
        estimated: false,
        ...(surplus > 0 ? { surplus: { amount: surplus, unit: ingredient.unit, display: formatAmount(surplus, ingredient.unit) } } : {}),
        ...(choice.surplus < 0 ? { note: "Swiggy's quantity limit is below what the recipe needs." } : {}),
      },
      ...(slas.length ? { sla: Math.max(...slas) } : {}),
    };
  }

  // Pack size couldn't be read or converted: buy one of the cheapest in-stock pack.
  const cheapest = [...variations].sort((a, b) => priceOf(a)! - priceOf(b)!)[0];
  if (!cheapest) {
    return {
      line: { ingredient: ingredient.name, need, status: "not_found", packs: [], cost: fallback, estimated: true, note: "Out of stock on Instamart near you; cost is a rough estimate." },
    };
  }
  const sla = slaMinutes(cheapest);
  return {
    line: {
      ingredient: ingredient.name,
      need,
      status: "matched",
      product: productInfo,
      packs: [toPack(cheapest, 1)],
      cost: round2(priceOf(cheapest)!),
      estimated: true,
      note: "Couldn't read the pack size; assumed one pack is enough.",
    },
    ...(sla !== undefined ? { sla } : {}),
  };
}

export function instamartFees(subtotal: number) {
  const f = appConfig.fees.instamart;
  const delivery = subtotal > 0 && subtotal < f.freeDeliveryThreshold ? f.smallOrderDeliveryFee : 0;
  const handling = subtotal > 0 ? f.handlingFee : 0;
  return { handling, delivery, total: handling + delivery, estimated: true as const };
}

/** Prices the "Make at home" option from live Instamart results. */
export async function buildCookOption(
  deps: CookDeps,
  input: { dish: string; servings: number; recipe: Recipe; settings: UserSettings; addressId: string },
): Promise<CookOption> {
  const { recipe, settings } = input;
  const assumeStaples = settings.hasBasicStaples;
  const staples = recipe.ingredients.filter((i) => assumeStaples && i.isStaple);
  const toBuy = recipe.ingredients.filter((i) => !(assumeStaples && i.isStaple));
  const perIngredient = appConfig.cook.candidatesPerIngredient;

  const searchResults = await mapLimit(toBuy, appConfig.cook.searchConcurrency, async (ing) => {
    try {
      const res = await deps.api.searchProducts(ing.searchQuery, input.addressId);
      return res.products.filter((p) => p.isAvail !== false && inStockVariations(p).length > 0).slice(0, perIngredient);
    } catch (err) {
      // Session problems must reach the user; a single failed search just marks that ingredient missing.
      if (err instanceof HttpError && err.status === 401) throw err;
      logger.warn({ ingredient: ing.name, err: (err as Error).message }, "Instamart search failed");
      return [] as Product[];
    }
  });

  const forLlm = toBuy
    .map((ing, i) => ({
      name: ing.name,
      candidates: searchResults[i]!.map(
        (p, index): ProductCandidateForLlm => ({
          index,
          name: p.displayName,
          ...(p.brand ? { brand: p.brand } : {}),
          packs: inStockVariations(p)
            .slice(0, 4)
            .map((v) => `${v.quantityDescription ?? "?"} ₹${priceOf(v)}`),
        }),
      ),
    }))
    .filter((x) => x.candidates.length > 0);

  let picks: Map<string, number | null>;
  try {
    picks = await pickProducts(deps.llm, input.dish, forLlm);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "AI product pick failed; using name matching");
    picks = new Map();
  }

  let maxSla = 0;
  const lines: CookLine[] = toBuy.map((ing, i) => {
    const candidates = searchResults[i]!;
    const key = ing.name.toLowerCase();
    const aiPick = picks.has(key) ? (picks.get(key) ?? null) : undefined;
    // An out-of-range AI index falls back to name matching; an explicit null means "none fit".
    const picked =
      aiPick === undefined || (aiPick !== null && !candidates[aiPick]) ? heuristicPick(ing, candidates) : aiPick;
    const product = picked !== null ? candidates[picked] : undefined;
    const { line, sla } = buildLine(ing, product);
    if (sla) maxSla = Math.max(maxSla, sla);
    return line;
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.cost, 0));
  const fees = instamartFees(subtotal);
  const payToday = round2(subtotal + fees.total);
  const skill = settings.skillLevel;
  const activeMin = Math.round(recipe.activeMin * appConfig.cook.skillTimeFactor[skill]);
  const extraActive = activeMin - recipe.activeMin;
  const groceryDeliveryMin = maxSla > 0 ? maxSla : appConfig.fees.instamart.defaultDeliveryMin;
  const servings = input.servings;

  return {
    kind: "cook",
    lines,
    staples: staples.map((s) => ({ ingredient: s.name, display: formatAmount(s.qty, s.unit) })),
    subtotal,
    fees,
    payToday,
    costPerServing: round2(payToday / servings),
    servings,
    yieldServings: recipe.yieldServings,
    leftoverServings: Math.max(0, recipe.yieldServings - servings),
    prepMin: recipe.prepMin,
    cookMin: recipe.cookMin,
    activeMin,
    groceryDeliveryMin,
    totalMinToEat: Math.round(groceryDeliveryMin + recipe.prepMin + recipe.cookMin + Math.max(0, extraActive)),
    difficulty: recipe.difficulty,
    quality: appConfig.cook.skillQuality[skill],
    steps: recipe.steps,
    notFoundCount: lines.filter((l) => l.status === "not_found").length,
  };
}
