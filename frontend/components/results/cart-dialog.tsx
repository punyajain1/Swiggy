"use client";

import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errorMessage, isSessionError } from "@/lib/api";
import { lineText, rupees } from "@/lib/format";
import type { CartResult, CookOption, OrderOption } from "@/lib/types";
import { cn } from "@/lib/utils";

export type CartTarget = { kind: "food"; option: OrderOption } | { kind: "instamart"; cook: CookOption };

type Phase =
  | { name: "confirm" }
  | { name: "loading" }
  | { name: "done"; result: CartResult }
  | { name: "error"; message: string; session: boolean };

/** Confirms, fills the Swiggy cart, and shows the real bill next to our estimate. Never places an order. */
export function CartDialog({
  decisionId,
  target,
  onClose,
  onSessionExpired,
}: {
  decisionId: string;
  target: CartTarget | null;
  onClose: () => void;
  onSessionExpired?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "confirm" });

  useEffect(() => {
    if (target) setPhase({ name: "confirm" });
  }, [target]);

  const appName = target?.kind === "food" ? "Swiggy Food" : "Instamart";

  async function fill() {
    if (!target) return;
    setPhase({ name: "loading" });
    try {
      const result =
        target.kind === "food"
          ? await api.fillFoodCart(decisionId, target.option.id)
          : await api.fillInstamartCart(decisionId);
      setPhase({ name: "done", result });
    } catch (err) {
      const session = isSessionError(err);
      if (session) onSessionExpired?.();
      setPhase({ name: "error", message: errorMessage(err), session });
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {phase.name === "confirm" || phase.name === "loading" ? (
          <>
            <DialogHeader>
              <DialogTitle>Fill your {appName} cart?</DialogTitle>
              <DialogDescription>
                This replaces whatever is in your current {appName} cart. Nothing is ordered: you place the order in the
                Swiggy app.
              </DialogDescription>
            </DialogHeader>
            {target?.kind === "food" && (
              <div className="grid gap-1 text-sm">
                <p>From {target.option.restaurantName}:</p>
                <ul className="grid gap-1">
                  {target.option.items.map((l) => (
                    <li key={l.menuItemId} className="font-medium">
                      {lineText(l)}
                    </li>
                  ))}
                </ul>
                {target.option.missingDishes.length > 0 && (
                  <p className="text-xs text-muted-foreground">Not available here: {target.option.missingDishes.join(", ")}</p>
                )}
              </div>
            )}
            {target?.kind === "instamart" && (
              <ul className="grid gap-1 text-sm">
                {target.cook.lines
                  .filter((l) => l.packs.length > 0)
                  .map((l) => (
                    <li key={l.ingredient}>
                      {l.packs.map((p) => `${p.quantity} × ${p.label}`).join(" + ")}{" "}
                      <span className="text-muted-foreground">{l.product?.name}</span>
                    </li>
                  ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={phase.name === "loading"} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button onClick={() => void fill()} disabled={phase.name === "loading"} className="w-full sm:w-auto">
                {phase.name === "loading" && <LoaderCircle className="animate-spin" />}
                Replace cart and fill
              </Button>
            </DialogFooter>
          </>
        ) : phase.name === "error" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5 text-destructive" /> Couldn&apos;t fill the cart
              </DialogTitle>
              <DialogDescription>{phase.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {phase.session ? (
                <a href={api.loginUrl()} className={cn(buttonVariants(), "w-full sm:w-auto")}>
                  Reconnect Swiggy
                </a>
              ) : (
                <Button onClick={() => void fill()} className="w-full sm:w-auto">Try again</Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <CartBill result={phase.result} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CartBill({ result, onClose }: { result: CartResult; onClose: () => void }) {
  const diff = result.difference;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CircleCheck className="size-5 text-success" /> Your {result.kind === "food" ? "Swiggy Food" : "Instamart"} cart is
          ready
        </DialogTitle>
        <DialogDescription>{result.title}. These are Swiggy&apos;s real numbers.</DialogDescription>
      </DialogHeader>

      <ul className="grid gap-1.5 sm:gap-1 text-xs sm:text-sm">
        {result.items.map((i, idx) => (
          <li key={`${i.name}-${idx}`} className="flex justify-between gap-2 sm:gap-3">
            <span className="min-w-0 flex-1 break-words">
              {i.quantity} × {i.name}
              {i.detail ? <span className="text-muted-foreground"> ({i.detail})</span> : null}
            </span>
            {i.price && <span className="shrink-0 tabular-nums">{i.price}</span>}
          </li>
        ))}
      </ul>

      {result.bill.length > 0 && (
        <div className="grid gap-1 border-t pt-3 text-xs sm:text-sm text-muted-foreground">
          {result.bill.map((b) => (
            <div key={b.label} className="flex justify-between gap-2">
              <span className="min-w-0 flex-1 break-words">{b.label}</span>
              <span className="shrink-0 tabular-nums">{b.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-1 rounded-lg bg-muted/60 p-3 text-xs sm:text-sm">
        <div className="flex justify-between font-semibold">
          <span>To pay</span>
          <span className="tabular-nums">{result.toPay !== null ? rupees(result.toPay) : "Not reported"}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Our estimate</span>
          <span className="tabular-nums">{rupees(result.estimate)}</span>
        </div>
        {diff !== null && diff !== 0 && (
          <p className={cn("text-xs", diff > 0 ? "text-destructive" : "text-success")}>
            {diff > 0 ? `${rupees(diff)} more` : `${rupees(-diff)} less`} than estimated
          </p>
        )}
      </div>

      {result.coupon && (
        <p className="text-xs sm:text-sm text-success break-words">
          Coupon {result.coupon.code} applied: −{rupees(result.coupon.discount)}
        </p>
      )}

      {result.warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {result.warnings.map((w) => (
            <li key={w} className="flex gap-2 break-words">
              <TriangleAlert className="size-3.5 shrink-0 text-warning" /> <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs sm:text-sm font-medium">Open the Swiggy app to review and place your order.</p>
      <DialogFooter>
        <Button onClick={onClose} className="w-full sm:w-auto">Done</Button>
      </DialogFooter>
    </>
  );
}
