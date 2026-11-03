import { SwiggyToolError } from "./callTool.js";
import { dineoutSearchSchema, type DineoutDay, type DineoutMeal, type DineoutSearch, type DineoutSlots } from "./schemas.js";

/**
 * Parsers for Swiggy tools that answer in text only. Formats below are copied from live responses.
 * A parser throws SwiggyToolError when it finds none of the structure it expects, so a change in
 * Swiggy's wording shows up as an error and not as a silent "0 results".
 */

// ---------- Dineout search ----------
//
//   Found 28 restaurant(s) matching "cafe", showing 15. 13 more available, call again with offset=15.
//   1. Pour Over — Coffee | 4.3★ | ₹1200 for two | Khan Market (ID: 962101)
//   5. Barista Coffee — ₹600 for two | 4.0★ | 3.2 km, Connaught Place | Connaught Place • ₹600 for two • Coffee (ID: 21301)

const COST_ONLY = /^₹\s?[\d,]+\s+for two$/i;
const DISTANCE = /^(\d+(?:\.\d+)?)\s*(km|m)\b/i;

interface ParsedLine {
  id: string;
  name: string;
  cuisine?: string;
  locality?: string;
  rating?: number;
  costForTwo?: string;
  distance?: string;
}

export function parseDineoutSearchLine(line: string): ParsedLine | undefined {
  const m = /^\s*\d+\.\s+(.*?)\s*\(ID:\s*([^)\s]+)\)\s*$/.exec(line);
  if (!m) return undefined;
  const body = m[1]!;
  const id = m[2]!;
  const parts = body.split(" | ").map((p) => p.trim());
  const head = parts.shift() ?? "";
  // "Name — Cuisine", "Name — ₹600 for two", or "Name —" when Dineout lists no cuisine. A name can
  // hold a dash, so split at the last one.
  const dash = head.lastIndexOf(" — ");
  const trailingDash = /\s—\s*$/.test(head) && dash < 0;
  const name = (dash >= 0 ? head.slice(0, dash) : trailingDash ? head.replace(/\s—\s*$/, "") : head).trim();
  const afterDash = dash >= 0 ? head.slice(dash + 3).trim() : "";
  if (!name) return undefined;

  const out: ParsedLine = { id, name };
  const loose: string[] = [];
  const consider = (p: string) => {
    if (!p) return;
    if (p.includes("•")) {
      // "Locality • ₹600 for two • Coffee"
      const bits = p.split("•").map((b) => b.trim());
      out.locality ??= bits[0];
      const cost = bits.find((b) => COST_ONLY.test(b));
      if (cost) out.costForTwo ??= cost;
      const cuisine = bits.slice(1).find((b) => !COST_ONLY.test(b));
      if (cuisine) out.cuisine ??= cuisine;
    } else if (p.includes("★")) {
      const r = Number(/(\d+(?:\.\d+)?)/.exec(p)?.[1]);
      if (Number.isFinite(r)) out.rating = r;
    } else if (DISTANCE.test(p)) {
      out.distance = p.split(",")[0]!.trim();
      const locality = p.split(",").slice(1).join(",").trim();
      if (locality) out.locality ??= locality;
    } else if (COST_ONLY.test(p)) {
      out.costForTwo ??= p;
    } else {
      loose.push(p);
    }
  };
  // The text right after the dash is the cuisine, unless it is a cost or a bullet group (second format).
  if (afterDash && !COST_ONLY.test(afterDash) && !afterDash.includes("•") && !afterDash.includes("★")) out.cuisine = afterDash;
  else consider(afterDash);
  parts.forEach(consider);
  // Any plain text left after the dash and the tagged fields is the locality.
  if (loose.length) out.locality ??= loose[loose.length - 1];
  return out;
}

