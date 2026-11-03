import { z } from "zod";

/**
 * Zod schemas for the Swiggy MCP payloads this app reads, based on the documented
 * output schemas at mcp.swiggy.com/builders/docs/reference. Objects are loose (extra
 * fields pass through) and most fields are optional, because Swiggy notes that
 * optional fields vary with user, cart and live availability.
 */

/** A number that may arrive as a string ("4.3", "₹249"). Invalid values become undefined. */
const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return undefined;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  });

const str = z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined ? undefined : String(v)));
const bool = z.union([z.boolean(), z.number(), z.string()]).nullish().transform((v) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v === "true" || v === "1";
});

// ---------- Shared ----------

export const addressesSchema = z.looseObject({
  addresses: z
    .array(
      z.looseObject({
        id: z.string(),
        addressLine: str,
        addressTag: str,
        addressCategory: str,
      }),
    )
    .default([]),
  pagination: z.looseObject({ total: num, hasMore: bool }).optional(),
  resolution: z.looseObject({ defaultAddressId: str }).optional(),
});
export type Addresses = z.infer<typeof addressesSchema>;

// ---------- Food ----------

export const restaurantSchema = z.looseObject({
  id: str,
  name: z.string(),
  cuisines: z.array(z.string()).nullish(),
  avgRating: num,
  totalRatings: str,
  costForTwo: str,
  areaName: str,
  distanceKm: num,
  deliveryTimeMinutes: num,
  deliveryTimeRange: str,
  offer: str,
  imageUrl: str,
  availabilityStatus: str,
});
export type Restaurant = z.infer<typeof restaurantSchema>;

export const searchRestaurantsSchema = z.looseObject({
  restaurants: z.array(restaurantSchema).default([]),
  dishes: z
    .array(
      z.looseObject({
        id: str,
        name: z.string(),
        price: num,
        restaurantId: str,
        restaurantName: str,
        restaurantRating: num,
        deliveryTimeMinutes: num,
        inStock: bool,
      }),
    )
    .default([]),
  nextOffset: str,
  hasMore: bool,
});
export type SearchRestaurants = z.infer<typeof searchRestaurantsSchema>;

const legacyVariation = z.looseObject({
  id: str,
  groupId: str,
  name: str,
  price: num,
  default: num,
  inStock: num,
});

const variantGroupV2 = z.looseObject({
  groupId: str,
  name: str,
  variations: z
    .array(z.looseObject({ id: str, name: str, price: num, inStock: num, default: num }))
    .default([]),
});

export const menuItemSchema = z.looseObject({
  name: z.string(),
  price: num,
  isVeg: bool,
  menu_item_id: str,
  inStock: num,
  restaurant_id: str,
  restaurant_name: str,
  imageUrl: str,
  rating: num,
  totalRatings: str,
  hasVariants: bool,
  hasAddons: bool,
  isBestseller: bool,
  variations: z.array(legacyVariation).nullish(),
  variantsV2: z.array(variantGroupV2).nullish(),
  addons: z
    .array(z.looseObject({ groupId: str, groupName: str, minAddons: num, maxAddons: num }))
    .nullish(),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

export const searchMenuSchema = z.looseObject({
  items: z.array(menuItemSchema).default([]),
  totalItems: num,
  hasMore: bool,
  nextOffset: num,
});
export type SearchMenu = z.infer<typeof searchMenuSchema>;

const foodCartInner = z.looseObject({
  cart_id: str,
  restaurant: z.looseObject({ id: str, name: str, area: str }).nullish(),
  items: z
    .array(
      z.looseObject({
        menu_item_id: str,
        name: str,
        quantity: num,
        final_price: num,
        total: num,
        in_stock: bool,
      }),
    )
    .default([]),
  item_count: num,
  pricing: z
    .looseObject({
      item_total: num,
      delivery_charge: num,
      delivery_charge_strikeoff: num,
      taxes_and_charges: num,
      to_pay: num,
    })
    .nullish(),
  offers: z
    .looseObject({
      coupon_applied: str,
      coupon_discount: num,
      free_delivery_applied: bool,
    })
    .nullish(),
});

/** Shared by update_food_cart and get_food_cart: the cart sits under `data.data`. */
export const foodCartSchema = z.looseObject({
  data: foodCartInner.nullish(),
  statusCode: num,
  statusMessage: str,
});
export type FoodCart = z.infer<typeof foodCartSchema>;

// ---------- Instamart ----------

export const productVariationSchema = z.looseObject({
  spinId: z.string(),
  skuId: z.string(),
  quantityDescription: str,
  displayName: str,
  brandName: str,
  imageUrl: str,
  price: z.looseObject({ mrp: num, offerPrice: num }).nullish(),
  isInStockAndAvailable: bool,
  maxQuantity: num,
  sla: z.looseObject({ value: str, unit: str }).nullish(),
});
export type ProductVariation = z.infer<typeof productVariationSchema>;

export const productSchema = z.looseObject({
  displayName: z.string(),
  brand: str,
  inStock: bool,
  isAvail: bool,
  productId: str,
  variations: z.array(productVariationSchema).default([]),
});
export type Product = z.infer<typeof productSchema>;

export const searchProductsSchema = z.looseObject({
  products: z.array(productSchema).default([]),
  nextOffset: str,
});
export type SearchProducts = z.infer<typeof searchProductsSchema>;

const instamartCartItem = z.looseObject({
  spinId: str,
  skuId: str,
  itemName: str,
  itemVariant: str,
  quantity: num,
  isInStockAndAvailable: bool,
  mrp: num,
  discountedFinalPrice: num,
});

export const instamartCartSchema = z.looseObject({
  cartTotalAmount: str,
  items: z.array(instamartCartItem).default([]),
  billBreakdown: z
    .looseObject({
      lineItems: z.array(z.looseObject({ label: str, value: str })).default([]),
      toPay: z.looseObject({ label: str, value: str }).nullish(),
    })
    .nullish(),
  unserviceableItems: z.array(instamartCartItem).nullish(),
  removedOutOfStockItems: z.array(instamartCartItem).nullish(),
  reducedQuantityItems: z
    .array(z.looseObject({ spinId: str, itemName: str, requestedQuantity: num, cappedQuantity: num, reason: str }))
    .nullish(),
  addressWarning: str,
  cartWarning: z.looseObject({ statusCode: num, message: str }).nullish(),
  cartAbsent: bool,
  cartAbsentReason: str,
});
export type InstamartCart = z.infer<typeof instamartCartSchema>;
