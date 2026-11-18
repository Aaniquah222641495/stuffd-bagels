// Worker order/booking API test against `wrangler dev`. Setup (three terminals):
//   1. node worker/tests/fake-apps-script.mjs /tmp/fake.log
//   2. npx wrangler@4.148.0 dev --port 8787 --var APP_ENV:development --var APPS_SCRIPT_URL:http://127.0.0.1:8799/exec --persist-to /tmp/stuffd-state --var APPS_SCRIPT_TOKEN:$TOKEN
//   3. rm -f /tmp/fake.log && TOKEN=<same value> node worker/tests/forms-api.mjs /tmp/fake.log
// TOKEN is the same 32+ character value passed to wrangler dev (the Worker refuses to forward without one).
// It sets up its own pickup points and uses a fresh pretend client IP for rate limits. Dates follow the real clock.
// The exact cut-off and month-end cases live in saturday-rules.mjs (fake clock); this file checks the live HTTP path.
import assert from "node:assert/strict";
import { admin, clearRateLimits, col, logged, post, resetPickups, saturdays, setAvail, testRules, uniqueEmail } from "./_helpers.mjs";

clearRateLimits();
await setAvail({});
const [P1, P2] = await resetPickups([
  { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm" },
  { name: "Off Point", area: "Elsewhere", active: false },
]);
const sats = saturdays();
assert.ok(sats.length >= 3, "need three open Saturdays to run");
const [, SAT, SAT2] = sats; // index 0 may be at its cut-off edge right now
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

const order = (o = {}) => ({ name: "Aisha Khan", phone: "082 123 4567", email: uniqueEmail("aisha"), pickupId: P1, pickupDate: SAT, items: { "Pizza Bagel": 2 }, toppings: {}, note: "No onions", website: "", ...o });
const booking = (o = {}) => ({ name: "Sam", phone: "+27 82 999 9999", email: uniqueEmail("sam"), eventDate: addDays(SAT, 90), venue: "Kenilworth", guests: 80, details: "Birthday", website: "", ...o });
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);

// 1. A good order goes through
let r = await post("/api/order", order()); let j = await r.json();
assert.equal(r.status, 200); assert.match(j.ref, /^SB-[A-Z2-9]{6}$/); assert.equal(j.total, 190); assert.equal(j.status, "awaiting_payment");
let l = logged(); assert.equal(l.length, 1);
assert.equal(l[0].method, "POST"); assert.match(l[0].ct, /text\/plain/);
const f = l[0].body;
assert.equal(f.type, "order"); assert.equal(f.phone, "+27821234567"); assert.equal(f.token, process.env.TOKEN); assert.equal(f.total, 190);
assert.equal(f.pickupPlace, "Kenilworth Corner, Main Rd, Kenilworth"); assert.equal(f.pickupDays, "Saturdays, 10am to 1pm"); assert.equal(f.pickupDate, SAT);
assert.equal(col.isSaturday(f.pickupDate), true);
ok("valid order forwarded with pickup point, Saturday, server total R190, phone normalised, token sent");

// 2. Bad input: nothing forwarded
const cases = [
  ["unknown item", { items: { "Free Bagel": 1 } }, 400], ["no bagel, extras only", { items: {}, toppings: { "Extra Cheese": 1 } }, 400],
  ["topping with no confirmed price", { toppings: { "Extra Cheese": 1 } }, 400], ["old menu name", { items: { "Plain Bagel": 1 } }, 400],
  ["negative qty", { items: { "Pizza Bagel": -1 } }, 400], ["fractional qty", { items: { "Pizza Bagel": 1.5 } }, 400], ["qty over 50", { items: { "Pizza Bagel": 51 } }, 400],
  ["prototype key", { items: { constructor: 1 } }, 400], ["bad email", { email: "nope" }, 400], ["bad phone", { phone: "123" }, 400],
  ["empty name", { name: "  " }, 400], ["name too long", { name: "x".repeat(61) }, 400], ["note too long", { note: "x".repeat(301) }, 400],
  ["name is a number", { name: 5 }, 400],
  ["a past Saturday", { pickupDate: "2026-01-03" }, 400], ["a Sunday", { pickupDate: addDays(SAT, 1) }, 400], ["a Friday", { pickupDate: addDays(SAT, -1) }, 400],
  ["a Wednesday", { pickupDate: addDays(SAT, -3) }, 400], ["a Saturday that is not on the collection list (9 weeks on)", { pickupDate: addDays(SAT, 63) }, 409], ["no date", { pickupDate: undefined }, 400],
  ["unknown pickup point", { pickupId: "nope" }, 409], ["switched-off pickup point", { pickupId: P2 }, 409], ["no pickup point", { pickupId: undefined }, 400],
  ["a market instead of a pickup point", { pickupId: undefined, eventId: "mgm-26" }, 400], ["unsafe pickup id", { pickupId: "../x" }, 400],
  ["time note too long", { pickupTime: "x".repeat(41) }, 400],
];
for (const [name, o, status] of cases) { r = await post("/api/order", order(o)); assert.equal(r.status, status, name); }
assert.equal(logged().length, 1);
ok(`${cases.length} invalid orders refused with the right status, nothing forwarded`);

