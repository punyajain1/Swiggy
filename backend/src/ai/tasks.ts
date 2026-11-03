import { z } from "zod";
import { errors } from "../errors.js";
import type { UserSettings } from "../settings/settings.js";
import type { JsonLlm } from "./groq.js";

// ---------- Intent ----------

/** What part of the meal a dish is. Decides how much of it the group needs. */
export const dishRoles = ["main", "bread", "rice", "side", "dessert", "drink"] as const;
export type DishRole = (typeof dishRoles)[number];

/** Most dishes one comparison handles; more would mean too many Swiggy searches. */
export const MAX_DISHES = 4;

const intentReply = z.object({
  isFoodRequest: z.boolean(),
  dishes: z
    .array(z.object({ name: z.string().trim().min(1).max(80), role: z.enum(dishRoles) }))
    .max(10)
    .default([]),
  servings: z.number().int().min(1).max(20).nullable(),
  timeLimitMin: z.number().int().min(5).max(1440).nullable(),
  notes: z.string().max(300).nullable().optional(),
});

export interface DishRequest {
  name: string;
  role: DishRole;
}

export interface Intent {
  /** Display label for the whole meal, e.g. "Paneer Butter Masala, Dal Makhani and Butter Naan". */
  dish: string;
  /** Every dish in the meal, in the order the user said them. */
  dishes: DishRequest[];
  servings: number;
  timeLimitMin: number | null;
  notes: string | null;
  /** True when servings came from settings, not the user's sentence. */
  servingsDefaulted: boolean;
  /** Dishes beyond MAX_DISHES that were left out. */
  droppedDishes: string[];
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Turns "paneer butter masala and dal makhani with naan for 6, 40 mins" into dishes, servings and a time limit. */
export async function parseIntent(llm: JsonLlm, text: string, settings: UserSettings): Promise<Intent> {
  const reply = await llm.json({
    task: "parseIntent",
    system: [
      "You extract a food craving from one sentence written by a user in India. The sentence may name one dish or a whole meal.",
      'Return JSON: {"isFoodRequest": boolean, "dishes": [{"name": string, "role": "main"|"bread"|"rice"|"side"|"dessert"|"drink"}], "servings": integer|null, "timeLimitMin": integer|null, "notes": string|null}.',
      "- dishes: EVERY distinct dish the user wants, in the order they said them. Words like \"and\", \"with\", \"plus\", \"&\" and commas separate dishes.",
      "  \"paneer butter masala and dal makhani with butter naan\" = 3 dishes. \"butter chicken\" = 1 dish.",
      "  Use the common Indian menu spelling in Title Case and fix typos (\"daal makahni\" -> \"Dal Makhani\", \"panner\" -> \"Paneer\"). No quantities in names.",
      "  Don't split one dish name (\"Chicken Butter Masala\", \"Dal Tadka\", \"Mac and Cheese\" are single dishes).",
      "- role: main = curries, gravies, dals, biryani, pizza, noodles; bread = naan, roti, paratha, kulcha, bhatura; rice = plain/jeera/steamed rice, pulao;",
      "  side = raita, salad, papad, fries; dessert = sweets, ice cream; drink = lassi, juice, soft drinks.",
      "- servings: number of people only if the user says it (\"for 4\", \"me and my wife\" = 2, \"just me\" = 1). Otherwise null.",
      "- timeLimitMin: minutes until they want to eat, only if stated (\"40 mins\" = 40, \"in an hour\" = 60, \"6 hours\" = 360, \"by 9pm\" is unknown = null). Otherwise null.",
      "- notes: short extra preferences (e.g. \"less spicy\", \"boneless\", \"Jain\") or null.",
      "- isFoodRequest: false if the sentence is not about wanting to eat something; then dishes is [].",
    ].join("\n"),
    user: text,
    schema: intentReply,
    temperature: 0,
    maxTokens: 1024,
  });

  // Drop duplicates ("naan and butter naan" stays two; "naan and naan" becomes one).
  const seen = new Set<string>();
  const unique = reply.dishes.filter((d) => {
    const key = d.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!reply.isFoodRequest || unique.length === 0) {
    throw errors.badRequest('Tell me what you want to eat, e.g. "butter chicken for 2 tonight" or "dal makhani with naan for 4".');
  }
  const dishes = unique.slice(0, MAX_DISHES);
  return {
    dish: joinNames(dishes.map((d) => d.name)),
    dishes,
    servings: reply.servings ?? settings.defaultServings,
    timeLimitMin: reply.timeLimitMin,
    notes: reply.notes ?? null,
    servingsDefaulted: reply.servings == null,
    droppedDishes: unique.slice(MAX_DISHES).map((d) => d.name),
  };
}

// ---------- Recipe ----------

export const recipeUnits = ["g", "ml", "pcs"] as const;

const recipeReply = z.object({
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        qty: z.number().positive().max(100_000),
        unit: z.enum(recipeUnits),
        searchQuery: z.string().min(1).max(60),
        isStaple: z.boolean(),
      }),
    )
    .min(1)
    .max(45),
  prepMin: z.number().int().min(0).max(1440),
  cookMin: z.number().int().min(0).max(1440),
  activeMin: z.number().int().min(0).max(1440),
  difficulty: z.number().int().min(1).max(5),
  yieldServings: z.number().int().min(1).max(40),
  steps: z.array(z.string().max(240)).min(1).max(16),
});

