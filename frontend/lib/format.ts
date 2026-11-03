import type { OrderLine } from "./types";

export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function minutes(m: number): string {
  const total = Math.max(0, Math.round(m));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function stars(rating: number | undefined): string | null {
  return rating && rating > 0 ? `${rating.toFixed(1)}★` : null;
}

/** "2 × Dal Makhani (Full)" */
export function lineText(l: OrderLine): string {
  return `${l.quantity} × ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`;
}

export const difficultyLabel = ["", "Very easy", "Easy", "Moderate", "Tricky", "Hard"];
