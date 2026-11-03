/**
 * India Standard Time helpers. IST is UTC+5:30 all year (no daylight saving), so a fixed
 * offset is exact and the result doesn't depend on the server's time zone.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;
const MINUTE = 60_000;

function shifted(ms: number): Date {
  return new Date(ms + IST_OFFSET_MS);
}

/** "7:30 PM" */
export function istTimeLabel(ms: number): string {
  const d = shifted(ms);
  const h24 = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "2026-11-03", the IST calendar date. */
export function istDate(ms: number): string {
  return shifted(ms).toISOString().slice(0, 10);
}

/** Epoch ms of hour:minute IST on the same IST calendar day as `dayMs`. */
export function istAt(dayMs: number, hour: number, minute: number): number {
  const d = shifted(dayMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute) - IST_OFFSET_MS;
}

export function istHour(ms: number): number {
  return shifted(ms).getUTCHours();
}

/** Rounds up to the next multiple of `step` minutes. */
export function ceilToMinutes(ms: number, step: number): number {
  const stepMs = step * MINUTE;
  return Math.ceil(ms / stepMs) * stepMs;
}

export const addMinutes = (ms: number, min: number) => ms + min * MINUTE;
export const minutesBetween = (a: number, b: number) => Math.round((b - a) / MINUTE);

/**
 * When the quest starts.
 * - "19:30" from the user: today at 7:30 PM IST, or the next half hour if that's already past.
 * - Nothing: the next half hour, but not before `earliestHour` (an afternoon request plans the evening).
 */
export function questStart(nowMs: number, requested: string | null, earliestHour: number): number {
  const nextSlot = ceilToMinutes(addMinutes(nowMs, 15), 30);
  if (requested) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(requested.trim());
    if (m) {
      const at = istAt(nowMs, Number(m[1]), Number(m[2]));
      return at >= nowMs ? at : nextSlot;
    }
  }
  return Math.max(nextSlot, istAt(nowMs, earliestHour, 0));
}

/** Swiggy sends epochs in seconds or milliseconds depending on the tool. */
export function epochToMs(value: number): number {
  return value < 1e12 ? value * 1000 : value;
}

/** Minutes since midnight, IST. */
export function istMinuteOfDay(ms: number): number {
  const d = shifted(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 17 * 60 -> "5:00 PM". Minutes past 1440 wrap to the next day. */
export function minutesLabel(min: number): string {
  const wrapped = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(wrapped % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Epoch ms of midnight IST at the start of a "YYYY-MM-DD" date. */
export function istDayStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}
