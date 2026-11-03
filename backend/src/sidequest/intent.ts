import { parseQuestRequest, type QuestRequestReply } from "../ai/sidequestTasks.js";
import type { JsonLlm } from "../ai/groq.js";
import { appConfig } from "../config/app.js";
import { errors } from "../errors.js";
import type { UserSettings } from "../settings/settings.js";
import { rupees } from "../engine/format.js";
import { resolvePlace } from "./places.js";
import { addMinutes, istTimeLabel, questStart } from "./time.js";
import type { QuestIntent } from "./types.js";

const cfg = appConfig.sidequest;

const uniqueTerms = (terms: string[], max: number) => {
  const seen = new Set<string>();
  return terms
    .map((t) => t.trim())
    .filter((t) => {
      const k = t.toLowerCase();
      if (!t || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
};

/** Pure part of intent building, separated so it can be tested without Groq. */
export function intentFromReply(
  reply: QuestRequestReply,
  ctx: { settings: UserSettings; nowMs: number },
): QuestIntent {
  if (!reply.isOutingRequest) {
    throw errors.badRequest('Tell me about your evening, e.g. "₹1,000, three friends and 5 hours in Delhi".');
  }
  const place = resolvePlace({
    city: reply.city,
    area: reply.area,
    cityLocation: reply.cityLatitude != null && reply.cityLongitude != null ? { lat: reply.cityLatitude, lng: reply.cityLongitude } : null,
    areaLocation: reply.areaLatitude != null && reply.areaLongitude != null ? { lat: reply.areaLatitude, lng: reply.areaLongitude } : null,
    fallbackText: ctx.settings.addressLine,
  });
  if (!place) {
    throw errors.badRequest('Which city? Add it to your request, e.g. "… in Delhi" or "… around Koramangala, Bengaluru".');
  }

  const assumptions: string[] = [];
  if (!reply.city) assumptions.push(`No city named, so we used ${place.city} from your saved address.`);
  if (place.areaIgnored && place.area) assumptions.push(`Couldn't pin down ${place.area}, so we searched across ${place.city}.`);

  const people = reply.people ?? ctx.settings.defaultServings;
  if (reply.people == null) assumptions.push(`Planned for ${people} ${people === 1 ? "person" : "people"} (your default).`);

  const rawHours = reply.hours ?? cfg.defaultHours;
  const hours = Math.min(cfg.maxHours, Math.max(cfg.minHours, rawHours));
  if (reply.hours == null) assumptions.push(`Planned for ${hours} hours.`);
  else if (hours !== rawHours) assumptions.push(`Planned for ${hours} hours (SideQuest plans ${cfg.minHours}–${cfg.maxHours} hours).`);

  const budgetRs =
    reply.budgetRs == null ? null : Math.round(reply.budgetIsPerPerson ? reply.budgetRs * people : reply.budgetRs);
  if (budgetRs !== null && reply.budgetIsPerPerson) {
    assumptions.push(`Budget is ${rupees(reply.budgetRs!)} each, so ${rupees(budgetRs)} for the group.`);
  }

  const startMs = questStart(ctx.nowMs, reply.startTime, cfg.earliestDefaultStartHour);
  const endMs = addMinutes(startMs, Math.round(hours * 60));
  if (!reply.startTime) assumptions.push(`Starts at ${istTimeLabel(startMs)}.`);

  const vibe = uniqueTerms(reply.vibe.length ? reply.vibe : ["quirky", "fun"], 5);
  const lateNight = uniqueTerms(reply.lateNightCravings.length ? reply.lateNightCravings : [reply.vegOnly ? "momos" : "rolls"], cfg.maxLateNightCravings);
  const dineout = uniqueTerms(reply.dineoutQueries.length ? reply.dineoutQueries : [place.area ?? "cafe"], 2);

  // At least one kind of stop must be on, or there would be nothing to plan.
  const uses = { ...reply.uses };
  if (!Object.values(uses).some(Boolean)) uses.activities = true;

  return {
    city: place.city,
    area: place.area,
    center: place.center,
    theme: reply.theme?.trim() || null,
    uses,
    people,
    budgetRs,
    hours,
    startMs,
    endMs,
    vibe,
    eventGenres: uniqueTerms(reply.eventGenres, 3),
    dineoutQueries: dineout,
    lateNightCravings: lateNight,
    vegOnly: reply.vegOnly,
    notes: reply.notes ?? null,
    assumptions,
  };
}

export async function buildQuestIntent(
  llm: JsonLlm,
  text: string,
  ctx: { settings: UserSettings; nowMs: number },
): Promise<QuestIntent> {
  return intentFromReply(await parseQuestRequest(llm, text), ctx);
}