export function parseDineoutSearchText(text: string): DineoutSearch {
  const header = /Found\s+(\d+)\s+restaurant/i.exec(text);
  const restaurants = text
    .split("\n")
    .map(parseDineoutSearchLine)
    .filter((r): r is ParsedLine => r !== undefined)
    .map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine ? r.cuisine.split(/\s*,\s*/) : [],
      locality: r.locality,
      rating: r.rating !== undefined ? { value: r.rating } : undefined,
      costForTwo: r.costForTwo,
      distance: r.distance,
    }));
  if (!header && restaurants.length === 0) {
    throw new SwiggyToolError("search_restaurants_dineout", "returned a response this app can't read");
  }
  const next = /offset=(\d+)/i.exec(text)?.[1];
  return dineoutSearchSchema.parse({
    restaurants,
    total: header ? Number(header[1]) : restaurants.length,
    ...(next ? { nextOffset: Number(next) } : {}),
  });
}

// ---------- Dineout slots ----------
//
//   Found 356 slot(s) across 7 day(s). Availability per date:
//     2026-11-03: Lunch (02:00 PM–04:45 PM, 12 slots); Dinner (05:00 PM–12:45 AM, 32 slots)
//   Booking params per date (slotId/itemId differ by date AND by deal):
//     2026-11-03 [FREE]: slotId=1, itemId="302252-195254"
//     2026-11-03 [PAID ₹25 Pre-Book]: slotId=1, itemId="302252-771833" — "Flat 20% off on Total Bill"

function clockToMin(clock: string): number {
  const m = /(\d{1,2}):(\d{2})\s*([AP])M/i.exec(clock);
  if (!m) return NaN;
  const h = Number(m[1]) % 12;
  return (m[3]!.toUpperCase() === "P" ? h + 12 : h) * 60 + Number(m[2]);
}

export function parseDineoutSlotsText(text: string): DineoutSlots {
  const days = new Map<string, DineoutDay>();
  const day = (date: string): DineoutDay => {
    let d = days.get(date);
    if (!d) {
      d = { date, meals: [], free: false, paid: [] };
      days.set(date, d);
    }
    return d;
  };

  for (const line of text.split("\n")) {
    const avail = /^\s*(\d{4}-\d{2}-\d{2}):\s*(.+)$/.exec(line);
    if (avail) {
      const d = day(avail[1]!);
      for (const m of avail[2]!.matchAll(/([A-Za-z][A-Za-z ]*?)\s*\((\d{1,2}:\d{2}\s*[AP]M)\s*[–—-]\s*(\d{1,2}:\d{2}\s*[AP]M),\s*(\d+)\s*slots?\)/gi)) {
        const startMin = clockToMin(m[2]!);
        let endMin = clockToMin(m[3]!);
        if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue;
        if (endMin < startMin) endMin += 1440;
        const meal: DineoutMeal = { name: m[1]!.trim(), startMin, endMin, slots: Number(m[4]) };
        d.meals.push(meal);
      }
      continue;
    }
    const deal = /^\s*(\d{4}-\d{2}-\d{2})\s*\[(FREE|PAID[^\]]*)\]/i.exec(line);
    if (deal) {
      const d = day(deal[1]!);
      if (/^FREE/i.test(deal[2]!)) {
        d.free = true;
      } else {
        const price = /₹\s?([\d,]+)/.exec(deal[2]!)?.[1];
        const title = /—\s*"([^"]+)"/.exec(line)?.[1];
        d.paid.push({ price: price ? Number(price.replace(/,/g, "")) : null, title: title ?? null });
      }
    }
  }
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (list.length === 0 || list.every((d) => d.meals.length === 0)) {
    // "No bookable slots for 2026-11-03" and "Found 0 slot(s)" are real answers; anything else we can't read is an error.
    if (/Found\s+0\s+slot/i.test(text) || /no (?:bookable|available) slots?/i.test(text)) return { days: [] };
    throw new SwiggyToolError("get_available_slots", "returned a response this app can't read");
  }
  return { days: list };
}
