/**
 * Tunable constants for fee estimates and scoring.
 * Fees are estimates only; real bills come from the Swiggy cart after "Fill cart".
 */
export const appConfig = {
  fees: {
    food: {
      deliveryFee: 40,
      gstRate: 0.05,
      platformFee: 10,
    },
    instamart: {
      handlingFee: 10,
      smallOrderDeliveryFee: 30,
      freeDeliveryThreshold: 199,
      /** Used when search results have no delivery SLA. */
      defaultDeliveryMin: 15,
    },
  },
  food: {
    /** Used when a restaurant has no deliveryTimeMinutes. Labelled "estimated" in the UI. */
    defaultDeliveryMin: 35,
    maxRestaurantOptions: 5,
    /** Menu items considered for a single-dish craving. */
    maxMenuItems: 40,
    /** Menu items considered per dish when the craving is a meal of several dishes. */
    maxMenuItemsPerDish: 25,
    /** Swiggy searches run at the same time. */
    searchConcurrency: 4,
    /** For a meal, restaurants that have part of it get a search inside their own menu for the missing dishes. */
    gapFillRestaurants: 6,
    /** Most restaurant-scoped searches used for those gap fills. */
    maxGapFillSearches: 12,
    /** Minutes of your time to place an order on Swiggy and receive it. */
    activeMinutesToOrder: 5,
  },
  cook: {
    searchConcurrency: 4,
    candidatesPerIngredient: 5,
    /** Active-time multiplier by skill level. */
    skillTimeFactor: { beginner: 1.3, average: 1.0, confident: 0.85 },
    /** Expected quality (0..1) of a home-cooked dish by skill level. */
    skillQuality: { beginner: 0.6, average: 0.75, confident: 0.9 },
    /** Rough per-ingredient price used when Instamart has no match. */
    fallbackIngredientCost: 60,
  },
  ratings: {
    /** Bayesian prior: the rating a restaurant is pulled toward. */
    priorMean: 4.0,
    /** Bayesian prior weight, in number of ratings. */
    priorWeight: 50,
    dishWeight: 0.6,
    restaurantWeight: 0.4,
  },
  score: {
    money: 0.4,
    timeEffort: 0.35,
    quality: 0.25,
    leftovers: 0.1,
    /** Split inside the time/effort term. */
    timeShare: 0.7,
    effortShare: 0.3,
    /** Inside the time sub-score: weight on active minutes vs wait until food is ready. */
    activeTimeShare: 0.6,
    /** Score multiplier applied to the time sub-score when the time limit is broken. */
    timeLimitPenalty: 0.4,
    /** Above this many minutes until food is ready, the "ready in" part of the time score reaches 0. */
    maxMinutes: 180,
    /** Hands-on time worth this many rupees (at your ₹/hour) or more scores 0 on the "active time" part. */
    timeValueCap: 500,
    /** Leftover servings that earn the full leftover bonus. */
    fullLeftoverServings: 2,
    /** An order with none of the meal would lose this share of its score; partial orders lose a proportional share. */
    missingDishPenalty: 0.5,
  },
  decisionCacheTtlMs: 30 * 60 * 1000,
} as const;

export type AppConfig = typeof appConfig;
