import { randomUUID } from "node:crypto";
import type { JsonLlm } from "../ai/groq.js";
import { HttpError, errors } from "../errors.js";
import type { SettingsStore } from "../settings/settings.js";
import { buildQuestIntent } from "./intent.js";
import { cityInText } from "./places.js";
import { choosePlan, type ScheduledStop } from "./plan.js";
import {
  checkTableSlot,
  filterBookable,
  gatherDinners,
  gatherEvents,
  gatherIdeas,
  gatherLateNight,
  type IdeasResult,
  type QuestApi,
  type SourceResult,
} from "./sources.js";
import { buildStoryFacts, tellStory } from "./story.js";
import { istTimeLabel } from "./time.js";
import type {
  DinnerCandidate,
  EventCandidate,
  LateNightCandidate,
  QuestBudget,
  QuestChapter,
  QuestIntent,
  QuestStop,
  ServiceCoverage,
  SideQuest,
  TableSlot,
} from "./types.js";

export interface SideQuestDeps {
  api: QuestApi;
  llm: JsonLlm;
  settings: SettingsStore;
  now?: () => number;
}

const LEFT_OUT = "Had options, but none fit your time window or budget.";

/** Says, per Swiggy service, whether it made it into the plan and, if not, why. */
export function buildCoverage(input: {
  uses: QuestIntent["uses"];
  has: (kind: QuestStop["kind"]) => boolean;
  events: { count: number; failed: boolean };
  dinners: { count: number; failed: boolean };
  delivery: { count: number; failed: boolean };
  suppliesState: IdeasResult["suppliesState"];
  suppliesCount: number;
}): ServiceCoverage[] {
  const { uses, has } = input;
  const decide = (
    service: ServiceCoverage["service"],
    role: string,
    kind: QuestStop["kind"],
    wanted: boolean,
    src: { count: number; failed: boolean },
    usedNote: string,
    emptyNote: string,
  ): ServiceCoverage => {
    if (!wanted) return { service, role, status: "not_needed", note: "This plan doesn't call for it." };
    if (has(kind)) return { service, role, status: "used", note: usedNote };
    if (src.failed) return { service, role, status: "unavailable", note: "Swiggy didn't respond, so this part is skipped." };
    if (src.count === 0) return { service, role, status: "nothing_found", note: emptyNote };
    return { service, role, status: "left_out", note: LEFT_OUT };
  };

  const suppliesKitStatus = (): ServiceCoverage => {
    const base = { service: "Instamart" as const, role: "Quest kit" };
    if (!uses.supplies) return { ...base, status: "not_needed", note: "This plan doesn't call for it." };
    if (has("supplies")) return { ...base, status: "used", note: "Snacks and props, priced from in-stock packs." };
    switch (input.suppliesState) {
      case "failed":
        return { ...base, status: "unavailable", note: "Swiggy didn't respond, so this part is skipped." };
      case "too_few":
      case "no_list":
        return { ...base, status: "nothing_found", note: "Not enough of the kit was in stock near your address." };
      default:
        return input.suppliesCount > 0
          ? { ...base, status: "left_out", note: LEFT_OUT }
          : { ...base, status: "nothing_found", note: "Not enough of the kit was in stock near your address." };
    }
  };

  return [
    decide("Scenes", "Event", "event", uses.events, input.events, "A show that starts inside your window.", "No event with a show in your window."),
    decide("Dineout", "Dinner", "dinner", uses.dining, input.dinners, "A table, with a slot check.", "No restaurant there has a table open during your quest."),
    decide("Swiggy Food", "Late-night food", "lateNight", uses.delivery, input.delivery, "Delivered to your saved address.", "Nothing suitable open near your address."),
    suppliesKitStatus(),
  ];
}

/** Candidates kept for the planner: it tries every combination, so the pool is trimmed. */
const MAX_EVENT_CANDIDATES = 8;
const MAX_DINNERS_BY_QUALITY = 5;
const MAX_DINNERS_BY_PRICE = 2;

const empty = <T>(): SourceResult<T> => ({ candidates: [], warnings: [] });

/** The best-rated dinners plus a couple of the cheapest, so a tight budget still has options. */
export function shortlistDinners(all: DinnerCandidate[]): DinnerCandidate[] {
  const byQuality = [...all].sort((a, b) => b.quality - a.quality).slice(0, MAX_DINNERS_BY_QUALITY);
  const cheap = [...all]
    .filter((d) => !byQuality.includes(d))
    .sort((a, b) => a.costForTwoRs - b.costForTwoRs || b.quality - a.quality)
    .slice(0, MAX_DINNERS_BY_PRICE);
  return [...byQuality, ...cheap];
}

