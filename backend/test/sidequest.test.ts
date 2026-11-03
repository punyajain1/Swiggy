import { describe, expect, it, vi } from "vitest";
import { MemorySettingsStore } from "../src/settings/settings.js";
import { planSideQuest, type SideQuestDeps } from "../src/sidequest/sidequest.js";
import { schedule } from "../src/sidequest/plan.js";
import { cheapestAvailable, fitKitToBudget, packUnits, parseUpcomingDay, withOpenWindows } from "../src/sidequest/sources.js";
import type { ActivityCandidate, DinnerCandidate, QuestIntent } from "../src/sidequest/types.js";
import { fallbackStory, storyUsesOnlyKnownNumbers, type StoryFacts } from "../src/sidequest/story.js";
import { findCity, firstAmount, parseDistanceKm, resolvePlace } from "../src/sidequest/places.js";
import { istDate, istTimeLabel, questStart } from "../src/sidequest/time.js";
import {
  dineoutSearchSchema,
  discoverEventsSchema,
  eventDetailsSchema,
  eventShowsSchema,
  searchEventsSchema,
  type DineoutSlots,
  searchMenuSchema,
  searchProductsSchema,
} from "../src/swiggy/schemas.js";
import { ALLOWED_TOOLS } from "../src/swiggy/callTool.js";
import { FakeLlm, settings } from "./helpers.js";

/** 3 Nov 2026, h:m IST, as epoch ms. */
const IST = (h: number, m = 0) => Date.UTC(2026, 10, 3, h, m) - 330 * 60_000;
const NOW = IST(12, 0);

function fakeApi() {
  const ticket = (id: string, name: string, price: number, available = 20) => ({
    id,
    name,
    availableInventory: available,
    price: { price: { units: String(price), nanos: 0 }, discountedPrice: { units: String(price), nanos: 0 } },
  });
  const show = (h: number, m: number, tickets: ReturnType<typeof ticket>[]) => ({
    id: `show-${h}`,
    show_time_unix: Math.floor(IST(h, m) / 1000),
    show_time_ist: `Tue, 3 Nov, ${h - 12}:${String(m).padStart(2, "0")} pm`,
    maxAvailableInventory: 25,
    tickets,
  });
  const listing = (id: string) =>
    id === "A"
      ? {
          eventInfo: { id: "A", name: "Improv Night", languages: ["english"], eventDuration: { type: "TYPE_HOURS", value: 1.5 }, eventCategory: { name: "Comedy" } },
          // Live Swiggy returns venueDetails as an array.
          venueDetails: [{ id: "v1", name: "The Habitat", localityDisplayName: "Hauz Khas", location: { latLng: { latitude: 28.55, longitude: 77.2 } } }],
          dateGroupedEventShow: [{ eventShow: [show(20, 30, [ticket("t1", "Entry Pass For 1", 249), ticket("t2", "Group Pass For 4", 950, 5)])] }],
        }
      : id === "B"
        ? {
            eventInfo: { id: "B", name: "Open Mic Poetry" },
            venueDetails: [{ id: "v2", name: "Kunzum Cafe" }],
            dateGroupedEventShow: [{ eventShow: [show(19, 0, [ticket("t3", "Entry for 1 Pass", 0)])] }],
          }
        : { dateGroupedEventShow: [] };
  return {
    // Empty, as it was for Delhi, Mumbai and Bengaluru when checked live.
    discoverEvents: vi.fn(async () => discoverEventsSchema.parse({ events: [], collectionChips: [] })),
    // search_events matches every city, each with a "Locality, City" string.
    searchEvents: vi.fn(async () =>
      searchEventsSchema.parse({
        suggestions: [
          { eventId: "A", eventName: "Improv Night", location: "Hauz Khas, Delhi" },
          { eventId: "B", eventName: "Open Mic Poetry", location: "Majnu-ka-tilla, Delhi" },
          { eventId: "C", eventName: "Pottery Workshop", location: "Sector 18, Noida" },
          { eventId: "Z", eventName: "Comedy Night", location: "Bodakdev, Ahmedabad" },
        ],
      }),
    ),
    getEventDetails: vi.fn(async (eventId: string, _at?: unknown) =>
      eventDetailsSchema.parse({
        eventId,
        eventName: eventId,
        venueId: eventId === "C" ? "v3" : eventId === "A" ? "v1" : "v2",
        venueName: "Venue",
        venueLat: eventId === "C" ? "28.57" : "28.55",
        venueLng: eventId === "C" ? "77.32" : "77.2",
      }),
    ),
    listEventShows: vi.fn(async (eventId: string, _venueId: string, _at: unknown, _window: unknown) =>
      eventShowsSchema.parse({ eventShowListing: listing(eventId) }),
    ),
    searchDineout: vi.fn(async () =>
      dineoutSearchSchema.parse({
        restaurants: [
          { id: "gem", name: "Tiny Tibet Kitchen", cuisine: ["Tibetan"], locality: "Hauz Khas", rating: { value: "4.5" }, costForTwo: "₹800 for two", distance: "1.2 km" },
          { id: "cheap", name: "Chaat Corner", cuisine: ["Street Food"], locality: "Green Park", rating: { value: "4.0" }, costForTwo: "₹400 for two", distance: "2 km" },
          { id: "pop", name: "Big Brewery", cuisine: ["Continental"], rating: { value: "4.4" }, costForTwo: "₹2,000 for two", distance: "0.5 km" },
        ],
      }),
    ),
    // Parsed from Dineout's text: service hours per meal, plus free and paid deals for the day.
    getDineoutSlots: vi.fn(
      async (_restaurantId: string, _date: string, _at: unknown): Promise<DineoutSlots> => ({
        days: [{ date: "2026-11-03", meals: [{ name: "Dinner", startMin: 17 * 60, endMin: 24 * 60 + 45, slots: 32 }], free: true, paid: [{ price: 25, title: "Flat 20% off on Total Bill" }] }],
      }),
    ),
    searchProducts: vi.fn(async (query: string) =>
      searchProductsSchema.parse({
        products: /chips|cards/i.test(query)
          ? [
              {
                displayName: /cards/i.test(query) ? "Playing Cards" : "Salted Chips",
                inStock: true,
                isAvail: true,
                variations: [
                  { spinId: "s1", skuId: "k1", quantityDescription: "1 pack", displayName: "Big pack", price: { mrp: 60, offerPrice: 50 }, isInStockAndAvailable: true },
                  { spinId: "s2", skuId: "k2", quantityDescription: "1 pack", displayName: "Small pack", price: { mrp: 30, offerPrice: 25 }, isInStockAndAvailable: true },
                ],
              },
            ]
          : [],
      }),
    ),
    searchMenu: vi.fn(async () =>
      searchMenuSchema.parse({
        items: [
          { name: "Chicken Roll", price: 120, isVeg: false, menu_item_id: "m1", inStock: 1, restaurant_id: "r1", restaurant_name: "Roll Baby Roll", rating: 4.4, totalRatings: "2K+" },
          { name: "Paneer Roll", price: 110, isVeg: true, menu_item_id: "m2", inStock: 1, restaurant_id: "r2", restaurant_name: "Nizam's", rating: 4.1, totalRatings: "500+" },
          { name: "Egg Roll", price: 60, isVeg: false, menu_item_id: "m3", inStock: 0, restaurant_id: "r3", restaurant_name: "Closed", rating: 4.8 },
        ],
      }),
    ),
  };
}

