import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SideQuest } from "@/lib/sidequest-types";
import { QuestResults } from "./quest-results";

const slot = { status: "free", displayTime: "9:00 PM", dealTitle: "Free booking", bookingPriceRs: null } as const;

function quest(patch: Partial<SideQuest> = {}): SideQuest {
  return {
    questId: "q1",
    createdAt: "2026-11-03T06:30:00.000Z",
    request: { text: "x", city: "Delhi", area: null, people: 4, hours: 5, budgetRs: 1000, startLabel: "6:00 PM", endLabel: "11:00 PM", vibe: ["quirky"], theme: "night out", assumptions: ["Starts at 6:00 PM."] },
    story: { title: "The Delhi Night Shift", tagline: "Four of you, zero boring.", finale: "Home, fed, legendary.", source: "ai" },
    chapters: [
      {
        index: 0, title: "The Opening Act", flavor: "Improv at The Habitat.", challenge: "Quote one line later.",
        startMs: 0, endMs: 1, startLabel: "7:00 PM", endLabel: "8:30 PM", travelBeforeMin: 0,
        stop: { kind: "event", eventId: "A", name: "Improv Night", venueName: "The Habitat", area: "Hauz Khas", genre: "Comedy", language: null, fit: 0.9, showStartMs: 0, showTimeLabel: "Tue, 3 Nov, 7:00 pm", durationMin: 90, durationEstimated: false, ticketTitle: "4 × Entry Pass For 1", groupCostRs: 400, pricePerPersonRs: 100, priceEstimated: false, seatsLeft: 5, venueLocation: null, costRs: 400 },
      },
      {
        index: 1, title: "The Secret Supper", flavor: "A quiet Tibetan kitchen.", challenge: "Order for the person on your left.",
        startMs: 2, endMs: 3, startLabel: "9:00 PM", endLabel: "10:15 PM", travelBeforeMin: 30,
        stop: { kind: "dinner", restaurantId: "gem", name: "Tiny Tibet Kitchen", locality: "Hauz Khas", cuisines: ["Tibetan"], rating: 4.5, ratingCount: null, costForTwoRs: 600, costForTwoKnown: true, distanceKm: 1.2, offers: [], highlights: [], badge: "Top rated", quality: 0.9, costRs: 1200, slot },
      },
    ],
    coverage: [
      { service: "Scenes", role: "Event", status: "used", note: "A show that starts inside your window." },
      { service: "Dineout", role: "Dinner", status: "used", note: "A table, with a slot check." },
      { service: "Swiggy Food", role: "Late-night food", status: "left_out", note: "Had options, but none fit your time window or budget." },
      { service: "Instamart", role: "Quest kit", status: "unavailable", note: "Swiggy didn't respond, so this part is skipped." },
    ],
    budget: { limitRs: 1000, totalRs: 1600, perPersonRs: 400, overByRs: 600, lines: [
      { kind: "event", label: "4 × ticket, Improv Night", costRs: 400, estimated: false },
      { kind: "dinner", label: "Dinner for 4, Tiny Tibet Kitchen", costRs: 1200, estimated: true },
    ] },
    alternatives: { events: [], dinners: [], lateNight: [], activities: [] },
    warnings: [],
    addressLine: null,
    ...patch,
  };
}

