import type { DecisionCache, CachedDecision } from "../engine/decisionCache.js";
import { parseMoney, rupees, rupeesExact } from "../engine/format.js";
import type { CookOption, OrderOption } from "../engine/types.js";
import { HttpError } from "../errors.js";
import type { FoodCartItemInput, InstamartCartItemInput, SwiggyApi } from "../swiggy/api.js";

export interface CartResult {
  kind: "food" | "instamart";
  title: string;
  items: Array<{ name: string; quantity: number; detail?: string; price?: string }>;
  bill: Array<{ label: string; value: string }>;
  /** Real amount from Swiggy, or null if the cart didn't report one. */
  toPay: number | null;
  /** What the comparison estimated. */
  estimate: number;
  /** toPay - estimate, rounded. */
  difference: number | null;
  coupon: { code: string; discount: number } | null;
  warnings: string[];
}

/** The update_food_cart items for an order option (one per dish), using the variant format search_menu returned. */
export function foodCartItems(option: OrderOption): FoodCartItemInput[] {
  return option.items.map((line) => ({
    menu_item_id: line.menuItemId,
    quantity: line.quantity,
    ...(line.variants ? { variants: line.variants } : {}),
    ...(line.variantsV2 ? { variantsV2: line.variantsV2 } : {}),
    addons: [],
  }));
}

/** The update_cart items for the cook option. The same SKU picked twice is merged. */
export function instamartItems(cook: CookOption): InstamartCartItemInput[] {
  const bySpin = new Map<string, InstamartCartItemInput>();
  for (const line of cook.lines) {
    for (const p of line.packs) {
      const existing = bySpin.get(p.spinId);
      if (existing) existing.quantity += p.quantity;
      else bySpin.set(p.spinId, { spinId: p.spinId, skuId: p.skuId, quantity: p.quantity });
    }
  }
  return [...bySpin.values()];
}

const diff = (toPay: number | null, estimate: number) => (toPay === null ? null : Math.round(toPay - estimate));

/** Swiggy's status message, if it says something a person can use (it sometimes just says "CART"). */
function swiggyReason(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const text = message.trim();
  if (text.length < 12 || /^[A-Z_]+$/.test(text)) return undefined;
  return ` ${text}`;
}

/**
 * Fills the Swiggy Food or Instamart cart for a decision and returns the real bill.
 * It never places an order: the user does that in the Swiggy app.
 */
export class CartService {
  constructor(
    private readonly deps: {
      api: Pick<SwiggyApi, "updateFoodCart" | "getFoodCart" | "updateInstamartCart" | "getInstamartCart">;
      cache: DecisionCache;
    },
  ) {}

  private load(decisionId: string): CachedDecision {
    const cached = this.deps.cache.get(decisionId);
    if (!cached) {
      throw new HttpError(410, "DECISION_EXPIRED", "This comparison has expired. Run it again, then fill the cart.");
    }
    return cached;
  }

