export type BaseUnit = "g" | "ml" | "pcs";

export interface PackSize {
  /** Total amount in the pack, in `unit`. */
  amount: number;
  unit: BaseUnit;
  /** Number of pieces, when the description also states it (e.g. "6 pcs", "1 pc (approx. 500 g)"). */
  pieces?: number;
}

const UNIT_ALIASES: Record<string, { unit: BaseUnit; factor: number }> = {
  kg: { unit: "g", factor: 1000 },
  kgs: { unit: "g", factor: 1000 },
  g: { unit: "g", factor: 1 },
  gm: { unit: "g", factor: 1 },
  gms: { unit: "g", factor: 1 },
  gram: { unit: "g", factor: 1 },
  grams: { unit: "g", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  ltr: { unit: "ml", factor: 1000 },
  litre: { unit: "ml", factor: 1000 },
  litres: { unit: "ml", factor: 1000 },
  liter: { unit: "ml", factor: 1000 },
  liters: { unit: "ml", factor: 1000 },
  ml: { unit: "ml", factor: 1 },
  pc: { unit: "pcs", factor: 1 },
  pcs: { unit: "pcs", factor: 1 },
  piece: { unit: "pcs", factor: 1 },
  pieces: { unit: "pcs", factor: 1 },
  unit: { unit: "pcs", factor: 1 },
  units: { unit: "pcs", factor: 1 },
  no: { unit: "pcs", factor: 1 },
  nos: { unit: "pcs", factor: 1 },
  egg: { unit: "pcs", factor: 1 },
  eggs: { unit: "pcs", factor: 1 },
  dozen: { unit: "pcs", factor: 12 },
  // A bunch of herbs (coriander, mint, methi) is roughly 100 g on Indian grocery apps.
  bunch: { unit: "g", factor: 100 },
  bunches: { unit: "g", factor: 100 },
};

const UNIT_PATTERN = Object.keys(UNIT_ALIASES)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM = String.raw`(\d+(?:\.\d+)?)`;

const MULTI_RE = new RegExp(String.raw`(\d+)\s*[x×*]\s*${NUM}\s*(${UNIT_PATTERN})\b`, "i");
const PACK_OF_RE = /pack\s+of\s+(\d+)/i;
// "500-600 g" uses the lower bound.
const AMOUNT_RE = new RegExp(String.raw`${NUM}\s*(?:-\s*\d+(?:\.\d+)?\s*)?(${UNIT_PATTERN})\b`, "gi");

/**
 * Parses an Instamart `quantityDescription` into a base amount.
 * Examples: "500 g", "1 kg", "200 ml", "1 L", "6 pcs", "1 bunch", "2 x 200 g", "Pack of 2 (100 g each)".
 * Weight/volume wins over a piece count when both are given; pieces are kept separately.
 */
export function parsePackSize(description: string | undefined | null): PackSize | null {
  if (!description) return null;
  const text = description.toLowerCase().replace(/,/g, "");

  const multi = MULTI_RE.exec(text);
  if (multi) {
    const alias = UNIT_ALIASES[multi[3]!.toLowerCase()]!;
    const count = Number(multi[1]);
    return {
      amount: count * Number(multi[2]) * alias.factor,
      unit: alias.unit,
      ...(alias.unit === "pcs" ? {} : { pieces: count }),
    };
  }

  let measure: { amount: number; unit: BaseUnit } | undefined;
  let pieces: number | undefined;
  for (const m of text.matchAll(AMOUNT_RE)) {
    const alias = UNIT_ALIASES[m[2]!.toLowerCase()]!;
    const amount = Number(m[1]) * alias.factor;
    if (!(amount > 0)) continue;
    if (alias.unit === "pcs") pieces ??= amount;
    else measure ??= { amount, unit: alias.unit };
  }

  const packOf = PACK_OF_RE.exec(text);
  if (packOf) {
    const count = Number(packOf[1]);
    if (measure && /\beach\b/.test(text)) return { amount: measure.amount * count, unit: measure.unit, pieces: count };
    if (!measure) return { amount: count, unit: "pcs", pieces: count };
    pieces ??= count;
  }

  if (measure) return { ...measure, ...(pieces ? { pieces } : {}) };
  if (pieces) return { amount: pieces, unit: "pcs", pieces };
  return null;
}

/** Approximate weight of one piece, in grams, for converting between pcs and g. */
const PIECE_WEIGHT_G: Array<[RegExp, number]> = [
  [/garlic/, 5],
  [/green chil+i|chil+i/, 5],
  [/onion/, 150],
  [/tomato/, 100],
  [/potato/, 150],
  [/lemon|lime/, 60],
  [/egg/, 55],
  [/ginger/, 30],
  [/capsicum|bell pepper/, 150],
  [/carrot/, 80],
  [/cucumber/, 200],
  [/bay leaf|bay leaves/, 0.5],
  [/cardamom|elaichi/, 0.3],
  [/clove|laung/, 0.1],
  [/cinnamon/, 2],
  [/bread/, 400],
];

export function pieceWeightGrams(ingredient: string): number | undefined {
  const name = ingredient.toLowerCase();
  return PIECE_WEIGHT_G.find(([re]) => re.test(name))?.[1];
}

/**
 * Converts a pack size into the unit the recipe asked for. Returns null when it can't
 * (e.g. recipe wants pcs, pack is in grams, and there's no known piece weight).
 * Grams and millilitres are treated as equal (density ~1), which is close enough for
 * cream, milk, oil and curd.
 */
export function packAmountIn(pack: PackSize, target: BaseUnit, ingredient: string): number | null {
  if (pack.unit === target) return pack.amount;
  const massLike = (u: BaseUnit) => u === "g" || u === "ml";
  if (massLike(pack.unit) && massLike(target)) return pack.amount;
  if (target === "pcs") {
    if (pack.pieces) return pack.pieces;
    const w = pieceWeightGrams(ingredient);
    return w ? pack.amount / w : null;
  }
  // pack is pcs, recipe wants g/ml
  const w = pieceWeightGrams(ingredient);
  return w ? pack.amount * w : null;
}

/** Formats an amount for display: 1500 g -> "1.5 kg", 250 ml -> "250 ml", 3 pcs -> "3 pcs". */
export function formatAmount(amount: number, unit: BaseUnit): string {
  if (unit === "pcs") {
    const n = Math.round(amount * 10) / 10;
    return `${n} ${n === 1 ? "pc" : "pcs"}`;
  }
  if (amount >= 1000) return `${Math.round((amount / 1000) * 100) / 100} ${unit === "g" ? "kg" : "L"}`;
  return `${Math.round(amount)} ${unit}`;
}