const parsed = {
  isOutingRequest: true,
  city: "Delhi",
  cityLatitude: 28.61,
  cityLongitude: 77.2,
  area: null,
  areaLatitude: null,
  areaLongitude: null,
  people: 4,
  budgetRs: 1000,
  budgetIsPerPerson: false,
  hours: 5,
  startTime: null,
  vibe: ["quirky"],
  eventGenres: ["Comedy"],
  dineoutQueries: ["cafe"],
  lateNightCravings: ["rolls"],
  vegOnly: false,
  notes: null,
};

const defaultIdeas = {
  activities: [
    { title: "Wander with a mission", what: "Photograph doors around the area.", durationMin: 60, costPerPersonRs: 0, where: "out", fit: 0.6 },
    { title: "Card round", what: "A round of cards and a playlist swap.", durationMin: 45, costPerPersonRs: 0, where: "home", fit: 0.5 },
  ],
  supplies: [
    { item: "chips", searchQuery: "chips", quantity: 2 },
    { item: "playing cards", searchQuery: "playing cards", quantity: 1 },
  ],
};

function build(
  over: { parse?: Record<string, unknown>; story?: "good" | "invents" | "fails"; ideas?: unknown | "fails" } = {},
) {
  const api = fakeApi();
  const llm = new FakeLlm({
    parseQuestRequest: () => ({ ...parsed, ...over.parse }),
    proposeQuestIdeas: () => {
      if (over.ideas === "fails") throw new Error("groq down");
      return over.ideas ?? defaultIdeas;
    },
    pickEvents: () => ({ picks: [{ index: 0, fit: 0.9 }, { index: 1, fit: 0.7 }, { index: 2, fit: 0.6 }, { index: 99, fit: 1 }] }),
    writeQuestStory: (opts) => {
      if (over.story === "fails") throw new Error("groq down");
      const facts = JSON.parse(opts.user) as { chapters: unknown[] };
      return {
        title: "The Night Shift",
        tagline: over.story === "invents" ? "Only ₹12345 for the night!" : "Four of you, zero boring.",
        chapters: facts.chapters.map((_, i) => ({ title: `Chapter ${i + 1}`, flavor: "Fun happens.", challenge: "Swap seats." })),
        finale: "Home, fed, legendary.",
      };
    },
  });
  const deps: SideQuestDeps = {
    api: api as never,
    llm,
    settings: new MemorySettingsStore(settings({ addressLine: "12 MG Road, Bengaluru" })),
    now: () => NOW,
  };
  return { api, llm, deps };
}