describe("QuestResults", () => {
  it("shows the story, one chapter per stop, and labels a top-rated restaurant", () => {
    render(<QuestResults quest={quest()} />);
    expect(screen.getByText("The Delhi Night Shift")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-event")).toHaveTextContent("Improv Night");
    const dinner = screen.getByTestId("chapter-dinner");
    expect(within(dinner).getByText(/Top rated/)).toBeInTheDocument();
    expect(within(dinner).queryByText(/Underrated/)).not.toBeInTheDocument();
    expect(within(dinner).getByText(/Free table booking at 9:00 PM/)).toBeInTheDocument();
  });

  it("says plainly when the plan is over budget", () => {
    render(<QuestResults quest={quest()} />);
    expect(screen.getByTestId("budget-card")).toHaveTextContent("₹600 over budget");
  });

  it("counts side challenges as they are ticked", async () => {
    const user = userEvent.setup();
    render(<QuestResults quest={quest()} />);
    const counter = screen.getByLabelText("Side challenges completed");
    expect(counter).toHaveTextContent("0/2");
    await user.click(screen.getAllByRole("button", { pressed: false })[0]!);
    expect(counter).toHaveTextContent("1/2");
  });

  it("shows what each Swiggy service did, and why one was left out", () => {
    render(<QuestResults quest={quest()} />);
    expect(within(screen.getByTestId("coverage-Scenes")).getByText("In your quest")).toBeInTheDocument();
    const food = screen.getByTestId("coverage-Swiggy Food");
    expect(within(food).getByText("Left out")).toBeInTheDocument();
    expect(food).toHaveTextContent(/time window or budget/);
    expect(within(screen.getByTestId("coverage-Instamart")).getByText("Unavailable")).toBeInTheDocument();
  });

  it("labels a shared late-night order", () => {
    const base = quest();
    const q = quest({
      chapters: [
        {
          ...base.chapters[0]!, index: 0, title: "The Midnight Drop", flavor: "Rolls.", challenge: "Rate it.",
          stop: { kind: "lateNight", restaurantId: "r1", restaurantName: "Roll Baby Roll", dish: "Chicken Roll", isVeg: false, pricePerItemRs: 120, quantity: 2, shared: true, itemTotalRs: 240, feesRs: 62, rating: 4.4, quality: 0.8, costRs: 302, orderAtLabel: "10:00 PM" },
        },
      ],
    });
    render(<QuestResults quest={q} />);
    const card = screen.getByTestId("chapter-lateNight");
    expect(card).toHaveTextContent("2 × Chicken Roll");
    expect(card).toHaveTextContent("to share");
    expect(card).toHaveTextContent("One portion per two people");
  });

  it("labels AI ideas as ideas and shows Instamart supplies with real line prices", () => {
    const base = quest();
    const q = quest({
      chapters: [
        {
          ...base.chapters[0]!, index: 0, title: "The Supply Run", flavor: "Stock up.", challenge: "Pick a job.", travelBeforeMin: 0,
          stop: { kind: "supplies", lines: [{ want: "chips", name: "Salted Chips", pack: "1 pack", unitPriceRs: 25, quantity: 2, lineRs: 50 }], missing: ["bunting"], itemTotalRs: 50, feesRs: 40, quality: 0.5, costRs: 90 },
        },
        {
          ...base.chapters[0]!, index: 1, title: "The Detour", flavor: "Wander.", challenge: "Find doors.", travelBeforeMin: 30,
          stop: { kind: "activity", id: "idea-0", title: "Wander with a mission", what: "Photograph doors.", where: "out", durationMin: 60, costPerPersonRs: 0, fit: 0.6, costRs: 0 },
        },
      ],
      budget: { limitRs: null, totalRs: 90, perPersonRs: 23, overByRs: null, lines: [] },
      alternatives: { events: [], dinners: [], lateNight: [], activities: [{ kind: "activity", id: "idea-1", title: "Card round", what: "Cards.", where: "home", durationMin: 45, costPerPersonRs: 0, fit: 0.5 }] },
    });
    render(<QuestResults quest={q} />);

    const supplies = screen.getByTestId("chapter-supplies");
    expect(within(supplies).getByText("Instamart")).toBeInTheDocument();
    expect(within(supplies).getByText(/2 × Salted Chips/)).toBeInTheDocument();
    expect(within(supplies).getByText(/Not found on Instamart near you: bunting/)).toBeInTheDocument();

    const idea = screen.getByTestId("chapter-activity");
    expect(within(idea).getByText("Idea")).toBeInTheDocument();
    expect(within(idea).getByText("Free")).toBeInTheDocument();
    expect(within(idea).getByText(/not a Swiggy listing/)).toBeInTheDocument();
    expect(within(screen.getByTestId("plan-b")).getByText("Card round")).toBeInTheDocument();
  });

  it("shows a plain card, not a crash, for a stop kind it doesn't know", () => {
    const base = quest();
    const odd = { ...base.chapters[0]!, stop: { kind: "mystery", costRs: 0 } } as unknown as SideQuest["chapters"][number];
    render(<QuestResults quest={quest({ chapters: [odd] })} />);
    expect(screen.getByText("The Opening Act")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-mystery")).toBeInTheDocument();
  });

  it("shows the group ticket price and which tickets make it", () => {
    const base = quest();
    const ev = base.chapters[0]!;
    const q = quest({
      chapters: [{ ...ev, stop: { ...(ev.stop as Extract<typeof ev.stop, { kind: "event" }>), ticketTitle: "1 × Group Pass For 4", groupCostRs: 950, pricePerPersonRs: 238, costRs: 950 } }],
    });
    render(<QuestResults quest={q} />);
    const card = screen.getByTestId("chapter-event");
    expect(card).toHaveTextContent("₹950");
    expect(card).toHaveTextContent("₹238 each");
    expect(card).toHaveTextContent("1 × Group Pass For 4");
  });

  it("says when Dineout takes tables, if the planned time is outside them", () => {
    const base = quest();
    const dn = base.chapters[1]!;
    const q = quest({
      chapters: [{ ...dn, stop: { ...(dn.stop as Extract<typeof dn.stop, { kind: "dinner" }>), slot: { status: "none", displayTime: null, dealTitle: null, bookingPriceRs: null, openRanges: "Dinner 5:00 PM–10:45 PM" } } }],
    });
    render(<QuestResults quest={q} />);
    expect(screen.getByTestId("chapter-dinner")).toHaveTextContent(/Tables are taken Dinner 5:00 PM–10:45 PM/);
  });

  it("is upfront that it books nothing", () => {
    render(<QuestResults quest={quest()} />);
    expect(screen.getByText(/doesn.t book anything/)).toBeInTheDocument();
  });
});
