// The payment path end to end in Node: the REAL order handler (forms.ts), webhook / status / attention handlers (payments.ts),
// Yoco client (yoco.ts), mailer and state machine, with a fake clock, fake Durable Objects, a fake KV and a fake Yoco + Apps Script
// behind a stubbed fetch. Run: node worker/tests/payments-handler.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { TEST_CANCEL_SECRET, TS_DUMMY_TOKEN, bundle, fakeLimiter, fakeOrders, fakeSiteverify } from "./_bundle.mjs";
const { handleForm } = await bundle("worker/forms.ts");
const { handleWebhook, handleStatus, handleAttention } = await bundle("worker/payments.ts");
const { trySend } = await bundle("worker/mailer.ts");

const sast = (iso, time = "12:00:00") => Date.parse(`${iso}T${time}+02:00`);
const NOW = sast("2026-11-16"); // Monday; Saturday 28 Nov is open (opened on the 15th)
const clock = { t: NOW, now: () => clock.t };
const TOKEN = "k7Vq2mXw9LpR4sTz8NbC3dHf6JyA1eGu0QiO5vWx";
const WH_KEY = crypto.randomBytes(24);
const WH_SECRET = "whsec_" + WH_KEY.toString("base64");
const baseEnv = { APP_ENV: "development", CANCEL_LINK_SECRET: TEST_CANCEL_SECRET, ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec", APPS_SCRIPT_TOKEN: TOKEN, YOCO_SECRET_KEY: "sk_test_localfake1234567890", YOCO_WEBHOOK_SECRET: WH_SECRET, YOCO_MODE: "test", SITE_ORIGIN: "https://stuffdbagels-preview.example.workers.dev" };
const kv = (() => { const m = new Map([["pickups", JSON.stringify({ pickups: [{ id: "p1", name: "Kenilworth Corner", area: "Main Rd", days: "", active: true }] })]]); return { get: async (k) => m.get(k) ?? null, put: async () => {} }; })();

// --- fake Yoco + fake Apps Script behind fetch
const yoco = { calls: [], mode: "ok", n: 0 };
const script = { calls: [], fail: 0 };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const ts = fakeSiteverify(url, init);
  if (ts) return ts;
  if (u.startsWith("https://payments.yoco.com/api/checkouts")) {
    yoco.calls.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
    if (yoco.mode === "down") return new Response("{}", { status: 500 });
    if (yoco.mode === "throw") throw new Error("network");
    const id = `ch_${++yoco.n}${crypto.randomBytes(3).toString("hex")}`;
    const redirectUrl = yoco.mode === "evil" ? "https://evil.example/pay" : yoco.mode === "evil2" ? "https://payments.yoco.com.evil.example/pay" : `https://c.yoco.com/checkout/${id}`;
    return new Response(JSON.stringify({ id, status: "created", redirectUrl, processingMode: yoco.mode === "livemode" ? "live" : "test" }), { status: 201 });
  }
  if (u === "http://fake/exec") {
    script.calls.push(JSON.parse(init.body));
    if (script.fail > 0) { script.fail--; return new Response('{"ok":false}'); }
    return new Response('{"ok":true}');
  }
  throw new Error("unexpected fetch " + u);
};
// --- capture console so we can prove no personal data is logged
const logs = [];
for (const k of ["log", "error", "warn", "info"]) console[k] = ((orig) => (...a) => logs.push(a.map(String).join(" ")))(console[k]);
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
let n = 0;
const ok = (name) => out("PASS", ++n, name);