export type Recipe = z.infer<typeof recipeReply>;
export type RecipeIngredient = Recipe["ingredients"][number];

/** Asks Groq for a home plan for the whole meal, with buyable ingredient quantities. Nothing is stored. */
export async function estimateRecipe(
  llm: JsonLlm,
  dishes: DishRequest[],
  servings: number,
  notes: string | null,
): Promise<Recipe> {
  const meal = dishes.length > 1;
  return llm.json({
    task: "estimateRecipe",
    system: [
      `You are an experienced Indian home cook. Write a realistic plan to cook ${meal ? "this whole meal" : "this dish"} at home.`,
      "Return JSON:",
      '{"ingredients":[{"name":string,"qty":number,"unit":"g"|"ml"|"pcs","searchQuery":string,"isStaple":boolean}],',
      ' "prepMin":int,"cookMin":int,"activeMin":int,"difficulty":1-5,"yieldServings":int,"steps":[string]}',
      "Rules:",
      ...(meal
        ? [
            "- This is ONE meal for the group: people eat some of every dish, so portion each dish as part of a meal, not as a full main for everyone.",
            "- Merge shared ingredients into ONE line with the total for the whole meal (e.g. all the butter, onions and cream across every dish).",
            "- Times are for the whole meal with sensible overlap (e.g. the dal simmers while you make the paneer gravy).",
            "- difficulty is for the whole meal. Breads like naan are made on a tawa at home.",
            "- steps: 6-12 short steps covering every dish, in the order you'd actually do them.",
          ]
        : ["- steps: 4-8 short steps."]),
      "- Quantities are for the requested servings. Use ONLY units g, ml or pcs. Convert spoons/cups: 1 tsp = 5 g or 5 ml, 1 tbsp = 15 g or 15 ml, 1 cup = 240 ml.",
      "- Garlic cloves, onions, tomatoes, eggs, chillies: use pcs. Meat, paneer, flour, rice, spices: g. Milk, cream, oil: ml.",
      "- searchQuery: what to type into a grocery app to find it (e.g. \"boneless chicken\", \"fresh cream\", \"kasuri methi\").",
      "- isStaple: true ONLY for things almost every Indian kitchen already has: salt, sugar, cooking oil, water, turmeric, red chilli powder, cumin seeds, garam masala, coriander powder. Everything else is false (butter, cream, meat, vegetables, paneer, kasuri methi, cashews are NOT staples).",
      "- activeMin: minutes of hands-on work (chopping, stirring), not waiting/marinating. prepMin + cookMin is total time.",
      "- difficulty: 1 = boil water, 3 = typical curry, 5 = restaurant-level technique.",
      "- yieldServings: how many people the food actually feeds as a meal (can be more than requested).",
    ].join("\n"),
    user: [
      meal ? `Meal: ${dishes.map((d) => `${d.name} (${d.role})`).join(", ")}` : `Dish: ${dishes[0]?.name ?? ""}`,
      `People: ${servings}`,
      ...(notes ? [`Preferences: ${notes}`] : []),
    ].join("\n"),
    schema: recipeReply,
    temperature: 0.2,
  });
}

// ---------- Instamart product picking ----------

export interface ProductCandidateForLlm {
  index: number;
  name: string;
  brand?: string;
  packs: string[];
}

const pickReply = z.object({
  picks: z.array(z.object({ ingredient: z.string(), candidateIndex: z.number().int().min(0).nullable() })),
});

/**
 * For each ingredient, picks the search result that really is that ingredient
 * (so "chicken" doesn't match "chicken masala"). Returns ingredient name -> index or null.
 */
