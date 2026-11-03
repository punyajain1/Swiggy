import type { LatLng } from "../swiggy/api.js";

interface City {
  name: string;
  aliases: string[];
  center: LatLng;
}

/**
 * City centres for the places Swiggy Dineout and Scenes cover. Dineout needs coordinates
 * and Swiggy addresses don't carry them, so the city named in the request is looked up here.
 */
const CITIES: City[] = [
  { name: "Delhi", aliases: ["new delhi", "delhi ncr", "ncr"], center: { lat: 28.6139, lng: 77.209 } },
  { name: "Gurugram", aliases: ["gurgaon"], center: { lat: 28.4595, lng: 77.0266 } },
  { name: "Noida", aliases: ["greater noida"], center: { lat: 28.5355, lng: 77.391 } },
  { name: "Mumbai", aliases: ["bombay"], center: { lat: 19.076, lng: 72.8777 } },
  { name: "Navi Mumbai", aliases: [], center: { lat: 19.033, lng: 73.0297 } },
  { name: "Thane", aliases: [], center: { lat: 19.2183, lng: 72.9781 } },
  { name: "Bengaluru", aliases: ["bangalore", "blr"], center: { lat: 12.9716, lng: 77.5946 } },
  { name: "Hyderabad", aliases: ["secunderabad"], center: { lat: 17.385, lng: 78.4867 } },
  { name: "Chennai", aliases: ["madras"], center: { lat: 13.0827, lng: 80.2707 } },
  { name: "Kolkata", aliases: ["calcutta"], center: { lat: 22.5726, lng: 88.3639 } },
  { name: "Pune", aliases: [], center: { lat: 18.5204, lng: 73.8567 } },
  { name: "Ahmedabad", aliases: [], center: { lat: 23.0225, lng: 72.5714 } },
  { name: "Jaipur", aliases: [], center: { lat: 26.9124, lng: 75.7873 } },
  { name: "Chandigarh", aliases: ["mohali", "panchkula"], center: { lat: 30.7333, lng: 76.7794 } },
  { name: "Lucknow", aliases: [], center: { lat: 26.8467, lng: 80.9462 } },
  { name: "Kochi", aliases: ["cochin"], center: { lat: 9.9312, lng: 76.2673 } },
  { name: "Goa", aliases: ["panaji", "panjim"], center: { lat: 15.4909, lng: 73.8278 } },
  { name: "Indore", aliases: [], center: { lat: 22.7196, lng: 75.8577 } },
  { name: "Surat", aliases: [], center: { lat: 21.1702, lng: 72.8311 } },
  { name: "Coimbatore", aliases: [], center: { lat: 11.0168, lng: 76.9558 } },
  { name: "Bhubaneswar", aliases: [], center: { lat: 20.2961, lng: 85.8245 } },
  { name: "Visakhapatnam", aliases: ["vizag"], center: { lat: 17.6868, lng: 83.2185 } },
  { name: "Nagpur", aliases: [], center: { lat: 21.1458, lng: 79.0882 } },
  { name: "Mysuru", aliases: ["mysore"], center: { lat: 12.2958, lng: 76.6394 } },
  { name: "Thiruvananthapuram", aliases: ["trivandrum"], center: { lat: 8.5241, lng: 76.9366 } },
  { name: "Bhopal", aliases: [], center: { lat: 23.2599, lng: 77.4126 } },
  { name: "Vadodara", aliases: ["baroda"], center: { lat: 22.3072, lng: 73.1812 } },
  { name: "Ludhiana", aliases: [], center: { lat: 30.901, lng: 75.8573 } },
  { name: "Dehradun", aliases: [], center: { lat: 30.3165, lng: 78.0322 } },
];

/** An area's coordinates are trusted only this close to the city centre. */
const MAX_AREA_DISTANCE_KM = 40;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export function findCity(name: string | null | undefined): City | undefined {
  if (!name) return undefined;
  const n = normalize(name);
  return CITIES.find((c) => normalize(c.name) === n || c.aliases.includes(n));
}

/** The first known city mentioned anywhere in a piece of text, e.g. a saved address line. */
export function cityInText(text: string | null | undefined): City | undefined {
  if (!text) return undefined;
  const words = ` ${normalize(text)} `;
  return CITIES.find((c) => [c.name, ...c.aliases].some((a) => words.includes(` ${normalize(a)} `)));
}

/** Neighbouring cities that count as part of the same metro for event searches. */
const METRO_EXTRAS: Record<string, string[]> = {
  Delhi: ["noida", "greater noida", "gurgaon", "gurugram", "ghaziabad", "faridabad", "new delhi"],
  Mumbai: ["navi mumbai", "thane", "bombay"],
  Bengaluru: ["bangalore"],
  Hyderabad: ["secunderabad"],
};

/** Words that put a "Locality, City" string in the same metro as `cityName`. */
export function regionTerms(cityName: string): string[] {
  const city = findCity(cityName);
  const base = city ? [city.name, ...city.aliases] : [cityName];
  return [...new Set([...base, ...(METRO_EXTRAS[city?.name ?? cityName] ?? [])].map(normalize))];
}

/** True when a Scenes location like "Sector 18, Noida" belongs to the metro of `cityName`. */
export function locationInRegion(location: string | null | undefined, cityName: string): boolean {
  if (!location) return false;
  const words = ` ${normalize(location)} `;
  return regionTerms(cityName).some((t) => words.includes(` ${t} `));
}

export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const inIndia = (p: LatLng) => p.lat >= 6 && p.lat <= 37.5 && p.lng >= 68 && p.lng <= 97.5;

export interface ResolvedPlace {
  city: string;
  area: string | null;
  center: LatLng;
  /** Set when the area's coordinates were rejected and the city centre is used instead. */
  areaIgnored: boolean;
}

/**
 * Picks the search coordinates. City coordinates come from the table above. Area coordinates
 * come from Groq and are used only if they land near that city; otherwise the city centre is used.
 * A city that isn't in the table is accepted with Groq's coordinates if they are inside India.
 */
export function resolvePlace(input: {
  city: string | null;
  area: string | null;
  areaLocation: LatLng | null;
  cityLocation: LatLng | null;
  fallbackText: string | null;
}): ResolvedPlace | undefined {
  const known = findCity(input.city) ?? (input.city ? undefined : cityInText(input.fallbackText));
  let city: { name: string; center: LatLng } | undefined = known;
  if (!city && input.city && input.cityLocation && inIndia(input.cityLocation)) {
    city = { name: input.city, center: input.cityLocation };
  }
  if (!city) return undefined;

  if (input.area && input.areaLocation && inIndia(input.areaLocation)) {
    if (distanceKm(city.center, input.areaLocation) <= MAX_AREA_DISTANCE_KM) {
      return { city: city.name, area: input.area, center: input.areaLocation, areaIgnored: false };
    }
    return { city: city.name, area: input.area, center: city.center, areaIgnored: true };
  }
  return { city: city.name, area: input.area, center: city.center, areaIgnored: Boolean(input.area) };
}

/** "₹1,200 for two" -> 1200, "₹499 onwards" -> 499, "Free" -> 0. Null when there's no price. */
export function firstAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (/\bfree\b/i.test(value)) return 0;
  const m = /\d[\d,]*(?:\.\d+)?/.exec(value);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "2.3 km" -> 2.3, "800 m" -> 0.8. */
export function parseDistanceKm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /(\d+(?:\.\d+)?)\s*(km|m)\b/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "m" ? n / 1000 : n;
}