const UUID = () => crypto.randomUUID();
let mailN = 0;
const body = (o = {}) => ({ name: "Aisha Khan", phone: "0821234567", email: `aisha.private${++mailN}@example.com`, pickupId: "p1", pickupDate: "2026-11-28", items: { "Classic Bagel": 1 }, website: "", attemptId: UUID(), turnstileToken: TS_DUMMY_TOKEN, ...o });
let ipN = 0;
async function ctx() {
  const lim = await fakeLimiter({ now: () => clock.t });
  const ord = await fakeOrders(clock);
  return { lim, ord, env: (extra = {}) => ({ ...baseEnv, LIMITER: lim.ns, ORDERS: ord.ns, STUFFD_KV: kv, ...extra }) };
}
async function order(c, b, { env = c.env(), ip = `203.0.113.${++ipN % 250 + 1}` } = {}) {
  try {
    const res = await handleForm(new Request("http://x/api/order", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(b) }), env, "order", clock.t);
    return { status: res.status, body: await res.json() };
  } catch (e) { return { status: e.status ?? 500, body: { error: e.message } }; }
}
function signed(payload, { id = "msg_" + crypto.randomUUID(), ts = Math.floor(clock.t / 1000), secretKey = WH_KEY, type = "payment.succeeded" } = {}) {
  const raw = JSON.stringify({ id: "evt_" + id, type, createdDate: "2026-11-16T10:00:00Z", payload });
  const sig = crypto.createHmac("sha256", secretKey).update(`${id}.${ts}.${raw}`).digest("base64");
  return { raw, headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + sig, "content-type": "application/json" } };
}
async function hook(c, w, env = c.env()) {
  try {
    const res = await handleWebhook(new Request("http://x/api/yoco/webhook", { method: "POST", headers: w.headers, body: w.raw }), env, clock.t);
    return { status: res.status, body: await res.json() };
  } catch (e) { return { status: e.status ?? 500, body: { error: e.message } }; }
}
const payEvt = (checkoutId, over = {}) => ({ id: "p_" + crypto.randomUUID().slice(0, 8), amount: 6500, currency: "ZAR", mode: "test", status: "succeeded", type: "payment", metadata: { checkoutId }, paymentMethodDetails: { type: "card", card: { maskedCard: "411111******1111", cardHolder: "AISHA KHAN" } }, ...over });
const alarm = (c) => c.ord.svc.tick((row) => trySend(baseEnv, { ...JSON.parse(row.orderJson), paid: true, checkoutId: row.checkoutId }));

// 1. An order opens a Yoco checkout and sends NO email; the amount is the server's, in cents
let c = await ctx();
let b = body({ items: { "Steak'd Bagel": 1, "Classic Bagel": 2 }, total: 1, amount: 1, price: 1 });
let r = await order(c, b);
assert.equal(r.status, 200); assert.match(r.body.ref, /^SB-[A-Z2-9]{6}$/); assert.equal(r.body.total, 245); assert.match(r.body.redirectUrl, /^https:\/\/c\.yoco\.com\/checkout\/ch_/);
assert.equal(script.calls.length, 0, "no email before payment");
assert.equal(yoco.calls.length, 1);
const y = yoco.calls[0];
assert.equal(y.body.amount, 24500, "R245 in cents, whatever the browser sent"); assert.equal(y.body.currency, "ZAR");
assert.equal(y.headers["Idempotency-Key"], b.attemptId); assert.match(y.headers.Authorization, /^Bearer sk_test_/);
assert.equal(y.body.externalId, r.body.ref); assert.deepEqual(y.body.metadata, { ref: r.body.ref });
assert.equal(y.body.successUrl, `${baseEnv.SITE_ORIGIN}/order/result?r=success&ref=${r.body.ref}`);
assert.equal(y.body.cancelUrl, `${baseEnv.SITE_ORIGIN}/order/result?r=cancel&ref=${r.body.ref}`);
assert.equal(y.body.failureUrl, `${baseEnv.SITE_ORIGIN}/order/result?r=failure&ref=${r.body.ref}`);
const sum = y.body.lineItems.reduce((s, l) => s + l.quantity * l.pricingDetails.price, 0); assert.equal(sum, y.body.amount, "line items add up to the amount");
const exp = Date.parse(y.body.expiresAt); assert.equal(exp - clock.t, 31 * 60_000); assert.match(y.body.expiresAt, /Z$/);
const sentToYoco = JSON.stringify(y.body);
for (const pii of ["Aisha", "0821234567", "+27821234567", "aisha.private", "Kenilworth", "No onions"]) assert.ok(!sentToYoco.includes(pii), "no personal data to Yoco: " + pii);
ok("order -> checkout: server amount in cents, Idempotency-Key = attemptId, ref only in metadata, return URLs, expiresAt +31 min, no personal data, no email sent");

