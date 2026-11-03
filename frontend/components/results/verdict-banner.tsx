import { Bike, ChefHat, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { minutes } from "@/lib/format";
import type { Decision } from "@/lib/types";

export function VerdictBanner({ decision }: { decision: Decision }) {
  const { intent, verdict, explanation, warnings } = decision;
  const isCook = verdict.winner === "cook";
  const Icon = isCook ? ChefHat : Bike;

  return (
    <section className="grid gap-4 rounded-xl border border-primary/30 bg-accent/50 p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Our suggestion</Badge>
        <span>
          {intent.dish} for {intent.servings}
          {intent.servingsDefaulted ? " (your default)" : ""}
          {intent.timeLimitMin ? ` · ready within ${minutes(intent.timeLimitMin)}` : ""}
          {decision.addressLine ? ` · ${decision.addressLine}` : ""}
        </span>
      </div>
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icon className="size-6" />
        </span>
        <div className="grid gap-2">
          <h2 className="text-2xl font-semibold leading-tight">{explanation.headline}</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-foreground/80">{explanation.text}</p>
          <p className="text-xs text-muted-foreground">
            It&apos;s a suggestion. Check the numbers below and pick whichever suits you.
          </p>
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
