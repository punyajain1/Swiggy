import type { Intent, Recipe } from "../ai/tasks.js";
import type { FoodVariantChoice } from "../swiggy/api.js";
import type { BaseUnit } from "./units.js";

export interface SubScores {
  money: number;
  time: number;
  effort: number;
  quality: number;
  leftovers: number;
  final: number;
}

export interface CookPack {
  spinId: string;
  skuId: string;
  label: string;
  unitPrice: number;
  mrp?: number;
  quantity: number;
}

export interface CookLine {
  ingredient: string;
  need: { qty: number; unit: BaseUnit; display: string };
  status: "matched" | "not_found";
  product?: { name: string; brand?: string; imageUrl?: string };
  packs: CookPack[];
  cost: number;
  /** True when cost is a rough estimate (no Instamart match or unknown pack size). */
  estimated: boolean;
  surplus?: { amount: number; unit: BaseUnit; display: string };
  note?: string;
}

export interface CookOption {
  kind: "cook";
  lines: CookLine[];
  staples: Array<{ ingredient: string; display: string }>;
  subtotal: number;
  fees: { handling: number; delivery: number; total: number; estimated: true };
  payToday: number;
  costPerServing: number;
  servings: number;
  yieldServings: number;
  leftoverServings: number;
  prepMin: number;
  cookMin: number;
  /** Hands-on minutes, adjusted for skill. */
  activeMin: number;
  groceryDeliveryMin: number;
  totalMinToEat: number;
  difficulty: number;
  quality: number;
  steps: string[];
  notFoundCount: number;
  scores?: SubScores;
}

/** One dish of the meal, as ordered from a restaurant. */
export interface OrderLine {
  /** The dish the user asked for, e.g. "Butter Naan". */
  dish: string;
  menuItemId: string;
  /** The restaurant's menu name, e.g. "Butter Naan (2 Pcs)". */
  name: string;
  variantLabel?: string;
  price: number;
  quantity: number;
  servesPerUnit: number;
  lineTotal: number;
  isVeg?: boolean;
  imageUrl?: string;
  rating?: number;
  ratingCount?: number;
  ratingCountLabel?: string;
  /** Exactly one of these is set when the item has variants; same format search_menu used. */
  variants?: FoodVariantChoice[];
  variantsV2?: FoodVariantChoice[];
}

export interface OrderOption {
  kind: "order";
  /** Stable id for cart filling: the Swiggy restaurant id. */
  id: string;
  restaurantId: string;
  restaurantName: string;
  areaName?: string;
  /** One line per dish this restaurant has. A Swiggy Food cart holds one restaurant only. */
  items: OrderLine[];
  /** Dishes the user asked for that this restaurant doesn't have (empty when it has the whole meal). */
  missingDishes: string[];
  /** Extra people the order could feed beyond the requested servings. */
  leftoverServings: number;
  itemTotal: number;
  fees: { delivery: number; platform: number; gst: number; total: number; estimated: true };
  estTotal: number;
  costPerServing: number;
  dishRating?: number;
  dishRatingCount?: number;
  dishRatingCountLabel?: string;
  restaurantRating?: number;
  restaurantRatingCount?: number;
  restaurantRatingCountLabel?: string;
  distanceKm?: number;
  deliveryMin: number;
  deliveryEstimated: boolean;
  offer?: string;
  availability: "OPEN" | "UNKNOWN";
  quality: number;
  activeMin: number;
  scores?: SubScores;
}

export type Side = "cook" | "order";

export interface ComparisonRow {
  key: "payToday" | "perServing" | "activeTime" | "readyIn" | "effort" | "leftovers" | "quality";
  label: string;
  cook: string;
  order: string;
  winner: Side | "tie";
}

export interface Verdict {
  winner: Side;
  /** Difference between the two final scores (0..1). */
  margin: number;
  cookScore: number;
  orderScore: number | null;
  timeLimitMin: number | null;
  cookBreaksTimeLimit: boolean;
  orderBreaksTimeLimit: boolean;
}

export interface Decision {
  decisionId: string;
  createdAt: string;
  intent: Intent;
  recipe: Recipe;
  cook: CookOption | null;
  order: { best: OrderOption; alternatives: OrderOption[] } | null;
  comparison: ComparisonRow[];
  verdict: Verdict;
  explanation: { headline: string; text: string; source: "ai" | "fallback" };
  warnings: string[];
  addressLine: string | null;
}
