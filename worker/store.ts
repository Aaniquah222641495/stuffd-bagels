// Reads, validates and writes the two KV keys: `availability` and `events` (ADR-0028).
import { DEFAULT_CUTOFF, isCutoffTime, isSaturday, saturdaysToKeep } from "../artifacts/stuffd-bagels/src/collection";
import { EVENTS, type MarketEvent, type MarketPreorder } from "../artifacts/stuffd-bagels/src/content";
import { HttpError } from "./http";

export const LIMITS = {
  closedDates: 60,
  addedSaturdays: 24,
  removedSaturdays: 24,
  keptSaturdays: 24,
  events: 50,
  preorderDays: 14,
  name: 60,
  venue: 80,
  message: 160,
  pickups: 30,
  pickupName: 60,
  pickupArea: 120,
  pickupDays: 120,
};

export interface Availability {
  ordersEnabled: boolean;
  /** Closed dates: a Saturday listed here can't be collected on; today listed here pauses new orders. */
  closedDates: string[];
  closedMessage: string;
  /** Wednesday cut-off for the coming Saturday, "HH:MM" SAST (owner-editable). */
  cutoffTime: string;
  /**
   * Collection Saturdays. By default the last Saturday of each month (collection.ts). The owner adds Saturdays here,
   * takes default ones off, and can change the day orders open (default: the 15th). This replaces the old
   * "weeks ahead" setting; a stored maxWeeksAhead from before is ignored.
   */
  addedSaturdays: string[];
  removedSaturdays: string[];
  /** Default Saturdays put back after being skipped for a market (collection.ts). */
  keptSaturdays: string[];
  opensOn: Record<string, string>;
}

export interface PublicAvailability extends Availability {
  closedToday: boolean;
}

const OPEN: Availability = { ordersEnabled: true, closedDates: [], closedMessage: "", cutoffTime: DEFAULT_CUTOFF, addedSaturdays: [], removedSaturdays: [], keptSaturdays: [], opensOn: {} };

