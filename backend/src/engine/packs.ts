export interface PackOption {
  /** Amount in one pack, already converted to the unit of `need`. */
  size: number;
  price: number;
  /** Max units Swiggy lets you add. Defaults to 10. */
  maxQuantity?: number;
}

export interface PackChoice {
  /** Index into the input `packs` array, with how many of that pack to buy. */
  lines: Array<{ index: number; quantity: number }>;
  totalCost: number;
  totalAmount: number;
  surplus: number;
}

const DEFAULT_MAX_QTY = 10;
const MAX_COMBINATIONS = 50_000;

/**
 * Picks the cheapest combination of packs whose total covers `need`.
 * Ties go to less surplus, then fewer packs. If even the maximum allowed quantity
 * of every pack can't cover `need`, it buys the most it can and reports a negative surplus.
 */
export function choosePacks(need: number, packs: PackOption[]): PackChoice | null {
  const usable = packs
    .map((p, index) => ({ ...p, index, max: Math.max(1, Math.floor(p.maxQuantity ?? DEFAULT_MAX_QTY)) }))
    .filter((p) => p.size > 0 && p.price >= 0 && Number.isFinite(p.price));
  if (usable.length === 0) return null;
  if (need <= 0) return { lines: [], totalCost: 0, totalAmount: 0, surplus: 0 };

  let best: PackChoice | null = null;
  let explored = 0;
  const counts = new Array<number>(usable.length).fill(0);

  const better = (cost: number, amount: number, packCount: number): boolean => {
    if (!best) return true;
    const eps = 1e-9;
    if (cost < best.totalCost - eps) return true;
    if (cost > best.totalCost + eps) return false;
    const surplus = amount - need;
    if (surplus < best.surplus - eps) return true;
    if (surplus > best.surplus + eps) return false;
    return packCount < best.lines.reduce((s, l) => s + l.quantity, 0);
  };

  const search = (i: number, amount: number, cost: number, packCount: number): void => {
    if (explored++ > MAX_COMBINATIONS) return;
    if (best && cost > best.totalCost + 1e-9) return;
    if (amount >= need) {
      if (better(cost, amount, packCount)) {
        best = {
          lines: counts.flatMap((q, k) => (q > 0 ? [{ index: usable[k]!.index, quantity: q }] : [])),
          totalCost: cost,
          totalAmount: amount,
          surplus: amount - need,
        };
      }
      return;
    }
    if (i >= usable.length) return;
    const p = usable[i]!;
    const upper = Math.min(p.max, Math.ceil((need - amount) / p.size));
    for (let q = upper; q >= 0; q--) {
      counts[i] = q;
      search(i + 1, amount + q * p.size, cost + q * p.price, packCount + q);
    }
    counts[i] = 0;
  };

  search(0, 0, 0, 0);
  if (best) return best;

  // Can't cover the need within quantity caps: buy the max of the best-value pack.
  const bestValue = [...usable].sort((a, b) => a.price / a.size - b.price / b.size)[0]!;
  const amount = bestValue.max * bestValue.size;
  return {
    lines: [{ index: bestValue.index, quantity: bestValue.max }],
    totalCost: bestValue.max * bestValue.price,
    totalAmount: amount,
    surplus: amount - need,
  };
}
