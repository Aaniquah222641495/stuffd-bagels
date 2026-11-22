// Collection rules (founder 2026-11-16, client 2026-11-18). ONE copy, used by the page and by the Worker, so they cannot drift:
//  - Collections happen only on Saturdays. For now ONE a month by default: the LAST Saturday of the month.
//  - Orders for a Saturday open on the 15th of that Saturday's month (owner can change the day per Saturday;
//    a Saturday early in the month opens on the 15th of the month before, since it closes before the 15th)
//    at 00:00 South African time, and close on the Wednesday before at the cut-off time (default 23:59, owner-editable).
//    The cut-off minute itself: with 23:59, an order at 23:59:30 Wednesday is accepted and the first refused
//    moment is Thursday 00:00:00 (all South African time).
//  - A default Saturday is skipped when a market (an event) covers that Saturday or its Sunday: with a market on, there
//    is usually no collection that month. The owner can put it back (keptSaturdays). A Saturday the owner adds by hand
//    is never skipped (admin shows a warning instead), and neither is one already open for orders when a market is added.
//  - The owner can add Saturdays (addedSaturdays) and take default ones off (removedSaturdays). There is no
//    "weeks ahead" setting any more: the list itself says what can be ordered. Closed dates still win.
import type { MarketEvent } from "./content";

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
  /** Default Saturdays the owner put back after they were skipped for a market (YYYY-MM-DD). */
  keptSaturdays?: string[];
  /** Markets (start and end inclusive). A default Saturday is skipped if one covers it or its Sunday. */
  events?: { name: string; start: string; end: string }[];
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
  return wednesdayCutoffInstant(cutoffDay(saturdayIso), cutoffTime);
}

/** The first refused instant for a given Wednesday (YYYY-MM-DD): the end of its cut-off minute, South African time. */
function wednesdayCutoffInstant(wednesdayIso: string, cutoffTime: string): number {
  const [h, m] = cutoffTime.split(":").map(Number);
  return dayStartUtc(wednesdayIso) + (h * 60 + m + 1) * 60000 - SAST_MS;
}

/** The Wednesday (YYYY-MM-DD) that orders for this Saturday close on. */
export function cutoffDay(saturdayIso: string): string {
  return new Date(dayStartUtc(saturdayIso) - 3 * DAY_MS).toISOString().slice(0, 10);
}

/**
 * SB-20: the Wednesday pre-orders for a market close on: the latest Wednesday STRICTLY before its first day (a Wednesday start
 * closes the Wednesday a week earlier, a Thursday start the day before). Never free-typed, so "Wednesday cut-off" stays true.
 */
