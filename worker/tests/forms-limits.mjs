// Form rate limits and the Apps Script token rule, against the real Worker code with a fake clock and fake Durable Objects.
// Run: node worker/tests/forms-limits.mjs
import assert from "node:assert/strict";
import { YOCO_TEST_ENV, bundle, fakeLimiter, fakeOrders, fakeYocoFetch } from "./_bundle.mjs";
const { handleForm } = await bundle("worker/forms.ts");
const sast = (iso, time = "12:00:00") => Date.parse(`${iso}T${time}+02:00`);
const NOW = sast("2026-11-16"); // a Monday; Saturday 28 Nov (the last of the month, open since the 15th) is the one on the list
const TOKEN = "k7Vq2mXw9LpR4sTz8NbC3dHf6JyA1eGu0QiO5vWx";
const fetched = [];
// Orders now open a Yoco checkout (the fake answers it) and send NO email; bookings still go to the (fake) Apps Script.
globalThis.fetch = fakeYocoFetch(async (url, init) => { fetched.push({ url, body: JSON.parse(init.body) }); return new Response('{"ok":true}'); });
const ordersFor = new WeakMap();
const kv = (() => { const m = new Map([["pickups", JSON.stringify({ pickups: [{ id: "p1", name: "Kenilworth Corner", area: "Main Rd", days: "", active: true }] })]]); return { get: async (k) => m.get(k) ?? null, put: async () => {} }; })();

async function run(lim, { ip = "203.0.113.5", email = "a@example.com", kind = "order", env = {} } = {}) {
  if (!ordersFor.has(lim)) ordersFor.set(lim, await fakeOrders({ now: () => NOW }));
  const e = { LIMITER: lim.ns, ORDERS: ordersFor.get(lim).ns, ...YOCO_TEST_ENV, STUFFD_KV: kv, ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec", APPS_SCRIPT_TOKEN: TOKEN, ...env };
  const body = kind === "order"
    ? { name: "Aisha", phone: "0821234567", email, pickupId: "p1", pickupDate: "2026-11-28", items: { "Classic Bagel": 1 }, website: "", attemptId: crypto.randomUUID() }
    : { name: "Sam", phone: "0821234567", email, eventDate: "2026-12-20", venue: "Hall", guests: 20, details: "", website: "" };
  try {
    const res = await handleForm(new Request("http://x/api/" + kind, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), e, kind, NOW);
    return { status: res.status, body: await res.json() };
  } catch (err) { return { status: err.status ?? 500, body: { error: err.message }, headers: err.headers }; }
}
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const mk = () => fakeLimiter({ now: () => NOW });

// token rule (M3)
let lim = await mk();
for (const env of [{ APPS_SCRIPT_TOKEN: undefined }, { APPS_SCRIPT_TOKEN: "" }, { APPS_SCRIPT_TOKEN: "short" }, { APPS_SCRIPT_URL: undefined }]) {
  fetched.length = 0; globalThis.fetch.calls.length = 0;
  for (const kind of ["order", "booking"]) {
    const r = await run(lim, { email: `t${n}@example.com`, env, kind });
    assert.equal(r.status, 503); assert.match(r.body.error, /isn't switched on/); assert.equal(fetched.length, 0, "nothing is sent to Apps Script without URL and a 32+ character token");
  }
  assert.equal(globalThis.fetch.calls.length, 0, "and no Yoco checkout is made (we won't take money we can't email about)");
}
fetched.length = 0;
assert.equal((await run(lim, { email: "tok@example.com", kind: "booking" })).status, 200);
assert.equal(fetched.length, 1); assert.equal(fetched[0].body.token, TOKEN);
fetched.length = 0;
const ordered = await run(lim, { email: "tok2@example.com" });
assert.equal(ordered.status, 200); assert.match(ordered.body.redirectUrl, /^https:\/\/c\.yoco\.com\//); assert.equal(fetched.length, 0, "an order sends no email until it is paid");
ok("no forwarding without APPS_SCRIPT_URL and a 32+ character APPS_SCRIPT_TOKEN (orders and bookings); a booking sends the token; an order opens a checkout and sends nothing");

// IPv6 /64 (#5): 8 different addresses in one /64 share one limit of 5 orders per hour
lim = await mk();
const net = "2001:db8:aaaa:bbbb";
const codes = [];
for (let i = 1; i <= 8; i++) codes.push((await run(lim, { ip: `${net}::${i}`, email: `v6u${i}@example.com` })).status);
assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429, 429]);
assert.equal((await run(lim, { ip: "2001:db8:aaaa:cccc::1", email: "other@example.com" })).status, 200, "another /64 is separate");
ok("orders: 5 per hour per IPv6 /64, however the low 64 bits change");

// booking limit 3 per hour per network
lim = await mk();
const bc = []; for (let i = 0; i < 5; i++) bc.push((await run(lim, { kind: "booking", ip: `${net}::${i + 1}`, email: `bk${i}@example.com` })).status);
assert.deepEqual(bc, [200, 200, 200, 429, 429]);
ok("bookings: 3 per hour per network");

// per recipient: 3 per day; Gmail dots and +tags are the same mailbox; refusal does not burn the sender's hour
lim = await mk();
const rc = [];
for (const [i, mail] of ["Sam.Smith@gmail.com", "samsmith+a@gmail.com", "SAMSMITH@googlemail.com", "s.a.m.smith@gmail.com"].entries()) rc.push((await run(lim, { ip: `198.51.100.${i + 1}`, email: mail })).status);
assert.deepEqual(rc, [200, 200, 200, 429]);
const r4 = await run(lim, { ip: "198.51.100.9", email: "sam.smith@gmail.com" }); assert.equal(r4.status, 429); assert.match(r4.body.error, /email address/);
for (let i = 0; i < 5; i++) assert.equal((await run(lim, { ip: "198.51.100.77", email: `fresh${i}@example.com` })).status, 200);
ok("3 per mailbox per day (dots and +tags count once); a refusal for one address does not use up the sender's own limit");

// shared daily cap 40
lim = await mk();
let accepted = 0, first429;
for (let i = 0; i < 50; i++) { const r = await run(lim, { ip: `192.0.2.${i + 1}`, email: `cap${i}@example.com` }); if (r.status === 200) accepted++; else if (!first429) first429 = r; }
assert.equal(accepted, 40); assert.match(first429.body.error, /busy day/);
ok("shared cap: 40 submissions a day (80 emails, under Gmail's 100)");

// store down: fail closed
lim = await mk(); lim.state.fail = true; fetched.length = 0; globalThis.fetch.calls.length = 0;
const down = await run(lim, { email: "down@example.com" });
assert.equal(down.status, 503); assert.equal(fetched.length, 0); assert.equal(globalThis.fetch.calls.length, 0, "no Yoco checkout while the limiter is down");
assert.equal((await run({ ns: undefined, state: {} }, { email: "nobinding@example.com", env: { LIMITER: undefined } })).status, 503);
ok("counter store unreachable or not bound: 503, nothing forwarded");
console.log(`forms-limits: all ${n} groups passed`);
