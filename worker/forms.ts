// Order and booking forms: validate, rate limit, then forward to the client's Google Apps Script
// (apps-script/Code.gs), which emails her and the customer from her own Gmail address.
// The browser only ever talks to this Worker, so the page CSP stays connect-src 'self'.
//
// Orders are "awaiting payment" until the Yoco step exists (hook: POST /api/order/pay, a stub).
// Nothing personal is stored here: the rate-limit counters (worker/limiter.ts) sit under keyed hashes of the network and
// the email address, hold only a number and a reset time, and delete themselves when their window ends.
import { menuPricingObject, pricedToppings } from "../artifacts/stuffd-bagels/src/content";
import { hashKey, ipBucket, normaliseEmail, refund, take, type LimiterEnv, type Rule } from "./limiter-client";
import { HttpError, json, readJsonObject } from "./http";
import { niceDay, opensOnFor, saturdayStatus, sastDay } from "../artifacts/stuffd-bagels/src/collection";
import { isRealDate, marketsForRules, publicAvailability, publicPickups, sastToday, secondsToSastMidnight } from "./store";

export interface FormsEnv extends LimiterEnv {
  STUFFD_KV?: KVNamespace;
  ADMIN_PASSWORD?: string;
  APPS_SCRIPT_URL?: string;
  APPS_SCRIPT_TOKEN?: string;
}

