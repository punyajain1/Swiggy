import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callToolText, type CallToolDeps } from "../src/swiggy/callTool.js";
import { parseDineoutSearchLine, parseDineoutSearchText, parseDineoutSlotsText } from "../src/swiggy/textParsers.js";
import { cheapestTicketMix, matchSlot, showsToCandidates, ticketPeople, toDinnerCandidate } from "../src/sidequest/sources.js";
import { eventShowsSchema } from "../src/swiggy/schemas.js";
import { locationInRegion } from "../src/sidequest/places.js";
import type { QuestIntent } from "../src/sidequest/types.js";

/** Captured from live Swiggy Dineout (Delhi, query "cafe"). Both line formats appear in one response. */
const SEARCH_TEXT = `Found 28 restaurant(s) matching "cafe", showing 15. 13 more available, call again with offset=15.
1. Pour Over — Coffee | 4.3★ | ₹1200 for two | Khan Market (ID: 962101)
2. Farzi Cafe — North Indian | 4.0★ | ₹2000 for two | Connaught Place (ID: 302252)
5. Barista Coffee — ₹600 for two | 4.0★ | 3.2 km, Connaught Place | Connaught Place • ₹600 for two • Coffee (ID: 21301)
10. Cafe Vagabond — ₹650 for two | 4.8★ | 5.3 km, Paharganj | Paharganj • ₹650 for two • North Indian (ID: 1033584)
12. Kaarobaar : The Modern - Desi Bistro — ₹700 for two | 4.2★ | 6.3 km, Rajinder Nagar | Rajinder Nagar • ₹700 for two • North Indian (ID: 893608)
Search coordinates: latitude=28.6139, longitude=77.209 (use these for get_restaurant_details and downstream calls).
When the user selects a restaurant (by name, number, or clicking), call get_restaurant_details with that restaurant's ID and the same latitude/longitude.`;

/** Captured from live Swiggy Dineout get_available_slots, trimmed. */
const SLOTS_TEXT = `Found 356 slot(s) across 7 day(s). Availability per date:
  2026-11-03: Lunch (02:00 PM–04:45 PM, 12 slots); Dinner (05:00 PM–12:45 AM, 32 slots)
  2026-11-04: Lunch (12:00 PM–04:45 PM, 20 slots); Dinner (05:00 PM–12:45 AM, 32 slots)
Deal types: 7 date(s) with FREE reservations, 7 date(s) with PAID prebook deals (isFree=false). Surface BOTH to the user.
Restaurant ID: 302252
Coordinates: latitude=28.6139, longitude=77.209
Booking params per date (slotId/itemId differ by date AND by deal):
  2026-11-03 [FREE]: slotId=1, itemId="302252-195254"
  2026-11-03 [PAID ₹25 Pre-Book]: slotId=1, itemId="302252-771833" — "Flat 20% off on Total Bill"
  2026-11-03 [PAID ₹25 Pre-Book]: slotId=1, itemId="302252-1226589" — "Flat 30% off on Total Bill"
  2026-11-04 [PAID ₹50 Pre-Book]: slotId=1, itemId="302252-771833" — "Flat 10% off on Total Bill"`;

