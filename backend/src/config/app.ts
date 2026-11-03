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
  sidequest: {
    /** Used when the user doesn't say how long they have. */
    defaultHours: 4,
    minHours: 2,
    maxHours: 8,
    /** With no start time given, the quest starts at the next half hour, but not before this hour (IST). */
    earliestDefaultStartHour: 18,
    /** Events shortlisted by Groq before their show times are checked. */
    maxEventsToCheck: 6,
    /** Events whose details (venue, next date) are looked up before show times are fetched for the best of them. */
    maxEventDetailChecks: 12,
    /** search_events queries per quest: the request's genres, then these. */
    eventSearchFallbacks: ["live", "comedy", "music"],
    maxEventSearches: 6,
    /** Events farther than this from the city centre are dropped. */
    maxEventDistanceKm: 60,
    eventDefaultDurationMin: 90,
    /** An event must start at least this long before the quest ends to be worth going to. */
    eventMinRemainingMin: 60,
    dinnerDurationMin: 75,
    /** Rough time between two stops in the city. Shown as an estimate. */
    travelMin: 30,
    /** Time to get home after the last stop, when the late-night food arrives. */
    homeTravelMin: 30,
    lateNightDurationMin: 30,
    maxDineoutResults: 30,
    /** Broader Dineout searches tried when the chosen ones find too few restaurants. */
    dineoutFallbackQueries: ["restaurant", "cafe", "North Indian"],
    /** Used for budgeting when a restaurant lists no cost for two. Labelled "est." in the UI. */
    defaultCostForTwo: 1000,
    maxLateNightCravings: 2,
    maxLateNightOptions: 4,
    /** Dineout shows no rating counts, so labels rest on the rating and the price only. */
    topRatedMin: 4.5,
    goodValueMinRating: 4.2,
    goodValueMaxCostForTwo: 1200,
    badgeBonus: 0.04,
    /** Quality for a restaurant with no rating. */
    unratedQuality: 0.7,
    /** Searches run until this many distinct restaurants are found. */
    minDinnerCandidates: 12,
    /** Dinner farther than this from the event (or the area) loses score. */
    comfortableDistanceKm: 5,
    /** Score weights for choosing the plan. `activity` is per idea, scaled by its fit. */
    weights: { event: 0.35, dinner: 0.35, lateNight: 0.2, activity: 0.08, supplies: 0.15 },
    /**
     * Score lost when a kind of stop is left out. Swiggy's services come first: every one of them is
     * meant to appear when it fits, and free-form ideas only fill the gaps.
     */
    missingPenalty: { event: 0.25, dinner: 0.25, lateNight: 0.15, activity: 0.02, supplies: 0.1 },
    /** A shared late-night order (one portion per two people) is scored a little below full portions. */
    sharedPortionQuality: 0.93,
    /** Most stops in one quest, so it stays an evening and not a to-do list. */
    maxStops: 5,
    /** Most free-form ideas in one quest. */
    maxActivities: 2,
    /** Ideas Groq proposes that are kept as candidates. */
    maxActivityCandidates: 4,
    /** Time at home to receive an Instamart order and get ready. */
    suppliesDurationMin: 20,
    maxSupplyItems: 6,
    /** A kit item dearer than this is skipped (a quest kit is snacks and props, not a shopping trip). */
    maxSupplyItemPriceRs: 250,
    /** With a budget, the Instamart kit (items and fees) is trimmed to at most this share of it. */
    maxSuppliesBudgetShare: 0.15,
    /** Packs of this many or more units are skipped ("Pack of 48"). */
    bulkPackUnits: 6,
    /** An Instamart order needs at least this share of its items found to be worth showing. */
    suppliesMinFoundShare: 0.5,
    /** Going over budget costs this much score, plus `overBudgetPerShare` per 100% over. */
    overBudgetBase: 0.2,
    overBudgetPerShare: 0.6,
    /** Table slots this close to the planned dinner time count as a match. */
    slotMatchWindowMin: 45,
    searchConcurrency: 4,
  },
} as const;

export type AppConfig = typeof appConfig;