export const FORM_LIMITS = {
  name: 60,
  phone: 20,
  email: 254,
  note: 300,
  venue: 120,
  pickupTime: 40,
  details: 1000,
  perItem: 50,
  totalItems: 100,
  maxGuests: 5000,
  perIpPerHour: { order: 5, booking: 3 }, // per IPv4 address or IPv6 /64
  perRecipientPerDay: 3, // customer replies to one mailbox per day (same cap in apps-script/Code.gs)
  perDay: 40, // Gmail lets a free account send about 100 emails a day; each submission sends 2. Code.gs has the same cap.
  minToken: 32, // APPS_SCRIPT_TOKEN must be at least this long (Code.gs refuses anything shorter)
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REF_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function reference(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${[...bytes].map((b) => REF_CHARS[b % REF_CHARS.length]).join("")}`;
}

const bad = () => new HttpError(400, "Please check the highlighted details and try again.");

/** One line of text: control characters out, spaces collapsed, length checked. */
function line(v: unknown, max: number, required: boolean): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw bad();
    return "";
  }
  if (typeof v !== "string") throw bad();
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if (required && !s) throw bad();
  if (s.length > max) throw bad();
  return s;
}

/** Several lines (notes, details): newlines kept, other control characters out. */
function text(v: unknown, max: number): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string") throw bad();
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ").trim();
  if (s.length > max) throw bad();
  return s;
}

function email(v: unknown): string {
  const s = line(v, FORM_LIMITS.email, true);
  if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$/.test(s)) throw bad();
  return s;
}

/** South African numbers become +27..., other international numbers +..., anything else is refused. */
function phone(v: unknown): string {
  const raw = line(v, FORM_LIMITS.phone, true).replace(/[\s\-().]/g, "");
  const za = /^(?:\+27|0027|27|0)([1-9]\d{8})$/.exec(raw);
  if (za) return `+27${za[1]}`;
  const intl = /^(?:\+|00)([1-9]\d{7,14})$/.exec(raw);
  if (intl) return `+${intl[1]}`;
  throw bad();
}

function dateAfter(days: number): string {
  return sastToday(Date.now() + days * 86400000);
}

export interface OrderPayload {
  type: "order";
  ref: string;
  name: string;
  phone: string;
  email: string;
  /** The Saturday the customer will collect on (YYYY-MM-DD). Always a Saturday. */
  pickupDate: string;
  /** Preferred collection time the customer typed (optional: a request, not a booking). */
  pickupTime: string;
  /** The owner's pickup point: "<name>, <area>". Online orders are never collected at markets. */
  pickupPlace: string;
  /** The point's own collection times, as the owner wrote them (may be empty). */
  pickupDays: string;
  items: { name: string; qty: number; unit: number; line: number }[];
  total: number;
  note: string;
}

export interface BookingPayload {
  type: "booking";
  ref: string;
  name: string;
  phone: string;
  email: string;
  eventDate: string;
  venue: string;
  guests: number;
  details: string;
}

function readQuantities(v: unknown, prices: Record<string, number>): { name: string; qty: number; unit: number; line: number }[] {
  if (v === undefined || v === null) return [];
  if (typeof v !== "object" || Array.isArray(v)) throw bad();
  const out: { name: string; qty: number; unit: number; line: number }[] = [];
  for (const [name, qty] of Object.entries(v as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(prices, name)) throw bad();
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > FORM_LIMITS.perItem) throw bad();
    if (qty > 0) out.push({ name, qty, unit: prices[name], line: qty * prices[name] });
  }
  return out;
}

async function parseOrder(body: Record<string, unknown>, env: FormsEnv, now: number): Promise<OrderPayload> {
  const name = line(body.name, FORM_LIMITS.name, true);
  const tel = phone(body.phone);
  const mail = email(body.email);
  const note = text(body.note, FORM_LIMITS.note);

  // Prices come from content.ts only (the browser sends names and quantities, never amounts).
  const bagels = readQuantities(body.items, Object.fromEntries(Object.entries(menuPricingObject).map(([k, v]) => [k, v.price])));
  const extras = readQuantities(body.toppings, pricedToppings());
  const items = [...bagels, ...extras];
  const count = items.reduce((n, i) => n + i.qty, 0);
  if (bagels.length === 0 || count > FORM_LIMITS.totalItems) throw bad();
  const total = items.reduce((n, i) => n + i.line, 0);

  // Collection: a listed collection Saturday, on or after the day orders open, before its Wednesday cut-off, not closed (collection.ts).
  const avail = await publicAvailability(env.STUFFD_KV);
  const status = saturdayStatus(typeof body.pickupDate === "string" ? body.pickupDate : "", now, {
    cutoffTime: avail.cutoffTime,
    closedDates: avail.closedDates,
    addedSaturdays: avail.addedSaturdays,
    removedSaturdays: avail.removedSaturdays,
    keptSaturdays: avail.keptSaturdays,
    events: await marketsForRules(env.STUFFD_KV),
    opensOn: avail.opensOn,
  });
  if (status === "closed_date") throw new HttpError(409, avail.closedMessage || "We're closed on that Saturday. Please choose another.");
  if (status === "cutoff_passed") throw new HttpError(409, "Orders for that Saturday have closed. Please choose the next Saturday.");
  if (status === "not_open_yet") throw new HttpError(409, `Orders for that Saturday open on ${niceDay(opensOnFor(body.pickupDate as string, avail))}. Please try again then.`);
  if (status === "not_offered") throw new HttpError(409, "That Saturday isn't a collection day. Please choose one from the list.");
  if (status !== "ok") throw bad(); // not a Saturday, or in the past
  const date = body.pickupDate as string;

  // The pickup point must exist AND be switched on (the owner may have turned it off since the page loaded).
  const pointId = body.pickupId;
  if (typeof pointId !== "string" || !SAFE_ID.test(pointId)) throw bad();
  const point = (await publicPickups(env.STUFFD_KV)).find((p) => p.id === pointId);
  if (!point) throw new HttpError(409, "That pickup point isn't available any more. Please choose another.");
  const time = line(body.pickupTime, FORM_LIMITS.pickupTime, false);

  return {
    type: "order", ref: reference("SB"), name, phone: tel, email: mail,
    pickupDate: date, pickupTime: time, pickupPlace: `${point.name}, ${point.area}`, pickupDays: point.days, items, total, note,
  };
}

function parseBooking(body: Record<string, unknown>): BookingPayload {
  const name = line(body.name, FORM_LIMITS.name, true);
  const tel = phone(body.phone);
  const mail = email(body.email);
  const date = body.eventDate;
  if (!isRealDate(date) || date < sastToday() || date > dateAfter(730)) throw bad();
  const venue = line(body.venue, FORM_LIMITS.venue, true);
  const guests = body.guests;
  if (typeof guests !== "number" || !Number.isInteger(guests) || guests < 1 || guests > FORM_LIMITS.maxGuests) throw bad();
  const details = text(body.details, FORM_LIMITS.details);
  return { type: "booking", ref: reference("BK"), name, phone: tel, email: mail, eventDate: date, venue, guests, details };
}

/**
 * Counts a submission against, in order: the sender's network per hour (IPv4 or IPv6 /64), the customer's mailbox
 * per day, and the shared daily cap. The counters live in Durable Objects (strongly consistent), so parallel
 * submissions cannot slip past them. A refusal gives back the slots already taken. Fails closed.
 */
async function rateLimit(request: Request, env: FormsEnv, kind: "order" | "booking", mail: string): Promise<void> {
  const unavailable = () => new HttpError(503, "We can't take this right now. Please try again in a minute.");
  const secret = env.ADMIN_PASSWORD ?? "stuffd-forms";
  const midnight = secondsToSastMidnight();
  const steps: { key: string; rule: Rule; refused: string }[] = [
    {
      key: `form:${kind}:${await hashKey(ipBucket(request.headers.get("CF-Connecting-IP") ?? "unknown"), secret)}`,
      rule: { id: "hour", limit: FORM_LIMITS.perIpPerHour[kind], windowSec: 3600 },
      refused: "That's a few too many in a row. Please wait an hour, or email stuffd.bagels@gmail.com.",
    },
    {
      key: `rcpt:${await hashKey(normaliseEmail(mail), secret)}`,
      rule: { id: "day", limit: FORM_LIMITS.perRecipientPerDay, windowSec: midnight },
      refused: "We've already had a few from that email address today. Please email stuffd.bagels@gmail.com instead.",
    },
    {
      key: `all:${sastToday()}`,
      rule: { id: "day", limit: FORM_LIMITS.perDay, windowSec: midnight },
      refused: "We've had a very busy day. Please email stuffd.bagels@gmail.com instead.",
    },
  ];
  const taken: typeof steps = [];
  for (const step of steps) {
    let verdict;
    try {
      verdict = await take(env, step.key, [step.rule]);
    } catch {
      await Promise.all(taken.map((t) => refund(env, t.key, [t.rule.id])));
      throw unavailable();
    }
    if (!verdict.ok) {
      await Promise.all(taken.map((t) => refund(env, t.key, [t.rule.id])));
      throw new HttpError(429, step.refused, { "Retry-After": String(Math.min(verdict.retryAfter, 3600)) });
    }
    taken.push(step);
  }
}

/** Both secrets must be set. Without the token the script (Code.gs) would be an open mail relay, so never forward without it. */
function assertSwitchedOn(env: FormsEnv): { url: string; token: string } {
  const { APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: token } = env;
  if (!url || !token || token.length < FORM_LIMITS.minToken) {
    throw new HttpError(503, "Online ordering isn't switched on yet. Please email stuffd.bagels@gmail.com.");
  }
  return { url, token };
}

async function forward(env: FormsEnv, payload: OrderPayload | BookingPayload): Promise<void> {
  const { url, token } = assertSwitchedOn(env); // again, so no code path can forward without it
  const fail = () => new HttpError(502, "We couldn't send that just now. Please try again, or email stuffd.bagels@gmail.com.");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // text/plain: Apps Script web apps do not answer CORS preflights, and this is server to server anyway.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...payload, token, receivedAt: new Date().toISOString() }),
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw fail();
  }
  let reply: unknown = null;
  try {
    reply = JSON.parse(await res.text());
  } catch {
    // not JSON: treated as a failure below
  }
  if (!res.ok || typeof reply !== "object" || reply === null || (reply as { ok?: unknown }).ok !== true) throw fail();
}

/** POST /api/order and POST /api/booking. */
export async function handleForm(request: Request, env: FormsEnv, kind: "order" | "booking", now: number = Date.now()): Promise<Response> {
  const body = await readJsonObject(request);
  // Honeypot: a real visitor never sees this field. Look successful, send nothing, count nothing.
  if (typeof body.website === "string" && body.website.trim() !== "") return json({ ok: true, ref: reference(kind === "order" ? "SB" : "BK") });

  if (kind === "order") {
    // Orders can be switched off in the admin, or closed for a date.
    const avail = await publicAvailability(env.STUFFD_KV);
    if (!avail.ordersEnabled || avail.closedDates.includes(sastDay(now))) {
      throw new HttpError(409, avail.closedMessage || "Orders are closed right now. See you at the next market.");
    }
  }
  const payload = kind === "order" ? await parseOrder(body, env, now) : parseBooking(body);
  assertSwitchedOn(env); // before counting anything: a switched-off site must not use up anyone's allowance
  await rateLimit(request, env, kind, payload.email);
  await forward(env, payload);
  return json({ ok: true, ref: payload.ref, ...(payload.type === "order" ? { total: payload.total, status: "awaiting_payment" } : {}) });
}

/**
 * POST /api/order/pay: where the "Pay now" step will go once the Yoco design (ADR pending with
 * dp-architect) is signed off. It deliberately does nothing yet. When built it takes the order
 * reference from the order email and creates the Yoco checkout for that order's total.
 */
export async function handlePayStub(request: Request): Promise<Response> {
  await readJsonObject(request).catch(() => ({}));
  throw new HttpError(501, "Online payment isn't switched on yet.");
}