describe("parseDineoutSearchText (live format)", () => {
  const parsed = parseDineoutSearchText(SEARCH_TEXT);
  const by = (id: string) => parsed.restaurants.find((r) => r.id === id)!;

  it("reads every restaurant line, in both formats", () => {
    expect(parsed.restaurants.map((r) => r.name)).toEqual([
      "Pour Over",
      "Farzi Cafe",
      "Barista Coffee",
      "Cafe Vagabond",
      "Kaarobaar : The Modern - Desi Bistro",
    ]);
    expect(parsed.total).toBe(28);
    expect(parsed.nextOffset).toBe(15);
  });

  it("reads rating, cost, cuisine, locality and distance from the first format", () => {
    expect(by("962101")).toMatchObject({ cuisine: ["Coffee"], locality: "Khan Market", costForTwo: "₹1200 for two", rating: { value: 4.3 } });
    expect(by("962101").distance).toBeUndefined();
  });

  it("reads them from the second format", () => {
    expect(by("21301")).toMatchObject({ cuisine: ["Coffee"], locality: "Connaught Place", costForTwo: "₹600 for two", distance: "3.2 km", rating: { value: 4 } });
    expect(by("1033584")).toMatchObject({ cuisine: ["North Indian"], rating: { value: 4.8 } });
  });

  it("keeps names that contain colons and hyphens", () => {
    expect(by("893608").name).toBe("Kaarobaar : The Modern - Desi Bistro");
  });

  it("treats a header with no restaurants as empty, and anything unreadable as an error", () => {
    expect(parseDineoutSearchText('Found 0 restaurant(s) matching "zzz", showing 0.').restaurants).toEqual([]);
    expect(() => parseDineoutSearchText("Something else entirely")).toThrow(/can't read/);
  });

  it("reads restaurants Dineout lists with no cuisine or cost (live: 'Asur - Microbrewery —  | 4.5★ |  | Moti Nagar')", () => {
    const r = parseDineoutSearchLine("1. Asur - Microbrewery —  | 4.5★ |  | Moti Nagar (ID: 856083)")!;
    expect(r).toMatchObject({ id: "856083", name: "Asur - Microbrewery", rating: 4.5, locality: "Moti Nagar" });
    expect(r.cuisine).toBeUndefined();
    expect(r.costForTwo).toBeUndefined();
    const parsed = parseDineoutSearchText(`Found 2 restaurant(s) matching "brewery", showing 2.\n1. Asur - Microbrewery —  | 4.5★ |  | Moti Nagar (ID: 856083)\n2. Royal brewery- Royal Plaza —  | 3.8★ |  | Connaught Place (ID: 667471)`);
    expect(parsed.restaurants.map((x) => [x.name, x.locality])).toEqual([
      ["Asur - Microbrewery", "Moti Nagar"],
      ["Royal brewery- Royal Plaza", "Connaught Place"],
    ]);
    // No cost listed: the planner uses a labelled default instead of treating it as free.
    expect(toDinnerCandidate(parsed.restaurants[0]!)).toMatchObject({ costForTwoKnown: false, costForTwoRs: 1000 });
  });

  it("returns undefined for lines that aren't restaurants", () => {
    expect(parseDineoutSearchLine("Search coordinates: latitude=28.6, longitude=77.2")).toBeUndefined();
  });

  it("feeds the SideQuest candidate: badges come from rating and price, not invented rating counts", () => {
    const top = toDinnerCandidate(by("1033584")); // 4.8★, ₹650
    const value = toDinnerCandidate(by("893608")); // 4.2★, ₹700
    const plain = toDinnerCandidate(by("302252")); // 4.0★, ₹2000
    expect(top).toMatchObject({ badge: "Top rated", ratingCount: null, costForTwoRs: 650 });
    expect(value.badge).toBe("Good value");
    expect(plain.badge).toBeNull();
    expect(top.quality).toBeGreaterThan(plain.quality);
  });
});

describe("parseDineoutSlotsText (live format)", () => {
  const slots = parseDineoutSlotsText(SLOTS_TEXT);

  it("reads service hours, including one that runs past midnight", () => {
    const dinner = slots.days[0]!.meals.find((m) => m.name === "Dinner")!;
    expect(dinner).toEqual({ name: "Dinner", startMin: 17 * 60, endMin: 24 * 60 + 45, slots: 32 });
    expect(slots.days.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("reads free and paid deals per day", () => {
    expect(slots.days[0]).toMatchObject({ free: true });
    expect(slots.days[0]!.paid).toEqual([
      { price: 25, title: "Flat 20% off on Total Bill" },
      { price: 25, title: "Flat 30% off on Total Bill" },
    ]);
    expect(slots.days[1]).toMatchObject({ free: false, paid: [{ price: 50 }] });
  });

  it("treats Dineout's 'No bookable slots' answer as no days, not an error", () => {
    const text = "No bookable slots for 2026-11-03. Do not retry this tool for the same date. Offer the user another date.";
    expect(parseDineoutSlotsText(text)).toEqual({ days: [] });
  });

  it("throws on text it can't read instead of returning an empty answer", () => {
    expect(() => parseDineoutSlotsText("Slots are available, ask again")).toThrow(/can't read/);
  });

  const IST = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - 330 * 60_000;

  it("matchSlot: a time inside dinner service gets the day's free booking", () => {
    expect(matchSlot(slots, IST(3, 21, 7))).toMatchObject({ status: "free", displayTime: "9:00 PM", dealTitle: "Free table booking" });
  });

  it("matchSlot: falls back to the cheapest paid deal when nothing is free", () => {
    expect(matchSlot(slots, IST(4, 20, 0))).toMatchObject({ status: "paid", bookingPriceRs: 50, dealTitle: "Flat 10% off on Total Bill" });
  });

  it("matchSlot: a time outside service says when tables are taken", () => {
    const r = matchSlot(slots, IST(3, 10, 0)); // before lunch opens at 2 PM
    expect(r.status).toBe("none");
    expect(r.openRanges).toContain("Dinner 5:00 PM–12:45 AM");
  });

  it("matchSlot: the early hours after midnight fall under the previous day's late service", () => {
    expect(matchSlot(slots, IST(4, 0, 20))).toMatchObject({ status: "free", displayTime: "12:15 AM" });
  });
});

describe("callToolText", () => {
  const deps = (result: CallToolResult): CallToolDeps => ({
    transport: { callTool: async () => result },
    session: { forceRefresh: async () => undefined, markDisconnected: async () => undefined },
  });

  it("reads text even when structuredContent is an empty object (Dineout's live shape)", async () => {
    const r = { content: [{ type: "text", text: SEARCH_TEXT }], structuredContent: {} } as CallToolResult;
    const out = await callToolText(deps(r), "dineout", "search_restaurants_dineout", {}, parseDineoutSearchText);
    expect(out.restaurants).toHaveLength(5);
  });

  it("turns an error result into a Swiggy tool error", async () => {
    const r = { isError: true, content: [{ type: "text", text: "Invalid coordinates" }] } as CallToolResult;
    await expect(callToolText(deps(r), "dineout", "search_restaurants_dineout", {}, parseDineoutSearchText)).rejects.toThrow(/Invalid coordinates/);
  });

  it("refuses tools that aren't on the allowlist", async () => {
    const r = { content: [{ type: "text", text: "x" }] } as CallToolResult;
    await expect(callToolText(deps(r), "dineout", "book_table", {}, (t) => t)).rejects.toThrow(/not allowed/);
  });
});

describe("Scenes", () => {
  it("search_events results are matched to the quest's metro by their location text", () => {
    expect(locationInRegion("Sector 18, Noida", "Delhi")).toBe(true);
    expect(locationInRegion("Dlf Phase - 2, Gurgaon", "Delhi")).toBe(true);
    expect(locationInRegion("Majnu-ka-tilla, Delhi", "Delhi")).toBe(true);
    expect(locationInRegion("Bodakdev, Ahmedabad", "Delhi")).toBe(false);
    expect(locationInRegion("Madhapur, Hyderabad", "Delhi")).toBe(false);
    expect(locationInRegion("Rajarajeshwari Nagar, Bangalore", "Bengaluru")).toBe(true);
  });

  it("reads who a ticket admits from its name", () => {
    expect(ticketPeople("Entry Pass For 1")).toBe(1);
    expect(ticketPeople("Group Pass For 4")).toBe(4);
    expect(ticketPeople("Group of 4 Pass")).toBe(4);
    expect(ticketPeople("Entry for 1 Pass")).toBe(1);
    expect(ticketPeople("General")).toBe(1);
  });

  it("picks the cheapest mix of tickets for the group", () => {
    const tickets = [
      { name: "Entry Pass For 1", price: 249, available: 20 },
      { name: "Group Pass For 4", price: 950, available: 5 },
    ];
    expect(cheapestTicketMix(tickets, 4)).toEqual({ costRs: 950, title: "1 × Group Pass For 4" });
    expect(cheapestTicketMix(tickets, 2)).toEqual({ costRs: 498, title: "2 × Entry Pass For 1" });
    expect(cheapestTicketMix(tickets, 5)).toEqual({ costRs: 1199, title: "1 × Entry Pass For 1 + 1 × Group Pass For 4" });
  });

  it("returns nothing when there aren't enough tickets left", () => {
    expect(cheapestTicketMix([{ name: "Entry Pass For 1", price: 249, available: 2 }], 4)).toBeNull();
    expect(cheapestTicketMix([{ name: "Entry Pass For 1", available: 9 }], 4)).toBeNull();
  });

  it("parses a live-shaped show listing (venueDetails as an array, nested money)", () => {
    const intent = { people: 4, startMs: Date.UTC(2026, 10, 3, 12, 30), endMs: Date.UTC(2026, 10, 3, 17, 30) } as QuestIntent;
    const listing = eventShowsSchema.parse({
      eventShowListing: {
        venueDetails: [{ id: "1292", name: "Highlane Comedy Club", localityDisplayName: "Sector 18", location: { latLng: { latitude: 28.56867, longitude: 77.324034 } } }],
        eventInfo: { name: "Comedy Non-Stop", eventDuration: { type: "TYPE_HOURS", value: 1 } },
        dateGroupedEventShow: [
          {
            eventShow: [
              // 7:00 pm IST; two parallel shows at the same time collapse to one.
              { id: "1", show_time_unix: 1793712600, show_time_ist: "Tue, 3 Nov, 7:00 pm", maxAvailableInventory: 25, tickets: [{ id: "a", name: "Entry Pass For 1", availableInventory: 20, price: { price: { units: "249", nanos: 0 }, discountedPrice: { units: "249", nanos: 0 } } }, { id: "b", name: "Group Pass For 4", availableInventory: 5, price: { price: { units: "950", nanos: 0 }, discountedPrice: { units: "950", nanos: 0 } } }] },
              { id: "2", show_time_unix: 1793712600, show_time_ist: "Tue, 3 Nov, 7:00 pm", maxAvailableInventory: 25, tickets: [] },
            ],
          },
        ],
      },
    });
    const [c, ...rest] = showsToCandidates({ eventId: "100128839", eventName: "Comedy Non-Stop", venueName: undefined, area: undefined, date: undefined, price: undefined }, listing, intent, 0.8);
    expect(rest).toHaveLength(0);
    expect(c).toMatchObject({
      name: "Comedy Non-Stop",
      venueName: "Highlane Comedy Club",
      showTimeLabel: "Tue, 3 Nov, 7:00 pm",
      durationMin: 60,
      durationEstimated: false,
      groupCostRs: 950,
      pricePerPersonRs: 238,
      ticketTitle: "1 × Group Pass For 4",
    });
    expect(c!.venueLocation).toEqual({ lat: 28.56867, lng: 77.324034 });
  });
});
