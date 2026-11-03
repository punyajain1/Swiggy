import { appConfig } from "../config/app.js";
import { addMinutes, minutesBetween } from "./time.js";
import type {
  ActivityCandidate,
  DinnerCandidate,
  EventCandidate,
  LateNightCandidate,
  QuestIntent,
  SuppliesCandidate,
} from "./types.js";

const cfg = appConfig.sidequest;

export type Candidate = EventCandidate | DinnerCandidate | LateNightCandidate | ActivityCandidate | SuppliesCandidate;

export interface ScheduledStop<C extends Candidate = Candidate> {
  candidate: C;
  startMs: number;
  endMs: number;
  /** Minutes between the previous stop ending and this one starting (0 for the first). */
  travelBeforeMin: number;
  costRs: number;
}

export interface Plan {
  stops: ScheduledStop[];
  totalRs: number;
  overByRs: number | null;
  score: number;
}

export interface PlanPicks {
  event?: EventCandidate | undefined;
  dinner?: DinnerCandidate | undefined;
  lateNight?: LateNightCandidate | undefined;
  supplies?: SuppliesCandidate | undefined;
  activities?: ActivityCandidate[] | undefined;
}

// ---------- Costs (for the whole group) ----------

export const eventCost = (e: EventCandidate) => e.groupCostRs ?? 0;
export const dinnerCost = (d: DinnerCandidate, people: number) => Math.round((d.costForTwoRs / 2) * people);
export const lateNightCost = (f: LateNightCandidate) => Math.round(f.itemTotalRs + f.feesRs);
export const activityCost = (a: ActivityCandidate, people: number) => Math.round(a.costPerPersonRs * people);
export const suppliesCost = (s: SuppliesCandidate) => Math.round(s.itemTotalRs + s.feesRs);

export function costOf(c: Candidate, people: number): number {
  switch (c.kind) {
    case "event":
      return eventCost(c);
    case "dinner":
      return dinnerCost(c, people);
    case "lateNight":
      return lateNightCost(c);
    case "activity":
      return activityCost(c, people);
    case "supplies":
      return suppliesCost(c);
  }
}

function durationOf(c: Candidate): number {
  switch (c.kind) {
    case "event":
      return c.durationMin;
    case "dinner":
      return cfg.dinnerDurationMin;
    case "lateNight":
      return cfg.lateNightDurationMin;
    case "activity":
      return c.durationMin;
    case "supplies":
      return cfg.suppliesDurationMin;
  }
}

/** True for stops where the group has to be somewhere other than home. */
const isOut = (c: Candidate) => c.kind === "event" || c.kind === "dinner" || (c.kind === "activity" && c.where === "out");

/**
 * Minutes between `prev` ending and `next` starting. Staying at home costs nothing. Leaving or
 * returning costs the usual trip. The delivery is ordered as the group heads home, so it arrives
 * after the trip home.
 */
function gap(prev: Candidate | undefined, next: Candidate): number {
  if (!prev) return 0;
  if (next.kind === "lateNight") return isOut(prev) ? cfg.homeTravelMin : 0;
  return isOut(prev) || isOut(next) ? cfg.travelMin : 0;
}

// ---------- Timeline ----------

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

function forward(list: Candidate[], prev: Candidate | undefined, prevEndMs: number, firstStartMs: number, people: number): ScheduledStop[] {
  const out: ScheduledStop[] = [];
  let last = prev;
  let cursor = prevEndMs;
  for (const c of list) {
    const g = gap(last, c);
    const startMs = last ? addMinutes(cursor, g) : firstStartMs;
    const endMs = addMinutes(startMs, durationOf(c));
    out.push({ candidate: c, startMs, endMs, travelBeforeMin: g, costRs: costOf(c, people) });
    last = c;
    cursor = endMs;
  }
  return out;
}

