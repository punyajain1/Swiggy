import type { JsonLlm } from "../ai/groq.js";
import { pickEvents, proposeQuestIdeas, type EventForLlm } from "../ai/sidequestTasks.js";
import { appConfig } from "../config/app.js";
import { mapLimit } from "../engine/concurrency.js";
import { instamartFees } from "../engine/cook.js";
import { adjustedRating, parseRatingCount } from "../engine/ratings.js";
import { HttpError } from "../errors.js";
import { logger } from "../logger.js";
import type { LatLng, SwiggyApi } from "../swiggy/api.js";
import type { DineoutDay, DineoutRestaurant, DineoutSlots, EventShows, Product, ProductVariation, SceneEventCard } from "../swiggy/schemas.js";
import { distanceKm, firstAmount, locationInRegion, parseDistanceKm } from "./places.js";
import { addMinutes, epochToMs, istDate, istDayStart, istMinuteOfDay, istTimeLabel, minutesLabel } from "./time.js";
import type {
  ActivityCandidate,
  DinnerCandidate,
  EventCandidate,
  LateNightCandidate,
  QuestIntent,
  SuppliesCandidate,
  SupplyLine,
  TableSlot,
} from "./types.js";

const cfg = appConfig.sidequest;

export type QuestApi = Pick<
  SwiggyApi,
  | "discoverEvents"
  | "searchEvents"
  | "getEventDetails"
  | "listEventShows"
  | "searchDineout"
  | "getDineoutSlots"
  | "searchMenu"
  | "searchProducts"
>;

export interface SourceResult<T> {
  candidates: T[];
  warnings: string[];
  /** True when Swiggy errored, as opposed to answering with nothing. */
  failed?: boolean;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Session problems must reach the user ("reconnect Swiggy"); everything else degrades to a warning. */
function rethrowSession(err: unknown): void {
  if (err instanceof HttpError && err.status === 401) throw err;
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    rethrowSession(error);
    return { ok: false, error };
  }
}

// ---------- Scenes ----------

