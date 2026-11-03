import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { CartResult, Decision, OrderOption } from "@/lib/types";
import { DecisionResults } from "./decision-results";

vi.mock("@/lib/api", () => ({
  api: {
    fillFoodCart: vi.fn(),
    fillInstamartCart: vi.fn(),
    loginUrl: () => "http://localhost:4000/auth/login?redirect=1",
  },
  isSessionError: () => false,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : "error"),
}));

const restaurant = (id: string, name: string, patch: Partial<OrderOption> = {}): OrderOption => ({
  kind: "order",
  id,
  restaurantId: id,
  restaurantName: name,
  items: [
    {
      dish: "Butter Chicken",
      menuItemId: `m_${id}`,
      name: "Butter Chicken",
      price: 320,
      variantLabel: "Full",
      quantity: 2,
      servesPerUnit: 2,
      lineTotal: 640,
    },
  ],
  missingDishes: [],
  leftoverServings: 0,
  itemTotal: 640,
  fees: { delivery: 40, platform: 10, gst: 32, total: 82, estimated: true },
  estTotal: 722,
  costPerServing: 180.5,
  dishRating: 4.5,
  dishRatingCountLabel: "1.2K",
  restaurantRating: 4.4,
  restaurantRatingCountLabel: "8.2K+",
  distanceKm: 2.1,
  deliveryMin: 32,
  deliveryEstimated: false,
  availability: "OPEN",
  quality: 0.88,
  activeMin: 5,
  ...patch,
});

function decision(winner: "cook" | "order"): Decision {
  return {
    decisionId: "11111111-1111-4111-8111-111111111111",
    createdAt: new Date().toISOString(),
    intent: {
      dish: "Butter Chicken",
      dishes: [{ name: "Butter Chicken", role: "main" }],
      servings: 4,
      timeLimitMin: null,
      notes: null,
      servingsDefaulted: false,
      droppedDishes: [],
    },
    recipe: { prepMin: 20, cookMin: 35, difficulty: 3, yieldServings: 4, steps: ["Cook"] },
    cook: {
      kind: "cook",
      lines: [
        {
          ingredient: "Chicken",
          need: { qty: 500, unit: "g", display: "500 g" },
          status: "matched",
          product: { name: "Fresh Chicken Boneless" },
          packs: [{ spinId: "c1k", skuId: "sku_c1k", label: "1 kg", unitPrice: 380, quantity: 1 }],
          cost: 380,
          estimated: false,
          surplus: { amount: 500, unit: "g", display: "500 g" },
        },
      ],
      staples: [{ ingredient: "Salt", display: "10 g" }],
      subtotal: 380,
      fees: { handling: 10, delivery: 0, total: 10, estimated: true },
      payToday: 390,
      costPerServing: 97.5,
      servings: 4,
      yieldServings: 4,
      leftoverServings: 0,
      prepMin: 20,
      cookMin: 35,
      activeMin: 40,
      groceryDeliveryMin: 12,
      totalMinToEat: 67,
      difficulty: 3,
      quality: 0.75,
      steps: ["Cook it"],
      notFoundCount: 0,
    },
    order: { best: restaurant("r1", "Punjabi Tadka"), alternatives: [restaurant("r3", "Curry House", { estTotal: 800 })] },
    comparison: [
      { key: "payToday", label: "You pay today", cook: "₹390 (est.)", order: "₹722 (est.)", winner: "cook" },
      { key: "readyIn", label: "Ready to eat in", cook: "~1 h 7 min", order: "~32 min", winner: "order" },
      { key: "leftovers", label: "Leftovers", cook: "None", order: "None", winner: "tie" },
    ],
    verdict: {
      winner,
      margin: 0.1,
      cookScore: 0.8,
      orderScore: 0.7,
      timeLimitMin: null,
      cookBreaksTimeLimit: false,
      orderBreaksTimeLimit: false,
    },
    explanation: { headline: "Cook it tonight and save ₹332", text: "Cooking saves you about ₹332.", source: "fallback" },
    warnings: [],
    addressLine: "Home — 12 MG Road",
  };
}

const cartResult: CartResult = {
  kind: "food",
  title: "Curry House",
  items: [{ name: "Butter Chicken", quantity: 2, price: "₹640" }],
  bill: [{ label: "Item total", value: "₹640" }],
  toPay: 760,
  estimate: 800,
  difference: -40,
  coupon: null,
  warnings: [],
};

beforeEach(() => {
  vi.mocked(api.fillFoodCart).mockReset().mockResolvedValue(cartResult);
  vi.mocked(api.fillInstamartCart).mockReset().mockResolvedValue({ ...cartResult, kind: "instamart", title: "Instamart" });
});