function toStop(s: ScheduledStop, slot: TableSlot | null): QuestStop {
  const c = s.candidate;
  if (c.kind === "dinner") {
    return { ...c, costRs: s.costRs, slot: slot ?? { status: "unchecked", displayTime: null, dealTitle: null, bookingPriceRs: null } };
  }
  if (c.kind === "lateNight") {
    return { ...c, costRs: s.costRs, orderAtLabel: istTimeLabel(s.startMs - s.travelBeforeMin * 60_000) };
  }
  return { ...c, costRs: s.costRs };
}

function budgetLine(stop: QuestStop, people: number): QuestBudget["lines"][number] {
  switch (stop.kind) {
    case "event":
      return {
        kind: "event",
        label: stop.pricePerPersonRs === 0 ? `${stop.name} (free entry)` : `${people} × ticket, ${stop.name}`,
        costRs: stop.costRs,
        estimated: stop.priceEstimated || stop.pricePerPersonRs === null,
      };
    case "dinner":
      return { kind: "dinner", label: `Dinner for ${people}, ${stop.name}`, costRs: stop.costRs, estimated: true };
    case "lateNight":
      return { kind: "lateNight", label: `${stop.quantity} × ${stop.dish} + delivery`, costRs: stop.costRs, estimated: true };
    case "activity":
      return { kind: "activity", label: stop.costRs === 0 ? `${stop.title} (free)` : stop.title, costRs: stop.costRs, estimated: true };
    case "supplies":
      return { kind: "supplies", label: "Instamart snacks and props + fees", costRs: stop.costRs, estimated: false };
  }
}

/**
 * The whole SideQuest flow for one request:
 * parse -> whichever of Scenes events, Dineout, Swiggy Food, Instamart and free-form ideas the request
 * calls for (in parallel where they don't depend on each other) -> choose the plan that fits time and
 * budget -> check a table slot and write the story.
 * Swiggy is the only data source, and nothing depends on it: when a service has nothing, the quest is
 * built from the rest, down to ideas alone. Read-only: it never books a table, buys a ticket, fills a
 * cart or places an order.
 */