/** How many people one ticket admits, from its name: "Entry Pass For 1" is 1, "Group Pass For 4" and "Group of 4 Pass" are 4. */
export function ticketPeople(name: string | undefined): number {
  const m = /(?:for|of)\s*(\d+)|(\d+)\s*(?:people|persons?|pax)/i.exec(name ?? "");
  const n = Number(m?.[1] ?? m?.[2] ?? 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export interface TicketOption {
  name?: string | undefined;
  price?: number | undefined;
  available?: number | undefined;
}

/**
 * The cheapest mix of tickets that admits at least `people`, e.g. one "Group Pass For 4" beats four
 * singles. Null when nothing is priced or there aren't enough tickets left.
 */
export function cheapestTicketMix(tickets: TicketOption[], people: number): { costRs: number; title: string } | null {
  const usable = tickets.filter((t) => t.price !== undefined && t.price >= 0 && (t.available === undefined || t.available > 0));
  if (usable.length === 0) return null;
  const dp: Array<{ cost: number; picks: Map<number, number> } | undefined> = [{ cost: 0, picks: new Map() }];
  for (let k = 1; k <= people; k++) {
    let best: { cost: number; picks: Map<number, number> } | undefined;
    usable.forEach((t, i) => {
      const prev = dp[Math.max(0, k - ticketPeople(t.name))];
      if (!prev) return;
      const cost = prev.cost + t.price!;
      if (!best || cost < best.cost) {
        const picks = new Map(prev.picks);
        picks.set(i, (picks.get(i) ?? 0) + 1);
        best = { cost, picks };
      }
    });
    dp[k] = best;
  }
  const result = dp[people];
  if (!result) return null;
  for (const [i, count] of result.picks) {
    const left = usable[i]!.available;
    if (left !== undefined && count > left) return null;
  }
  const title = [...result.picks]
    .sort(([a], [b]) => a - b)
    .map(([i, count]) => `${count} × ${usable[i]!.name ?? "ticket"}`)
    .join(" + ");
  return { costRs: Math.round(result.cost), title };
}

function durationMinutes(info: { eventDuration?: { type?: string | undefined; value?: number | undefined } | null | undefined } | null | undefined): number | null {
  const d = info?.eventDuration;
  if (!d || d.value === undefined || d.value <= 0) return null;
  if (/HOUR/i.test(d.type ?? "")) return Math.round(d.value * 60);
  if (/MIN/i.test(d.type ?? "")) return Math.round(d.value);
  return null;
}

/** Turns one event's show listing into up to two candidates that start inside the quest window. */
export function showsToCandidates(card: SceneEventCard, shows: EventShows, intent: QuestIntent, fit: number): EventCandidate[] {
  const listing = shows.eventShowListing;
  const latest = addMinutes(intent.endMs, -cfg.eventMinRemainingMin);
  const seen = new Set<number>();
  const usable = (listing?.dateGroupedEventShow ?? [])
    .flatMap((g) => g.eventShow)
    .filter((s) => s.show_time_unix !== undefined && s.maxAvailableInventory !== 0)
    .map((show) => ({ show, ms: epochToMs(show.show_time_unix!) }))
    .filter(({ ms }) => ms >= intent.startMs && ms <= latest)
    .sort((a, b) => a.ms - b.ms)
    // Venues often run parallel shows at one time; one of each is enough.
    .filter(({ ms }) => (seen.has(ms) ? false : (seen.add(ms), true)))
    .slice(0, 2);

  const info = listing?.eventInfo;
  const venue = listing?.venueDetails?.[0];
  const ll = venue?.location?.latLng;
  const venueLocation = ll?.latitude !== undefined && ll.longitude !== undefined ? { lat: ll.latitude, lng: ll.longitude } : null;
  const durationMin = durationMinutes(info);

  return usable.flatMap(({ show, ms }): EventCandidate[] => {
    const priced = show.tickets.length > 0;
    const mix = priced
      ? cheapestTicketMix(
          show.tickets.map((t) => ({
            name: t.name,
            price: t.price?.discountedPrice ?? t.price?.price,
            available: t.availableInventory,
          })),
          intent.people,
        )
      : null;
    // Tickets are listed but there aren't enough left for the group.
    if (priced && !mix && show.tickets.some((t) => (t.price?.discountedPrice ?? t.price?.price) !== undefined)) return [];
    return [
      {
        kind: "event" as const,
        eventId: card.eventId,
        name: info?.name ?? card.eventName,
        venueName: venue?.name || card.venueName || null,
        area: venue?.localityDisplayName || card.area || null,
        genre: info?.eventCategory?.name || null,
        language: info?.languages?.length ? info.languages.join(", ") : null,
        fit,
        showStartMs: ms,
        showTimeLabel: show.show_time_ist ?? istTimeLabel(ms),
        durationMin: durationMin ?? cfg.eventDefaultDurationMin,
        durationEstimated: durationMin === null,
        ticketTitle: mix?.title ?? null,
        groupCostRs: mix?.costRs ?? null,
        pricePerPersonRs: mix ? Math.round(mix.costRs / intent.people) : null,
        priceEstimated: false,
        seatsLeft: show.maxAvailableInventory ?? null,
        venueLocation,
      },
    ];
  });
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * "3rd Nov • 05:00 PM onwards" -> "2026-11-03" (IST date), or undefined if there is no date in the text.
 * The year isn't given, so it is the year of `nowMs`, or the next one when that date has already passed by months.
 */
export function parseUpcomingDay(text: string | undefined, nowMs: number): string | undefined {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})/.exec(text ?? "");
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  const day = Number(m[1]);
  if (month < 0 || day < 1 || day > 31) return undefined;
  const [year, nowMonth] = istDate(nowMs).split("-").map(Number) as [number, number];
  const y = month + 1 < nowMonth - 6 ? year + 1 : year;
  return `${y}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Scenes: events matching the vibe's genres, in the right city, shortlisted by Groq, then checked for
 * shows that start during the quest.
 *
 * discover_events is tried first but came back empty for Delhi, Mumbai and Bengaluru when checked live,
 * so the real source is search_events. Its matches span every city, so they are filtered to the quest's
 * metro by their "Locality, City" text and again by the venue's distance from the city centre.
 */
export async function gatherEvents(deps: { api: QuestApi; llm: JsonLlm }, intent: QuestIntent): Promise<SourceResult<EventCandidate>> {
  const warnings: string[] = [];
  const queries = [...new Set([...intent.eventGenres, ...cfg.eventSearchFallbacks].map((q) => q.trim()).filter(Boolean))].slice(
    0,
    cfg.maxEventSearches,
  );
  const [discovered, ...searched] = await Promise.all([
    settle(deps.api.discoverEvents(intent.center)),
    ...queries.map((q) => settle(deps.api.searchEvents(q, intent.center))),
  ]);
  const attempts = [discovered, ...searched];
  if (attempts.every((r) => !r.ok)) {
    const first = attempts.find((r) => !r.ok);
    logger.warn({ err: first && !first.ok ? reason(first.error) : "" }, "Scenes event lookups failed");
    return { candidates: [], failed: true, warnings: [`Couldn't check events on Swiggy Scenes: ${first && !first.ok ? reason(first.error) : "no answer"}`] };
  }

  const pool: SceneEventCard[] = [];
  const seen = new Set<string>();
  const add = (card: SceneEventCard) => {
    if (seen.has(card.eventId)) return;
    seen.add(card.eventId);
    pool.push(card);
  };
  if (discovered.ok) discovered.value.events.forEach(add);
  for (const r of searched) {
    if (!r.ok) continue;
    for (const s of r.value.suggestions) {
      if (locationInRegion(s.location, intent.city)) add({ eventId: s.eventId, eventName: s.eventName, venueName: undefined, area: s.location, date: undefined, price: undefined });
    }
  }
  const shortlistPool = pool.slice(0, 25);
  if (shortlistPool.length === 0) {
    return { candidates: [], warnings: [`Swiggy Scenes has no events listed in ${intent.area ?? intent.city} right now.`] };
  }

  let picks: Array<{ index: number; fit: number }>;
  try {
    const forLlm: EventForLlm[] = shortlistPool.map((e, index) => ({
      index,
      name: e.eventName,
      ...(e.venueName ? { venue: e.venueName } : {}),
      ...(e.area ? { area: e.area } : {}),
      ...(e.date ? { date: e.date } : {}),
      ...(e.price ? { price: e.price } : {}),
    }));
    picks = await pickEvents(deps.llm, {
      vibe: intent.vibe,
      genres: intent.eventGenres,
      people: intent.people,
      events: forLlm,
      max: cfg.maxEventsToCheck,
    });
  } catch (err) {
    rethrowSession(err);
    logger.warn({ err: reason(err) }, "pickEvents failed; using feed order");
    picks = [];
  }
  if (picks.length === 0) picks = shortlistPool.map((_, index) => ({ index, fit: 0.5 }));
  // Groq's picks come first; the rest of the pool follows with a middling fit, so a good show that Groq
  // ranked lower still gets a look when the top picks don't play during the quest.
  const picked = new Set(picks.map((p) => p.index));
  const ordered = [
    ...picks,
    ...shortlistPool.map((_, index) => ({ index, fit: 0.4 })).filter((p) => !picked.has(p.index)),
  ].slice(0, cfg.maxEventDetailChecks);

  const questFirstDay = istDate(intent.startMs);
  const questLastDay = istDate(intent.endMs);
  const looked = await mapLimit(ordered, cfg.searchConcurrency, async (p) => {
    const card = shortlistPool[p.index]!;
    const details = await settle(deps.api.getEventDetails(card.eventId, intent.center));
    if (!details.ok) {
      logger.warn({ eventId: card.eventId, err: reason(details.error) }, "get_event_details failed");
      return undefined;
    }
    const d = details.value;
    // A show listing without a venue isn't safe to book from, so it isn't safe to plan around either.
    if (!d.venueId) return undefined;
    if (d.venueLat !== undefined && d.venueLng !== undefined && distanceKm(intent.center, { lat: d.venueLat, lng: d.venueLng }) > cfg.maxEventDistanceKm) {
      return undefined;
    }
    // "upcomingDate" is the event's next date. If that is after the quest, no show can fall inside it.
    const next = parseUpcomingDay(d.upcomingDate, intent.startMs);
    if (next && next > questLastDay) return undefined;
    if (next && next < questFirstDay) return undefined;
    return { p, card, d };
  });
  const playable = looked.filter((x): x is NonNullable<typeof x> => x !== undefined).slice(0, cfg.maxEventsToCheck);

  const window = { start: new Date(intent.startMs).toISOString(), end: new Date(intent.endMs).toISOString() };
  const shows = await mapLimit(playable, cfg.searchConcurrency, async ({ p, card, d }) => {
    const r = await settle(deps.api.listEventShows(card.eventId, d.venueId!, intent.center, window));
    if (!r.ok) {
      logger.warn({ eventId: card.eventId, err: reason(r.error) }, "list_event_shows failed");
      return [];
    }
    const found = showsToCandidates({ ...card, venueName: d.venueName ?? card.venueName, area: d.area ?? card.area }, r.value, intent, p.fit);
    return found.map((c) => (c.venueLocation || d.venueLat === undefined || d.venueLng === undefined ? c : { ...c, venueLocation: { lat: d.venueLat, lng: d.venueLng } }));
  });
  const candidates = shows.flat();
  if (candidates.length === 0) {
    warnings.push("None of the events we found have a show during your time window, so this quest skips the event.");
  }
  return { candidates, warnings };
}

