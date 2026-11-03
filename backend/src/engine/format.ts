/** ₹1,234 (rounded to whole rupees, Indian digit grouping). */
export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** ₹1,234.50 for real bills; drops ".00". */
export function rupeesExact(n: number): string {
  const fixed = (Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${fixed.replace(/\.00$/, "")}`;
}

/** 45 -> "45 min", 75 -> "1 h 15 min", 120 -> "2 h". */
export function minutes(m: number): string {
  const total = Math.max(0, Math.round(m));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function servingsLabel(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} extra serving${rounded === 1 ? "" : "s"}`;
}

/** Parses "₹523.50" or "523" into a number; null if there is no number. */
export function parseMoney(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value.replace(/[^0-9.\-]/g, ""));
  return value.trim() && Number.isFinite(n) ? n : null;
}
