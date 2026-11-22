// SB-20 market pre-orders, with the REAL Worker code (forms.ts, payments.ts, cancel.ts, collection.ts) in Node: fake clock, fake KV,
// fake Durable Objects, fake Yoco and Apps Script behind a stubbed fetch. Run: node worker/tests/market-preorders.mjs
// Dates are in December 2035 on purpose: the Worker's "upcoming markets" list uses the real calendar, so a far-future market never expires.
// All times are South African (SAST, UTC+2).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TEST_CANCEL_SECRET, TS_DUMMY_TOKEN, bundle, fakeLimiter, fakeOrders, fakeSiteverify } from "./_bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const col = await import(pathToFileURL(path.join(root, "artifacts/stuffd-bagels/src/collection.ts")).href);
const { handleForm } = await bundle("worker/forms.ts");
const { handleWebhook } = await bundle("worker/payments.ts");
const { handleCancel, handleCancelCheck } = await bundle("worker/cancel.ts");
const { parsePreorderInput } = await bundle("worker/store.ts");
const { trySend } = await bundle("worker/mailer.ts");
const T = await bundle("worker/cancel-token.ts");

const sast = (iso, time = "12:00:00.000") => Date.parse(`${iso}T${time}+02:00`);
const dow = (iso) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${iso}T00:00:00Z`).getUTCDay()];
let n = 0;
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const ok = (name) => out("PASS", ++n, name);

// ---- 1. The cut-off day is always a Wednesday: the latest Wednesday STRICTLY before the market's first day
for (const [start, wed] of [
  ["2035-12-12", "2035-12-05"], // Wednesday start: the Wednesday a week earlier
  ["2035-12-13", "2035-12-12"], // Thursday start: the day before
  ["2035-12-14", "2035-12-12"], // Friday start
  ["2035-12-16", "2035-12-12"], // Sunday start
  ["2035-12-17", "2035-12-12"], // Monday start
  ["2035-12-18", "2035-12-12"], // Tuesday start
  ["2036-01-01", "2035-12-26"], // across the year end (a Tuesday start)
  ["2036-01-02", "2035-12-26"], // a Wednesday start across the year end
  ["2026-12-16", "2026-12-09"], // MGM '26 (the spec's own example): Wednesday 16 Dec closes Wednesday 9 Dec
  ["2028-03-02", "2028-03-01"], // leap year: Thursday 2 Mar after Wednesday 1 Mar
  ["2028-03-01", "2028-02-23"], // leap year: Wednesday start, week earlier
]) {
  assert.equal(col.marketCutoffDay(start), wed, start);
  assert.equal(dow(wed), "Wed");
}
ok("cut-off day: Wednesday start -> a week earlier, Thu..Tue start -> the Wednesday before, across month, year and leap-year ends");
assert.equal(col.marketCutoffInstant("2026-12-16", "23:59"), sast("2026-12-10", "00:00:00.000"), "first refused instant: Thu 10 Dec 00:00:00 SAST");
assert.equal(col.marketCutoffInstant("2026-12-16", "23:59") - 1, sast("2026-12-09", "23:59:59.999"));
assert.equal(col.marketCutoffInstant("2026-12-16", "12:00"), sast("2026-12-09", "12:01:00.000"), "an owner-set cut-off time is honoured");
ok("cut-off instant: Wed 9 Dec 23:59:59.999 SAST is the last accepted moment, Thu 10 Dec 00:00:00 the first refused");

// ---- 2. Pure rules (collection.ts): status and state
const mk = (preorder, extra = {}) => ({ start: "2035-12-12", end: "2035-12-16", preorder, ...extra });
const ALL = ["2035-12-12", "2035-12-13", "2035-12-14", "2035-12-15", "2035-12-16"];
const PO = { enabled: true, days: ALL, opens: "10:00", closes: "19:00" };
const R = { cutoffTime: "23:59", closedDates: [] };
const now = sast("2035-12-01");
assert.equal(col.marketState(now, mk(undefined), R), "off");
assert.equal(col.marketState(now, mk({ ...PO, enabled: false }), R), "off");
assert.equal(col.marketState(now, mk({ ...PO, opens: "", closes: "" }), R), "off", "no stall hours: not offered");
assert.equal(col.marketState(now, mk({ ...PO, days: [] }), R), "off", "no days: not offered");
assert.equal(col.marketState(now, mk({ ...PO, days: ["2036-02-01"] }), R), "off", "days outside the market do not count");
assert.equal(col.marketState(now, mk(PO), R), "open");
assert.equal(col.marketState(now, mk({ ...PO, opensOn: "2035-12-03" }), R), "not_open_yet");
assert.equal(col.marketState(sast("2035-12-03", "00:00:00.000"), mk({ ...PO, opensOn: "2035-12-03" }), R), "open", "opens at 00:00 SAST on the day");
assert.equal(col.marketState(sast("2035-12-05", "23:59:59.999"), mk(PO), R), "open");
assert.equal(col.marketState(sast("2035-12-06", "00:00:00.000"), mk(PO), R), "closed");
assert.deepEqual(col.availableMarketDays(now, mk({ ...PO, days: ["2035-12-14", "2035-12-13"] }), { ...R, closedDates: ["2035-12-14"] }), ["2035-12-13"], "a closed date removes that day");
assert.equal(col.marketState(now, mk({ ...PO, days: ["2035-12-14"] }), { ...R, closedDates: ["2035-12-14"] }), "off", "every day closed: off");
assert.equal(col.marketHoursLabel(mk(PO)), "10am to 7pm");
ok("collection.ts: off / not_open_yet / open / closed, closed dates, days outside the market, stall hours");

// ---- 3. Admin save rules (A1)
const ev = { id: "mgm", name: "MGM", venue: "V", start: "2035-12-12", end: "2035-12-16" };
const save = (preorder) => { try { return parsePreorderInput({ preorder }, ev); } catch (e) { return e; } };
assert.equal(save({ enabled: true, days: ALL, opens: "10:00", closes: "19:00" }).enabled, true);
for (const [what, p] of [
  ["no hours", { enabled: true, days: ALL, opens: "", closes: "" }],
  ["closes before opens", { enabled: true, days: ALL, opens: "19:00", closes: "10:00" }],
  ["no day ticked", { enabled: true, days: [], opens: "10:00", closes: "19:00" }],
]) { const e = save(p); assert.equal(e.status, 400, what); assert.match(e.message, /stall hours|day/i, what); }
assert.equal(save({ enabled: true, days: ["2035-12-20"], opens: "10:00", closes: "19:00" }).status, 400, "a day outside the market is refused");
assert.equal(save({ enabled: false, days: [], opens: "", closes: "" }).enabled, false, "switching OFF needs no hours");
assert.equal(save({ enabled: true, days: ALL, opens: "10:00", closes: "19:00", opensOn: "no" }).status, 400);
assert.equal(save({ enabled: "yes" }).status, 400);
ok("admin save: needs stall hours and a day to switch ON, refuses days outside the market, OFF is always allowed");

// ---- 4. The Worker: order, webhook, cancel, with a fake clock
const clock = { t: now, now: () => clock.t };
const MAILTOKEN = "k7Vq2mXw9LpR4sTz8NbC3dHf6JyA1eGu0QiO5vWx";
const WH_KEY = crypto.randomBytes(24);
const baseEnv = { APP_ENV: "development", CANCEL_LINK_SECRET: TEST_CANCEL_SECRET, ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec", APPS_SCRIPT_TOKEN: MAILTOKEN, YOCO_SECRET_KEY: "sk_test_localfake1234567890", YOCO_WEBHOOK_SECRET: "whsec_" + WH_KEY.toString("base64"), YOCO_MODE: "test", SITE_ORIGIN: "https://stuffdbagels-preview.example.workers.dev" };
const store = { availability: { ordersEnabled: true, closedDates: [], closedMessage: "", cutoffTime: "23:59", addedSaturdays: ["2035-12-29"], opensOn: { "2035-12-29": "2035-01-01" } } };
const setStore = (events, availability = {}) => {
  const m = new Map([
    ["pickups", JSON.stringify({ pickups: [{ id: "p1", name: "Strandfontein collection", area: "Strandfontein", days: "", active: true }] })],
    ["availability", JSON.stringify({ ...store.availability, ...availability })],
    ["events", JSON.stringify({ events })],
  ]);
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
};
const MGM = { id: "mgm", name: "MGM '26", venue: "Test Venue, Cape Town", start: "2035-12-12", end: "2035-12-16", preorder: { enabled: true, days: ALL, opens: "10:00", closes: "19:00" } };
const yoco = { created: 0, refunds: [], bodies: [] };
const script = { calls: [] };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const ts = fakeSiteverify(url, init);
  if (ts) return ts;
  let m;
  if (u === "https://payments.yoco.com/api/checkouts") {
    const id = `ch_${++yoco.created}${crypto.randomBytes(3).toString("hex")}`;
    yoco.bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id, status: "created", redirectUrl: `https://c.yoco.com/checkout/${id}`, processingMode: "test" }), { status: 201 });
  }
  if ((m = /^https:\/\/payments\.yoco\.com\/api\/checkouts\/([A-Za-z0-9_-]+)\/refund$/.exec(u))) {
    yoco.refunds.push({ id: m[1], key: init.headers["Idempotency-Key"] });
    return new Response(JSON.stringify({ refundId: "rfd_" + crypto.randomBytes(6).toString("hex"), status: "succeeded" }), { status: 200 });
  }
  if (u === "http://fake/exec") { script.calls.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
  throw new Error("unexpected fetch " + u);
};
for (const k of ["log", "error", "warn", "info"]) console[k] = () => {};

