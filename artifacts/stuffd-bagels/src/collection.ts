// Collection rules (founder 2026-11-16). ONE copy, used by the page and by the Worker, so they cannot drift:
//  - Collections happen only on Saturdays.
//  - Orders for a Saturday close on the Wednesday before, at the cut-off time (default 23:59, owner-editable).
//    The cut-off minute itself is still open: with 23:59, an order at 23:59:30 Wednesday is accepted and the
//    first refused moment is Thursday 00:00:00 (all South African time).
//  - A Saturday can't be more than `maxWeeksAhead` weeks (default 2: the client's paydays are the 15th and 25th) from today, and can't be a closed date.
// South Africa is UTC+2 all year (no daylight saving), so SAST is plain arithmetic on UTC milliseconds.
// Keep this file free of imports and of TypeScript-only runtime features: tests run it directly in Node.

const SAST_MS = 2 * 3600 * 1000;
const DAY_MS = 86400000;

export const DEFAULT_CUTOFF = "23:59";
export const DEFAULT_WEEKS_AHEAD = 2;
export const MAX_WEEKS_AHEAD = 12;

export interface CollectionRules {
  /** "HH:MM", 24-hour, SAST. */
  cutoffTime: string;
  maxWeeksAhead: number;
  closedDates: string[];
}

export type SaturdayStatus = "ok" | "not_saturday" | "past" | "cutoff_passed" | "too_far" | "closed_date";

export const isCutoffTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Today (or any instant) in South Africa as YYYY-MM-DD. */
export function sastDay(now: number): string {
  return new Date(now + SAST_MS).toISOString().slice(0, 10);
}

const dayStartUtc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export function isSaturday(iso: string): boolean {
  return new Date(dayStartUtc(iso)).getUTCDay() === 6;
}

/**
 * The first instant at which orders for this Saturday are refused: the end of the cut-off minute on the
 * Wednesday three days before. Date.UTC rolls month and year ends for us (Sat 1 Aug -> Wed 29 Jul).
 */
export function cutoffInstant(saturdayIso: string, cutoffTime: string): number {
  const [h, m] = cutoffTime.split(":").map(Number);
  const wedMidnightUtc = dayStartUtc(saturdayIso) - 3 * DAY_MS;
  return wedMidnightUtc + (h * 60 + m + 1) * 60000 - SAST_MS;
}

/** The Wednesday (YYYY-MM-DD) that orders for this Saturday close on. */
export function cutoffDay(saturdayIso: string): string {
  return new Date(dayStartUtc(saturdayIso) - 3 * DAY_MS).toISOString().slice(0, 10);
}

export function saturdayStatus(iso: string, now: number, rules: CollectionRules): SaturdayStatus {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(dayStartUtc(iso)) || !isSaturday(iso)) return "not_saturday";
  const today = sastDay(now);
  if (iso < today) return "past";
  if (now >= cutoffInstant(iso, rules.cutoffTime)) return "cutoff_passed";
  if (dayStartUtc(iso) - dayStartUtc(today) > rules.maxWeeksAhead * 7 * DAY_MS) return "too_far";
  if (rules.closedDates.includes(iso)) return "closed_date";
  return "ok";
}

/** Saturdays a customer can order for right now, soonest first. */
export function availableSaturdays(now: number, rules: CollectionRules): string[] {
  const out: string[] = [];
  const start = dayStartUtc(sastDay(now));
  for (let d = 0; d <= rules.maxWeeksAhead * 7; d++) {
    const iso = new Date(start + d * DAY_MS).toISOString().slice(0, 10);
    if (isSaturday(iso) && saturdayStatus(iso, now, rules) === "ok") out.push(iso);
  }
  return out;
}

/** The first Saturday on or after today (SAST), whether or not it can still be ordered for. */
export function nextCalendarSaturday(now: number): string {
  const start = dayStartUtc(sastDay(now));
  for (let d = 0; d < 7; d++) {
    const iso = new Date(start + d * DAY_MS).toISOString().slice(0, 10);
    if (isSaturday(iso)) return iso;
  }
  return sastDay(now);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Saturday 28 Nov": the same wording on the page, in the emails and in the notes below. */
export function niceDay(iso: string): string {
  const d = new Date(dayStartUtc(iso));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Plain-English reason the nearest Saturday is not offered, or "" when it is (or nothing to say). */
export function nearestSaturdayNote(now: number, rules: CollectionRules): string {
  const nearest = nextCalendarSaturday(now);
  const status = saturdayStatus(nearest, now, rules);
  const next = availableSaturdays(now, rules)[0];
  const tail = next ? ` You're ordering for ${niceDay(next)}.` : "";
  if (status === "cutoff_passed") return `Orders for this Saturday closed on Wednesday.${tail}`;
  if (status === "closed_date") return `We're closed on ${niceDay(nearest)}.${tail}`;
  return "";
}