/** Today in Africa/Johannesburg (UTC+2, no daylight saving), as YYYY-MM-DD. */
export function sastToday(now = Date.now()): string {
  return new Date(now + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

export function secondsToSastMidnight(now = Date.now()): number {
  const sast = now + 2 * 3600 * 1000;
  const next = Math.floor(sast / 86400000 + 1) * 86400000;
  return Math.max(60, Math.ceil((next - sast) / 1000));
}

export function isRealDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

async function readKey(kv: KVNamespace, key: string): Promise<unknown | null> {
  const raw = await kv.get(key); // throws if KV is unavailable: callers decide what to do
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

const isSat = (x: unknown): x is string => isRealDate(x) && isSaturday(x);

/** Only real Saturdays as keys, real dates as values, an opening day never after its Saturday. */
function cleanOpensOn(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, d] of Object.entries(asRecord(v)).slice(0, LIMITS.addedSaturdays + LIMITS.removedSaturdays + 12)) {
    if (isSat(k) && isRealDate(d) && d <= k) out[k] = d;
  }
  return out;
}

/** Stored availability, with every field checked. Missing or odd values fall back to "open". */
export async function readAvailability(kv: KVNamespace): Promise<Availability> {
  const v = asRecord(await readKey(kv, "availability"));
  return {
    ordersEnabled: typeof v.ordersEnabled === "boolean" ? v.ordersEnabled : OPEN.ordersEnabled,
    closedDates: Array.isArray(v.closedDates) ? v.closedDates.filter(isRealDate).slice(0, LIMITS.closedDates) : [],
    closedMessage: typeof v.closedMessage === "string" ? v.closedMessage.slice(0, LIMITS.message) : "",
    cutoffTime: isCutoffTime(v.cutoffTime) ? v.cutoffTime : DEFAULT_CUTOFF,
    addedSaturdays: Array.isArray(v.addedSaturdays) ? v.addedSaturdays.filter(isSat).slice(0, LIMITS.addedSaturdays) : [],
    removedSaturdays: Array.isArray(v.removedSaturdays) ? v.removedSaturdays.filter(isSat).slice(0, LIMITS.removedSaturdays) : [],
    keptSaturdays: Array.isArray(v.keptSaturdays) ? v.keptSaturdays.filter(isSat).slice(0, LIMITS.keptSaturdays) : [],
    opensOn: cleanOpensOn(v.opensOn),
  };
}

export function withToday(a: Availability): PublicAvailability {
  return { ...a, closedToday: a.closedDates.includes(sastToday()) };
}

/** Public view. Fails open: if storage is missing or broken, orders stay open. */
export async function publicAvailability(kv: KVNamespace | undefined): Promise<PublicAvailability> {
  if (!kv) return withToday(OPEN);
  try {
    return withToday(await readAvailability(kv));
  } catch {
    return withToday(OPEN);
  }
}

/**
 * Checks an availability save. Only `ordersEnabled` is required. Any other list or setting that is OMITTED keeps its
 * stored value (`current`); one that is sent, even as an empty list, replaces it. So a partial save (for example just the
 * orders switch) can no longer reset the cut-off, the collection Saturdays or the closed dates.
 */
export function parseAvailabilityInput(body: Record<string, unknown>, current: Availability): Availability {
  const bad = () => new HttpError(400, "Invalid fields");
  if (typeof body.ordersEnabled !== "boolean") throw bad();
  const dates = body.closedDates === undefined ? current.closedDates : body.closedDates;
  if (!Array.isArray(dates) || dates.length > LIMITS.closedDates || !dates.every(isRealDate)) throw bad();
  const message = body.closedMessage === undefined ? current.closedMessage : body.closedMessage;
  if (typeof message !== "string" || message.length > LIMITS.message) throw bad();
  const cutoffTime = body.cutoffTime === undefined ? current.cutoffTime : body.cutoffTime;
  if (!isCutoffTime(cutoffTime)) throw bad();
  const added = body.addedSaturdays === undefined ? current.addedSaturdays : body.addedSaturdays;
  const removed = body.removedSaturdays === undefined ? current.removedSaturdays : body.removedSaturdays;
  if (!Array.isArray(added) || added.length > LIMITS.addedSaturdays || !added.every(isSat)) throw bad();
  if (!Array.isArray(removed) || removed.length > LIMITS.removedSaturdays || !removed.every(isSat)) throw bad();
  const kept = body.keptSaturdays === undefined ? current.keptSaturdays : body.keptSaturdays;
  if (!Array.isArray(kept) || kept.length > LIMITS.keptSaturdays || !kept.every(isSat)) throw bad();
  const opens = body.opensOn === undefined ? current.opensOn : body.opensOn;
  if (typeof opens !== "object" || opens === null || Array.isArray(opens)) throw bad();
  const opensEntries = Object.entries(opens as Record<string, unknown>);
  if (opensEntries.length > LIMITS.addedSaturdays + LIMITS.removedSaturdays + 12) throw bad();
  for (const [k, d] of opensEntries) if (!isSat(k) || !isRealDate(d) || d > k) throw bad();
  return {
    ordersEnabled: body.ordersEnabled,
    closedDates: [...new Set(dates as string[])].sort(),
    closedMessage: message.trim(),
    cutoffTime,
    addedSaturdays: [...new Set(added as string[])].sort(),
    removedSaturdays: [...new Set(removed as string[])].sort(),
    keptSaturdays: [...new Set(kept as string[])].sort(),
    opensOn: Object.fromEntries(opensEntries.sort(([a], [b]) => a.localeCompare(b))) as Record<string, string>,
  };
}

export async function writeAvailability(kv: KVNamespace, a: Availability): Promise<void> {
  try {
    await kv.put("availability", JSON.stringify({ ...a, updatedAt: new Date().toISOString() }));
  } catch {
    throw new HttpError(503, "Could not save. Try again in a minute.");
  }
}

function cleanEvent(v: unknown): MarketEvent | null {
  const e = asRecord(v);
  if (typeof e.id !== "string" || typeof e.name !== "string" || typeof e.venue !== "string") return null;
  if (!isRealDate(e.start) || !isRealDate(e.end)) return null;
  const ev: MarketEvent = { id: e.id.slice(0, 64), name: e.name.slice(0, LIMITS.name), venue: e.venue.slice(0, LIMITS.venue), start: e.start, end: e.end };
  const pre = cleanPreorder(e.preorder, ev);
  return pre ? { ...ev, preorder: pre } : ev;
}

const HHMM_T = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Stored pre-order settings, checked. Anything odd means "no pre-orders" (the safe side). */
function cleanPreorder(v: unknown, ev: Pick<MarketEvent, "start" | "end">): MarketPreorder | null {
  const p = asRecord(v);
  if (typeof p.enabled !== "boolean" || typeof p.opens !== "string" || typeof p.closes !== "string" || !Array.isArray(p.days)) return null;
  if (!HHMM_T.test(p.opens) || !HHMM_T.test(p.closes) || p.closes <= p.opens) return null;
  const days = [...new Set(p.days.filter((d): d is string => isRealDate(d) && d >= ev.start && d <= ev.end))].sort().slice(0, LIMITS.preorderDays);
  const out: MarketPreorder = { enabled: p.enabled, days, opens: p.opens, closes: p.closes };
  if (isRealDate(p.opensOn)) out.opensOn = p.opensOn;
  return out;
}

/**
 * Admin save of one market's pre-order settings (PUT /api/admin/events/<id>). Switching ON needs stall hours and at least one
 * day inside the market, otherwise a plain 400 (spec A1). Switching OFF keeps what was typed so she need not retype it.
 */
export function parsePreorderInput(body: Record<string, unknown>, ev: MarketEvent): MarketPreorder {
  const bad = (msg: string) => new HttpError(400, msg);
  const raw = asRecord(body.preorder);
  if (typeof raw.enabled !== "boolean") throw bad("Invalid fields");
  const opens = typeof raw.opens === "string" ? raw.opens : "";
  const closes = typeof raw.closes === "string" ? raw.closes : "";
  const hoursOk = HHMM_T.test(opens) && HHMM_T.test(closes) && closes > opens;
  const rawDays = raw.days === undefined ? [] : raw.days;
  if (!Array.isArray(rawDays) || rawDays.length > LIMITS.preorderDays || !rawDays.every((d) => isRealDate(d) && d >= ev.start && d <= ev.end)) {
    throw bad("Pick pre-order days inside the market's dates.");
  }
  const days = [...new Set(rawDays as string[])].sort();
  const opensOn = raw.opensOn === undefined || raw.opensOn === null || raw.opensOn === "" ? undefined : raw.opensOn;
  if (opensOn !== undefined && !isRealDate(opensOn)) throw bad("Invalid fields");
  if (raw.enabled) {
    if (!hoursOk) throw bad("Add the stall hours first (opening time, then a later closing time).");
    if (days.length === 0) throw bad("Pick at least one pre-order day.");
  }
  const out: MarketPreorder = { enabled: raw.enabled, days, opens: hoursOk ? opens : "00:00", closes: hoursOk ? closes : "00:01" };
  if (opensOn) out.opensOn = opensOn;
  return out;
}

const byStart = (a: MarketEvent, b: MarketEvent) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end);

