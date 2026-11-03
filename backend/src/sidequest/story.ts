import type { JsonLlm } from "../ai/groq.js";
import { writeQuestStory } from "../ai/sidequestTasks.js";
import { rupees } from "../engine/format.js";
import { logger } from "../logger.js";
import type { ScheduledStop } from "./plan.js";
import { istTimeLabel } from "./time.js";
import type { QuestIntent } from "./types.js";

export interface StoryText {
  title: string;
  tagline: string;
  chapters: Array<{ title: string; flavor: string; challenge: string }>;
  finale: string;
}

export interface StoryFacts {
  theme?: string | null;
  city: string;
  area: string | null;
  people: number;
  hours: number;
  startLabel: string;
  endLabel: string;
  vibe: string[];
  budget: { limitRs: number | null; totalRs: number; perPersonRs: number; overByRs: number | null; underByRs: number | null };
  chapters: Array<Record<string, unknown>>;
}

export function buildStoryFacts(intent: QuestIntent, stops: ScheduledStop[], totals: { totalRs: number; overByRs: number | null }): StoryFacts {
  const chapters = stops.map((s) => {
    const base = { startLabel: istTimeLabel(s.startMs), endLabel: istTimeLabel(s.endMs), groupCostRs: s.costRs };
    const c = s.candidate;
    if (c.kind === "event") {
      return {
        kind: "event",
        name: c.name,
        venue: c.venueName,
        area: c.area,
        genre: c.genre,
        showTime: istTimeLabel(c.showStartMs),
        ticketPerPersonRs: c.pricePerPersonRs,
        ...base,
      };
    }
    if (c.kind === "dinner") {
      return {
        kind: "dinner",
        name: c.name,
        locality: c.locality,
        cuisines: c.cuisines.slice(0, 3),
        rating: c.rating,
        ratingCount: c.ratingCount,
        badge: c.badge,
        costForTwoRs: c.costForTwoRs,
        highlights: c.highlights.slice(0, 2),
        ...base,
      };
    }
    if (c.kind === "activity") {
      return {
        kind: "activity",
        title: c.title,
        what: c.what,
        where: c.where === "home" ? "at home" : "out and about",
        durationMin: c.durationMin,
        ...base,
      };
    }
    if (c.kind === "supplies") {
      return {
        kind: "supplies",
        items: c.lines.map((l) => `${l.quantity} × ${l.want}`),
        ...base,
      };
    }
    return {
      kind: "lateNight",
      dish: c.dish,
      restaurant: c.restaurantName,
      quantity: c.quantity,
      orderWhenLeavingAt: istTimeLabel(s.startMs - (s.travelBeforeMin * 60_000)),
      ...base,
    };
  });
  const limit = intent.budgetRs;
  return {
    theme: intent.theme,
    city: intent.city,
    area: intent.area,
    people: intent.people,
    hours: intent.hours,
    startLabel: istTimeLabel(intent.startMs),
    endLabel: istTimeLabel(intent.endMs),
    vibe: intent.vibe,
    budget: {
      limitRs: limit,
      totalRs: totals.totalRs,
      perPersonRs: Math.round(totals.totalRs / intent.people),
      overByRs: totals.overByRs,
      underByRs: limit !== null && totals.totalRs <= limit ? limit - totals.totalRs : null,
    },
    chapters,
  };
}

function collectNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === "number") {
    out.add(value);
    out.add(Math.round(value));
    out.add(Math.round(value * 10) / 10);
  } else if (typeof value === "string") {
    for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) collectNumbers(Number(m[0].replace(/,/g, "")), out);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectNumbers(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectNumbers(v, out));
  }
}

/** True if every number of 10 or more in `text` appears in the facts. Small counts ("3 friends") are allowed. */
export function storyUsesOnlyKnownNumbers(text: string, facts: StoryFacts): boolean {
  const known = new Set<number>();
  collectNumbers(facts, known);
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (n < 10) continue;
    if (!known.has(n) && !known.has(Math.round(n))) return false;
  }
  return true;
}

