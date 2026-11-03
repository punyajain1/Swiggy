import { ChefHat, Clock, Gauge, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { difficultyLabel, minutes, rupees } from "@/lib/format";
import type { CookOption } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CookCard({
  cook,
  recommended,
  onFillCart,
}: {
  cook: CookOption | null;
  recommended: boolean;
  onFillCart: () => void;
}) {
  if (!cook) {
    return (
      <Card data-testid="cook-card" className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChefHat className="size-5" /> Make at home
          </CardTitle>
          <CardDescription>We couldn&apos;t price the ingredients on Instamart near you this time.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const canFill = cook.lines.some((l) => l.packs.length > 0);
  const surplus = cook.lines.filter((l) => l.surplus);

  return (
    <Card data-testid="cook-card" className={cn(recommended && "border-primary ring-2 ring-primary/30")}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ChefHat className="size-5" /> Make at home
          </CardTitle>
          {recommended && <Badge>Recommended</Badge>}
        </div>
        <CardDescription>Ingredients from Instamart, cooked by you.</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4 sm:gap-5">
        <div className="flex flex-wrap gap-1.5 sm:gap-2 text-xs">
          <Badge variant="secondary">
            <Clock /> {minutes(cook.activeMin)} hands-on
          </Badge>
          <Badge variant="secondary">
            <Clock /> eat in ~{minutes(cook.totalMinToEat)}
          </Badge>
          <Badge variant="secondary">
            <Gauge /> {cook.difficulty}/5 {difficultyLabel[cook.difficulty]?.toLowerCase()}
          </Badge>
        </div>

        <ul className="grid gap-2.5 sm:gap-2 text-sm">
          {cook.lines.map((l) => (
            <li key={l.ingredient} className="flex items-start justify-between gap-2 sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm sm:text-base break-words">
                  {l.ingredient} <span className="font-normal text-muted-foreground">· need {l.need.display}</span>
                </p>
                {l.status === "matched" ? (
                  <p className="break-words text-xs text-muted-foreground">
                    {l.packs.map((p) => `${p.quantity} × ${p.label}`).join(" + ")} · {l.product?.name}
                  </p>
                ) : (
                  <p className="text-xs text-warning">Not on Instamart near you</p>
                )}
                {l.note && l.status === "matched" && <p className="break-words text-xs text-muted-foreground">{l.note}</p>}
              </div>
              <span className={cn("shrink-0 tabular-nums text-sm sm:text-base font-medium", l.estimated && "text-muted-foreground")}>
                {l.estimated ? "~" : ""}
                {rupees(l.cost)}
              </span>
            </li>
          ))}
        </ul>

        {cook.staples.length > 0 && (
          <p className="break-words text-xs text-muted-foreground/80">
            Assumed in your pantry: {cook.staples.map((s) => `${s.ingredient} (${s.display})`).join(", ")}
          </p>
        )}

        {surplus.length > 0 && (
          <p className="break-words text-xs text-muted-foreground">
            Left over after cooking: {surplus.map((l) => `${l.surplus!.display} ${l.ingredient.toLowerCase()}`).join(", ")}
          </p>
        )}

        <div className="grid gap-1 rounded-lg bg-muted/60 p-3 text-sm">
          <Row label="Ingredients" value={rupees(cook.subtotal)} />
          <Row label="Instamart fees (est.)" value={rupees(cook.fees.total)} />
          <Row label="You pay today (est.)" value={rupees(cook.payToday)} strong />
          <Row label={`Per serving (${cook.servings})`} value={rupees(cook.costPerServing)} />
          {cook.leftoverServings > 0 && <Row label="Extra servings" value={String(cook.leftoverServings)} />}
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">How to make it</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            {cook.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>
      </CardContent>

      <CardFooter>
        <Button onClick={onFillCart} disabled={!canFill} variant={recommended ? "default" : "outline"} className="w-full">
          <ShoppingCart /> Fill Instamart cart
        </Button>
      </CardFooter>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "font-semibold")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