// 2. Double submit with one attemptId: one Yoco call, same redirect, no extra rate-limit slot
c = await ctx(); yoco.calls.length = 0;
const same = body(); const ip = "198.51.100.7";
const first = await order(c, same, { ip });
const again = await order(c, same, { ip });
assert.equal(first.status, 200); assert.equal(again.status, 200);
assert.equal(again.body.ref, first.body.ref); assert.equal(again.body.redirectUrl, first.body.redirectUrl);
assert.equal(yoco.calls.length, 1, "one Yoco call for two presses");
assert.equal(c.ord.rows().length, 1);
const par = await Promise.all(Array.from({ length: 6 }, () => order(c, body({ attemptId: same.attemptId }), { ip })));
assert.equal(c.ord.rows().length, 1); assert.equal(yoco.calls.length, 1);
ok("double / parallel submit with one attemptId: one Yoco call and one row, the same redirect every time");
// the five-per-hour network limit counts presses, not repeats of one press
for (let i = 0; i < 4; i++) assert.equal((await order(c, body(), { ip })).status, 200);
assert.equal((await order(c, body(), { ip })).status, 429, "the 6th distinct order from one network in an hour is refused (5 an hour)");
assert.equal((await order(c, same, { ip })).status, 200, "but a repeat of an earlier press still answers");
ok("rate limit counts distinct presses (5 an hour); a repeat of an earlier press still gets its answer");

// 3. Changed cart with the same attemptId -> 409; unknown / bad attemptId -> 400
c = await ctx(); const p1 = body(); await order(c, p1);
r = await order(c, { ...p1, items: { "Classic Bagel": 3 } }); assert.equal(r.status, 409); assert.match(r.body.error, /changed/);
for (const bad of [undefined, "", "not-a-uuid", "00000000-0000-1000-8000-000000000000", 5, "x".repeat(300)]) { r = await order(c, body({ attemptId: bad })); assert.equal(r.status, 400, String(bad)); }
ok("same attemptId with a changed cart -> 409 'press Pay again'; missing or non-UUID-v4 attemptId -> 400");

// 4. Expired attempt -> 409
c = await ctx(); const p2 = body(); await order(c, p2);
clock.t = NOW + 31 * 60_000; r = await order(c, p2); assert.equal(r.status, 409); assert.match(r.body.error, /timed out/); clock.t = NOW;
ok("repeating an attemptId after its 30 minutes -> 409 (the browser starts a new press)");