let mailN = 0, ipN = 0;
const call = async (fn) => { try { const res = await fn(); return { status: res.status, body: await res.json() }; } catch (e) { return { status: e.status ?? 500, body: { error: e.message } }; } };
async function ctx(events, availability) {
  const lim = await fakeLimiter(clock);
  const ord = await fakeOrders(clock);
  const kv = setStore(events, availability);
  return { ord, env: (extra = {}) => ({ ...baseEnv, LIMITER: lim.ns, ORDERS: ord.ns, STUFFD_KV: kv, ...extra }) };
}
const body = (o = {}) => ({ name: "Aisha Khan", phone: "0821234567", email: `aisha.private${++mailN}@example.com`, marketId: "mgm", pickupDate: "2035-12-14", pickupTime: "10am to 11am", items: { "Classic Bagel": 1 }, note: "", website: "", attemptId: crypto.randomUUID(), turnstileToken: TS_DUMMY_TOKEN, ...o });
const order = (c, b, at = clock.t) => call(() => handleForm(new Request("http://x/api/order", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": `203.0.113.${++ipN % 250 + 1}` }, body: JSON.stringify(b) }), c.env(), "order", at));
const at = async (iso, time, c, o) => { clock.t = sast(iso, time); const r = await order(c, o ?? body()); clock.t = now; return r; };

let c = await ctx([MGM]);
let before = yoco.created;
let r = await order(c, body());
assert.equal(r.status, 200, JSON.stringify(r));
assert.equal(yoco.created, before + 1, "a valid market order opens exactly one Yoco checkout");
ok("a market order is accepted (same Yoco flow)");

// Cut-off (A3): Wednesday 5 Dec 23:59:30 accepted, Thursday 6 Dec 00:00:00 refused, nothing created.
c = await ctx([MGM]);
assert.equal((await at("2035-12-05", "23:59:30.000", c)).status, 200);
before = yoco.created;
r = await at("2035-12-06", "00:00:00.000", c);
assert.equal(r.status, 409); assert.match(r.body.error, /^Pre-orders for MGM '26 closed on Wednesday 5 Dec\.$/);
assert.equal(yoco.created, before, "no Yoco checkout after the cut-off");
ok("Wed 23:59:30 SAST accepted; Thu 00:00:00 refused with 'Pre-orders for <market> closed on <date>'");

// Thursday and Sunday starts, other cut-offs
for (const [start, end, lastOk, firstBad] of [["2035-12-13", "2035-12-16", "2035-12-12", "2035-12-13"], ["2035-12-16", "2035-12-16", "2035-12-12", "2035-12-13"]]) {
  const m = { ...MGM, start, end, preorder: { ...MGM.preorder, days: [end] } };
  c = await ctx([m]);
  assert.equal((await at(lastOk, "23:59:59.000", c, body({ pickupDate: end }))).status, 200, `${start}: Wednesday ${lastOk} still open`);
  assert.equal((await at(firstBad, "00:00:00.000", c, body({ pickupDate: end }))).status, 409, `${start}: Thursday closes`);
}
ok("a Thursday start and a Sunday start both close on the Wednesday before");

// Server rules (A4, A1, A2, A11, A12): every refusal is 4xx and no checkout is created
async function refused(name, c2, b, status, re, when = now) {
  const was = yoco.created;
  clock.t = when;
  const res = await order(c2, b);
  clock.t = now;
  assert.equal(res.status, status, `${name}: ${JSON.stringify(res)}`);
  if (re) assert.match(res.body.error, re, name);
  assert.equal(yoco.created, was, `${name}: no Yoco checkout`);
}
await refused("toggle off", await ctx([{ ...MGM, preorder: { ...MGM.preorder, enabled: false } }]), body(), 409, /aren't open for that market/);
await refused("walk-up market (no settings)", await ctx([{ ...MGM, preorder: undefined }]), body(), 409, /aren't open for that market/);
await refused("unknown market", await ctx([MGM]), body({ marketId: "nope" }), 409, /aren't open for that market/);
await refused("bad id", await ctx([MGM]), body({ marketId: "../x" }), 400);
await refused("id is not text", await ctx([MGM]), body({ marketId: { a: 1 } }), 400);
await refused("a day not ticked", await ctx([{ ...MGM, preorder: { ...MGM.preorder, days: ["2035-12-14", "2035-12-15", "2035-12-16"] } }]), body({ pickupDate: "2035-12-12" }), 409, /isn't a pre-order day/);
await refused("a day outside the market", await ctx([MGM]), body({ pickupDate: "2035-12-20" }), 409, /isn't a pre-order day/);
await refused("a Saturday that is not a market day", await ctx([MGM]), body({ pickupDate: "2035-12-29" }), 409, /isn't a pre-order day/);
await refused("no date", await ctx([MGM]), body({ pickupDate: undefined }), 400);
await refused("junk date", await ctx([MGM]), body({ pickupDate: "tomorrow" }), 409, /isn't a pre-order day/);
await refused("not open yet", await ctx([{ ...MGM, preorder: { ...MGM.preorder, opensOn: "2035-12-03" } }]), body(), 409, /^Pre-orders for MGM '26 open on Monday 3 Dec\. Please try again then\.$/);
await refused("a closed date is a market day", await ctx([MGM], { closedDates: ["2035-12-14"], closedMessage: "Closed that day" }), body(), 409, /Closed that day/);
await refused("orders switched off", await ctx([MGM], { ordersEnabled: false, closedMessage: "Orders are off" }), body(), 409, /Orders are off/);
await refused("a day that has already passed", await ctx([MGM]), body(), 400, undefined, sast("2036-02-01"));
await refused("hours missing in storage (stored by hand)", await ctx([{ ...MGM, preorder: { ...MGM.preorder, opens: "", closes: "" } }]), body(), 409, /aren't open for that market/);
assert.equal((await order(await ctx([MGM], { closedDates: ["2035-12-14"] }), body({ pickupDate: "2035-12-15" }))).status, 200, "other days still open when one day is closed");
ok("server refuses: toggle off, walk-up market, unknown/odd id, day not ticked or outside the market, not open yet, closed date, orders off, a past day, no hours; never a checkout");

// A bagel-only price list: the amount still comes from content.ts, and Yoco never sees the market name or the customer
const sent = yoco.bodies.at(-1);
assert.equal(sent.amount, 6500);
assert.ok(!JSON.stringify(sent).includes("Aisha"), "no personal data to Yoco");
ok("price from content.ts (R65), no personal data to Yoco");

// The Saturday path is untouched (A12) and still needs a pickup point
c = await ctx([MGM]);
assert.equal((await order(c, body({ marketId: undefined, pickupId: "p1", pickupDate: "2035-12-29" }))).status, 200, "Saturday order with a market on the list");
assert.equal((await order(c, body({ marketId: undefined, pickupDate: "2035-12-29" }))).status, 400, "a Saturday order still needs a pickup point");
ok("Saturday orders behave as before while a market has pre-orders on");

// ---- 5. Paid -> confirmation email -> cancel link (A6, A7, A9): the market's own cut-off, the market in the email
const baseWebhook = (row) => {
  const id = "msg_" + crypto.randomUUID(), ts = Math.floor(clock.t / 1000);
  const payload = { id: "p_" + crypto.randomUUID().slice(0, 8), amount: row.amountCents, currency: "ZAR", mode: "test", status: "succeeded", type: "payment", metadata: { checkoutId: row.checkoutId } };
  const raw = JSON.stringify({ id: "evt_" + id, type: "payment.succeeded", createdDate: "2035-12-01T10:00:00Z", payload });
  return { raw, headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + crypto.createHmac("sha256", WH_KEY).update(`${id}.${ts}.${raw}`).digest("base64") } };
};
async function alarm(c2) {
  return c2.ord.svc.tick(
    async (row) => {
      const link = row.cancelBy !== null && clock.t < row.cancelBy ? await T.cancelLink(baseEnv, row.ref, row.cancelBy) : null;
      return trySend(baseEnv, { ...JSON.parse(row.orderJson), paid: true, checkoutId: row.checkoutId, ...(link ? { cancelUrl: link, cancelByLabel: T.cancelByLabel(row.cancelBy) } : {}) });
    },
    async (row) => { const p = c2.ord.svc.cancelMailPayload(row); return p ? trySend(baseEnv, p) : false; },
  );
}
c = await ctx([MGM]);
script.calls.length = 0;
r = await order(c, body({ pickupDate: "2035-12-15" }));
assert.equal(r.status, 200);
const row = c.ord.rows().find((x) => x.ref === r.body.ref);
const BY = sast("2035-12-06", "00:00:00.000");
assert.equal(row.cancelBy, BY, "cancel-by = the MARKET's cut-off (Thu 6 Dec 00:00 SAST), not a Saturday's");
const stored = JSON.parse(row.orderJson);
assert.equal(stored.marketName, "MGM '26");
assert.equal(stored.pickupPlace, "Our stall at MGM '26, Test Venue, Cape Town");
assert.equal(stored.pickupDays, "10am to 7pm");
assert.equal(stored.pickupDate, "2035-12-15");
assert.equal(stored.pickupTime, "10am to 11am");
const cj = JSON.parse(row.cancelJson);
assert.equal(cj.marketName, "MGM '26");
assert.deepEqual(Object.keys(cj).sort(), ["email", "items", "marketName", "name", "pickupDate", "pickupPlace", "total"], "cancel details: still no phone, note or time");
const w = baseWebhook(row);
const h = await call(() => handleWebhook(new Request("http://x/api/yoco/webhook", { method: "POST", headers: w.headers, body: w.raw }), c.env(), clock.t));
assert.equal(h.status, 200);
assert.equal(script.calls.length, 0, "no email before payment is confirmed by the webhook... and none until the alarm runs");
await alarm(c);
const confirm = script.calls.find((x) => x.type === "order");
assert.ok(confirm && confirm.marketName === "MGM '26" && confirm.paid === true, "the confirmation carries the market name");
assert.equal(confirm.cancelByLabel, "Wednesday 5 Dec at 23:59");
assert.ok(confirm.cancelUrl.startsWith(`${baseEnv.SITE_ORIGIN}/order/cancel#`));
const token = confirm.cancelUrl.split("#")[1];
assert.deepEqual(await T.verifyCancelToken(baseEnv, token), { ok: true, ref: r.body.ref, cancelByMs: BY });
ok("paid market order: owner/customer email payload names the market, day and hours; the signed link expires at the MARKET's cut-off (Wed 5 Dec 23:59)");

// Cancel before the cut-off refunds automatically; after it, credit only
const post = async (path, b, when) => { clock.t = when; try { return await post0(path, b, when); } finally { clock.t = now; } };
const post0 = (path, b, when) => call(() => (path === "check" ? handleCancelCheck : handleCancel)(new Request("http://x/api/order/cancel", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.9" }, body: JSON.stringify(b) }), c.env(), when));
const chk = await post("check", { token }, sast("2035-12-05", "23:59:30.000"));
assert.equal(chk.body.state, "open"); assert.equal(chk.body.pickupDate, "2035-12-15");
const late = await post("check", { token }, sast("2035-12-06", "00:00:00.000"));
assert.equal(late.body.state, "closed", "the link stops at the market's cut-off");
const done = await post("cancel", { token, turnstileToken: TS_DUMMY_TOKEN }, sast("2035-12-05", "23:59:30.000"));
assert.equal(done.status, 200); assert.equal(done.body.state, "refunded");
assert.equal(yoco.refunds.length, 1); assert.equal(yoco.refunds[0].key, `refund-${r.body.ref}`);
script.calls.length = 0;
clock.t = sast("2035-12-05", "23:59:40.000"); // the cancellation email is due just after the refund
await alarm(c);
clock.t = now;
const cancelMail = script.calls.find((x) => x.type === "cancel");
assert.ok(cancelMail && cancelMail.marketName === "MGM '26" && cancelMail.outcome === "refunded", "the cancellation email names the market too (so it is filed under it)");
ok("cancel before the cut-off: automatic refund once, cancellation email carries the market; after it: link closed");

// A Saturday order is unchanged: its cancel-by is still its own Wednesday
c = await ctx([MGM]);
r = await order(c, body({ marketId: undefined, pickupId: "p1", pickupDate: "2035-12-29" }));
assert.equal(c.ord.rows().find((x) => x.ref === r.body.ref).cancelBy, sast("2035-12-27", "00:00:00.000"));
assert.equal(JSON.parse(c.ord.rows().find((x) => x.ref === r.body.ref).orderJson).marketName, undefined);
ok("Saturday orders keep their own cut-off and carry no market name");

// Same cart twice for two different options is two different presses (the duplicate-press hash includes the option)
c = await ctx([MGM, { ...MGM, id: "other", name: "Other" }]);
const same = { attemptId: crypto.randomUUID(), email: "same@example.com" };
const a1 = await order(c, body({ ...same, marketId: "mgm" }));
const a2 = await order(c, body({ ...same, marketId: "other" }));
assert.equal(a1.status, 200);
assert.equal(a2.status, 409, "the same press with a different market is a changed order, not a repeat");
ok("the same press for a different market is a 'changed order', never the old checkout");

out("market pre-orders: all", n, "checks passed");
