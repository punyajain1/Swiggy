import { z } from "zod";
import type { JsonLlm } from "./groq.js";

// ---------- Request parsing ----------

const term = z.string().trim().min(1).max(40);

const questReply = z.object({
  isOutingRequest: z.boolean(),
  city: z.string().trim().max(60).nullable(),
  cityLatitude: z.number().nullable(),
  cityLongitude: z.number().nullable(),
  area: z.string().trim().max(60).nullable(),
  areaLatitude: z.number().nullable(),
  areaLongitude: z.number().nullable(),
  people: z.number().int().min(1).max(20).nullable(),
  budgetRs: z.number().min(0).max(1_000_000).nullable(),
  budgetIsPerPerson: z.boolean(),
  hours: z.number().min(0.5).max(24).nullable(),
  startTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .nullable(),
  vibe: z.array(term).max(6).default([]),
  eventGenres: z.array(term).max(4).default([]),
  dineoutQueries: z.array(term).max(3).default([]),
  lateNightCravings: z.array(term).max(4).default([]),
  vegOnly: z.boolean(),
  notes: z.string().max(200).nullable().optional(),
  theme: z.string().trim().max(60).nullable().default(null),
  uses: z
    .object({
      events: z.boolean().default(true),
      dining: z.boolean().default(true),
      delivery: z.boolean().default(true),
      supplies: z.boolean().default(true),
      activities: z.boolean().default(true),
    })
    .default({ events: true, dining: true, delivery: true, supplies: true, activities: true }),
});

export type QuestRequestReply = z.infer<typeof questReply>;

/** Turns "₹1,000, three friends, 5 hours in Delhi" into structured fields. Defaults are filled by the caller. */
export async function parseQuestRequest(llm: JsonLlm, text: string): Promise<QuestRequestReply> {
  return llm.json({
    task: "parseQuestRequest",
    system: [
      "You read one sentence from a user in India who wants a plan for an evening out in a city.",
      "Return JSON:",
      '{"isOutingRequest":boolean,"city":string|null,"cityLatitude":number|null,"cityLongitude":number|null,',
      ' "area":string|null,"areaLatitude":number|null,"areaLongitude":number|null,"people":int|null,',
      ' "budgetRs":number|null,"budgetIsPerPerson":boolean,"hours":number|null,"startTime":"HH:MM"|null,',
      ' "vibe":[string],"eventGenres":[string],"dineoutQueries":[string],"lateNightCravings":[string],"vegOnly":boolean,"notes":string|null,',
      ' "theme":string|null,"uses":{"events":boolean,"dining":boolean,"delivery":boolean,"supplies":boolean,"activities":boolean}}',
      "Rules:",
      "- isOutingRequest: false only if the sentence isn't about planning time with others or alone: a night out, a date, a birthday, a rainy day, a stay-in night, a day trip, a hangout, anything like that. Food is only one possible part of it.",
      '- theme: the kind of outing in 2-4 words ("night out", "date night", "birthday surprise", "stay-in movie night", "solo reset day"), or null.',
      "- uses: which kinds of stops the plan should try. The plan should use ALL of Swiggy's services whenever they make sense, so everything is true by default.",
      "  Set one to false ONLY in these cases:",
      "  events (shows, gigs, workshops on Swiggy Scenes) and dining (a table on Swiggy Dineout): false only for a stay-in or at-home plan, or if the user says no events / no eating out / no drinks out.",
      "  delivery (food delivered at the end of the night on Swiggy Food): false only if the user says no food or delivery.",
      "  supplies (a small kit of snacks, drinks and props from Swiggy Instamart): false only if the user says no shopping or no snacks.",
      "  activities (free-form things to do that aren't on Swiggy: walks, games, photo hunts): false only if the user wants only specific bookings.",
      "  At least one of them must be true.",
      "- city: the Indian city they named, in its common English name (\"Bangalore\" -> \"Bengaluru\", \"Gurgaon\" -> \"Gurugram\"). null if none named.",
      "  cityLatitude/cityLongitude: that city's centre. null if no city.",
      "- area: a neighbourhood or landmark they named (\"Hauz Khas\", \"Koramangala\", \"Bandra\"), else null. areaLatitude/areaLongitude: its location, else null.",
      "- people: everyone going INCLUDING the user. \"me and three friends\" or \"three friends and I\" or \"I have three friends\" = 4. \"me and my partner\" = 2. \"a group of 5\" = 5. null if not said.",
      "- budgetRs: the money they mentioned, as a number. budgetIsPerPerson: true only if they say \"each\", \"per person\", \"per head\"; otherwise the amount is for the whole group.",
      "- hours: how long they have (\"5 hours\" = 5, \"the whole evening\" = null). startTime: 24-hour IST start if they say one (\"from 7pm\" = \"19:00\"), else null.",
      "- vibe: 2-5 short words for the mood (\"quirky\", \"chill\", \"romantic\", \"loud\", \"artsy\", \"budget\"). Default to [\"quirky\",\"fun\"] if nothing is said.",
      "- eventGenres: 1-3 event categories that fit, chosen from: Comedy, Music, Theatre, Workshop, Open Mic, Poetry, Quiz, Dance, Art, Gaming, Sports, Kids, Food & Drinks, Nightlife. Default [\"Comedy\",\"Open Mic\"] for quirky.",
      "- dineoutQueries: 1-2 single search terms for a sit-down dinner (a cuisine like \"North Indian\" or \"Asian\", a kind of place like \"cafe\" or \"brewery\", or a vibe like \"rooftop\" or \"live music\").",
      "  One term each, no sentences, no city words. Add \"Pure Veg\" as one term if they are vegetarian.",
      "- lateNightCravings: 1-2 dish words for a late-night snack delivered at the end (\"rolls\", \"shawarma\", \"momos\", \"biryani\", \"ice cream\", \"maggi\"). Veg dishes if vegOnly.",
      "- vegOnly: true if they say veg, vegetarian, Jain or no meat.",
      "- notes: other constraints in a few words (\"no alcohol\", \"wheelchair access\"), else null.",
    ].join("\n"),
    user: text,
    schema: questReply,
    temperature: 0,
    maxTokens: 1024,
  });
}

