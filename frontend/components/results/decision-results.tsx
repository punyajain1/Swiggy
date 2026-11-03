"use client";

import { useState } from "react";
import type { Decision } from "@/lib/types";
import { CartDialog, type CartTarget } from "./cart-dialog";
import { ComparisonTable } from "./comparison-table";
import { CookCard } from "./cook-card";
import { OrderCard } from "./order-card";
import { VerdictBanner } from "./verdict-banner";

/** Verdict, the two option cards side by side, and the comparison table. */
export function DecisionResults({ decision, onSessionExpired }: { decision: Decision; onSessionExpired?: () => void }) {
  const [target, setTarget] = useState<CartTarget | null>(null);
  const winner = decision.verdict.winner;

  return (
    <div className="grid gap-6">
      <VerdictBanner decision={decision} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <CookCard
          cook={decision.cook}
          recommended={winner === "cook"}
          onFillCart={() => decision.cook && setTarget({ kind: "instamart", cook: decision.cook })}
        />
        <OrderCard
          order={decision.order}
          recommended={winner === "order"}
          onFillCart={(option) => setTarget({ kind: "food", option })}
        />
      </div>
      <ComparisonTable rows={decision.comparison} restaurantName={decision.order?.best.restaurantName} />
      <CartDialog
        decisionId={decision.decisionId}
        target={target}
        onClose={() => setTarget(null)}
        onSessionExpired={onSessionExpired}
      />
    </div>
  );
}
