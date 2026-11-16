// Reads, validates and writes the two KV keys: `availability` and `events` (ADR-0028).
import { DEFAULT_CUTOFF, DEFAULT_WEEKS_AHEAD, MAX_WEEKS_AHEAD, isCutoffTime } from "../artifacts/stuffd-bagels/src/collection";
import { EVENTS, type MarketEvent } from "../artifacts/stuffd-bagels/src/content";
import { HttpError } from "./http";

export const LIMITS = {
  closedDates: 60,
  events: 50,
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
  /** How many weeks ahead a customer may order (owner-editable). */
  maxWeeksAhead: number;
}

export interface PublicAvailability extends Availability {
  closedToday: boolean;
}

const OPEN: Availability = { ordersEnabled: true, closedDates: [], closedMessage: "", cutoffTime: DEFAULT_CUTOFF, maxWeeksAhead: DEFAULT_WEEKS_AHEAD };

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

/** Stored availability, with every field checked. Missing or odd values fall back to "open". */
export async function readAvailability(kv: KVNamespace): Promise<Availability> {
  const v = asRecord(await readKey(kv, "availability"));
  return {
    ordersEnabled: typeof v.ordersEnabled === "boolean" ? v.ordersEnabled : OPEN.ordersEnabled,
    closedDates: Array.isArray(v.closedDates) ? v.closedDates.filter(isRealDate).slice(0, LIMITS.closedDates) : [],
    closedMessage: typeof v.closedMessage === "string" ? v.closedMessage.slice(0, LIMITS.message) : "",
    cutoffTime: isCutoffTime(v.cutoffTime) ? v.cutoffTime : DEFAULT_CUTOFF,
    maxWeeksAhead:
      typeof v.maxWeeksAhead === "number" && Number.isInteger(v.maxWeeksAhead) && v.maxWeeksAhead >= 1 && v.maxWeeksAhead <= MAX_WEEKS_AHEAD
        ? v.maxWeeksAhead
        : DEFAULT_WEEKS_AHEAD,
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

export function parseAvailabilityInput(body: Record<string, unknown>): Availability {
  const bad = () => new HttpError(400, "Invalid fields");
  if (typeof body.ordersEnabled !== "boolean") throw bad();
  const dates = body.closedDates ?? [];
  if (!Array.isArray(dates) || dates.length > LIMITS.closedDates || !dates.every(isRealDate)) throw bad();
  const message = body.closedMessage ?? "";
  if (typeof message !== "string" || message.length > LIMITS.message) throw bad();
  // Cut-off and weeks ahead are optional in the request (older callers) and default to the standard rules.
  const cutoffTime = body.cutoffTime ?? DEFAULT_CUTOFF;
  if (!isCutoffTime(cutoffTime)) throw bad();
  const weeks = body.maxWeeksAhead ?? DEFAULT_WEEKS_AHEAD;
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS_AHEAD) throw bad();
  return {
    ordersEnabled: body.ordersEnabled,
    closedDates: [...new Set(dates as string[])].sort(),
    closedMessage: message.trim(),
    cutoffTime,
    maxWeeksAhead: weeks,
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
  return { id: e.id.slice(0, 64), name: e.name.slice(0, LIMITS.name), venue: e.venue.slice(0, LIMITS.venue), start: e.start, end: e.end };
}

const byStart = (a: MarketEvent, b: MarketEvent) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end);

/** All events. If nothing has ever been saved, the bundled list from content.ts. */
export async function readEvents(kv: KVNamespace): Promise<MarketEvent[]> {
  const v = asRecord(await readKey(kv, "events"));
  if (!Array.isArray(v.events)) return [...EVENTS].sort(byStart);
  return v.events.map(cleanEvent).filter((e): e is MarketEvent => e !== null).sort(byStart);
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

export function parseEventInput(body: Record<string, unknown>): Omit<MarketEvent, "id"> {
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
  active: boolean;
}

function cleanPickup(v: unknown): PickupPoint | null {
  const p = asRecord(v);
  if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.area !== "string") return null;
  return {
    id: p.id.slice(0, 64),
    name: p.name.slice(0, LIMITS.pickupName),
    area: p.area.slice(0, LIMITS.pickupArea),
    days: typeof p.days === "string" ? p.days.slice(0, LIMITS.pickupDays) : "",
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
  return {
    name: textField(body.name, LIMITS.pickupName, true),
    area: textField(body.area, LIMITS.pickupArea, true),
    days: textField(body.days, LIMITS.pickupDays, false),
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