// ---------- Event shortlisting ----------

export interface EventForLlm {
  index: number;
  name: string;
  venue?: string;
  area?: string;
  date?: string;
  price?: string;
}

const pickEventsReply = z.object({
  picks: z
    .array(z.object({ index: z.number().int().min(0), fit: z.number().min(0).max(1) }))
    .max(12),
});

/** Ranks Scenes events by how well they fit the vibe. Returns index -> fit (0..1), best first. */
export async function pickEvents(
  llm: JsonLlm,
  input: { vibe: string[]; genres: string[]; people: number; events: EventForLlm[]; max: number },
): Promise<Array<{ index: number; fit: number }>> {
  if (input.events.length === 0) return [];
  const reply = await llm.json({
    task: "pickEvents",
    system: [
      "You pick events from Swiggy Scenes for a group's evening out.",
      `Return JSON: {"picks":[{"index":int,"fit":number}]} with up to ${input.max} events, best first, using only the given indexes.`,
      "- fit (0..1): how well it matches the vibe and genres, and how memorable or unusual it is for a group (quirky shows, open mics, workshops, immersive or offbeat formats score higher than generic ones).",
      "- Skip events that are clearly for kids only, online-only, or multi-day passes, unless the vibe asks for them.",
    ].join("\n"),
    user: JSON.stringify(input),
    schema: pickEventsReply,
    temperature: 0,
    maxTokens: 1024,
  });
  const seen = new Set<number>();
  return reply.picks.filter((p) => {
    if (p.index >= input.events.length || seen.has(p.index)) return false;
    seen.add(p.index);
    return true;
  });
}

// ---------- Ideas (not from Swiggy) ----------

const ideasReply = z.object({
  activities: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(60),
        what: z.string().trim().min(1).max(220),
        durationMin: z.number().int().min(15).max(180),
        costPerPersonRs: z.number().min(0).max(2000),
        where: z.enum(["out", "home"]),
        fit: z.number().min(0).max(1),
      }),
    )
    .max(6)
    .default([]),
  supplies: z
    .array(
      z.object({
        item: z.string().trim().min(1).max(40),
        searchQuery: z.string().trim().min(1).max(40),
        quantity: z.number().int().min(1).max(12),
      }),
    )
    .max(6)
    .default([]),
});

export type IdeasReply = z.infer<typeof ideasReply>;

/**
 * Free-form things to do, and a small shopping list for Instamart. These are ideas from Groq,
 * not Swiggy data, so the prompt forbids naming real businesses, venues, prices or hours.
 */
