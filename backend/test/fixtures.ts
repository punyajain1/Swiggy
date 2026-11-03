import type { Recipe } from "../src/ai/tasks.js";
import { searchMenuSchema, searchProductsSchema, searchRestaurantsSchema } from "../src/swiggy/schemas.js";

// Saved-response style fixtures shaped like the documented Swiggy MCP payloads.

export const recipe: Recipe = {
  ingredients: [
    { name: "Chicken", qty: 500, unit: "g", searchQuery: "boneless chicken", isStaple: false },
    { name: "Fresh Cream", qty: 200, unit: "ml", searchQuery: "fresh cream", isStaple: false },
    { name: "Salt", qty: 10, unit: "g", searchQuery: "salt", isStaple: true },
  ],
  prepMin: 20,
  cookMin: 35,
  activeMin: 40,
  difficulty: 3,
  yieldServings: 4,
  steps: ["Marinate the chicken", "Cook the gravy", "Add cream and simmer"],
};

const variation = (spinId: string, qty: string, price: number, extra: Record<string, unknown> = {}) => ({
  spinId,
  skuId: `sku_${spinId}`,
  quantityDescription: qty,
  displayName: qty,
  brandName: "Brand",
  price: { mrp: price + 20, offerPrice: price },
  isInStockAndAvailable: true,
  sla: { value: "12", unit: "MINS" },
  ...extra,
});

const product = (displayName: string, variations: unknown[]) => ({
  displayName,
  brand: "Brand",
  inStock: true,
  isAvail: true,
  productId: displayName,
  parentProductId: displayName,
  variations,
});

export const instamartCatalog: Record<string, unknown> = {
  "boneless chicken": {
    nextOffset: "0",
    products: [
      product("Chicken Masala", [variation("cm", "100 g", 50)]),
      product("Fresh Chicken Boneless", [
        variation("c450", "450 g", 200),
        variation("c1k", "1 kg", 380),
        variation("cOOS", "500 g", 150, { isInStockAndAvailable: false }),
      ]),
    ],
  },
  "fresh cream": { nextOffset: "0", products: [product("Amul Fresh Cream", [variation("cr", "200 ml", 65)])] },
  salt: { nextOffset: "0", products: [product("Tata Salt", [variation("s", "1 kg", 28)])] },
};

export const searchProducts = (catalog: Record<string, unknown> = instamartCatalog) => async (query: string) =>
  searchProductsSchema.parse(catalog[query] ?? { nextOffset: "0", products: [] });

export const restaurantsResponse = () =>
  searchRestaurantsSchema.parse({
    query: "Butter Chicken",
    restaurants: [
      { id: "r1", name: "Punjabi Tadka", cuisines: ["North Indian"], avgRating: 4.4, totalRatings: "8.2K+", deliveryTimeMinutes: 32, distanceKm: 2.1, offer: "20% OFF", availabilityStatus: "OPEN" },
      { id: "r2", name: "Closed Dhaba", cuisines: [], avgRating: 4.6, availabilityStatus: "CLOSED" },
      { id: "r3", name: "Curry House", cuisines: [], avgRating: 4.0, totalRatings: "500+", deliveryTimeMinutes: 45, availabilityStatus: "OPEN" },
    ],
    dishes: [],
  });