// ---------- Dineout ----------

export function toDinnerCandidate(r: DineoutRestaurant): DinnerCandidate {
  const rating = r.rating?.value && r.rating.value > 0 ? r.rating.value : null;
  const cost = firstAmount(r.costForTwo);
  const distance = parseDistanceKm(r.distance);
  const badge: DinnerCandidate["badge"] =
    rating !== null && rating >= cfg.topRatedMin
      ? "Top rated"
      : rating !== null && rating >= cfg.goodValueMinRating && cost !== null && cost > 0 && cost <= cfg.goodValueMaxCostForTwo
        ? "Good value"
        : null;
  const farPenalty = distance !== null ? Math.min(0.2, Math.max(0, distance - cfg.comfortableDistanceKm) * 0.03) : 0;
  const base = rating !== null ? rating / 5 : cfg.unratedQuality;
  const quality = Math.max(0, Math.min(1, base + (badge ? cfg.badgeBonus : 0) - farPenalty));
  return {
    kind: "dinner",
    restaurantId: r.id,
    name: r.name,
    locality: r.locality ?? r.area ?? null,
    cuisines: r.cuisine ?? [],
    rating,
    ratingCount: r.rating?.count ?? null,
    costForTwoRs: cost && cost > 0 ? cost : cfg.defaultCostForTwo,
    costForTwoKnown: Boolean(cost && cost > 0),
    distanceKm: distance,
    offers: [],
    highlights: [],
    badge,
    quality,
  };
}