export function marketCutoffDay(startIso: string): string {
  let t = dayStartUtc(startIso) - DAY_MS;
  while (new Date(t).getUTCDay() !== 3) t -= DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** The first instant pre-orders for this market are refused (and the first instant a customer can no longer self-cancel). */
export function marketCutoffInstant(startIso: string, cutoffTime: string): number {
  return wednesdayCutoffInstant(marketCutoffDay(startIso), cutoffTime);
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

/** Name of a market covering this Saturday or the Sunday after it, or "" when there is none. */
export function marketClash(saturdayIso: string, events: CollectionRules["events"]): string {
  const sunday = new Date(dayStartUtc(saturdayIso) + DAY_MS).toISOString().slice(0, 10);
  const hit = (events ?? []).find((e) => (e.start <= saturdayIso && saturdayIso <= e.end) || (e.start <= sunday && sunday <= e.end));
  return hit ? hit.name : "";
}

/** The built-in last Saturdays from today on, before any owner change and before market skipping. */
function defaultSaturdays(now: number): string[] {
  const today = sastDay(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let k = 0; k < DEFAULT_MONTHS_AHEAD; k++) {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    const iso = lastSaturdayOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
    if (iso >= today) out.push(iso);
  }
  return out;
}

/** Default Saturdays skipped because of a market and not put back or removed: the admin shows these. */
export function skippedSaturdays(now: number, rules: CollectionRules): { date: string; event: string }[] {
  const out: { date: string; event: string }[] = [];
  for (const iso of defaultSaturdays(now)) {
    const event = marketClash(iso, rules.events);
    if (event && !(rules.keptSaturdays ?? []).includes(iso) && !(rules.removedSaturdays ?? []).includes(iso)) out.push({ date: iso, event });
  }
  return out;
}

/** Warning for a Saturday that is on the list although a market covers its weekend (hand-added, put back or already open). */
export function saturdayWarning(saturdayIso: string, rules: CollectionRules): string {
  const event = marketClash(saturdayIso, rules.events);
  return event ? `${event} is on that weekend` : "";
}

/** Every Saturday that is on the list from today on (soonest first): default last Saturdays (minus market weekends) plus added, minus removed. */
export function collectionSaturdays(now: number, rules: CollectionRules): string[] {
  const today = sastDay(now);
  const set = new Set<string>();
  const kept = rules.keptSaturdays ?? [];
  for (const iso of defaultSaturdays(now)) if (!marketClash(iso, rules.events) || kept.includes(iso)) set.add(iso);
  for (const a of rules.addedSaturdays ?? []) set.add(a);
  for (const r of rules.removedSaturdays ?? []) set.delete(r);
  return [...set].filter((iso) => iso >= today && isSaturday(iso)).sort();
}

/**
 * Saturdays that must be kept when a market is added: default ones already open for orders that the new market
 * would otherwise skip (orders may already exist, so they are not removed, the admin just warns).
 */
export function saturdaysToKeep(now: number, rules: CollectionRules, newEvents: NonNullable<CollectionRules["events"]>): string[] {
  const before = new Set(collectionSaturdays(now, rules));
  const after = new Set(collectionSaturdays(now, { ...rules, events: [...(rules.events ?? []), ...newEvents] }));
  const today = sastDay(now);
  return [...before].filter((d) => !after.has(d) && today >= opensOnFor(d, rules));
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

// ---------------------------------------------------------------------------------------------
// Collection hours of a pickup point -> one-hour tap slots on the order form (preferred time).
// New points store "opens" and "closes" ("HH:MM", 24-hour). Older points only have free text in `days`
// ("Saturdays, 13:00 to 18:00 (times to be confirmed)"), so we read the hours out of that text when we can;
// if we cannot, the form simply has no time chips (the time is optional anyway).
// ---------------------------------------------------------------------------------------------
export interface PickupHoursSource {
  opens?: string;
  closes?: string;
  days?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "1pm", "1:30pm", "12pm", "12am". */
export function clockLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h24 < 12 ? "am" : "pm"}`;
}

/** Read "13:00 to 18:00", "1pm to 6pm", "10am-1pm" out of free text. null when it is not clear enough to trust. */
export function hoursFromText(text: string): { opens: string; closes: string } | null {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|-|\u2013)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (!m) return null;
  const [, h1, m1, ap1, h2, m2, ap2] = m;
  // Needs a colon or am/pm somewhere, or "2 to 5" (could be anything, or a date range) is not a time.
  if (!m1 && !m2 && !ap1 && !ap2) return null;
  const to24 = (h: string, mm: string | undefined, ap: string | undefined): number | null => {
    let hour = Number(h);
    if (hour > 24 || Number(mm ?? 0) > 59) return null;
    if (ap) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
    }
    return hour * 60 + Number(mm ?? 0);
  };
  const end = to24(h2, m2, ap2);
  let start = to24(h1, m1, ap1);
  if (end === null || start === null) return null;
  // "10-1pm": the start borrows the end's am/pm, or is am when that would run backwards.
  if (!ap1 && ap2 && start >= end) start -= 12 * 60;
  if (!ap1 && ap2 && start < 0) return null;
  if (start < 0 || end > 24 * 60 || end <= start) return null;
  const hh = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return { opens: hh(start), closes: end === 24 * 60 ? "23:59" : hh(end) };
}

/** Collection hours of a point: the structured fields, else whatever the free text says, else null. */
export function pickupHours(p: PickupHoursSource): { opens: string; closes: string } | null {
  if (p.opens && p.closes && HHMM.test(p.opens) && HHMM.test(p.closes) && toMin(p.closes) > toMin(p.opens)) {
    return { opens: p.opens, closes: p.closes };
  }
  return p.days ? hoursFromText(p.days) : null;
}

/** "1pm to 6pm". */
export function hoursLabel(h: { opens: string; closes: string }): string {
  return `${clockLabel(toMin(h.opens))} to ${clockLabel(toMin(h.closes))}`;
}

/** One-hour slots from opening to closing ("1pm to 2pm" ...). A last part-hour is left out. At most 12. */
export function timeSlots(p: PickupHoursSource): string[] {
  const h = pickupHours(p);
  if (!h) return [];
  const out: string[] = [];
  for (let t = toMin(h.opens); t + 60 <= toMin(h.closes) && out.length < 12; t += 60) out.push(`${clockLabel(t)} to ${clockLabel(t + 60)}`);
  return out;
}

/** The bracketed part of the free text ("(times to be confirmed)") as a short sentence, so the caveat is not lost. */
export function hoursCaveat(days: string | undefined): string {
  const m = /\(([^)]{3,60})\)/.exec(days ?? "");
  return m ? `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}.` : "";
}

/** "Orders for Saturday 26 Dec open on Tuesday 15 Dec.", or "" when there is nothing to say. */
export function openingNote(now: number, rules: CollectionRules): string {
  const next = nextOpening(now, rules);
  if (!next) return "";
  const newYear = next.saturday.slice(0, 4) > sastDay(now).slice(0, 4) ? " Back in the new year." : "";
  return `Orders for ${niceDay(next.saturday)} open on ${niceDay(next.opens)}.${newYear}`;
}

/**
 * Cancellation and no-show wording: dp-counsel option 1a (counsel-review-2026-11-19.md s1), approved by the founder 2026-11-19.
 * Refund or credit before the cut-off; credit only after it or for a no-show; credit valid 6 months (CPA s17).
 * Shown in the FAQ, above the order button, and in the order
 * auto-reply (apps-script/Code.gs keeps its own copy: keep them identical).
 */
export const CANCELLATION_POLICY =
  "If you cancel before the Wednesday cut-off, you can choose a refund or credit. If you cancel after the cut-off, or you pay and don't collect, your order becomes credit for another collection day or one of our markets, valid for 6 months from your original collection day. Credit is not paid out as cash.";

// ---------------------------------------------------------------------------------------------
// SB-20: market pre-orders. Same pay-first flow as a Saturday; the customer picks ONE market day and collects at the stall.
// One copy of the rules, used by the page and the Worker. The owner's master switch (orders on/off) is checked by the caller.
// ---------------------------------------------------------------------------------------------
export type MarketDayStatus = "ok" | "not_enabled" | "not_a_day" | "past" | "cutoff_passed" | "not_open_yet" | "closed_date";
export type MarketState = "off" | "not_open_yet" | "open" | "closed";
type MarketLike = Pick<MarketEvent, "start" | "end" | "preorder">;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when the toggle is on AND the market has usable stall hours and at least one day (the Worker refuses a save without them). */
export function preorderConfigured(m: MarketLike): boolean {
  const p = m.preorder;
  return !!p && p.enabled === true && HHMM_RE.test(p.opens) && HHMM_RE.test(p.closes) && p.closes > p.opens
    && p.days.some((d) => d >= m.start && d <= m.end);
}

/** The days inside the market that the owner ticked, soonest first. */
export function marketPreorderDays(m: MarketLike): string[] {
  return (m.preorder?.days ?? []).filter((d) => d >= m.start && d <= m.end).sort();
}

export function marketDayStatus(iso: string, now: number, m: MarketLike, rules: Pick<CollectionRules, "cutoffTime" | "closedDates">): MarketDayStatus {
  if (!preorderConfigured(m)) return "not_enabled";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(dayStartUtc(iso)) || !marketPreorderDays(m).includes(iso)) return "not_a_day";
  const today = sastDay(now);
  if (iso < today) return "past";
  if (now >= marketCutoffInstant(m.start, rules.cutoffTime)) return "cutoff_passed";
  const opens = m.preorder?.opensOn;
  if (opens && today < opens) return "not_open_yet";
  if (rules.closedDates.includes(iso)) return "closed_date";
  return "ok";
}

/** Market days a customer can order for right now. */
export function availableMarketDays(now: number, m: MarketLike, rules: Pick<CollectionRules, "cutoffTime" | "closedDates">): string[] {
  return marketPreorderDays(m).filter((d) => marketDayStatus(d, now, m, rules) === "ok");
}

/** What the page says about a market: off (walk-up only), waiting to open, open, or closed (cut-off passed). */
export function marketState(now: number, m: MarketLike, rules: Pick<CollectionRules, "cutoffTime" | "closedDates">): MarketState {
  if (!preorderConfigured(m)) return "off";
  if (now >= marketCutoffInstant(m.start, rules.cutoffTime)) return "closed";
  if (availableMarketDays(now, m, rules).length > 0) return "open";
  const opens = m.preorder?.opensOn;
  if (opens && sastDay(now) < opens && marketPreorderDays(m).some((d) => d >= sastDay(now) && !rules.closedDates.includes(d))) return "not_open_yet";
  return "off"; // every day is past or closed
}

/** Stall hours as "10am to 7pm", or "" when not set. */
export function marketHoursLabel(m: MarketLike): string {
  const p = m.preorder;
  return p && HHMM_RE.test(p.opens) && HHMM_RE.test(p.closes) && p.closes > p.opens ? hoursLabel({ opens: p.opens, closes: p.closes }) : "";
}
