// Mirrors the backend response types (backend/src/engine/types.ts, cart/cartService.ts).
// The two folders share no package, so keep these in step by hand.

export type SkillLevel = "beginner" | "average" | "confident";
export type BaseUnit = "g" | "ml" | "pcs";
export type Side = "cook" | "order";

export interface Settings {
  addressId: string | null;
  addressLine: string | null;
  defaultServings: number;
  skillLevel: SkillLevel;
  hourlyTimeValue: number;
  hasBasicStaples: boolean;
}

export interface AuthStatus {
  connected: boolean;
  needsReconnect: boolean;
  expiresAt: string | null;
}

export interface Address {
  id: string;
  label: string;
  line: string;
}

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
  activeMin: number;
  groceryDeliveryMin: number;
  totalMinToEat: number;
  difficulty: number;
  quality: number;
  steps: string[];
  notFoundCount: number;
  scores?: SubScores;
}

export interface OrderLine {
  /** The dish you asked for, e.g. "Butter Naan". */
  dish: string;
  menuItemId: string;
  /** The restaurant's menu name. */
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
}

export interface OrderOption {
  kind: "order";
  id: string;
  restaurantId: string;
  restaurantName: string;
  areaName?: string;
  /** One line per dish of the meal this restaurant has. */
  items: OrderLine[];
  /** Dishes you asked for that this restaurant doesn't have. */
  missingDishes: string[];
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

export interface ComparisonRow {
  key: "payToday" | "perServing" | "activeTime" | "readyIn" | "effort" | "leftovers" | "quality";
  label: string;
  cook: string;
  order: string;
  winner: Side | "tie";
}

export interface Verdict {
  winner: Side;
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
  intent: {
    /** Label for the whole meal, e.g. "Paneer Butter Masala, Dal Makhani and Butter Naan". */
    dish: string;
    dishes: Array<{ name: string; role: "main" | "bread" | "rice" | "side" | "dessert" | "drink" }>;
    servings: number;
    timeLimitMin: number | null;
    notes: string | null;
    servingsDefaulted: boolean;
    droppedDishes: string[];
  };
  recipe: { prepMin: number; cookMin: number; difficulty: number; yieldServings: number; steps: string[] };
  cook: CookOption | null;
  order: { best: OrderOption; alternatives: OrderOption[] } | null;
  comparison: ComparisonRow[];
  verdict: Verdict;
  explanation: { headline: string; text: string; source: "ai" | "fallback" };
  warnings: string[];
  addressLine: string | null;
}

export interface CartResult {
  kind: "food" | "instamart";
  title: string;
  items: Array<{ name: string; quantity: number; detail?: string; price?: string }>;
  bill: Array<{ label: string; value: string }>;
  toPay: number | null;
  estimate: number;
  difference: number | null;
  coupon: { code: string; discount: number } | null;
  warnings: string[];
}