describe("DecisionResults", () => {
  it("puts the Recommended badge on the suggested option only", () => {
    render(<DecisionResults decision={decision("cook")} />);
    expect(within(screen.getByTestId("cook-card")).getByText("Recommended")).toBeInTheDocument();
    expect(within(screen.getByTestId("order-card")).queryByText("Recommended")).toBeNull();
    expect(screen.getByText("Our suggestion")).toBeInTheDocument();
    expect(screen.getByText("Cook it tonight and save ₹332")).toBeInTheDocument();
  });

  it("moves the badge when ordering wins", () => {
    render(<DecisionResults decision={decision("order")} />);
    expect(within(screen.getByTestId("order-card")).getByText("Recommended")).toBeInTheDocument();
    expect(within(screen.getByTestId("cook-card")).queryByText("Recommended")).toBeNull();
  });

  it("shows the best restaurant, the alternatives, ratings and staples", () => {
    render(<DecisionResults decision={decision("cook")} />);
    expect(screen.getByTestId("restaurant-r1")).toHaveTextContent("Punjabi Tadka");
    expect(screen.getByTestId("restaurant-r1")).toHaveTextContent("4.5★ dish (1.2K)");
    expect(screen.getByTestId("restaurant-r3")).toHaveTextContent("Curry House");
    expect(screen.getByText(/Assumed in your pantry: Salt \(10 g\)/)).toBeInTheDocument();
  });

  it("lists every dish of a meal for each restaurant, and what's missing", () => {
    const d = decision("order");
    const line = (dish: string, id: string, quantity: number, price: number) => ({
      dish,
      menuItemId: id,
      name: dish,
      price,
      quantity,
      servesPerUnit: 1,
      lineTotal: quantity * price,
    });
    d.intent.dish = "Dal Makhani and Butter Naan";
    d.order = {
      best: restaurant("r1", "Dhaba", { items: [line("Dal Makhani", "d1", 2, 240), line("Butter Naan", "n1", 8, 50)] }),
      alternatives: [restaurant("r2", "Naan Stop", { items: [line("Butter Naan", "n2", 8, 45)], missingDishes: ["Dal Makhani"] })],
    };
    render(<DecisionResults decision={d} />);
    const best = screen.getByTestId("restaurant-r1");
    expect(best).toHaveTextContent("2 × Dal Makhani");
    expect(best).toHaveTextContent("8 × Butter Naan");
    expect(screen.getByTestId("restaurant-r2")).toHaveTextContent("Doesn't have Dal Makhani");
    expect(screen.getByText(/Dal Makhani and Butter Naan for 4/)).toBeInTheDocument();
  });

  it("marks the winner of each comparison row", () => {
    render(<DecisionResults decision={decision("cook")} />);
    const [, cookPay, orderPay] = within(screen.getByTestId("row-payToday")).getAllByRole("cell");
    expect(cookPay).toHaveAttribute("data-winner", "true");
    expect(orderPay).toHaveAttribute("data-winner", "false");
    const [, cookReady, orderReady] = within(screen.getByTestId("row-readyIn")).getAllByRole("cell");
    expect(cookReady).toHaveAttribute("data-winner", "false");
    expect(orderReady).toHaveAttribute("data-winner", "true");
    const tie = within(screen.getByTestId("row-leftovers")).getAllByRole("cell");
    expect(tie.filter((c) => c.getAttribute("data-winner") === "true")).toHaveLength(0);
  });

  it("fills the Food cart for the chosen restaurant after confirmation", async () => {
    const user = userEvent.setup();
    render(<DecisionResults decision={decision("cook")} />);
    await user.click(screen.getByRole("button", { name: "Fill Food cart from Curry House" }));
    expect(await screen.findByText(/This replaces whatever is in your current Swiggy Food cart/)).toBeInTheDocument();
    expect(api.fillFoodCart).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Replace cart and fill/ }));
    await waitFor(() => expect(api.fillFoodCart).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "r3"));
    expect(await screen.findByText("₹760")).toBeInTheDocument();
    expect(screen.getByText("₹40 less than estimated")).toBeInTheDocument();
    expect(screen.getByText(/Open the Swiggy app/)).toBeInTheDocument();
  });

  it("fills the Instamart cart from the cook card", async () => {
    const user = userEvent.setup();
    render(<DecisionResults decision={decision("cook")} />);
    await user.click(screen.getByRole("button", { name: /Fill Instamart cart/ }));
    await user.click(await screen.findByRole("button", { name: /Replace cart and fill/ }));
    await waitFor(() => expect(api.fillInstamartCart).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"));
    expect(api.fillFoodCart).not.toHaveBeenCalled();
  });
});
