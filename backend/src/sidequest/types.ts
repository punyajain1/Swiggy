import type { LatLng } from "../swiggy/api.js";

/** What the user asked for, after parsing and filling defaults. */
export interface QuestIntent {
  city: string;
  area: string | null;
  /** Where Dineout and Scenes are searched. */
  center: LatLng;
  people: number;
  /** Budget for the whole group, or null when none was given. */
  budgetRs: number | null;
  hours: number;
  /** Quest window in epoch ms. */
  startMs: number;
  endMs: number;
  vibe: string[];
  eventGenres: string[];
  dineoutQueries: string[];
  lateNightCravings: string[];
  vegOnly: boolean;
  notes: string | null;
  /** What kind of outing this is, e.g. "night out", "date night", "stay-in movie night". */
  theme: string | null;
  /** Which kinds of stops this quest should try. A stay-in night, say, has no use for Scenes or Dineout. */
  uses: QuestUses;
  /** Things we assumed because the sentence didn't say them, shown to the user. */
  assumptions: string[];
}

export interface QuestUses {
  /** Swiggy Scenes: shows and events. */
  events: boolean;
  /** Swiggy Dineout: a table somewhere. */
  dining: boolean;
  /** Swiggy Food: a delivery to end the night. */
  delivery: boolean;
  /** Swiggy Instamart: snacks and props to pick up before heading out (or to stay in). */
  supplies: boolean;
  /** Free-form ideas written by Groq. Not from Swiggy. */
  activities: boolean;
}

/**
 * Something to do that Swiggy doesn't list: a walk, a photo hunt, a game round. Written by Groq
 * with no venue, price or hours from any real place, and labelled as an idea in the UI.
 */
export interface ActivityCandidate {
  kind: "activity";
  id: string;
  title: string;
  what: string;
  where: "out" | "home";
  durationMin: number;
  /** A rough guess for what it costs each person (0 for free). */
  costPerPersonRs: number;
  /** 0..1 from Groq: how well it fits the vibe and the group. */
  fit: number;
}

export interface SupplyLine {
  /** What the plan wanted, e.g. "chips". */
  want: string;
  /** The Instamart product that was found for it. */
  name: string;
  pack: string | null;
  unitPriceRs: number;
  quantity: number;
  lineRs: number;
}

/** Snacks and props from Instamart, ordered before heading out (or to stay in). Prices are Instamart's. */
export interface SuppliesCandidate {
  kind: "supplies";
  lines: SupplyLine[];
  /** Wanted items Instamart had no match for. */
  missing: string[];
  itemTotalRs: number;
  feesRs: number;
  /** 0..1: share of the wanted items that were found. */
  quality: number;
}

export interface EventCandidate {
  kind: "event";
  eventId: string;
  name: string;
  venueName: string | null;
  area: string | null;
  genre: string | null;
  language: string | null;
  /** 0..1 from Groq: how well it fits the vibe and how unusual it is. */
  fit: number;
  showStartMs: number;
  showTimeLabel: string;
  durationMin: number;
  durationEstimated: boolean;
  /** e.g. "4 × Entry Pass For 1" or "1 × Group Pass For 4". */
  ticketTitle: string | null;
  /** What the whole group pays at the cheapest mix of this show's tickets; null when Swiggy lists no price. */
  groupCostRs: number | null;
  /** groupCostRs split across the group, for display. */
  pricePerPersonRs: number | null;
  /** False: the price is from the show's own ticket list. */
  priceEstimated: boolean;
  seatsLeft: number | null;
  venueLocation: LatLng | null;
}

export type SlotStatus = "free" | "paid" | "none" | "unchecked";

export interface DinnerCandidate {
  kind: "dinner";
  restaurantId: string;
  name: string;
  locality: string | null;
  cuisines: string[];
  rating: number | null;
  ratingCount: number | null;
  costForTwoRs: number;
  costForTwoKnown: boolean;
  distanceKm: number | null;
  offers: string[];
  highlights: string[];
  /** A label the data backs up: a 4.5★+ rating, or 4.2★+ at a modest price. Dineout gives no rating counts. */
  badge: "Top rated" | "Good value" | null;
  /**
   * When Dineout takes tables during the quest (epoch ms). A dinner must start inside one of these.
   * Absent when the check couldn't run, which means no constraint.
   */
  openWindows?: Array<{ startMs: number; endMs: number }>;
  /** 0..1 */
  quality: number;
}

export interface LateNightCandidate {
  kind: "lateNight";
  restaurantId: string | null;
  restaurantName: string;
  dish: string;
  isVeg: boolean | null;
  pricePerItemRs: number;
  quantity: number;
  /** True when it is one portion per two people, a snack after dinner rather than a second meal. */
  shared: boolean;
  itemTotalRs: number;
  feesRs: number;
  rating: number | null;
  /** 0..1 */
  quality: number;
}

export interface TableSlot {
  /** How Dineout's table hours and deals look around the planned dinner time. */
  status: SlotStatus;
  /** The service hours that day, e.g. "Dinner 5:00 PM–12:45 AM". */
  openRanges?: string | null;
  /** e.g. "8:30 PM" */
  displayTime: string | null;
  dealTitle: string | null;
  bookingPriceRs: number | null;
}

export type QuestStop =
  | (EventCandidate & { costRs: number })
  | (DinnerCandidate & { costRs: number; slot: TableSlot })
  | (LateNightCandidate & { costRs: number; orderAtLabel: string })
  | (ActivityCandidate & { costRs: number })
  | (SuppliesCandidate & { costRs: number });

export interface QuestChapter {
  index: number;
  title: string;
  flavor: string;
  challenge: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
  /** Minutes of travel before this chapter starts (0 for the first). */
  travelBeforeMin: number;
  stop: QuestStop;
}

export interface QuestBudget {
  limitRs: number | null;
  totalRs: number;
  perPersonRs: number;
  /** How much the plan goes over the budget, or null when it fits / there is none. */
  overByRs: number | null;
  lines: Array<{ kind: QuestStop["kind"]; label: string; costRs: number; estimated: boolean }>;
}

export type SwiggyService = "Scenes" | "Dineout" | "Swiggy Food" | "Instamart";

/**
 * What each Swiggy service did for this quest.
 * - used: it supplied a stop in the plan.
 * - left_out: it had options, but none fit the time window or budget.
 * - nothing_found: it answered with nothing relevant.
 * - unavailable: the call failed.
 * - not_needed: the request didn't call for it (a stay-in night has no use for Scenes or Dineout).
 */
export type CoverageStatus = "used" | "left_out" | "nothing_found" | "unavailable" | "not_needed";

export interface ServiceCoverage {
  service: SwiggyService;
  /** What it was used for, e.g. "Event" or "Quest kit". */
  role: string;
  status: CoverageStatus;
  note: string;
}

export interface SideQuest {
  questId: string;
  createdAt: string;
  request: {
    text: string;
    city: string;
    area: string | null;
    people: number;
    hours: number;
    budgetRs: number | null;
    startLabel: string;
    endLabel: string;
    vibe: string[];
    theme: string | null;
    assumptions: string[];
  };
  story: { title: string; tagline: string; finale: string; source: "ai" | "fallback" };
  chapters: QuestChapter[];
  budget: QuestBudget;
  /** One entry per Swiggy service, in a fixed order, saying what it did. */
  coverage: ServiceCoverage[];
  /** Other good options for each kind of stop ("Plan B"). */
  alternatives: {
    events: EventCandidate[];
    dinners: DinnerCandidate[];
    lateNight: LateNightCandidate[];
    activities: ActivityCandidate[];
  };
  warnings: string[];
  addressLine: string | null;
}