export async function planSideQuest(deps: SideQuestDeps, text: string): Promise<SideQuest> {
  const settings = await deps.settings.get();
  if (!settings.addressId) throw errors.noAddress();
  const addressId = settings.addressId;
  const nowMs = (deps.now ?? Date.now)();
  const intent = await buildQuestIntent(deps.llm, text, { settings, nowMs });
  const uses = intent.uses;

  // Started together; a rejection here is reported where it is awaited, not as an unhandled rejection.
  const lateNightP: Promise<SourceResult<LateNightCandidate>> = uses.delivery ? gatherLateNight(deps.api, intent, addressId) : Promise.resolve(empty());
  const ideasP: Promise<IdeasResult> = gatherIdeas(deps, intent, addressId);
  lateNightP.catch(() => undefined);
  ideasP.catch(() => undefined);

  const eventsR = uses.events ? await gatherEvents(deps, intent) : empty<EventCandidate>();
  // Search dinner around the most promising event so the night doesn't zigzag across the city.
  const anchorEvent = [...eventsR.candidates].sort((a, b) => b.fit - a.fit)[0];
  const anchor = anchorEvent?.venueLocation ?? intent.center;
  const dinnersR = uses.dining ? await gatherDinners(deps.api, intent, anchor) : empty<DinnerCandidate>();
  const [lateR, ideasR] = await Promise.all([lateNightP, ideasP]);

  const events = [...eventsR.candidates].sort((a, b) => b.fit - a.fit).slice(0, MAX_EVENT_CANDIDATES);
  const shortlisted = shortlistDinners(dinnersR.candidates);
  const bookable = shortlisted.length > 0 ? await filterBookable(deps.api, shortlisted, anchor, intent) : { dinners: [], slots: new Map() };
  const dinners = bookable.dinners;
  const warnings = [...eventsR.warnings, ...dinnersR.warnings, ...lateR.warnings, ...ideasR.warnings];

  if (shortlisted.length > 0 && dinners.length === 0) {
    warnings.push("The restaurants we found have no tables open during your quest, so dinner is skipped.");
  }
  const plan = choosePlan(intent, {
    events,
    dinners,
    lateNight: lateR.candidates,
    activities: ideasR.activities,
    supplies: ideasR.supplies,
  });
  if (!plan) {
    throw new HttpError(
      404,
      "NOTHING_FOUND",
      `Couldn't put together a plan in ${intent.area ?? intent.city} for that time. Try a longer window or a different area.`,
      { warnings },
    );
  }

  const has = (kind: QuestStop["kind"]) => plan.stops.some((s) => s.candidate.kind === kind);
  const coverage = buildCoverage({
    uses,
    has,
    events: { count: events.length, failed: eventsR.failed === true },
    dinners: { count: dinners.length, failed: dinnersR.failed === true },
    delivery: { count: lateR.candidates.length, failed: lateR.failed === true },
    suppliesState: ideasR.suppliesState,
    suppliesCount: ideasR.supplies.length,
  });
  const homeCity = cityInText(settings.addressLine);
  if (homeCity && homeCity.name !== intent.city && (has("lateNight") || has("supplies"))) {
    warnings.push(`Swiggy delivers to your saved address in ${homeCity.name}, not ${intent.city}. Change it in Settings if you're staying elsewhere.`);
  }

  const dinnerStop = plan.stops.find((s) => s.candidate.kind === "dinner");
  const facts = buildStoryFacts(intent, plan.stops, plan);
  const [slot, story] = await Promise.all([
    dinnerStop && dinnerStop.candidate.kind === "dinner"
      ? checkTableSlot(deps.api, dinnerStop.candidate.restaurantId, anchor, dinnerStop.startMs, bookable.slots.get(dinnerStop.candidate.restaurantId))
      : Promise.resolve(null),
    tellStory(deps.llm, facts),
  ]);

  const chapters: QuestChapter[] = plan.stops.map((s, index) => ({
    index,
    title: story.chapters[index]!.title,
    flavor: story.chapters[index]!.flavor,
    challenge: story.chapters[index]!.challenge,
    startMs: s.startMs,
    endMs: s.endMs,
    startLabel: istTimeLabel(s.startMs),
    endLabel: istTimeLabel(s.endMs),
    travelBeforeMin: s.travelBeforeMin,
    stop: toStop(s, s === dinnerStop ? slot : null),
  }));

  const chosen = (kind: QuestStop["kind"]) => plan.stops.find((s) => s.candidate.kind === kind)?.candidate;
  const chosenEvent = chosen("event");
  const chosenDinner = chosen("dinner");
  const chosenFood = chosen("lateNight");
  const usedActivities = new Set(plan.stops.filter((s) => s.candidate.kind === "activity").map((s) => (s.candidate as { id: string }).id));
  const eventIds = new Set<string>(chosenEvent?.kind === "event" ? [chosenEvent.eventId] : []);
  const altEvents = events.filter((e) => {
    if (eventIds.has(e.eventId)) return false;
    eventIds.add(e.eventId);
    return true;
  });

  return {
    questId: randomUUID(),
    createdAt: new Date(nowMs).toISOString(),
    request: {
      text,
      city: intent.city,
      area: intent.area,
      people: intent.people,
      hours: intent.hours,
      budgetRs: intent.budgetRs,
      startLabel: istTimeLabel(intent.startMs),
      endLabel: istTimeLabel(intent.endMs),
      vibe: intent.vibe,
      theme: intent.theme,
      assumptions: intent.assumptions,
    },
    story: { title: story.title, tagline: story.tagline, finale: story.finale, source: story.source },
    chapters,
    budget: {
      limitRs: intent.budgetRs,
      totalRs: plan.totalRs,
      perPersonRs: Math.round(plan.totalRs / intent.people),
      overByRs: plan.overByRs,
      lines: chapters.map((c) => budgetLine(c.stop, intent.people)),
    },
    coverage,
    alternatives: {
      events: altEvents.slice(0, 2),
      dinners: dinners.filter((d) => d !== chosenDinner).sort((a, b) => b.quality - a.quality).slice(0, 4),
      lateNight: lateR.candidates
        .filter((f) => !(chosenFood?.kind === "lateNight" && f.restaurantName === chosenFood.restaurantName && f.dish === chosenFood.dish))
        .filter((f) => !f.shared)
        .slice(0, 2),
      activities: ideasR.activities.filter((a) => !usedActivities.has(a.id)).sort((a, b) => b.fit - a.fit).slice(0, 2),
    },
    warnings,
    addressLine: settings.addressLine,
  };
}