function backward(list: Candidate[], next: Candidate, nextStartMs: number, people: number): ScheduledStop[] {
  const out: ScheduledStop[] = [];
  let following = next;
  let cursor = nextStartMs;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    const g = gap(c, following);
    const endMs = addMinutes(cursor, -g);
    const startMs = addMinutes(endMs, -durationOf(c));
    out.unshift({ candidate: c, startMs, endMs, travelBeforeMin: 0, costRs: costOf(c, people) });
    following = c;
    cursor = startMs;
  }
  // travelBeforeMin is the gap from the previous stop, so fill it in once the order is known.
  for (let i = 1; i < out.length; i++) out[i]!.travelBeforeMin = minutesBetween(out[i - 1]!.endMs, out[i]!.startMs);
  return out;
}

interface Arrangement {
  stops: ScheduledStop[];
  /** 0 is the preferred shape. */
  penalty: number;
  travelMin: number;
}

/**
 * Places the chosen stops on the evening's timeline, or returns null if they don't fit.
 *
 * - The event, if any, is fixed at its show time. Other stops go before or after it.
 * - Instamart supplies come first, at home, before anything else.
 * - Dinner and the free-form ideas can go in any order. The arrangement kept is the one with
 *   dinner next to the event (or last, with no event) and the least travel.
 * - The delivery is the finale: it is ordered on the way home and arrives when the group gets there.
 * Every stop must end inside the quest window, and the delivery must arrive by its end.
 */
export function schedule(intent: QuestIntent, picks: PlanPicks): ScheduledStop[] | null {
  const { event, dinner, lateNight, supplies } = picks;
  const people = intent.people;
  const flex: Candidate[] = [...(dinner ? [dinner] : []), ...(picks.activities ?? [])];
  if (flex.length + (event ? 1 : 0) + (lateNight ? 1 : 0) + (supplies ? 1 : 0) === 0) return null;

  const fits = (stops: ScheduledStop[]): boolean => {
    if (stops.length === 0) return false;
    for (const s of stops) {
      if (s.startMs < intent.startMs) return false;
      if (s.candidate.kind === "lateNight" ? s.startMs > intent.endMs : s.endMs > intent.endMs) return false;
      // A restaurant only takes tables during its service hours.
      const windows = s.candidate.kind === "dinner" ? s.candidate.openWindows : undefined;
      if (windows && !windows.some((w) => s.startMs >= w.startMs && s.startMs <= w.endMs)) return false;
    }
    return true;
  };
  const withFinale = (stops: ScheduledStop[]): ScheduledStop[] => {
    if (!lateNight) return stops;
    const last = stops.at(-1);
    const tail = forward([lateNight], last?.candidate, last?.endMs ?? intent.startMs, intent.startMs, people);
    // `forward` leaves the gap at 0 for the first stop of the evening, which is right when the delivery is all there is.
    return [...stops, ...tail];
  };

  const candidates: Arrangement[] = [];
  const consider = (stops: ScheduledStop[], penalty: number) => {
    const full = withFinale(stops);
    if (!fits(full)) return;
    candidates.push({ stops: full, penalty, travelMin: full.reduce((sum, s) => sum + s.travelBeforeMin, 0) });
  };

  for (const order of permutations(flex)) {
    if (event) {
      const eventStartMs = event.showStartMs;
      for (let k = 0; k <= order.length; k++) {
        const before: Candidate[] = [...(supplies ? [supplies] : []), ...order.slice(0, k)];
        const after = order.slice(k);
        const pre = backward(before, event, eventStartMs, people);
        const eventStop: ScheduledStop = {
          candidate: event,
          startMs: eventStartMs,
          endMs: addMinutes(eventStartMs, event.durationMin),
          travelBeforeMin: pre.length ? gap(before.at(-1), event) : 0,
          costRs: costOf(event, people),
        };
        const post = forward(after, event, eventStop.endMs, eventStop.endMs, people);
        // Dinner counts as "next to the event" if it is the last stop before it or the first after it.
        const adjacent = dinner ? (order[k - 1] === dinner || order[k] === dinner ? 0 : 1) : 0;
        consider([...pre, eventStop, ...post], adjacent);
      }
    } else {
      const seq: Candidate[] = [...(supplies ? [supplies] : []), ...order];
      const dinnerLast = dinner && order.length > 0 ? (order.at(-1) === dinner ? 0 : 1) : 0;
      consider(forward(seq, undefined, intent.startMs, intent.startMs, people), dinnerLast);
    }
  }

  candidates.sort((a, b) => a.penalty - b.penalty || a.travelMin - b.travelMin);
  return candidates[0]?.stops ?? null;
}