export async function pickProducts(
  llm: JsonLlm,
  dish: string,
  ingredients: Array<{ name: string; candidates: ProductCandidateForLlm[] }>,
): Promise<Map<string, number | null>> {
  if (ingredients.length === 0) return new Map();
  const reply = await llm.json({
    task: "pickProducts",
    system: [
      "You match recipe ingredients to grocery search results from Swiggy Instamart.",
      'Return JSON: {"picks":[{"ingredient":string,"candidateIndex":int|null}]} with one entry per ingredient, using the exact ingredient names given.',
      "- Pick the candidate that IS the raw ingredient a cook would buy for this dish. Prefer plain, unflavoured, fresh items.",
      "- Reject ready-made mixes, sauces, snacks or flavoured versions (e.g. for \"chicken\" reject \"chicken masala\" and \"chicken nuggets\").",
      "- If none of the candidates fit, use null.",
    ].join("\n"),
    user: JSON.stringify({ dish, ingredients }),
    schema: pickReply,
    temperature: 0,
  });
  const map = new Map<string, number | null>();
  for (const p of reply.picks) map.set(p.ingredient.toLowerCase(), p.candidateIndex);
  return map;
}

// ---------- Food dish matching ----------

export interface MenuItemForLlm {
  index: number;
  /** The dish the user asked for that this item was found for. */
  wanted: string;
  role: DishRole;
  name: string;
  variant?: string;
  restaurant?: string;
  price?: number;
}

const matchReply = z.object({
  items: z.array(
    z.object({
      index: z.number().int().min(0),
      isDish: z.boolean(),
      servesPerUnit: z.number().min(0.2).max(10),
    }),
  ),
});

export interface DishMatch {
  isDish: boolean;
  servesPerUnit: number;
}

/** Confirms which menu items really are the dish they were found for, and how many people one unit feeds. */
export async function matchDishes(llm: JsonLlm, items: MenuItemForLlm[]): Promise<Map<number, DishMatch>> {
  if (items.length === 0) return new Map();
  const reply = await llm.json({
    task: "matchDishes",
    system: [
      "You review Indian restaurant menu items from Swiggy. Each item says which dish the user wants (`wanted`) and its role in the meal.",
      'Return JSON: {"items":[{"index":int,"isDish":boolean,"servesPerUnit":number}]} with one entry per item.',
      "- isDish: true if ordering this item gets the user the `wanted` dish (a reasonable variant is fine, e.g. \"Butter Chicken Boneless\" for Butter Chicken, \"Garlic Butter Naan\" for Butter Naan is false but \"Butter Naan (2 pcs)\" is true).",
      "  false for combos/thalis where the dish is minor, different dishes (\"Butter Chicken Pizza\" or \"Butter Chicken Roll\" for a curry), or anything else.",
      "- servesPerUnit: how many adults one unit (at the listed variant) feeds in that role.",
      "  main curries/dals: Half ~1, regular/single ~1.5, Full ~2-3, Family/Large ~4.",
      "  bread: one naan/roti/paratha piece ~0.5 (people eat about 2); \"2 pcs\" ~1; a basket of 4 ~2.",
      "  rice: one plate ~1.5. side/dessert/drink: one portion ~1. Use name, variant and price as hints.",
    ].join("\n"),
    user: JSON.stringify({ items }),
    schema: matchReply,
    temperature: 0,
  });
  const map = new Map<number, DishMatch>();
  for (const it of reply.items) map.set(it.index, { isDish: it.isDish, servesPerUnit: it.servesPerUnit });
  return map;
}

// ---------- Explanation ----------

const explainReply = z.object({
  headline: z.string().min(1).max(120),
  explanation: z.string().min(1).max(700),
});

export type Explanation = z.infer<typeof explainReply>;

/**
 * Writes the verdict in second person. It only sees numbers the code computed, and is
 * told not to introduce any others, so it can't invent prices.
 */
export async function explainVerdict(llm: JsonLlm, facts: Record<string, unknown>): Promise<Explanation> {
  return llm.json({
    task: "explainVerdict",
    system: [
      "You explain a cook-or-order decision to the user, speaking directly to them as \"you\".",
      'Return JSON: {"headline":string,"explanation":string}.',
      "- headline: under 12 words, states the suggestion (e.g. \"Cook it tonight — you'll save ₹380\").",
      "- explanation: 2-3 plain sentences covering the money difference, your time (and what it's worth at your hourly value), and the best restaurant's rating and delivery time.",
      "- facts.dish may be a whole meal of several dishes; talk about the meal, not just the first dish. If bestRestaurant.missingDishes is non-empty, say that restaurant doesn't have them.",
      "- Use ONLY the numbers in the facts. Do not invent, round differently, or add any number. Use ₹ for rupees.",
      "- Mention that fees are estimated if facts.feesEstimated is true. Don't use markdown.",
      "- It's a suggestion: the user decides.",
    ].join("\n"),
    user: JSON.stringify(facts),
    schema: explainReply,
    temperature: 0.4,
    maxTokens: 1024,
  });
}