/**
 * Dineout restaurants near `anchor` (the event venue when there is one). The queries Groq chose can be
 * narrow ("pub" matched one restaurant in Delhi), so broader searches run until there are enough to choose from.
 */
export async function gatherDinners(api: QuestApi, intent: QuestIntent, anchor: LatLng): Promise<SourceResult<DinnerCandidate>> {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const candidates: DinnerCandidate[] = [];
  let attempted = 0;
  let errored = 0;
  const run = async (query: string) => {
    attempted++;
    const r = await settle(api.searchDineout(query, anchor, cfg.maxDineoutResults));
    if (!r.ok) {
      errored++;
      logger.warn({ query, err: reason(r.error) }, "search_restaurants_dineout failed");
      return;
    }
    for (const rest of r.value.restaurants) {
      if (seen.has(rest.id)) continue;
      seen.add(rest.id);
      candidates.push(toDinnerCandidate(rest));
    }
  };

  const asked = intent.dineoutQueries.map((q) => q.trim()).filter(Boolean);
  await mapLimit(asked, cfg.searchConcurrency, run);
  if (candidates.length < cfg.minDinnerCandidates) {
    const tried = new Set(asked.map((q) => q.toLowerCase()));
    const broader = [intent.area, ...cfg.dineoutFallbackQueries].filter((q): q is string => Boolean(q) && !tried.has(q!.toLowerCase()));
    for (const q of broader) {
      if (candidates.length >= cfg.minDinnerCandidates) break;
      await run(q);
    }
  }
  if (attempted > 0 && errored === attempted) {
    warnings.push("Couldn't search Swiggy Dineout.");
  } else if (candidates.length === 0) {
    warnings.push(`Swiggy Dineout has no matches near ${intent.area ?? intent.city}.`);
  }
  return { candidates, warnings, failed: attempted > 0 && errored === attempted };
}

/** The hours Dineout takes tables that day, e.g. "Dinner 5:00 PM–12:45 AM". */
function openRanges(day: DineoutDay | undefined): string | null {
  if (!day || day.meals.length === 0) return null;
  return day.meals.map((m) => `${m.name} ${minutesLabel(m.startMin)}–${minutesLabel(m.endMin)}`).join(", ");
}

