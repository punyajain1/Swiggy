// Mirrors backend/src/sidequest/types.ts. The two folders share no package, so keep these in step by hand.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface EventCandidate {
  kind: "event";
  eventId: string;
  name: string;
  venueName: string | null;
  area: string | null;
  genre: string | null;
  language: string | null;
  fit: number;
  showStartMs: number;
  showTimeLabel: string;
  durationMin: number;
  durationEstimated: boolean;
  /** e.g. "1 × Group Pass For 4". */
  ticketTitle: string | null;
  /** What the whole group pays at the cheapest mix of this show's tickets; null when no price is listed. */
  groupCostRs: number | null;
  pricePerPersonRs: number | null;
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
  /** A label the data backs up (rating and price). Dineout gives no rating counts. */
  badge: "Top rated" | "Good value" | null;
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
  shared: boolean;
  itemTotalRs: number;
  feesRs: number;
  rating: number | null;
  quality: number;
}

export interface TableSlot {
  status: SlotStatus;
  /** The service hours that day, e.g. "Dinner 5:00 PM–12:45 AM". */
  openRanges?: string | null;
  displayTime: string | null;
  dealTitle: string | null;
  bookingPriceRs: number | null;
}

/** A free-form idea written by the AI. Not from Swiggy: no venue, price or hours from a real place. */
export interface ActivityCandidate {
  kind: "activity";
  id: string;
  title: string;
  what: string;
  where: "out" | "home";
  durationMin: number;
  costPerPersonRs: number;
  fit: number;
}

export interface SupplyLine {
  want: string;
  name: string;
  pack: string | null;
  unitPriceRs: number;
  quantity: number;
  lineRs: number;
}

/** Snacks and props priced from Swiggy Instamart. */
export interface SuppliesCandidate {
  kind: "supplies";
  lines: SupplyLine[];
  missing: string[];
  itemTotalRs: number;
  feesRs: number;
  quality: number;
}

export type EventStop = EventCandidate & { costRs: number };
export type DinnerStop = DinnerCandidate & { costRs: number; slot: TableSlot };
export type LateNightStop = LateNightCandidate & { costRs: number; orderAtLabel: string };
export type ActivityStop = ActivityCandidate & { costRs: number };
export type SuppliesStop = SuppliesCandidate & { costRs: number };
export type QuestStop = EventStop | DinnerStop | LateNightStop | ActivityStop | SuppliesStop;

export interface QuestChapter {
  index: number;
  title: string;
  flavor: string;
  challenge: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
  travelBeforeMin: number;
  stop: QuestStop;
}

export interface QuestBudget {
  limitRs: number | null;
  totalRs: number;
  perPersonRs: number;
  overByRs: number | null;
  lines: Array<{ kind: QuestStop["kind"]; label: string; costRs: number; estimated: boolean }>;
}

export type SwiggyService = "Scenes" | "Dineout" | "Swiggy Food" | "Instamart";
export type CoverageStatus = "used" | "left_out" | "nothing_found" | "unavailable" | "not_needed";

/** What one Swiggy service did for this quest. */
export interface ServiceCoverage {
  service: SwiggyService;
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
  coverage: ServiceCoverage[];
  alternatives: {
    events: EventCandidate[];
    dinners: DinnerCandidate[];
    lateNight: LateNightCandidate[];
    activities: ActivityCandidate[];
  };
  warnings: string[];
  addressLine: string | null;
}
