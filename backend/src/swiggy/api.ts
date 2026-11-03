import { callTool, callToolText, type CallToolDeps } from "./callTool.js";
import { parseDineoutSearchText, parseDineoutSlotsText } from "./textParsers.js";
import {
  addressesSchema,
  discoverEventsSchema,
  eventDetailsSchema,
  eventShowsSchema,
  eventsCollectionSchema,
  foodCartSchema,
  instamartCartSchema,
  searchMenuSchema,
  searchProductsSchema,
  searchEventsSchema,
  searchRestaurantsSchema,
  type Addresses,
  type DineoutSearch,
  type DineoutSlots,
  type DiscoverEvents,
  type EventDetails,
  type EventShows,
  type EventsCollection,
  type FoodCart,
  type InstamartCart,
  type SearchMenu,
  type SearchEvents,
  type SearchProducts,
  type SearchRestaurants,
} from "./schemas.js";

export interface LatLng {
  lat: number;
  lng: number;
}

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

  // ----- Dineout (read-only) -----

  /** `query` is one term (a cuisine, area, kind of place or vibe), not a sentence. Answers in text, parsed here. */
  searchDineout(query: string, at: LatLng, limit = 30): Promise<DineoutSearch> {
    return callToolText(
      this.deps,
      "dineout",
      "search_restaurants_dineout",
      { query, latitude: at.lat, longitude: at.lng, limit },
      parseDineoutSearchText,
    );
  }

  /** Meal service hours and free/paid deals for up to 7 days from `date` (YYYY-MM-DD). Answers in text, parsed here. */
  getDineoutSlots(restaurantId: string, date: string, at: LatLng): Promise<DineoutSlots> {
    return callToolText(
      this.deps,
      "dineout",
      "get_available_slots",
      { restaurantId, date, latitude: at.lat, longitude: at.lng },
      parseDineoutSlotsText,
    );
  }

  // ----- Scenes (read-only) -----

  discoverEvents(at: LatLng): Promise<DiscoverEvents> {
    return callTool(this.deps, "scenes", "discover_events", { latitude: at.lat, longitude: at.lng }, discoverEventsSchema);
  }

  getEventsCollection(collectionIdentifier: string, at: LatLng): Promise<EventsCollection> {
    return callTool(
      this.deps,
      "scenes",
      "get_events_collection",
      { collectionIdentifier, latitude: at.lat, longitude: at.lng },
      eventsCollectionSchema,
    );
  }

  /** Matches across every city, each with a "Locality, City" string, so callers filter by place. */
  searchEvents(query: string, at: LatLng): Promise<SearchEvents> {
    return callTool(this.deps, "scenes", "search_events", { query, latitude: at.lat, longitude: at.lng }, searchEventsSchema);
  }

  /** The only source of an event's venueId and venue coordinates. */
  getEventDetails(eventId: string, at: LatLng): Promise<EventDetails> {
    return callTool(this.deps, "scenes", "get_event_details", { eventId, latitude: at.lat, longitude: at.lng }, eventDetailsSchema);
  }

  /** Shows of one event at one venue. The window is a hint: Swiggy can return shows outside it, so callers filter. */
  listEventShows(eventId: string, venueId: string, at: LatLng, window: { start: string; end: string }): Promise<EventShows> {
    return callTool(
      this.deps,
      "scenes",
      "list_event_shows",
      { eventId, venueId, latitude: at.lat, longitude: at.lng, showStartTime: window.start, showEndTime: window.end },
      eventShowsSchema,
    );
  }
}