/**
 * Checks Dineout's table hours and deals around the planned dinner time. Dineout lists a service window
 * per meal ("Dinner 5:00 PM–12:45 AM") and the free and paid deals for the day, not individual times, so
 * this says whether the planned time falls inside a service and what kind of booking is on offer.
 * Never books anything.
 */
export function matchSlot(slots: DineoutSlots, dinnerStartMs: number): TableSlot {
  const none = (extra: Partial<TableSlot> = {}): TableSlot => ({ status: "none", displayTime: null, dealTitle: null, bookingPriceRs: null, openRanges: null, ...extra });
  const date = istDate(dinnerStartMs);
  const minute = istMinuteOfDay(dinnerStartMs);
  const today = slots.days.find((d) => d.date === date);
  const yesterday = slots.days.find((d) => d.date === istDate(addMinutes(dinnerStartMs, -24 * 60)));
  const covers = (day: DineoutDay | undefined, m: number) => day?.meals.find((meal) => m >= meal.startMin && m <= meal.endMin);

  // A service that runs past midnight on the previous day also covers the early hours here.
  const service = covers(today, minute);
  const spill = service ? undefined : covers(yesterday, minute + 1440);
  const day = service ? today : spill ? yesterday : undefined;
  const meal = service ?? spill;
  if (!day || !meal) {
    if (!today) return none({ status: "unchecked" });
    return none({ openRanges: openRanges(today) });
  }

  const m = service ? minute : minute + 1440;
  const rounded = Math.min(meal.endMin, Math.max(meal.startMin, Math.round(m / 15) * 15));
  const displayTime = minutesLabel(rounded);
  if (day.free) {
    return { status: "free", displayTime, dealTitle: "Free table booking", bookingPriceRs: null, openRanges: openRanges(day) };
  }
  const cheapest = [...day.paid].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
  if (cheapest) {
    return { status: "paid", displayTime, dealTitle: cheapest.title, bookingPriceRs: cheapest.price, openRanges: openRanges(day) };
  }
  return none({ status: "unchecked", openRanges: openRanges(day) });
}

export async function checkTableSlot(
  api: QuestApi,
  restaurantId: string,
  anchor: LatLng,
  dinnerStartMs: number,
  known?: DineoutSlots,
): Promise<TableSlot> {
  if (known) return matchSlot(known, dinnerStartMs);
  const r = await settle(api.getDineoutSlots(restaurantId, istDate(dinnerStartMs), anchor));
  if (!r.ok) {
    logger.warn({ restaurantId, err: reason(r.error) }, "get_available_slots failed");
    return { status: "unchecked", displayTime: null, dealTitle: null, bookingPriceRs: null, openRanges: null };
  }
  return matchSlot(r.value, dinnerStartMs);
}

/**
 * Keeps the restaurants that take tables during the quest. Dineout lists restaurants that have no
 * bookable slots ("No bookable slots for 2026-11-03"), and planning dinner at one would send the group
 * to a closed door. A restaurant whose check errors is kept: unknown isn't the same as unbookable.
 * The slot data is returned so the chosen restaurant doesn't need a second call.
 */
export async function filterBookable(
  api: QuestApi,
  dinners: DinnerCandidate[],
  anchor: LatLng,
  intent: QuestIntent,
): Promise<{ dinners: DinnerCandidate[]; slots: Map<string, DineoutSlots> }> {
  const first = istDate(intent.startMs);
  const last = istDate(intent.endMs);
  const slots = new Map<string, DineoutSlots>();
  const checked = await mapLimit(dinners, cfg.searchConcurrency, async (d) => {
    const r = await settle(api.getDineoutSlots(d.restaurantId, first, anchor));
    if (!r.ok) {
      logger.warn({ restaurantId: d.restaurantId, err: reason(r.error) }, "get_available_slots failed");
      return true;
    }
    slots.set(d.restaurantId, r.value);
    return r.value.days.some((day) => (day.date === first || day.date === last) && day.meals.length > 0);
  });
  const open = dinners.filter((_, i) => checked[i]);
  return { dinners: open.map((d) => withOpenWindows(d, slots.get(d.restaurantId), [first, last])), slots };
}