/** All events. If nothing has ever been saved, the bundled list from content.ts. */
export async function readEvents(kv: KVNamespace): Promise<MarketEvent[]> {
  const v = asRecord(await readKey(kv, "events"));
  if (!Array.isArray(v.events)) return [...EVENTS].sort(byStart);
  return v.events.map(cleanEvent).filter((e): e is MarketEvent => e !== null).sort(byStart);
}

/** Markets for the collection rules. Fails open to the bundled list if storage is missing or broken. */
export async function marketsForRules(kv: KVNamespace | undefined): Promise<{ name: string; start: string; end: string }[]> {
  let list: MarketEvent[] = EVENTS;
  if (kv) {
    try {
      list = await readEvents(kv);
    } catch {
      list = EVENTS;
    }
  }
  return list.map((e) => ({ name: e.name, start: e.start, end: e.end }));
}

/**
 * After the owner adds a market: any default Saturday that is already open for orders and that the market would skip is
 * put in keptSaturdays instead (orders may exist already; the admin warns). Returns the dates kept.
 */
export async function keepOpenSaturdays(kv: KVNamespace, before: MarketEvent[], added: MarketEvent, now = Date.now()): Promise<string[]> {
  const avail = await readAvailability(kv);
  const rules = { ...avail, events: before.map((e) => ({ name: e.name, start: e.start, end: e.end })) };
  const keep = saturdaysToKeep(now, rules, [{ name: added.name, start: added.start, end: added.end }]).filter((d) => !avail.keptSaturdays.includes(d));
  if (keep.length) await writeAvailability(kv, { ...avail, keptSaturdays: [...avail.keptSaturdays, ...keep].sort() });
  return keep;
}

export function upcoming(list: MarketEvent[]): MarketEvent[] {
  const today = sastToday();
  return list.filter((e) => e.end >= today).sort(byStart);
}

/** Public view. If storage is missing or broken, the bundled list. */
export async function publicEvents(kv: KVNamespace | undefined): Promise<MarketEvent[]> {
  if (!kv) return upcoming(EVENTS);
  try {
    return upcoming(await readEvents(kv));
  } catch {
    return upcoming(EVENTS);
  }
}