const CHALLENGES: Record<string, string[]> = {
  event: [
    "Before it starts, everyone guesses the best moment of the show. Closest guess picks the dinner seats.",
    "Each of you has to remember one line from the show and quote it at the next stop.",
  ],
  dinner: [
    "Everyone orders one dish for the person on their left. No vetoes.",
    "Find the most unusual thing on the menu. Someone has to try it.",
  ],
  lateNight: [
    "Rate the night out of 10 before the food arrives. Lowest score plans the next quest.",
    "Last bite goes to whoever told the best story tonight. The group votes.",
  ],
  activity: [
    "Everyone predicts the winner before you start. Wrong guesses pick the next snack.",
    "Take one group photo that sums it up in a single look. The group votes on the best one.",
  ],
  supplies: [
    "Each person picks one item from the order that nobody else would. Defend your choice.",
    "Assign a job to everyone before the first stop: photographer, timekeeper, snack minister.",
  ],
};

/** Plain template used when Groq fails or writes a number it wasn't given. */
export function fallbackStory(facts: StoryFacts): StoryText {
  const place = facts.area ?? facts.city;
  const b = facts.budget;
  const money = b.limitRs !== null ? `, ${rupees(b.limitRs)}` : "";
  const chapters = facts.chapters.map((c, i) => {
    const pool = CHALLENGES[String(c.kind)] ?? CHALLENGES.dinner!;
    const challenge = pool[i % pool.length]!;
    if (c.kind === "event") {
      return {
        title: "The Opening Act",
        flavor: `${c.name}${c.venue ? ` at ${c.venue}` : ""}. The show starts ${c.showTime}, so don't be late.`,
        challenge,
      };
    }
    if (c.kind === "dinner") {
      return {
        title: c.badge === "Top rated" ? "The Feast" : "The Supper Stop",
        flavor: `${c.name}${c.locality ? ` in ${c.locality}` : ""}${c.badge ? `, ${String(c.badge).toLowerCase()} on Dineout` : ""}.`,
        challenge,
      };
    }
    if (c.kind === "activity") {
      return { title: String(c.title), flavor: String(c.what), challenge };
    }
    if (c.kind === "supplies") {
      const items = Array.isArray(c.items) ? c.items.join(", ") : "";
      return {
        title: "The Supply Run",
        flavor: `Order from Instamart before you head out${items ? `: ${items}` : ""}.`,
        challenge,
      };
    }
    return {
      title: "The Midnight Drop",
      flavor: `${c.quantity} × ${c.dish} from ${c.restaurant}. Order as you head home and it meets you there.`,
      challenge,
    };
  });
  const finale =
    b.overByRs !== null
      ? `All in, about ${rupees(b.totalRs)} for the group, ${rupees(b.overByRs)} over budget. Trim a stop if you need to.`
      : b.underByRs !== null
        ? `All in, about ${rupees(b.totalRs)} for the group, ${rupees(b.underByRs)} under budget. Quest complete.`
        : `All in, about ${rupees(b.totalRs)} for the group (${rupees(b.perPersonRs)} each). Quest complete.`;
  return {
    title: `The ${place} Side Quest`,
    tagline: `${facts.people} ${facts.people === 1 ? "explorer" : "explorers"}, ${facts.hours} hours${money}. Your mission: make ${facts.theme ? `this ${facts.theme}` : "tonight"} in ${place} worth retelling.`,
    chapters,
    finale,
  };
}

export async function tellStory(llm: JsonLlm, facts: StoryFacts): Promise<StoryText & { source: "ai" | "fallback" }> {
  try {
    const ai = await writeQuestStory(llm, facts as unknown as Record<string, unknown>);
    if (ai.chapters.length !== facts.chapters.length) {
      logger.warn({ got: ai.chapters.length, want: facts.chapters.length }, "Quest story chapter count mismatch; using template");
    } else {
      const all = [ai.title, ai.tagline, ai.finale, ...ai.chapters.flatMap((c) => [c.title, c.flavor, c.challenge])].join(" ");
      if (storyUsesOnlyKnownNumbers(all, facts)) return { ...ai, source: "ai" };
      logger.warn({ title: ai.title }, "Quest story used numbers outside the facts; using template");
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Quest story failed; using template");
  }
  return { ...fallbackStory(facts), source: "fallback" };
}