/** Adds the times Dineout takes tables on the quest's dates, so the planner can't schedule dinner outside them. */
export function withOpenWindows(d: DinnerCandidate, slots: DineoutSlots | undefined, dates: string[]): DinnerCandidate {
  if (!slots) return d;
  const openWindows = slots.days
    .filter((day) => dates.includes(day.date))
    .flatMap((day) => {
      const start = istDayStart(day.date);
      return day.meals.map((m) => ({ startMs: addMinutes(start, m.startMin), endMs: addMinutes(start, m.endMin) }));
    });
  return openWindows.length > 0 ? { ...d, openWindows } : d;
}

// ---------- Swiggy Food (late night) ----------

export function lateNightFees(itemTotal: number): number {
  const f = appConfig.fees.food;
  return Math.round(f.deliveryFee + f.platformFee + itemTotal * f.gstRate);
}

/** The same dish, one portion per two people. */
export function sharedPortion(f: LateNightCandidate, people: number): LateNightCandidate {
  const quantity = Math.ceil(people / 2);
  const itemTotalRs = f.pricePerItemRs * quantity;
  return { ...f, shared: true, quantity, itemTotalRs, feesRs: lateNightFees(itemTotalRs), quality: f.quality * cfg.sharedPortionQuality };
}

/** Late-night snack options from Swiggy Food, delivered to the saved address: one per person, or shared. */
export async function gatherLateNight(api: QuestApi, intent: QuestIntent, addressId: string): Promise<SourceResult<LateNightCandidate>> {
  const results = await mapLimit(intent.lateNightCravings, cfg.searchConcurrency, (q) => settle(api.searchMenu(q, addressId)));
  const byRestaurant = new Map<string, LateNightCandidate>();
  results.forEach((r, i) => {
    if (!r.ok) {
      logger.warn({ query: intent.lateNightCravings[i], err: reason(r.error) }, "search_menu failed");
      return;
    }
    for (const item of r.value.items) {
      const price = item.price;
      const restaurant = item.restaurant_name;
      if (!price || price <= 0 || !restaurant || item.inStock === 0) continue;
      if (intent.vegOnly && item.isVeg !== true) continue;
      const stars = adjustedRating(item.rating, parseRatingCount(item.totalRatings)) ?? appConfig.ratings.priorMean;
      const itemTotal = price * intent.people;
      const candidate: LateNightCandidate = {
        kind: "lateNight",
        restaurantId: item.restaurant_id ?? null,
        restaurantName: restaurant,
        dish: item.name,
        isVeg: item.isVeg ?? null,
        pricePerItemRs: price,
        quantity: intent.people,
        shared: false,
        itemTotalRs: itemTotal,
        feesRs: lateNightFees(itemTotal),
        rating: item.rating ?? null,
        quality: Math.min(1, stars / 5 + (item.isBestseller ? 0.03 : 0)),
      };
      const key = item.restaurant_id ?? restaurant;
      const existing = byRestaurant.get(key);
      if (!existing || candidate.quality > existing.quality || (candidate.quality === existing.quality && price < existing.pricePerItemRs)) {
        byRestaurant.set(key, candidate);
      }
    }
  });
  const full = [...byRestaurant.values()]
    .sort((a, b) => b.quality - a.quality || a.pricePerItemRs - b.pricePerItemRs)
    .slice(0, cfg.maxLateNightOptions);
  // Each option also comes as a shared order, so a tight budget can still keep Swiggy Food in the plan.
  const candidates = [...full, ...(intent.people >= 2 ? full.map((f) => sharedPortion(f, intent.people)) : [])];
  const warnings: string[] = [];
  if (results.every((r) => !r.ok)) warnings.push("Couldn't check late-night food on Swiggy Food.");
  else if (candidates.length === 0) warnings.push(`No ${intent.lateNightCravings.join(" or ")} available on Swiggy Food near your address right now.`);
  return { candidates, warnings, failed: results.length > 0 && results.every((r) => !r.ok) };
}

// ---------- Ideas (Groq) and supplies (Swiggy Instamart) ----------

/** Alcohol, tobacco and similar are never suggested, whatever the model writes. */
const RESTRICTED = /\b(beers?|wines?|whisk(?:e)?y|vodka|rum|gin|tequila|brandy|liquors?|alcohol(?:ic)?|cigar(?:ette)?s?|tobacco|vapes?|hookah|nicotine|weed|cannabis)\b/i;