  async fillFood(decisionId: string, restaurantOptionId: string): Promise<CartResult> {
    const { decision, addressId } = this.load(decisionId);
    const options = decision.order ? [decision.order.best, ...decision.order.alternatives] : [];
    const option = options.find((o) => o.id === restaurantOptionId);
    if (!option) throw new HttpError(404, "NOT_FOUND", "That restaurant isn't part of this comparison.");

    const allItems = foodCartItems(option);
    const fill = async (cartItems: FoodCartItemInput[]) => {
      const updated = await this.deps.api.updateFoodCart({
        restaurantId: option.restaurantId,
        restaurantName: option.restaurantName,
        addressId,
        cartItems,
      });
      const cart = await this.deps.api.getFoodCart(addressId, option.restaurantName);
      return { updated, cart, ok: (cart.data?.items.length ?? 0) > 0 };
    };

    let attempt = await fill(allItems);
    const rejected: string[] = [];
    // Swiggy rejects the whole cart if one item can't be added (e.g. it needs a choice the app can't make).
    // update_food_cart replaces the cart, so add dishes one at a time and keep the ones it accepts.
    if (!attempt.ok && allItems.length > 1) {
      let accepted: FoodCartItemInput[] = [];
      let best = attempt;
      let cartHoldsAccepted = false;
      for (const [i, item] of allItems.entries()) {
        const next = await fill([...accepted, item]);
        if (next.ok) {
          accepted = [...accepted, item];
          best = next;
          cartHoldsAccepted = true;
        } else {
          rejected.push(option.items[i]!.name);
          cartHoldsAccepted = false;
        }
      }
      // A failed try may have emptied the cart; put the accepted dishes back.
      if (accepted.length > 0 && !cartHoldsAccepted) best = await fill(accepted);
      attempt = best;
    }

    const { updated, cart } = attempt;
    const inner = cart.data;
    const names = option.items.map((l) => l.name).join(", ");
    if (!inner || inner.items.length === 0) {
      throw new HttpError(
        502,
        "CART_EMPTY",
        `Swiggy didn't add ${names} to your cart.${swiggyReason(cart.statusMessage ?? updated.statusMessage) ?? " The item may need a choice (size, bread, add-on) that the app can't make, or it may be out of stock. Try another restaurant."}`,
      );
    }

    const p = inner.pricing;
    const bill: CartResult["bill"] = [];
    if (p?.item_total !== undefined) bill.push({ label: "Item total", value: rupeesExact(p.item_total) });
    if (p?.delivery_charge !== undefined) bill.push({ label: "Delivery fee", value: rupeesExact(p.delivery_charge) });
    if (p?.taxes_and_charges !== undefined) bill.push({ label: "Taxes and charges", value: rupeesExact(p.taxes_and_charges) });
    // A coupon counts as applied only when it actually discounts something.
    const discount = inner.offers?.coupon_discount ?? 0;
    const coupon = inner.offers?.coupon_applied && discount > 0 ? { code: inner.offers.coupon_applied, discount } : null;
    if (coupon) bill.push({ label: `Coupon ${coupon.code}`, value: `−${rupeesExact(coupon.discount)}` });

    const toPay = p?.to_pay ?? null;
    const warnings = inner.items
      .filter((i) => i.in_stock === false)
      .map((i) => `${i.name ?? "An item"} is out of stock.`);
    // Tell the user which dish didn't make it, whether Swiggy rejected it or silently dropped it.
    const inCart = new Set(inner.items.map((i) => i.menu_item_id));
    for (const line of option.items) {
      if (!inCart.has(line.menuItemId)) {
        warnings.push(
          rejected.includes(line.name)
            ? `Swiggy wouldn't add ${line.name} (it may need a choice, like bread or size). Add it in the Swiggy app.`
            : `${line.name} couldn't be added to the cart.`,
        );
      }
    }
    if (option.missingDishes.length) {
      warnings.push(`${option.restaurantName} doesn't have ${option.missingDishes.join(", ")}.`);
    }

    return {
      kind: "food",
      title: inner.restaurant?.name ?? option.restaurantName,
      items: inner.items.map((i) => {
        const line = option.items.find((l) => l.menuItemId === i.menu_item_id);
        return {
          name: i.name ?? line?.name ?? "Item",
          quantity: i.quantity ?? line?.quantity ?? 1,
          ...(i.final_price !== undefined ? { price: rupeesExact(i.final_price) } : {}),
          ...(line?.variantLabel ? { detail: line.variantLabel } : {}),
        };
      }),
      bill,
      toPay,
      estimate: option.estTotal,
      difference: diff(toPay, option.estTotal),
      coupon,
      warnings,
    };
  }

  async fillInstamart(decisionId: string): Promise<CartResult> {
    const { decision, addressId } = this.load(decisionId);
    const cook = decision.cook;
    const items = cook ? instamartItems(cook) : [];
    if (!cook || items.length === 0) {
      throw new HttpError(409, "NOTHING_TO_ADD", "None of the ingredients were found on Instamart, so there's nothing to add.");
    }

    const updated = await this.deps.api.updateInstamartCart(addressId, items);
    const cart = await this.deps.api.getInstamartCart();

    const warnings: string[] = [];
    for (const i of updated.removedOutOfStockItems ?? []) warnings.push(`${i.itemName ?? "An item"} was out of stock and removed.`);
    for (const i of updated.reducedQuantityItems ?? []) {
      warnings.push(
        `${i.itemName ?? "An item"}: Swiggy allows ${i.cappedQuantity ?? "fewer"} instead of ${i.requestedQuantity ?? "the requested amount"}${i.reason ? ` (${i.reason})` : ""}.`,
      );
    }
    for (const i of cart.unserviceableItems ?? []) warnings.push(`${i.itemName ?? "An item"} can't be delivered to your address.`);
    if (cart.addressWarning) warnings.push(cart.addressWarning);
    if (cart.cartWarning?.message) warnings.push(cart.cartWarning.message);
    if (cart.cartAbsent) warnings.push(cart.cartAbsentReason ?? "Swiggy reported the cart as empty.");
    const notFound = cook.lines.filter((l) => l.status === "not_found").map((l) => l.ingredient);
    if (notFound.length) warnings.push(`Not on Instamart, buy separately: ${notFound.join(", ")}.`);

    const toPay = parseMoney(cart.billBreakdown?.toPay?.value ?? cart.cartTotalAmount);
    const bill = (cart.billBreakdown?.lineItems ?? [])
      .filter((l) => l.label && l.value)
      .map((l) => ({ label: l.label!, value: l.value! }));

    return {
      kind: "instamart",
      title: "Instamart",
      items: cart.items.map((i) => ({
        name: i.itemName ?? "Item",
        quantity: i.quantity ?? 1,
        ...(i.itemVariant ? { detail: i.itemVariant } : {}),
        ...(i.discountedFinalPrice !== undefined ? { price: rupees(i.discountedFinalPrice) } : {}),
      })),
      bill,
      toPay,
      estimate: cook.payToday,
      difference: diff(toPay, cook.payToday),
      coupon: null,
      warnings,
    };
  }
}
