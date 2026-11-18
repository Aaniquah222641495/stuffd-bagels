// Collection rules (founder 2026-11-16, client 2026-11-18). ONE copy, used by the page and by the Worker, so they cannot drift:
//  - Collections happen only on Saturdays. For now ONE a month by default: the LAST Saturday of the month.
//  - Orders for a Saturday open on the 15th of that Saturday's month (owner can change the day per Saturday;
//    a Saturday early in the month opens on the 15th of the month before, since it closes before the 15th)
//    at 00:00 South African time, and close on the Wednesday before at the cut-off time (default 23:59, owner-editable).
//    The cut-off minute itself: with 23:59, an order at 23:59:30 Wednesday is accepted and the first refused
//    moment is Thursday 00:00:00 (all South African time).
//  - The owner can add Saturdays (addedSaturdays) and take default ones off (removedSaturdays). There is no
//    "weeks ahead" setting any more: the list itself says what can be ordered. Closed dates still win.
const SAST_MS = 2 * 3600 * 1000;
const DAY_MS = 86400000;

export const DEFAULT_CUTOFF = "23:59";
/** How many months ahead (counting this one) the default last-Saturday list is generated for. */
export const DEFAULT_MONTHS_AHEAD = 6;
/** The day of the month orders open by default. */
export const DEFAULT_OPEN_DAY = 15;

export interface CollectionRules {
  /** "HH:MM", 24-hour, SAST. */
  cutoffTime: string;
  closedDates: string[];
  /** Saturdays the owner added on top of the default list (YYYY-MM-DD). */
  addedSaturdays?: string[];
  /** Default Saturdays the owner took off the list (YYYY-MM-DD). */
  removedSaturdays?: string[];
  /** Per-Saturday day orders open (YYYY-MM-DD, at 00:00 SAST). Missing = the 15th of that Saturday's month. */
  opensOn?: Record<string, string>;
}

export type SaturdayStatus = "ok" | "not_saturday" | "past" | "cutoff_passed" | "not_offered" | "not_open_yet" | "closed_date";

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

/** The last Saturday of a month (month is 1 to 12). */
export function lastSaturdayOfMonth(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const back = (lastDay.getUTCDay() + 1) % 7; // Saturday is 6: 0 days back if the month ends on one
  return new Date(lastDay.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The day orders for this Saturday open: the owner's choice, else the 15th of the Saturday's month. A Saturday early
 * in the month (one the owner added) would close before the 15th, so then it is the 15th of the month before.
 */
export function opensOnFor(saturdayIso: string, rules: Pick<CollectionRules, "opensOn">): string {
  const own = rules.opensOn?.[saturdayIso];
  if (own && /^\d{4}-\d{2}-\d{2}$/.test(own)) return own;
  const pad = String(DEFAULT_OPEN_DAY).padStart(2, "0");
  const sameMonth = `${saturdayIso.slice(0, 8)}${pad}`;
  if (sameMonth <= cutoffDay(saturdayIso)) return sameMonth;
  const prev = new Date(Date.UTC(Number(saturdayIso.slice(0, 4)), Number(saturdayIso.slice(5, 7)) - 2, DEFAULT_OPEN_DAY));
  return prev.toISOString().slice(0, 10);
}

/** Every Saturday that is on the list from today on (soonest first): default last Saturdays plus added, minus removed. */
export function collectionSaturdays(now: number, rules: CollectionRules): string[] {
  const today = sastDay(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const set = new Set<string>();
  for (let k = 0; k < DEFAULT_MONTHS_AHEAD; k++) {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    set.add(lastSaturdayOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  for (const a of rules.addedSaturdays ?? []) set.add(a);
  for (const r of rules.removedSaturdays ?? []) set.delete(r);
  return [...set].filter((iso) => iso >= today && isSaturday(iso)).sort();
}

export function saturdayStatus(iso: string, now: number, rules: CollectionRules): SaturdayStatus {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(dayStartUtc(iso)) || !isSaturday(iso)) return "not_saturday";
  const today = sastDay(now);
  if (iso < today) return "past";
  if (now >= cutoffInstant(iso, rules.cutoffTime)) return "cutoff_passed";
  if (!collectionSaturdays(now, rules).includes(iso)) return "not_offered";
  if (today < opensOnFor(iso, rules)) return "not_open_yet";
  if (rules.closedDates.includes(iso)) return "closed_date";
  return "ok";
}

/** Saturdays a customer can order for right now, soonest first. */
export function availableSaturdays(now: number, rules: CollectionRules): string[] {
  return collectionSaturdays(now, rules).filter((iso) => saturdayStatus(iso, now, rules) === "ok");
}

/** The next listed Saturday that is not open for orders yet, with the day it opens. */
export function nextOpening(now: number, rules: CollectionRules): { saturday: string; opens: string } | null {
  for (const iso of collectionSaturdays(now, rules)) {
    if (saturdayStatus(iso, now, rules) === "not_open_yet") return { saturday: iso, opens: opensOnFor(iso, rules) };
  }
  return null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Saturday 28 Nov": the same wording on the page, in the emails and in the notes below. */
export function niceDay(iso: string): string {
  const d = new Date(dayStartUtc(iso));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Orders for Saturday 26 Dec open on Tuesday 15 Dec.", or "" when there is nothing to say. */
export function openingNote(now: number, rules: CollectionRules): string {
  const next = nextOpening(now, rules);
  return next ? `Orders for ${niceDay(next.saturday)} open on ${niceDay(next.opens)}.` : "";
}

/**
 * Cancellation and no-show wording, DRAFT from the client's rule (2026-11-18: credit, not refunds).
 * Pending dp-counsel review (CPA s17, advance-booking cancellations). No credit expiry is stated because none has
 * been decided: ask the founder before adding one. Shown in the FAQ, above the order button, and in the order
 * auto-reply (apps-script/Code.gs keeps its own copy: keep them identical).
 */
export const CANCELLATION_POLICY =
  "If you cancel before the Wednesday cut-off, or you pay and don't collect, your order becomes credit for another collection Saturday or one of our markets (credit, not a refund).";