export function fallbackIdeas(intent: QuestIntent): ActivityCandidate[] {
  const place = intent.area ?? intent.city;
  const idea = (
    n: number,
    title: string,
    what: string,
    where: "out" | "home",
    durationMin: number,
    costPerPersonRs: number,
    fit: number,
  ): ActivityCandidate => ({ kind: "activity", id: `classic-${n}`, title, what, where, durationMin, costPerPersonRs, fit });
  return [
    idea(1, "Wander with a mission", `Pick a theme (doors, street art, old signboards) and photograph as many as you can around ${place}. Whoever finds the most chooses the next stop.`, "out", 60, 0, 0.6),
    idea(2, "Street-snack tasting walk", `Walk around ${place} and share one small snack at each stop. Everyone scores it out of 10 and the group crowns a winner.`, "out", 60, 100, 0.55),
    idea(3, "Skyline spot hunt", `Find the best place around ${place} to sit and watch the city lights. Each person gets one minute to pitch their favourite spot.`, "out", 45, 0, 0.5),
    idea(4, "Playlist swap and card round", "Everyone adds three songs to a shared playlist without saying who picked what, then guess whose is whose over a round of cards.", "home", 45, 0, 0.5),
  ];
}

function variationPrice(v: ProductVariation): number | undefined {
  const p = v.price?.offerPrice ?? v.price?.mrp;
  return p !== undefined && p > 0 ? p : undefined;
}

