import { Bike, Clock, MapPin, ShoppingCart, Star, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { lineText, minutes, rupees, stars } from "@/lib/format";
import type { OrderOption } from "@/lib/types";
import { cn } from "@/lib/utils";

export function OrderCard({
  order,
  recommended,
  onFillCart,
}: {
  order: { best: OrderOption; alternatives: OrderOption[] } | null;
  recommended: boolean;
  onFillCart: (option: OrderOption) => void;
}) {
  if (!order) {
    return (
      <Card data-testid="order-card" className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bike className="size-5" /> Order from outside
          </CardTitle>
          <CardDescription>No open restaurant near you has this on Swiggy Food right now.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-testid="order-card" className={cn(recommended && "border-primary ring-2 ring-primary/30")}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Bike className="size-5" /> Order from outside
          </CardTitle>
          {recommended && <Badge>Recommended</Badge>}
        </div>
        <CardDescription>
          Best of {1 + order.alternatives.length} open restaurant{order.alternatives.length ? "s" : ""} on Swiggy Food,
          by price, ratings and delivery time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <RestaurantOption option={order.best} highlight primary={recommended} onFillCart={onFillCart} />
        {order.alternatives.length > 0 && (
          <div className="grid gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Other options</p>
            {order.alternatives.map((o) => (
              <RestaurantOption key={o.id} option={o} onFillCart={onFillCart} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RestaurantOption({
  option: o,
  highlight,
  primary,
  onFillCart,
}: {
  option: OrderOption;
  highlight?: boolean;
  primary?: boolean;
  onFillCart: (option: OrderOption) => void;
}) {
  const multi = o.items.length > 1;
  // With one dish, its rating sits in the summary line; with a meal, each dish shows its own.
  const dish = multi ? null : stars(o.dishRating);
  const restaurant = stars(o.restaurantRating);
  const single = o.items[0];

  return (
    <div data-testid={`restaurant-${o.id}`} className={cn("grid gap-3 rounded-lg border p-3.5 sm:p-4", highlight && "bg-muted/40")}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm sm:text-base break-words">{o.restaurantName}</p>
          {!multi && single && (
            <p className="text-xs sm:text-sm text-muted-foreground break-words">
              {lineText(single)}
              {single.isVeg === true && <span className="ml-1 text-success">· veg</span>}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-sm sm:text-base">{rupees(o.estTotal)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{rupees(o.costPerServing)}/serving · est.</p>
        </div>
      </div>

      {multi && (
        <ul className="grid gap-1.5 sm:gap-1 text-xs sm:text-sm">
          {o.items.map((l) => (
            <li key={l.menuItemId} className="flex items-start justify-between gap-2 sm:gap-3">
              <span className="min-w-0 flex-1 break-words">
                {lineText(l)}
                {l.isVeg === true && <span className="ml-1 text-success">· veg</span>}
                {l.rating ? (
                  <span className="ml-2 inline-block text-xs text-muted-foreground whitespace-nowrap">
                    {stars(l.rating)}
                    {l.ratingCountLabel ? ` (${l.ratingCountLabel})` : ""}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{rupees(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
      )}

      {o.missingDishes.length > 0 && (
        <p className="break-words text-xs text-warning">
          Doesn&apos;t have {o.missingDishes.join(", ")}. The price doesn&apos;t include {o.missingDishes.length === 1 ? "it" : "them"}.
        </p>
      )}

      <div className="flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {dish && (
          <span className="flex items-center gap-1">
            <Star className="size-3 fill-current text-warning" /> {dish} dish
            {o.dishRatingCountLabel ? ` (${o.dishRatingCountLabel})` : ""}
          </span>
        )}
        {restaurant && (
          <span className="flex items-center gap-1">
            <Star className="size-3" /> {restaurant} restaurant
            {o.restaurantRatingCountLabel ? ` (${o.restaurantRatingCountLabel})` : ""}
          </span>
        )}
        {!dish && !restaurant && !multi && <span>No ratings yet</span>}
        <span className="flex items-center gap-1">
          <Clock className="size-3" /> {minutes(o.deliveryMin)}
          {o.deliveryEstimated ? " (est.)" : ""}
        </span>
        {o.distanceKm !== undefined && (
          <span className="flex items-center gap-1">
            <MapPin className="size-3" /> {o.distanceKm.toFixed(1)} km
          </span>
        )}
        {o.offer && (
          <span className="flex items-center gap-1 text-primary">
            <Tag className="size-3" /> {o.offer}
          </span>
        )}
        {o.leftoverServings > 0 && <span>{o.leftoverServings} extra serving{o.leftoverServings === 1 ? "" : "s"}</span>}
      </div>

      <Button
        size="sm"
        variant={primary ? "default" : "outline"}
        onClick={() => onFillCart(o)}
        aria-label={`Fill Food cart from ${o.restaurantName}`}
        className="w-full sm:w-auto"
      >
        <ShoppingCart /> Fill Food cart
      </Button>
    </div>
  );
}