// ---------- Choosing the plan ----------

export function scorePlan(intent: QuestIntent, stops: ScheduledStop[]): Plan {
  const { weights, missingPenalty } = cfg;
  const of = <K extends Candidate["kind"]>(kind: K) =>
    stops.filter((s) => s.candidate.kind === kind).map((s) => s.candidate as Extract<Candidate, { kind: K }>);
  const [event] = of("event");
  const [dinner] = of("dinner");
  const [lateNight] = of("lateNight");
  const [supplies] = of("supplies");
  const activities = of("activity");

  let score = 0;
  score += event ? weights.event * event.fit : -missingPenalty.event;
  score += dinner ? weights.dinner * dinner.quality : -missingPenalty.dinner;
  score += lateNight ? weights.lateNight * lateNight.quality : -missingPenalty.lateNight;
  score += supplies ? weights.supplies * supplies.quality : -missingPenalty.supplies;
  score += activities.length ? weights.activity * activities.reduce((sum, a) => sum + a.fit, 0) : -missingPenalty.activity;

  const totalRs = stops.reduce((sum, s) => sum + s.costRs, 0);
  let overByRs: number | null = null;
  if (intent.budgetRs !== null && totalRs > intent.budgetRs) {
    overByRs = totalRs - intent.budgetRs;
    score -= cfg.overBudgetBase + cfg.overBudgetPerShare * (overByRs / Math.max(1, intent.budgetRs));
  }
  return { stops, totalRs, overByRs, score };
}

/** Every way to pick up to `max` items, including none. */
function subsets<T>(items: T[], max: number): T[][] {
  const out: T[][] = [[]];
  const walk = (start: number, chosen: T[]) => {
    if (chosen.length === max) return;
    for (let i = start; i < items.length; i++) {
      const next = [...chosen, items[i]!];
      out.push(next);
      walk(i + 1, next);
    }
  };
  walk(0, []);
  return out;
}

/**
 * Tries every combination of event, dinner, delivery, supplies and up to two free-form ideas (each
 * optional), keeps the ones that fit the time window, and returns the best-scoring plan. Over-budget
 * plans are allowed but lose score in proportion to how far over they go, so a plan that fits the
 * budget wins unless nothing does.
 */
export function choosePlan(
  intent: QuestIntent,
  options: {
    events: EventCandidate[];
    dinners: DinnerCandidate[];
    lateNight: LateNightCandidate[];
    activities?: ActivityCandidate[];
    supplies?: SuppliesCandidate[];
  },
): Plan | null {
  const events = [undefined, ...options.events];
  const dinners = [undefined, ...options.dinners];
  const foods = [undefined, ...options.lateNight];
  const supplies = [undefined, ...(options.supplies ?? [])];
  const activityPicks = subsets(options.activities ?? [], cfg.maxActivities);
  let best: Plan | null = null;
  for (const event of events) {
    for (const dinner of dinners) {
      for (const lateNight of foods) {
        for (const sup of supplies) {
          for (const activities of activityPicks) {
            const count = [event, dinner, lateNight, sup].filter(Boolean).length + activities.length;
            if (count === 0 || count > cfg.maxStops) continue;
            const stops = schedule(intent, { event, dinner, lateNight, supplies: sup, activities });
            if (!stops) continue;
            const plan = scorePlan(intent, stops);
            if (!best || plan.score > best.score + 1e-9) best = plan;
          }
        }
      }
    }
  }
  return best;
}