/** Units in a bulk pack: "Pack of 48", "Set Of 24", "48 Pieces". Returns 1 when none is named. */
export function packUnits(text: string): number {
  const m = /(?:pack|set|box|case|carton)\s*of\s*(\d+)|(\d+)\s*(?:pieces|pcs|packs|bottles|cans)\b/i.exec(text);
  const n = Number(m?.[1] ?? m?.[2] ?? 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * The first product (results come best match first) with an in-stock variation that suits a quest
 * kit: not a bulk pack and no dearer than `maxPrice`. Within that product, the cheapest such variation.
 */
export function cheapestAvailable(
  products: Product[],
  maxPrice: number = cfg.maxSupplyItemPriceRs,
): { product: Product; variation: ProductVariation; price: number } | undefined {
  for (const product of products) {
    if (product.inStock === false || product.isAvail === false) continue;
    const ok = product.variations
      .filter((v) => v.isInStockAndAvailable !== false && variationPrice(v) !== undefined)
      .filter((v) => variationPrice(v)! <= maxPrice)
      .filter((v) => packUnits(`${product.displayName} ${v.displayName ?? ""} ${v.quantityDescription ?? ""}`) < cfg.bulkPackUnits)
      .sort((a, b) => variationPrice(a)! - variationPrice(b)!);
    const variation = ok[0];
    if (variation) return { product, variation, price: variationPrice(variation)! };
  }
  return undefined;
}

/**
 * With a budget, keeps the kit (items plus Instamart fees) within a share of it by dropping the dearest
 * lines first. At least two lines stay, so the kit is still a kit. Without a budget the list is unchanged.
 */
export function fitKitToBudget(lines: SupplyLine[], budgetRs: number | null): SupplyLine[] {
  if (budgetRs === null) return lines;
  const cap = budgetRs * cfg.maxSuppliesBudgetShare;
  const kept = [...lines].sort((a, b) => a.lineRs - b.lineRs);
  const cost = (ls: SupplyLine[]) => {
    const items = ls.reduce((sum, l) => sum + l.lineRs, 0);
    return items + instamartFees(items).total;
  };
  while (kept.length > 2 && cost(kept) > cap) kept.pop();
  // Keep the original order so the card reads the way the plan was written.
  return lines.filter((l) => kept.includes(l));
}

export interface IdeasResult {
  activities: ActivityCandidate[];
  supplies: SuppliesCandidate[];
  warnings: string[];
  /**
   * How the Instamart kit went: "ok" (priced), "off" (not wanted), "no_list" (the AI wrote no usable
   * shopping list), "failed" (every Instamart search errored), "too_few" (too little was in stock).
   */
  suppliesState: "ok" | "off" | "no_list" | "failed" | "too_few";
}

/**
 * Free-form ideas from Groq (not Swiggy data) and, when the plan calls for it, an Instamart shopping
 * list priced from Swiggy. If Groq can't help, a few classic ideas keep the quest from being empty.
 */
export async function gatherIdeas(
  deps: { api: QuestApi; llm: JsonLlm },
  intent: QuestIntent,
  addressId: string,
): Promise<IdeasResult> {
  const { activities: wantActivities, supplies: wantSupplies } = intent.uses;
  if (!wantActivities && !wantSupplies) return { activities: [], supplies: [], warnings: [], suppliesState: "off" };
  const warnings: string[] = [];

  let reply: Awaited<ReturnType<typeof proposeQuestIdeas>> | undefined;
  try {
    reply = await proposeQuestIdeas(deps.llm, {
      theme: intent.theme,
      city: intent.city,
      area: intent.area,
      people: intent.people,
      hours: intent.hours,
      vibe: intent.vibe,
      vegOnly: intent.vegOnly,
      budgetPerPersonRs: intent.budgetRs === null ? null : Math.round(intent.budgetRs / intent.people),
      notes: intent.notes,
      wantActivities,
      wantSupplies,
      goingOut: intent.uses.events || intent.uses.dining,
    });
  } catch (err) {
    rethrowSession(err);
    logger.warn({ err: reason(err) }, "proposeQuestIdeas failed");
    warnings.push("The AI couldn't write fresh ideas this time, so the free-form parts are classics.");
  }

  let activities: ActivityCandidate[] = [];
  if (wantActivities) {
    activities = (reply?.activities ?? [])
      .filter((a) => !RESTRICTED.test(`${a.title} ${a.what}`))
      .slice(0, cfg.maxActivityCandidates)
      .map((a, i) => ({
        kind: "activity" as const,
        id: `idea-${i}`,
        title: a.title,
        what: a.what,
        where: a.where,
        durationMin: a.durationMin,
        costPerPersonRs: Math.round(a.costPerPersonRs),
        fit: a.fit,
      }));
    if (activities.length === 0) activities = fallbackIdeas(intent);
  }

  const supplies: SuppliesCandidate[] = [];
  let suppliesState: IdeasResult["suppliesState"] = wantSupplies ? "no_list" : "off";
  if (wantSupplies && reply) {
    const wanted = reply.supplies.filter((s) => !RESTRICTED.test(`${s.item} ${s.searchQuery}`)).slice(0, cfg.maxSupplyItems);
    if (wanted.length > 0) {
      let errored = 0;
      const found = await mapLimit(wanted, cfg.searchConcurrency, async (w) => {
        const r = await settle(deps.api.searchProducts(w.searchQuery, addressId));
        if (!r.ok) {
          logger.warn({ query: w.searchQuery, err: reason(r.error) }, "search_products failed");
          errored++;
          return undefined;
        }
        const hit = cheapestAvailable(r.value.products);
        if (!hit || RESTRICTED.test(`${hit.product.displayName} ${hit.product.brand ?? ""}`)) return undefined;
        const line: SupplyLine = {
          want: w.item,
          name: hit.variation.displayName ?? hit.product.displayName,
          pack: hit.variation.quantityDescription ?? null,
          unitPriceRs: hit.price,
          quantity: w.quantity,
          lineRs: Math.round(hit.price * w.quantity),
        };
        return line;
      });
      const foundLines = found.filter((l): l is SupplyLine => l !== undefined);
      const missing = wanted.filter((_, i) => found[i] === undefined).map((w) => w.item);
      if (foundLines.length / wanted.length >= cfg.suppliesMinFoundShare) {
        const lines = fitKitToBudget(foundLines, intent.budgetRs);
        const itemTotalRs = lines.reduce((sum, l) => sum + l.lineRs, 0);
        supplies.push({
          kind: "supplies",
          lines,
          missing,
          itemTotalRs,
          feesRs: instamartFees(itemTotalRs).total,
          quality: foundLines.length / wanted.length,
        });
        suppliesState = "ok";
      } else if (errored === wanted.length) {
        suppliesState = "failed";
        warnings.push("Couldn't check Swiggy Instamart, so the quest kit is skipped.");
      } else {
        suppliesState = "too_few";
        warnings.push("Instamart didn't have enough of the snacks and props for this plan near your address, so that stop is skipped.");
      }
    }
  }
  return { activities, supplies, warnings, suppliesState };
}