// 5. Yoco failures: 502, row dropped, slots refunded, nothing orphaned
for (const mode of ["down", "throw", "evil", "evil2", "livemode"]) {
  c = await ctx(); yoco.mode = mode;
  r = await order(c, body(), { ip: "192.0.2.50" });
  assert.equal(r.status, 502, mode); assert.match(r.body.error, /payment page didn't open/);
  assert.equal(c.ord.rows().length, 0, "row dropped: " + mode);
  yoco.mode = "ok";
  // the slots were given back: 5 more presses from the same network still fit
  for (let i = 0; i < 5; i++) assert.equal((await order(c, body(), { ip: "192.0.2.50" })).status, 200, `${mode}: slot ${i}`);
}
ok("Yoco 5xx, network error, redirect to another host (incl. look-alike hostname) or a live checkout on a test key: 502, row dropped, rate-limit slots refunded");

// 6. Not switched on: missing secrets / wrong key prefix / no mode / no binding -> 503, nothing counted, nothing sent
yoco.calls.length = 0;
for (const [name, extra] of [["no key", { YOCO_SECRET_KEY: undefined }], ["no webhook secret", { YOCO_WEBHOOK_SECRET: undefined }], ["live key on test mode", { YOCO_SECRET_KEY: "sk_live_localfake1234567890" }],
  ["test key on live mode", { YOCO_MODE: "live" }], ["no mode", { YOCO_MODE: undefined }], ["no origin", { SITE_ORIGIN: undefined }], ["no ORDERS", { ORDERS: undefined }], ["no script url", { APPS_SCRIPT_URL: undefined }], ["short token", { APPS_SCRIPT_TOKEN: "short" }]]) {
  c = await ctx(); r = await order(c, body(), { env: c.env(extra) });
  assert.equal(r.status, 503, name); assert.match(r.body.error, /isn't switched on/);
  assert.equal(c.lim.keys().length, 0, name + ": nothing counted");
}
assert.equal(yoco.calls.length, 0);
ok("missing key / webhook secret / mode / origin / ORDERS / script, or a key whose prefix disagrees with YOCO_MODE: 503, no Yoco call, no rate-limit use");

// 7. Store down: fail closed
c = await ctx(); c.ord.state.fail = true; r = await order(c, body()); assert.equal(r.status, 503); assert.equal(yoco.calls.length, 0);
ok("Orders object unreachable: 503, no Yoco call");

// 8. Webhook: verified payment -> paid once -> exactly one script call (owner + customer sent by the script), paid:true; replays send nothing more
c = await ctx(); script.calls.length = 0; logs.length = 0;
const o1 = await order(c, body()); const ch1 = c.ord.rows()[0].checkoutId;
assert.equal(await c.ord.svc.status(o1.body.ref), "pending");
const w1 = signed(payEvt(ch1));
let h = await hook(c, w1); assert.equal(h.status, 200);
assert.equal(c.ord.svc.status(o1.body.ref), "paid");
assert.equal(script.calls.length, 0, "the webhook answers at once; the alarm sends");
await alarm(c);
assert.equal(script.calls.length, 1); const mail = script.calls[0];
assert.equal(mail.type, "order"); assert.equal(mail.paid, true); assert.equal(mail.checkoutId, ch1); assert.equal(mail.ref, o1.body.ref); assert.equal(mail.token, TOKEN); assert.match(mail.email, /^aisha\.private\d+@example\.com$/);
assert.equal(c.ord.rows()[0].status, "confirmed"); assert.equal(c.ord.rows()[0].orderJson, null);
// the same delivery again, a retry with a new id/timestamp, and a replay of the captured request
assert.equal((await hook(c, w1)).status, 200);
assert.equal((await hook(c, signed(payEvt(ch1)))).status, 200);
await alarm(c);
assert.equal(script.calls.length, 1, "replays and duplicate deliveries send no second email");
ok("signed payment.succeeded -> paid once -> one email request with paid:true and the checkout id; same / retried / replayed deliveries add none");

// 9. Bad signature 401, stale 400, future 400, missing headers 400, nothing changes
c = await ctx(); script.calls.length = 0; await order(c, body()); const ch2 = c.ord.rows()[0].checkoutId;
const good = signed(payEvt(ch2));
assert.equal((await hook(c, { ...good, raw: good.raw.replace("6500", "6400") })).status, 401);
assert.equal((await hook(c, signed(payEvt(ch2), { secretKey: crypto.randomBytes(24) }))).status, 401);
assert.equal((await hook(c, signed(payEvt(ch2), { ts: Math.floor(clock.t / 1000) - 181 }))).status, 400);
assert.equal((await hook(c, signed(payEvt(ch2), { ts: Math.floor(clock.t / 1000) + 181 }))).status, 400);
assert.equal((await hook(c, { raw: good.raw, headers: {} })).status, 400);
const oldSig = good.headers["webhook-signature"];
assert.equal((await hook(c, { raw: good.raw, headers: { ...good.headers, "webhook-timestamp": String(Math.floor(clock.t / 1000) + 5), "webhook-signature": oldSig } })).status, 401, "old signature with a fresh timestamp");
assert.equal(c.ord.rows()[0].status, "pending"); await alarm(c); assert.equal(script.calls.length, 0);
ok("forged / tampered / stale / future / header-less webhooks refused (401 or 400): order stays pending, no email");

// 10. Amount / currency mismatch -> no email, listed for the owner
c = await ctx(); script.calls.length = 0; await order(c, body()); const ch3 = c.ord.rows()[0].checkoutId;
assert.equal((await hook(c, signed(payEvt(ch3, { amount: 100 })))).status, 200);
await alarm(c); assert.equal(script.calls.length, 0);
assert.equal(c.ord.rows()[0].status, "mismatch");
const att = await (await handleAttention(c.env())).json();
assert.equal(att.count, 1); assert.equal(att.items[0].status, "mismatch"); assert.equal(att.items[0].order.name, "Aisha Khan");
c = await ctx(); await order(c, body()); const ch4 = c.ord.rows()[0].checkoutId;
await hook(c, signed(payEvt(ch4, { currency: "USD" }))); assert.equal(c.ord.rows()[0].status, "mismatch");
ok("verified payment for the wrong amount or currency: 200, no email, status mismatch, shown under attention with the order details");

// 11. Mode mismatch: a test event on a live Worker (and the reverse) is ignored; so is a live-key check on a test event
c = await ctx(); script.calls.length = 0; await order(c, body()); const ch5 = c.ord.rows()[0].checkoutId;
const liveEnv = c.env({ YOCO_MODE: "live", YOCO_SECRET_KEY: "sk_live_localfake1234567890" });
h = await hook(c, signed(payEvt(ch5, { mode: "test" })), liveEnv); assert.equal(h.status, 200);
assert.equal(c.ord.rows()[0].status, "pending", "test event did not confirm an order on a live Worker");
h = await hook(c, signed(payEvt(ch5, { mode: "live" }))); assert.equal(h.status, 200);
assert.equal(c.ord.rows()[0].status, "pending", "live event did not confirm an order on a test Worker");
await alarm(c); assert.equal(script.calls.length, 0);
assert.equal((await hook(c, signed(payEvt(ch5, { mode: undefined })))).status, 200); assert.equal(c.ord.rows()[0].status, "pending");
ok("mode mismatch (test event on live, live event on test, no mode): 200 and ignored, order stays pending");

// 12. Other events and unknown checkouts: 200, nothing happens; webhook not switched on: 503
c = await ctx(); await order(c, body()); const ch6 = c.ord.rows()[0].checkoutId;
assert.equal((await hook(c, signed(payEvt(ch6), { type: "refund.succeeded" }))).status, 200);
assert.equal((await hook(c, signed(payEvt(ch6), { type: "payment.failed" }))).status, 200);
assert.equal(c.ord.rows()[0].status, "pending");
logs.length = 0;
assert.equal((await hook(c, signed(payEvt("ch_unknown", { metadata: { checkoutId: "ch_unknown", orderNo: "7" } })))).status, 200);
assert.ok(logs.some((l) => l.includes("unmatched") && l.includes("checkoutId") && l.includes("orderNo")), "an unmatched event logs the metadata KEY NAMES");
assert.ok(!logs.some((l) => l.includes("ch_unknown")), "but not the values");
assert.equal((await hook(c, signed(payEvt(ch6)), c.env({ YOCO_WEBHOOK_SECRET: undefined }))).status, 503);
assert.equal((await hook(c, { raw: "x".repeat(70000), headers: { "content-length": "70000" } })).status, 413);
assert.equal((await hook(c, { raw: "not json", headers: signed({}, {}).headers })).status, 401);
const notJson = (() => { const id = "m1", ts = Math.floor(clock.t / 1000), raw = "not json"; return { raw, headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + crypto.createHmac("sha256", WH_KEY).update(`${id}.${ts}.${raw}`).digest("base64") } }; })();
assert.equal((await hook(c, notJson)).status, 400);
ok("other event types ignored; unmatched checkout logs key names only; secret unset -> 503; 70 KB body -> 413; signed non-JSON -> 400");

// 13. Fallback when Yoco passes our ref metadata instead of a checkout id
c = await ctx(); script.calls.length = 0; const o13 = await order(c, body());
assert.equal((await hook(c, signed(payEvt(null, { metadata: { ref: o13.body.ref } })))).status, 200);
assert.equal(c.ord.svc.status(o13.body.ref), "paid");
ok("no metadata.checkoutId but metadata.ref present: matched by ref (amount still checked)");

// 14. Email retry through the alarm: script fails twice, then accepts; the owner is told if it never does
c = await ctx(); script.calls.length = 0; script.fail = 2; const o14 = await order(c, body()); const ch14 = c.ord.rows()[0].checkoutId;
await hook(c, signed(payEvt(ch14)));
await alarm(c); assert.equal(c.ord.rows()[0].status, "paid", "first try failed");
clock.t += 61_000; await alarm(c); assert.equal(c.ord.rows()[0].status, "paid", "second try failed");
clock.t += 5 * 60_000 + 1000; await alarm(c); assert.equal(c.ord.rows()[0].status, "confirmed");
assert.equal(script.calls.length, 3); assert.ok(script.calls.every((m) => m.ref === o14.body.ref && m.paid === true), "the same order each time (Code.gs de-duplicates by ref)");
clock.t = NOW;
c = await ctx(); script.fail = 99; await order(c, body()); await hook(c, signed(payEvt(c.ord.rows()[0].checkoutId)));
for (let i = 0; i < 6; i++) { await alarm(c); const rw = c.ord.rows()[0]; if (rw.nextTryAt) clock.t = rw.nextTryAt; }
assert.equal(c.ord.rows()[0].status, "email_failed"); script.fail = 0; clock.t = NOW;
const att2 = await (await handleAttention(c.env())).json(); assert.equal(att2.count, 1); assert.equal(att2.items[0].status, "email_failed"); assert.match(att2.items[0].order.email, /^aisha\.private\d+@example\.com$/);
ok("emails: script fails twice then accepts -> confirmed after retries; if it never does -> email_failed and listed under attention with the order");

// 15. Status endpoint: only a status, limited per network, junk refs are unknown
c = await ctx(); const o15 = await order(c, body());
const st = async (ref, ip = "203.0.113.200", env = c.env()) => { try { const res = await handleStatus(new Request("http://x/api/order/status?ref=" + ref, { headers: { "CF-Connecting-IP": ip } }), env); return { status: res.status, body: await res.json() }; } catch (e) { return { status: e.status, body: { error: e.message } }; } };
assert.deepEqual((await st(o15.body.ref)).body, { status: "pending" });
await hook(c, signed(payEvt(c.ord.rows()[0].checkoutId)));
assert.deepEqual((await st(o15.body.ref)).body, { status: "paid" });
assert.deepEqual((await st("SB-ZZZZZZ")).body, { status: "unknown" }); assert.deepEqual((await st("../../x")).body, { status: "unknown" });
for (let i = 0; i < 70; i++) await st(o15.body.ref, "203.0.113.201");
assert.equal((await st(o15.body.ref, "203.0.113.201")).status, 429, "60 an hour per network");
assert.equal((await st(o15.body.ref, "203.0.113.202")).status, 200);
c.ord.state.fail = true; assert.equal((await st(o15.body.ref, "203.0.113.203")).status, 503);
ok("status endpoint: pending -> paid, junk refs unknown, 60 an hour per network, fails closed");

// 16. No personal data in any log line
const all = logs.join("\n");
for (const pii of ["Aisha", "aisha.private", "0821234567", "+27821234567", "Kenilworth", "411111", "AISHA KHAN", "sk_test_", "whsec_", TOKEN]) assert.ok(!all.includes(pii), "log contains: " + pii);
ok(`no name, email, phone, card or secret in ${logs.length} captured log lines`);
out(`payments-handler: all ${n} groups passed`);