describe("planSideQuest", () => {
  it("builds an event + dinner plan inside the time window and budget", async () => {
    const { deps, api } = build();
    const q = await planSideQuest(deps, "₹1,000, three friends, 5 hours in Delhi");

    expect(q.request).toMatchObject({ city: "Delhi", people: 4, hours: 5, budgetRs: 1000, startLabel: "6:00 PM", endLabel: "11:00 PM" });
    const kinds = q.chapters.map((c) => c.stop.kind);
    expect(kinds).toContain("event");
    expect(kinds).toContain("dinner");
    // Chapters are in time order and don't overlap.
    for (let i = 1; i < q.chapters.length; i++) expect(q.chapters[i]!.startMs).toBeGreaterThanOrEqual(q.chapters[i - 1]!.endMs);
    expect(q.chapters.every((c) => c.startMs >= IST(18) && c.endMs <= IST(23))).toBe(true);
    expect(q.budget.overByRs).toBeNull();
    expect(q.budget.totalRs).toBe(q.chapters.reduce((s, c) => s + c.stop.costRs, 0));
    expect(q.story.source).toBe("ai");
    // Only searches, never books. Each restaurant's slots are fetched once and reused for the one chosen.
    expect(api.getDineoutSlots).toHaveBeenCalledTimes(3);
  });

  it("only plans dinner at restaurants that take tables during the quest", async () => {
    const { deps, api } = build({ parse: { budgetRs: null, hours: 8 } });
    // Dineout answers "No bookable slots" for the first two; only the last one has tables.
    api.getDineoutSlots.mockImplementation(async (id: string) =>
      id === "pop"
        ? { days: [{ date: "2026-11-03", meals: [{ name: "Dinner", startMin: 17 * 60, endMin: 24 * 60, slots: 8 }], free: true, paid: [] }] }
        : { days: [] },
    );
    const q = await planSideQuest(deps, "night out in Delhi for four");
    const dinner = q.chapters.find((c) => c.stop.kind === "dinner")?.stop;
    expect(dinner?.kind === "dinner" && dinner.name).toBe("Big Brewery");
    expect(q.alternatives.dinners.map((d) => d.name)).not.toContain("Chaat Corner");
  });

  it("says so when no restaurant has tables, and still plans the rest", async () => {
    const { deps, api } = build({ parse: { budgetRs: null } });
    api.getDineoutSlots.mockResolvedValue({ days: [] });
    const q = await planSideQuest(deps, "night out in Delhi for four");
    expect(q.chapters.some((c) => c.stop.kind === "dinner")).toBe(false);
    expect(q.warnings.join(" ")).toMatch(/no tables open/);
    expect(q.coverage.find((c) => c.service === "Dineout")?.status).toBe("nothing_found");
    expect(q.chapters.length).toBeGreaterThan(0);
  });

  it("keeps a restaurant whose slot check errors: unknown isn't unbookable", async () => {
    const { deps, api } = build({ parse: { budgetRs: null } });
    api.getDineoutSlots.mockRejectedValue(new Error("timeout"));
    const q = await planSideQuest(deps, "night out in Delhi for four");
    const dinner = q.chapters.find((c) => c.stop.kind === "dinner")?.stop;
    expect(dinner?.kind === "dinner" && dinner.slot.status).toBe("unchecked");
  });

  it("only looks at Scenes events in the quest's metro, and not events elsewhere", async () => {
    const { deps, api } = build({ parse: { budgetRs: null } });
    await planSideQuest(deps, "evening in Delhi");
    const looked = api.getEventDetails.mock.calls.map((c) => c[0]);
    expect(looked).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(looked).not.toContain("Z"); // an Ahmedabad show
  });

  it("skips an event whose next date is after the quest, or whose venue is far from the city", async () => {
    const { deps, api } = build({ parse: { budgetRs: null } });
    api.getEventDetails.mockImplementation(async (id: string) =>
      eventDetailsSchema.parse({
        eventId: id,
        venueId: `v-${id}`,
        venueName: "Venue",
        venueLat: id === "C" ? "19.07" : "28.55", // C is in Mumbai
        venueLng: id === "C" ? "72.87" : "77.2",
        upcomingDate: id === "B" ? "24th Nov • 03:00 PM onwards" : "3rd Nov • 05:00 PM onwards",
      }),
    );
    await planSideQuest(deps, "evening in Delhi");
    const shown = api.listEventShows.mock.calls.map((c) => c[0]);
    expect(shown).toContain("A");
    expect(shown).not.toContain("B"); // next show is three weeks away
    expect(shown).not.toContain("C"); // venue is ~1,100 km away
  });

  it("passes the venue id to the show listing, as Swiggy requires", async () => {
    const { deps, api } = build({ parse: { budgetRs: null } });
    await planSideQuest(deps, "evening in Delhi");
    for (const call of api.listEventShows.mock.calls) expect(call[1]).toMatch(/^v/);
  });

  it("budgets the whole group and honours 'each' budgets", async () => {
    const { deps } = build({ parse: { budgetRs: 500, budgetIsPerPerson: true } });
    const q = await planSideQuest(deps, "₹500 each, four of us, 5 hours in Delhi");
    expect(q.budget.limitRs).toBe(2000);
    expect(q.request.assumptions.join(" ")).toContain("₹2,000 for the group");
  });

  const allFour = [
    ["Scenes", "used"],
    ["Dineout", "used"],
    ["Swiggy Food", "used"],
    ["Instamart", "used"],
  ];

  it("uses Scenes, Dineout, Swiggy Food and Instamart together when the budget allows", async () => {
    const { deps } = build({ parse: { budgetRs: 1500 } });
    const q = await planSideQuest(deps, "₹1,500, three friends, 5 hours in Delhi");
    expect(q.coverage.map((c) => [c.service, c.status])).toEqual(allFour);
    expect(q.budget.overByRs).toBeNull();
    expect(q.budget.totalRs).toBeLessThanOrEqual(1500);
    const food = q.chapters.find((c) => c.stop.kind === "lateNight")?.stop;
    expect(food?.kind === "lateNight" && food.shared).toBe(false);
  });

  it("shares the late-night order (one portion per two people) to keep all four in a tighter budget", async () => {
    const { deps } = build({ parse: { budgetRs: 1250 } });
    const q = await planSideQuest(deps, "₹1,250, three friends, 5 hours in Delhi");
    expect(q.coverage.map((c) => [c.service, c.status])).toEqual(allFour);
    expect(q.budget.totalRs).toBeLessThanOrEqual(1250);
    const food = q.chapters.find((c) => c.stop.kind === "lateNight")?.stop;
    expect(food?.kind === "lateNight" && food.shared && food.quantity).toBe(2);
  });

  it("never exceeds a budget it can meet, and explains what it dropped when it can't (₹1,000 for four)", async () => {
    const { deps } = build({ parse: { budgetRs: 1000 } });
    const q = await planSideQuest(deps, "₹1,000, three friends, 5 hours in Delhi");
    expect(q.budget.totalRs).toBeLessThanOrEqual(1000);
    // A table for four is ₹800 here, so something has to give, and the report says what.
    const dropped = q.coverage.filter((c) => c.status === "left_out");
    expect(dropped.length + q.coverage.filter((c) => c.status === "used").length).toBe(4);
    expect(dropped.every((c) => /time window or budget/.test(c.note))).toBe(true);
  });

  it("says why a service was left out when the budget can't take it", async () => {
    const { deps } = build({ parse: { budgetRs: 300 } });
    const q = await planSideQuest(deps, "₹300 for four in Delhi, 5 hours");
    const left = q.coverage.filter((c) => c.status === "left_out");
    expect(left.length).toBeGreaterThan(0);
    expect(left[0]!.note).toMatch(/time window or budget/);
    expect(q.budget.totalRs).toBeLessThanOrEqual(300 + (q.budget.overByRs ?? 0));
  });

  it("reports an unavailable service differently from one that found nothing", async () => {
    const { deps, api } = build();
    api.discoverEvents.mockRejectedValue(new Error("down"));
    api.searchEvents.mockRejectedValue(new Error("down"));
    api.searchDineout.mockResolvedValue(dineoutSearchSchema.parse({ restaurants: [] }));
    const q = await planSideQuest(deps, "evening in Delhi");
    const by = Object.fromEntries(q.coverage.map((c) => [c.service, c.status]));
    expect(by["Scenes"]).toBe("unavailable");
    expect(by["Dineout"]).toBe("nothing_found");
  });

  it("skips non-veg late-night food for vegetarians", async () => {
    const { deps } = build({ parse: { vegOnly: true, budgetRs: null } });
    const q = await planSideQuest(deps, "veg evening in Delhi for four");
    const food = q.chapters.find((c) => c.stop.kind === "lateNight")?.stop;
    expect(food && food.kind === "lateNight" ? food.dish : "Paneer Roll").toBe("Paneer Roll");
  });

  it("replaces a story that invents numbers with the template", async () => {
    const { deps } = build({ story: "invents" });
    const q = await planSideQuest(deps, "evening in Delhi");
    expect(q.story.source).toBe("fallback");
    expect(JSON.stringify(q.story)).not.toContain("12345");
  });

  it("falls back to the template when Groq fails", async () => {
    const { deps } = build({ story: "fails" });
    const q = await planSideQuest(deps, "evening in Delhi");
    expect(q.story.source).toBe("fallback");
    expect(q.chapters.length).toBeGreaterThan(0);
    expect(q.chapters.every((c) => c.title && c.flavor && c.challenge)).toBe(true);
  });

  it("still plans dinner when Scenes is down", async () => {
    const { deps, api } = build();
    api.discoverEvents.mockRejectedValue(new Error("scenes down"));
    api.searchEvents.mockRejectedValue(new Error("scenes down"));
    const q = await planSideQuest(deps, "evening in Delhi");
    expect(q.chapters.some((c) => c.stop.kind === "event")).toBe(false);
    expect(q.chapters.some((c) => c.stop.kind === "dinner")).toBe(true);
    expect(q.warnings.join(" ")).toContain("Scenes");
  });

  it("passes a Swiggy session error through instead of hiding it", async () => {
    const { deps, api } = build();
    const { errors } = await import("../src/errors.js");
    api.discoverEvents.mockRejectedValue(errors.reconnect());
    api.searchEvents.mockRejectedValue(errors.reconnect());
    await expect(planSideQuest(deps, "evening in Delhi")).rejects.toMatchObject({ code: "SWIGGY_RECONNECT" });
  });

  it("rejects requests that aren't about an outing, or have no city", async () => {
    await expect(planSideQuest(build({ parse: { isOutingRequest: false } }).deps, "hello")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const noCity = build({ parse: { city: null, cityLatitude: null, cityLongitude: null } });
    noCity.deps.settings = new MemorySettingsStore(settings({ addressLine: "somewhere unknown" }));
    await expect(planSideQuest(noCity.deps, "evening out")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires an address", async () => {
    const { deps } = build();
    deps.settings = new MemorySettingsStore(settings({ addressId: null }));
    await expect(planSideQuest(deps, "evening in Delhi")).rejects.toMatchObject({ code: "NO_ADDRESS" });
  });
});

describe("quests that aren't only about food", () => {
  const stayIn = { uses: { events: false, dining: false, delivery: true, supplies: true, activities: true }, theme: "stay-in movie night", budgetRs: null };

  it("builds a stay-in night from Instamart, Swiggy Food and ideas, without touching Scenes or Dineout", async () => {
    const homeOnly = { ...defaultIdeas, activities: defaultIdeas.activities.filter((a) => a.where === "home") };
    const { deps, api } = build({ parse: stayIn, ideas: homeOnly });
    const q = await planSideQuest(deps, "stay-in game night for four in Delhi");
    const kinds = q.chapters.map((c) => c.stop.kind);
    expect(kinds[0]).toBe("supplies");
    expect(kinds).toContain("activity");
    expect(kinds).toContain("lateNight");
    expect(api.discoverEvents).not.toHaveBeenCalled();
    expect(api.searchDineout).not.toHaveBeenCalled();
    expect(api.searchProducts).toHaveBeenCalled();
    expect(q.request.theme).toBe("stay-in movie night");
    // Everything is at home or delivered, so there is no travel between stops.
    expect(q.chapters.every((c) => c.travelBeforeMin === 0)).toBe(true);
    const by = Object.fromEntries(q.coverage.map((c) => [c.service, c.status]));
    expect(by).toEqual({ Scenes: "not_needed", Dineout: "not_needed", "Swiggy Food": "used", Instamart: "used" });
  });

  it("skips bulk packs and dear items when picking Instamart products", () => {
    const v = (displayName: string, quantityDescription: string, offerPrice: number) => ({
      spinId: "s", skuId: "k", displayName, quantityDescription, price: { mrp: offerPrice, offerPrice }, isInStockAndAvailable: true,
    });
    const products = searchProductsSchema.parse({
      products: [
        { displayName: "Clear Premium Drinking Water (Pack of 48)", inStock: true, isAvail: true, variations: [v("Clear Water", "48 Pieces", 265)] },
        { displayName: "Copper Water Bottle", inStock: true, isAvail: true, variations: [v("Copper Bottle", "1 Piece", 1042)] },
        { displayName: "Bisleri Water", inStock: true, isAvail: true, variations: [v("Bisleri 1 ltr", "1 ltr", 20), v("Bisleri Set of 24", "24 Pieces", 144)] },
      ],
    }).products;
    const hit = cheapestAvailable(products);
    expect(hit?.product.displayName).toBe("Bisleri Water");
    expect(hit?.price).toBe(20);
    expect(packUnits("Pack of 48")).toBe(48);
    expect(packUnits("1 ltr x 2")).toBe(1);
    expect(cheapestAvailable(products.slice(0, 2))).toBeUndefined();
  });

  it("prices Instamart supplies from the cheapest in-stock pack and adds fees", async () => {
    const { deps } = build({ parse: stayIn });
    const q = await planSideQuest(deps, "stay-in night for four");
    const supplies = q.chapters.find((c) => c.stop.kind === "supplies")?.stop;
    if (supplies?.kind !== "supplies") throw new Error("no supplies stop");
    expect(supplies.lines.map((l) => [l.want, l.unitPriceRs, l.lineRs])).toEqual([
      ["chips", 25, 50],
      ["playing cards", 25, 25],
    ]);
    expect(supplies.itemTotalRs).toBe(75);
    // Under the free-delivery threshold: ₹10 handling + ₹30 delivery.
    expect(supplies.feesRs).toBe(40);
    expect(supplies.costRs).toBe(115);
  });

  it("mixes ideas into a night out", async () => {
    // Eight hours leaves room for a walk as well as the show, dinner and the late-night delivery.
    const { deps } = build({ parse: { theme: "night out", budgetRs: null, hours: 8 } });
    const q = await planSideQuest(deps, "plan a night out in Delhi for four, 8 hours");
    const kinds = q.chapters.map((c) => c.stop.kind);
    expect(kinds).toContain("event");
    expect(kinds).toContain("activity");
    for (let i = 1; i < q.chapters.length; i++) expect(q.chapters[i]!.startMs).toBeGreaterThanOrEqual(q.chapters[i - 1]!.endMs);
    expect(q.chapters.length).toBeLessThanOrEqual(5);
  });

  it("still returns a quest when every Swiggy service is down and the AI has no ideas", async () => {
    const { deps, api } = build({ ideas: "fails" });
    api.discoverEvents.mockRejectedValue(new Error("down"));
    api.searchEvents.mockRejectedValue(new Error("down"));
    api.searchDineout.mockRejectedValue(new Error("down"));
    api.searchMenu.mockRejectedValue(new Error("down"));
    const q = await planSideQuest(deps, "plan an evening in Delhi");
    expect(q.chapters.length).toBeGreaterThan(0);
    expect(q.chapters.every((c) => c.stop.kind === "activity")).toBe(true);
    expect(q.warnings.join(" ")).toMatch(/classics/);
  });

  it("never suggests alcohol or tobacco, in ideas or in the shopping list", async () => {
    const ideas = {
      activities: [
        { title: "Vodka tasting", what: "Taste vodka.", durationMin: 60, costPerPersonRs: 0, where: "out", fit: 1 },
        { title: "Sunset spot hunt", what: "Find a skyline view.", durationMin: 45, costPerPersonRs: 0, where: "out", fit: 0.5 },
      ],
      supplies: [
        { item: "Beer", searchQuery: "beer", quantity: 6 },
        { item: "chips", searchQuery: "chips", quantity: 1 },
      ],
    };
    const { deps, api } = build({ ideas, parse: stayIn });
    const q = await planSideQuest(deps, "stay-in night for four");
    expect(JSON.stringify(q)).not.toMatch(/vodka|beer/i);
    expect(api.searchProducts).not.toHaveBeenCalledWith("beer", expect.anything());
  });

  it("skips the Instamart stop, with a warning, when too little is in stock", async () => {
    const ideas = { ...defaultIdeas, supplies: [{ item: "lanterns", searchQuery: "lanterns", quantity: 2 }, { item: "bunting", searchQuery: "bunting", quantity: 1 }] };
    const { deps } = build({ ideas, parse: stayIn });
    const q = await planSideQuest(deps, "stay-in night for four");
    expect(q.chapters.some((c) => c.stop.kind === "supplies")).toBe(false);
    expect(q.warnings.join(" ")).toMatch(/Instamart didn't have enough/);
  });

  it("uses at least one kind of stop even if the request turns them all off", async () => {
    const off = { events: false, dining: false, delivery: false, supplies: false, activities: false };
    const { deps } = build({ parse: { uses: off } });
    const q = await planSideQuest(deps, "just plan something for four in Delhi");
    expect(q.chapters.length).toBeGreaterThan(0);
  });
});

describe("response shape the frontend relies on", () => {
  it("only emits stop kinds the UI knows, each with a cost, across different quests", async () => {
    const known = new Set(["event", "dinner", "lateNight", "activity", "supplies"]);
    const allOn = { events: true, dining: true, delivery: true, supplies: true, activities: true };
    const stayIn = { events: false, dining: false, delivery: true, supplies: true, activities: true };
    for (const parse of [{}, { uses: allOn, hours: 8, budgetRs: null }, { uses: stayIn, budgetRs: null }]) {
      const { deps } = build({ parse });
      const q = JSON.parse(JSON.stringify(await planSideQuest(deps, "plan something in Delhi")));
      expect(q.chapters.length).toBeGreaterThan(0);
      for (const c of q.chapters) {
        expect(known.has(c.stop.kind)).toBe(true);
        expect(typeof c.stop.costRs).toBe("number");
      }
      expect(Array.isArray(q.alternatives.activities)).toBe(true);
    }
  });
});

describe("read-only guarantee", () => {
  it("the allowlist has no booking, cart or payment tools for Dineout or Scenes", () => {
    const risky = /book|cart|order|pay|confirm|cancel/i;
    for (const server of ["dineout", "scenes"] as const) {
      for (const tool of ALLOWED_TOOLS[server]) expect(tool).not.toMatch(risky);
    }
  });
  it("SideQuest's Instamart use is search only", async () => {
    const { deps, api } = build({ parse: { uses: { events: false, dining: false, delivery: false, supplies: true, activities: true } } });
    await planSideQuest(deps, "picnic for four in Delhi");
    expect(Object.keys(api).filter((k) => /cart|order|book/i.test(k))).toEqual([]);
  });
});

describe("story number guard", () => {
  const facts = { budget: { totalRs: 800, limitRs: 1000 }, hours: 5 } as unknown as StoryFacts;
  it("allows numbers from the facts and small counts, rejects invented ones", () => {
    expect(storyUsesOnlyKnownNumbers("About ₹800 of ₹1,000 for 4 friends", facts)).toBe(true);
    expect(storyUsesOnlyKnownNumbers("Only ₹750 tonight", facts)).toBe(false);
  });
  it("fallback story only uses facts", () => {
    const f: StoryFacts = {
      city: "Delhi", area: null, people: 4, hours: 5, startLabel: "6:00 PM", endLabel: "11:00 PM", vibe: [],
      budget: { limitRs: 1000, totalRs: 800, perPersonRs: 200, overByRs: null, underByRs: 200 },
      chapters: [{ kind: "dinner", name: "Chaat Corner", locality: "Green Park", badge: null }],
    };
    const s = fallbackStory(f);
    expect(storyUsesOnlyKnownNumbers(JSON.stringify(s), f)).toBe(true);
    expect(s.chapters).toHaveLength(1);
  });
});

describe("table hours", () => {
  const intent = { people: 4, startMs: IST(18), endMs: IST(23), budgetRs: null } as QuestIntent;
  const dinner = (openWindows?: DinnerCandidate["openWindows"]): DinnerCandidate => ({
    kind: "dinner", restaurantId: "r", name: "R", locality: null, cuisines: [], rating: 4.5, ratingCount: null,
    costForTwoRs: 800, costForTwoKnown: true, distanceKm: null, offers: [], highlights: [], badge: null, quality: 0.9, ...(openWindows ? { openWindows } : {}),
  });
  const walk: ActivityCandidate = { kind: "activity", id: "w", title: "Walk", what: "Walk.", where: "out", durationMin: 60, costPerPersonRs: 0, fit: 0.5 };

  it("schedules dinner inside service hours, moving it ahead of an activity if it has to", () => {
    // Tables only 6:00-7:00 PM. With the walk first, dinner would start at 7:30 PM, so dinner goes first.
    const stops = schedule(intent, { dinner: dinner([{ startMs: IST(18), endMs: IST(19) }]), activities: [walk] })!;
    expect(stops.map((s) => s.candidate.kind)).toEqual(["dinner", "activity"]);
    expect(stops[0]!.startMs).toBe(IST(18));
  });

  it("drops the plan when dinner can't start inside service hours", () => {
    expect(schedule(intent, { dinner: dinner([{ startMs: IST(22, 30), endMs: IST(23, 30) }]), activities: [walk] })).toBeNull();
  });

  it("puts no limit on dinner when the hours are unknown", () => {
    expect(schedule(intent, { dinner: dinner(), activities: [walk] })).not.toBeNull();
  });

  it("turns Dineout's service windows into times on the quest's dates, including past midnight", () => {
    const slots = { days: [{ date: "2026-11-03", meals: [{ name: "Dinner", startMin: 17 * 60, endMin: 24 * 60 + 45, slots: 32 }], free: true, paid: [] }] };
    const d = withOpenWindows(dinner(), slots, ["2026-11-03"]);
    expect(d.openWindows).toEqual([{ startMs: IST(17), endMs: IST(24, 45) }]);
    expect(withOpenWindows(dinner(), slots, ["2026-11-09"]).openWindows).toBeUndefined();
    expect(withOpenWindows(dinner(), undefined, ["2026-11-03"]).openWindows).toBeUndefined();
  });
});

describe("Instamart kit and budget", () => {
  const line = (want: string, lineRs: number) => ({ want, name: want, pack: null, unitPriceRs: lineRs, quantity: 1, lineRs });
  const kit = [line("snack", 108), line("water", 20), line("cards", 79), line("notes", 80)];

  it("leaves the kit alone with no budget", () => {
    expect(fitKitToBudget(kit, null)).toEqual(kit);
  });

  it("drops the dearest lines until the kit and its fees fit a share of the budget", () => {
    // 15% of ₹1,000 = ₹150. All four cost ₹287 + ₹40 fees. Dropping the snack (₹108) and the notes (₹80)
    // leaves water + cards = ₹99 + ₹40 fees = ₹139.
    const fitted = fitKitToBudget(kit, 1000);
    expect(fitted.map((l) => l.want)).toEqual(["water", "cards"]);
  });

  it("always keeps two lines so it is still a kit", () => {
    expect(fitKitToBudget(kit, 100)).toHaveLength(2);
  });

  it("keeps everything when the budget is roomy", () => {
    expect(fitKitToBudget(kit, 8000)).toEqual(kit);
  });
});

describe("parseUpcomingDay", () => {
  const now = Date.UTC(2026, 10, 3, 6, 30); // 3 Nov 2026
  it("reads Scenes' 'next date' text", () => {
    expect(parseUpcomingDay("3rd Nov • 05:00 PM onwards", now)).toBe("2026-11-03");
    expect(parseUpcomingDay("24th Nov • 03:00 PM onwards", now)).toBe("2026-11-24");
    expect(parseUpcomingDay("1st Jan • 08:00 PM onwards", now)).toBe("2027-01-01");
    expect(parseUpcomingDay("", now)).toBeUndefined();
    expect(parseUpcomingDay("Coming soon", now)).toBeUndefined();
  });
});

describe("time", () => {
  it("formats IST regardless of server time zone", () => {
    expect(istTimeLabel(IST(19, 30))).toBe("7:30 PM");
    expect(istTimeLabel(IST(0, 5))).toBe("12:05 AM");
    expect(istDate(IST(23, 30))).toBe("2026-11-03");
  });
  it("starts at the next half hour, not before 6 PM", () => {
    expect(questStart(IST(12, 0), null, 18)).toBe(IST(18, 0));
    expect(questStart(IST(19, 10), null, 18)).toBe(IST(19, 30));
    expect(questStart(IST(12, 0), "20:00", 18)).toBe(IST(20, 0));
    expect(questStart(IST(21, 0), "19:00", 18)).toBe(IST(21, 30));
  });
});

describe("places and parsing", () => {
  it("knows city aliases", () => {
    expect(findCity("Bangalore")?.name).toBe("Bengaluru");
    expect(findCity("gurgaon")?.name).toBe("Gurugram");
    expect(findCity("Atlantis")).toBeUndefined();
  });
  it("ignores area coordinates far from the city", () => {
    const base = { city: "Delhi", area: "Bandra", cityLocation: null, fallbackText: null };
    expect(resolvePlace({ ...base, areaLocation: { lat: 19.06, lng: 72.83 } })?.areaIgnored).toBe(true);
    expect(resolvePlace({ ...base, area: "Hauz Khas", areaLocation: { lat: 28.55, lng: 77.2 } })?.areaIgnored).toBe(false);
  });
  it("parses prices and distances", () => {
    expect(firstAmount("₹1,200 for two")).toBe(1200);
    expect(firstAmount("Free")).toBe(0);
    expect(firstAmount("Price on request")).toBeNull();
    expect(parseDistanceKm("800 m")).toBe(0.8);
    expect(parseDistanceKm("2.3 km")).toBe(2.3);
  });
});
