import { callTool, type CallToolDeps } from "./callTool.js";
import {
  addressesSchema,
  foodCartSchema,
  instamartCartSchema,
  searchMenuSchema,
  searchProductsSchema,
  searchRestaurantsSchema,
  type Addresses,
  type FoodCart,
  type InstamartCart,
  type SearchMenu,
  type SearchProducts,
  type SearchRestaurants,
} from "./schemas.js";

/** One variant choice for update_food_cart, paired with its customization group. */
export interface FoodVariantChoice {
  group_id: string;
  variation_id: string;
}

export interface FoodCartItemInput {
  menu_item_id: string;
  quantity: number;
  /** Legacy format: used when search_menu returned `variations`. */
  variants?: FoodVariantChoice[];
  /** New format: used when search_menu returned `variantsV2`. */
  variantsV2?: FoodVariantChoice[];
  addons?: unknown[];
}

export interface InstamartCartItemInput {
  spinId: string;
  skuId: string;
  quantity: number;
}

/** Typed wrappers for the Swiggy Food and Instamart tools this app uses. */
export class SwiggyApi {
  constructor(private readonly deps: CallToolDeps) {}

  // ----- Food -----

  getAddresses(page = 1): Promise<Addresses> {
    return callTool(this.deps, "food", "get_addresses", { page }, addressesSchema);
  }

  searchRestaurants(query: string, addressId: string, offset?: string | number): Promise<SearchRestaurants> {
    return callTool(
      this.deps,
      "food",
      "search_restaurants",
      { query, addressId, ...(offset !== undefined ? { offset: Number(offset) } : {}) },
      searchRestaurantsSchema,
    );
  }

  /** Searches dishes across restaurants, or inside one restaurant when `restaurantId` is given. */
  searchMenu(query: string, addressId: string, offset?: number, restaurantId?: string): Promise<SearchMenu> {
    return callTool(
      this.deps,
      "food",
      "search_menu",
      {
        query,
        addressId,
        ...(offset ? { offset } : {}),
        ...(restaurantId ? { restaurantIdOfAddedItem: restaurantId } : {}),
      },
      searchMenuSchema,
    );
  }

  updateFoodCart(input: {
    restaurantId: string;
    restaurantName?: string;
    addressId: string;
    cartItems: FoodCartItemInput[];
  }): Promise<FoodCart> {
    return callTool(this.deps, "food", "update_food_cart", { ...input }, foodCartSchema);
  }

  getFoodCart(addressId: string, restaurantName?: string): Promise<FoodCart> {
    return callTool(
      this.deps,
      "food",
      "get_food_cart",
      { addressId, ...(restaurantName ? { restaurantName } : {}) },
      foodCartSchema,
    );
  }

  // ----- Instamart -----

  searchProducts(query: string, addressId: string): Promise<SearchProducts> {
    return callTool(this.deps, "im", "search_products", { query, addressId }, searchProductsSchema);
  }

  updateInstamartCart(addressId: string, items: InstamartCartItemInput[]): Promise<InstamartCart> {
    return callTool(this.deps, "im", "update_cart", { selectedAddressId: addressId, items }, instamartCartSchema);
  }

  getInstamartCart(): Promise<InstamartCart> {
    return callTool(this.deps, "im", "get_cart", {}, instamartCartSchema);
  }
}
