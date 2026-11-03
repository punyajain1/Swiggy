import { randomUUID } from "node:crypto";
import type { JsonLlm } from "../ai/groq.js";
import { estimateRecipe, parseIntent } from "../ai/tasks.js";
import { errors, HttpError } from "../errors.js";
import { logger } from "../logger.js";
import type { SettingsStore } from "../settings/settings.js";
import type { SwiggyApi } from "../swiggy/api.js";
import { buildCookOption } from "./cook.js";
import type { DecisionCache } from "./decisionCache.js";
import { buildFacts, explain } from "./explain.js";
import { buildOrderOptions } from "./order.js";
import { scoreAll } from "./score.js";
import type { CookOption, Decision, OrderOption } from "./types.js";

export interface DecideDeps {
  api: Pick<SwiggyApi, "searchProducts" | "searchRestaurants" | "searchMenu">;
  llm: JsonLlm;
  settings: SettingsStore;
  cache: DecisionCache;
}

const isSessionError = (err: unknown) => err instanceof HttpError && err.status === 401;
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The whole "cook or click" flow for one craving:
 * intent -> (recipe -> Instamart costing) in parallel with (Swiggy Food options) -> score -> explain.
 */
export async function decide(deps: DecideDeps, text: string): Promise<Decision> {
  const settings = await deps.settings.get();
  if (!settings.addressId) throw errors.noAddress();
  const addressId = settings.addressId;

  const intent = await parseIntent(deps.llm, text, settings);
  const recipeP = estimateRecipe(deps.llm, intent.dishes, intent.servings, intent.notes);
  const cookP = recipeP.then((recipe) =>
    buildCookOption({ api: deps.api, llm: deps.llm }, { dish: intent.dish, servings: intent.servings, recipe, settings, addressId }),
  );
  const orderP = buildOrderOptions(
    { api: deps.api, llm: deps.llm },
    { dishes: intent.dishes, servings: intent.servings, addressId },
  );

  const [recipeR, cookR, orderR] = await Promise.allSettled([recipeP, cookP, orderP]);
  for (const r of [recipeR, cookR, orderR]) {
    if (r.status === "rejected" && isSessionError(r.reason)) throw r.reason;
  }
  if (recipeR.status === "rejected") throw recipeR.reason;
  const recipe = recipeR.value;

  const warnings: string[] = [];
  if (intent.droppedDishes.length > 0) {
    warnings.push(`One comparison covers up to ${intent.dishes.length} dishes, so ${intent.droppedDishes.join(", ")} ${intent.droppedDishes.length === 1 ? "was" : "were"} left out.`);
  }
  let cook: CookOption | null = null;
  if (cookR.status === "fulfilled" && cookR.value.lines.length > 0 && cookR.value.notFoundCount === cookR.value.lines.length) {
    // Every price would be a guess, so there's nothing real to compare.
    warnings.push("None of the ingredients were found on Instamart near you, so cooking can't be priced.");
  } else if (cookR.status === "fulfilled") {
    cook = cookR.value;
    if (cook.notFoundCount > 0) {
      warnings.push(
        `${cook.notFoundCount} ingredient${cook.notFoundCount === 1 ? " wasn't" : "s weren't"} found on Instamart near you; ${cook.notFoundCount === 1 ? "its" : "their"} cost is a rough estimate.`,
      );
    }
  } else {
    logger.warn({ err: reason(cookR.reason) }, "Cook option failed");
    warnings.push(`Couldn't price the ingredients on Instamart: ${reason(cookR.reason)}`);
  }

  let orders: OrderOption[] = [];
  if (orderR.status === "fulfilled") {
    orders = orderR.value.options;
    warnings.push(...orderR.value.warnings);
    if (orders.length === 0) warnings.push(`No open restaurant near you has ${intent.dish} on Swiggy Food right now.`);
  } else {
    logger.warn({ err: reason(orderR.reason) }, "Order options failed");
    warnings.push(`Couldn't check restaurants on Swiggy Food: ${reason(orderR.reason)}`);
  }

  if (!cook && orders.length === 0) {
    throw new HttpError(404, "NOTHING_FOUND", `Couldn't find ${intent.dish} on Swiggy Food or price its ingredients on Instamart near you.`, { warnings });
  }

  const scored = scoreAll({
    cook,
    orders,
    hourlyTimeValue: settings.hourlyTimeValue,
    skillLevel: settings.skillLevel,
    timeLimitMin: intent.timeLimitMin,
  });
  const [best, ...alternatives] = scored.ranked;

  const facts = buildFacts({
    dish: intent.dish,
    servings: intent.servings,
    hourlyTimeValue: settings.hourlyTimeValue,
    cook: scored.cook,
    best,
    verdict: scored.verdict,
  });
  const explanation = await explain(deps.llm, facts);

  const decision: Decision = {
    decisionId: randomUUID(),
    createdAt: new Date().toISOString(),
    intent,
    recipe,
    cook: scored.cook,
    order: best ? { best, alternatives } : null,
    comparison: scored.comparison,
    verdict: scored.verdict,
    explanation,
    warnings,
    addressLine: settings.addressLine,
  };
  deps.cache.set(decision.decisionId, { decision, addressId });
  return decision;
}