export function parseEventInput(body: Record<string, unknown>): Omit<MarketEvent, "id" | "preorder"> {
  const bad = () => new HttpError(400, "Invalid fields");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const venue = typeof body.venue === "string" ? body.venue.trim() : "";
  if (!name || name.length > LIMITS.name || !venue || venue.length > LIMITS.venue) throw bad();
  if (!isRealDate(body.start) || !isRealDate(body.end) || body.end < body.start) throw bad();
  return { name, venue, start: body.start, end: body.end };
}

export async function writeEvents(kv: KVNamespace, events: MarketEvent[]): Promise<void> {
  try {
    await kv.put("events", JSON.stringify({ events: [...events].sort(byStart), updatedAt: new Date().toISOString() }));
  } catch {
    throw new HttpError(503, "Could not save. Try again in a minute.");
  }
}

// ---------------------------------------------------------------------------------------------
// Pickup points: places the owner sets for customers to collect from (KV key `pickups`).
// Starts EMPTY on purpose: nothing is invented. Online orders are collected ONLY at these points (not at
// markets: at a market people just buy at the cart), so ordering is hidden until one point is active.
// ---------------------------------------------------------------------------------------------
export interface PickupPoint {
  id: string;
  name: string;
  /** Area or address shown to customers. */
  area: string;
  /** Optional collection times, shown as a hint ("Saturdays, 10am to 1pm"). */
  days: string;
  /** Optional structured collection hours ("HH:MM", 24-hour): the order form turns them into one-hour time chips. Both or neither. */
  opens?: string;
  closes?: string;
  active: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanPickup(v: unknown): PickupPoint | null {
  const p = asRecord(v);
  if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.area !== "string") return null;
  // Points saved before opens/closes existed have neither: they keep working (the form reads the hours from `days`).
  const hours =
    typeof p.opens === "string" && typeof p.closes === "string" && HHMM.test(p.opens) && HHMM.test(p.closes) && p.closes > p.opens
      ? { opens: p.opens, closes: p.closes }
      : {};
  return {
    id: p.id.slice(0, 64),
    name: p.name.slice(0, LIMITS.pickupName),
    area: p.area.slice(0, LIMITS.pickupArea),
    days: typeof p.days === "string" ? p.days.slice(0, LIMITS.pickupDays) : "",
    ...hours,
    active: typeof p.active === "boolean" ? p.active : true,
  };
}

/** All pickup points, active or not. Empty if nothing has ever been saved. */
export async function readPickups(kv: KVNamespace): Promise<PickupPoint[]> {
  const v = asRecord(await readKey(kv, "pickups"));
  if (!Array.isArray(v.pickups)) return [];
  return v.pickups.map(cleanPickup).filter((p): p is PickupPoint => p !== null);
}

/** Public view: active points only. If storage is missing or broken, none (markets still work). */
export async function publicPickups(kv: KVNamespace | undefined): Promise<PickupPoint[]> {
  if (!kv) return [];
  try {
    return (await readPickups(kv)).filter((p) => p.active);
  } catch {
    return [];
  }
}

function textField(v: unknown, max: number, required: boolean): string {
  const bad = () => new HttpError(400, "Invalid fields");
  if (v === undefined || v === null || v === "") {
    if (required) throw bad();
    return "";
  }
  if (typeof v !== "string") throw bad();
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if ((required && !s) || s.length > max) throw bad();
  return s;
}

/** Add or edit: name and area required, days (collection times) optional, active defaults to true. */
export function parsePickupInput(body: Record<string, unknown>): Omit<PickupPoint, "id"> {
  const bad = () => new HttpError(400, "Invalid fields");
  if (body.active !== undefined && typeof body.active !== "boolean") throw bad();
  // Collection hours are optional, but both or neither, as "HH:MM", and closing after opening.
  const blank = (v: unknown) => v === undefined || v === null || v === "";
  let hours: { opens: string; closes: string } | Record<string, never> = {};
  if (!blank(body.opens) || !blank(body.closes)) {
    if (typeof body.opens !== "string" || typeof body.closes !== "string" || !HHMM.test(body.opens) || !HHMM.test(body.closes) || body.closes <= body.opens) throw bad();
    hours = { opens: body.opens, closes: body.closes };
  }
  return {
    name: textField(body.name, LIMITS.pickupName, true),
    area: textField(body.area, LIMITS.pickupArea, true),
    days: textField(body.days, LIMITS.pickupDays, false),
    ...hours,
    active: body.active ?? true,
  };
}

export async function writePickups(kv: KVNamespace, pickups: PickupPoint[]): Promise<void> {
  try {
    await kv.put("pickups", JSON.stringify({ pickups, updatedAt: new Date().toISOString() }));
  } catch {
    throw new HttpError(503, "Could not save. Try again in a minute.");
  }
}