export const menuPage1 = () =>
  searchMenuSchema.parse({
    query: "Butter Chicken",
    totalItems: 6,
    hasMore: true,
    nextOffset: 20,
    items: [
      {
        name: "Butter Chicken",
        price: 320,
        menu_item_id: "m1",
        inStock: 1,
        restaurant_id: "r1",
        restaurant_name: "Punjabi Tadka",
        rating: 4.5,
        totalRatings: "1.2K",
        hasVariants: true,
        variantsV2: [
          {
            groupId: "g1",
            name: "Size",
            variations: [
              { id: "v1", name: "Half", price: 220, default: 0 },
              { id: "v2", name: "Full", price: 320, default: 1 },
            ],
          },
        ],
      },
      { name: "Butter Chicken", price: 280, menu_item_id: "m2", restaurant_id: "r2", restaurant_name: "Closed Dhaba" },
      { name: "Butter Chicken Pizza", price: 299, menu_item_id: "m3", restaurant_id: "r3", restaurant_name: "Curry House" },
      {
        name: "Butter Chicken",
        price: 300,
        menu_item_id: "m4",
        restaurant_id: "r3",
        restaurant_name: "Curry House",
        hasVariants: true,
        variations: [{ id: "x1", groupId: "G", name: "Regular", price: 300, default: 1 }],
      },
      { name: "Butter Chicken", price: 250, menu_item_id: "m5", inStock: 0, restaurant_id: "r1", restaurant_name: "Punjabi Tadka" },
    ],
  });

export const menuPage2 = () =>
  searchMenuSchema.parse({
    query: "Butter Chicken",
    hasMore: false,
    items: [{ name: "Butter Chicken", price: 350, menu_item_id: "m6", restaurant_id: "r4", restaurant_name: "Far Away Kitchen" }],
  });

/** Fake matchDishes: everything except pizza is the dish; a curry unit feeds 2, a bread piece 0.5. */
export const matchDishesHandler = (opts: { user: string }) => {
  const { items } = JSON.parse(opts.user) as { items: Array<{ index: number; name: string; role: string }> };
  return {
    items: items.map((i) => ({ index: i.index, isDish: !/pizza/i.test(i.name), servesPerUnit: i.role === "bread" ? 0.5 : 2 })),
  };
};

// ---------- A meal: Dal Makhani with Butter Naan ----------

export const mealRestaurants = () =>
  searchRestaurantsSchema.parse({
    restaurants: [
      { id: "rA", name: "Dhaba", avgRating: 4.3, totalRatings: "5K+", deliveryTimeMinutes: 30, availabilityStatus: "OPEN" },
      { id: "rB", name: "Curry Hub", avgRating: 4.1, totalRatings: "2K+", deliveryTimeMinutes: 40, availabilityStatus: "OPEN" },
      { id: "rC", name: "Naan Stop", avgRating: 4.6, totalRatings: "900", deliveryTimeMinutes: 25, availabilityStatus: "OPEN" },
    ],
    dishes: [],
  });

const menuItem = (name: string, price: number, id: string, rid: string, rname: string) => ({
  name,
  price,
  menu_item_id: id,
  restaurant_id: rid,
  restaurant_name: rname,
});

/**
 * Cross-restaurant search: Dhaba has both dishes, Curry Hub shows only dal, Naan Stop only naan.
 * Searching inside Curry Hub finds its naan; Naan Stop has no dal.
 */
export const mealMenu = async (query: string, _addressId: string, _offset?: number, restaurantId?: string) => {
  if (restaurantId === "rB" && query === "Butter Naan") return searchMenuSchema.parse({ items: [menuItem("Butter Naan", 55, "bN", "rB", "Curry Hub")] });
  if (restaurantId) return searchMenuSchema.parse({ items: [] });
  if (query === "Dal Makhani") {
    return searchMenuSchema.parse({
      items: [menuItem("Dal Makhani", 240, "aD", "rA", "Dhaba"), menuItem("Dal Makhani", 260, "bD", "rB", "Curry Hub")],
    });
  }
  if (query === "Butter Naan") {
    return searchMenuSchema.parse({
      items: [menuItem("Butter Naan", 50, "aN", "rA", "Dhaba"), menuItem("Butter Naan", 45, "cN", "rC", "Naan Stop")],
    });
  }
  return searchMenuSchema.parse({ items: [] });
};

/** Fake pickProducts: chicken -> the plain chicken (index 1), cream -> index 0. */
export const pickProductsHandler = () => ({
  picks: [
    { ingredient: "Chicken", candidateIndex: 1 },
    { ingredient: "Fresh Cream", candidateIndex: 0 },
  ],
});