export async function proposeQuestIdeas(
  llm: JsonLlm,
  input: {
    theme: string | null;
    city: string;
    area: string | null;
    people: number;
    hours: number;
    vibe: string[];
    vegOnly: boolean;
    budgetPerPersonRs: number | null;
    notes: string | null;
    wantActivities: boolean;
    wantSupplies: boolean;
    /** True when the group is leaving home (a show, a restaurant), false for a stay-in plan. */
    goingOut: boolean;
  },
): Promise<IdeasReply> {
  return llm.json({
    task: "proposeQuestIdeas",
    system: [
      "You help a group plan an evening or day out in an Indian city. Other parts of the plan (events, restaurants, delivery) come from Swiggy; you only add the free-form parts.",
      'Return JSON: {"activities":[{"title":string,"what":string,"durationMin":int,"costPerPersonRs":number,"where":"out"|"home","fit":number}],"supplies":[{"item":string,"searchQuery":string,"quantity":int}]}',
      "activities (only if input.wantActivities, else []): 4 ideas, most memorable first.",
      "- Each must be doable without booking or buying a ticket, and work anywhere in that area. Do NOT name any specific business, venue, event, street vendor, brand or app. You may name the area or city the user gave.",
      "- Good: a walk with a mission, a photo scavenger hunt, a sunset or skyline spot hunt, a street-snack tasting walk, a card or board-game round, a blind-playlist swap, a mini quiz night, a letter-writing round, a themed cook-along at home.",
      "- Never claim opening hours, prices at a place, ratings, crowds or weather. Never involve alcohol, trespassing, danger, strangers, driving or anything illegal.",
      "- title: under 7 words. what: 1-2 sentences, concrete steps. durationMin: 15-180. costPerPersonRs: an honest low guess (0 if free). where: \"out\" or \"home\". fit 0-1: match with the vibe and group.",
      "- Mix: at most 2 of the same kind, and at least one that costs nothing.",
      "supplies (only if input.wantSupplies, else []): the group's quest kit, ordered from a grocery app (Swiggy Instamart) before they set off.",
      "- If input.goingOut: a SMALL, cheap, portable kit, 3-4 items, for the whole group in total about ₹150-₹400: a snack to share on the go, a small soft drink or water, and one or two props for the side challenges (playing cards, sticky notes, a marker, chalk).",
      "- If not input.goingOut (stay-in): a fuller kit, 4-6 items: snacks, soft drinks, and props like candles, playing cards, disposable plates.",
      "- item: what it is. searchQuery: 1-3 plain words to type into a grocery app. quantity: packs for the whole group.",
      "- No alcohol, tobacco, vapes, medicines or anything age-restricted. Vegetarian only if input.vegOnly.",
      "- Keep the list inexpensive and relevant. Don't pad it.",
    ].join("\n"),
    user: JSON.stringify(input),
    schema: ideasReply,
    temperature: 0.8,
    maxTokens: 1536,
  });
}

// ---------- Story ----------

export const questStoryReply = z.object({
  title: z.string().trim().min(1).max(70),
  tagline: z.string().trim().min(1).max(180),
  chapters: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(60),
        flavor: z.string().trim().min(1).max(280),
        challenge: z.string().trim().min(1).max(160),
      }),
    )
    .min(1)
    .max(8),
  finale: z.string().trim().min(1).max(240),
});

export type QuestStoryReply = z.infer<typeof questStoryReply>;

/** Writes the adventure framing around a plan the code already built. It must not change any fact. */
export async function writeQuestStory(llm: JsonLlm, facts: Record<string, unknown>): Promise<QuestStoryReply> {
  return llm.json({
    task: "writeQuestStory",
    system: [
      "You turn a group's evening plan into a short, playful mini adventure (a 'side quest'), not a dry itinerary.",
      "Speak to the group as \"you\". Indian English, warm and witty, no cringe, no markdown, no emojis.",
      'Return JSON: {"title":string,"tagline":string,"chapters":[{"title":string,"flavor":string,"challenge":string}],"finale":string}',
      "- title: a quest name under 8 words that references the area or city (e.g. \"The Hauz Khas Night Shift\").",
      "- tagline: one sentence that sets up the mission.",
      "- chapters: exactly one per entry in facts.chapters, in the same order.",
      "  title: a chapter name under 7 words. flavor: 1-2 sentences that make the stop sound like a scene in a story, naming the real place.",
      "  challenge: one small, safe, free side challenge for the group at that stop (e.g. \"Everyone picks a dish for someone else\").",
      "  No alcohol or drinking games, nothing that costs extra, nothing that bothers staff or strangers, nothing unsafe.",
      "  For a chapter with kind \"activity\", the idea is a suggestion with no fixed venue: build on its own text and do not name any business. For kind \"supplies\", it is an Instamart order placed at home before heading out or settling in.",
      "- finale: 1-2 sentences wrapping up the night with the late-night food (if any) and the budget result.",
      "- Use ONLY the names, times and numbers in the facts. Never invent a price, rating, time, distance or place. Use ₹ for rupees.",
      "- If facts.budget.overByRs is a number, say honestly that the plan goes over budget by that amount.",
    ].join("\n"),
    user: JSON.stringify(facts),
    schema: questStoryReply,
    temperature: 0.8,
    maxTokens: 1536,
  });
}