// 3. Honeypot
r = await post("/api/order", order({ website: "http://spam.example" }));
assert.equal(r.status, 200); assert.equal(logged().length, 1);
ok("honeypot: looks like success, nothing forwarded");

// 4. Transport
assert.equal((await post("/api/order", "not json")).status, 400);
assert.equal((await post("/api/order", order(), { "Content-Type": "text/plain" })).status, 400);
assert.equal((await post("/api/order", order({ note: "x".repeat(20000) }))).status, 400);
assert.equal((await fetch("http://localhost:8787/api/order")).status, 405);
assert.equal((await post("/api/order/pay", { ref: "SB-AAAAAA" })).status, 501);
ok("bad JSON / content-type / oversize / GET refused; /api/order/pay stub answers 501");

// 5. Closed Saturday
assert.equal((await setAvail({ closedDates: [SAT], closedMessage: "Closed that Saturday" })).status, 200);
r = await post("/api/order", order()); assert.equal(r.status, 409); assert.equal((await r.json()).error, "Closed that Saturday");
r = await post("/api/order", order({ pickupDate: SAT2 })); assert.equal(r.status, 200);
assert.ok(!(await (await fetch("http://localhost:8787/api/availability")).json()).closedDates.includes(SAT2));
ok("a closed Saturday is refused with the owner's message; the next one still works");

// 5b. A listed Saturday before its opening day is refused with the date it opens (the 15th rule, live HTTP path)
const tr = testRules(); const tomorrow = addDays(col.sastDay(Date.now()), 1);
assert.equal((await setAvail({ opensOn: { ...tr.opensOn, [SAT2]: tomorrow > SAT2 ? SAT2 : tomorrow } })).status, 200);
if (tomorrow <= SAT2) { r = await post("/api/order", order({ pickupDate: SAT2 })); assert.equal(r.status, 409); assert.match((await r.json()).error, /^Orders for that Saturday open on /); }
assert.equal((await setAvail({})).status, 200);
ok("a Saturday on the list but not open yet: 409 naming the day it opens");

// 6. Orders off, today closed
assert.equal((await setAvail({ ordersEnabled: false, closedMessage: "Back soon" })).status, 200);
r = await post("/api/order", order()); assert.equal(r.status, 409); assert.equal((await r.json()).error, "Back soon");
r = await post("/api/booking", booking()); assert.equal(r.status, 200);
const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
assert.equal((await setAvail({ closedDates: [today] })).status, 200);
assert.equal((await post("/api/order", order())).status, 409);
assert.equal((await setAvail({})).status, 200);
ok("orders switched off -> 409 with her message; today closed pauses orders; bookings unaffected");

// 7. Switching a pickup point off takes effect immediately
assert.equal((await admin(`/pickups/${P1}`, "PUT", { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "", active: false })).status, 200);
r = await post("/api/order", order()); assert.equal(r.status, 409); assert.match((await r.json()).error, /isn't available/);
await admin(`/pickups/${P1}`, "PUT", { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm", active: true });
ok("a pickup point switched off in the admin is refused straight away");

// 8. Booking validation
const before = logged().length;
for (const [name, o] of [["past date", { eventDate: "2026-01-01" }], ["far future", { eventDate: "2031-01-01" }], ["zero guests", { guests: 0 }], ["guests string", { guests: "80" }],
  ["guests 5001", { guests: 5001 }], ["no venue", { venue: "" }], ["bad email", { email: "x@y" }], ["details too long", { details: "x".repeat(1001) }]]) {
  r = await post("/api/booking", booking(o)); assert.equal(r.status, 400, name);
}
assert.equal(logged().length, before);
l = logged().at(-1); assert.equal(l.body.type, "booking"); assert.equal(l.body.phone, "+27829999999"); assert.match(l.body.ref, /^BK-/);
ok("booking forwarded with BK ref; 8 invalid bookings refused");

// 9. Apps Script says no
r = await post("/api/order", order({ name: "FailMe", pickupDate: SAT2 })); j = await r.json();
assert.equal(r.status, 502); assert.ok(!/apps script|google|exception/i.test(j.error), j.error);
ok("Apps Script failure -> 502 with a plain message");

// 10. Rate limits. Counted so far: orders 3 (first, SAT2, FailMe), bookings 1.
const codes = []; for (let i = 0; i < 4; i++) codes.push((await post("/api/order", order({ pickupDate: SAT2 }))).status);
assert.deepEqual(codes, [200, 200, 429, 429], "orders: 5 per hour per IP");
r = await post("/api/order", order({ pickupDate: SAT2 })); assert.ok(r.headers.get("retry-after"));
const bc = []; for (let i = 0; i < 4; i++) bc.push((await post("/api/booking", booking())).status);
assert.deepEqual(bc, [200, 200, 429, 429], "bookings: 3 per hour per IP");
ok("per-IP limits: 5 orders and 3 bookings per hour, then 429 with Retry-After");
clearRateLimits();
await resetPickups([]);
console.log(`forms-api: all ${n} groups passed`);
