// Automatic refunds end to end in Node: the REAL order handler (forms.ts), webhook (payments.ts), cancel handlers (cancel.ts), Yoco client,
// token code and state machine, with a fake clock, fake Durable Objects, a fake KV and a fake Yoco + Apps Script behind a stubbed fetch.
// Yoco only refunds LIVE checkouts, so the refund call is always the stub here. Run: node worker/tests/cancel-handler.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { TEST_CANCEL_SECRET, TS_DUMMY_TOKEN, bundle, fakeLimiter, fakeOrders, fakeSiteverify } from "./_bundle.mjs";
const { handleForm } = await bundle("worker/forms.ts");
const { handleWebhook } = await bundle("worker/payments.ts");
const { handleCancel, handleCancelCheck, CANCEL_LIMITS } = await bundle("worker/cancel.ts");
const { trySend } = await bundle("worker/mailer.ts");
const T = await bundle("worker/cancel-token.ts");

const sast = (iso, time = "12:00:00.000") => Date.parse(`${iso}T${time}+02:00`);
const NOW = sast("2026-11-16"); // Monday; Saturday 28 Nov is open
const BY = sast("2026-11-26", "00:00:00.000"); // Wed 25 Nov 23:59 is the last minute
const clock = { t: NOW, now: () => clock.t };
const MAILTOKEN = "k7Vq2mXw9LpR4sTz8NbC3dHf6JyA1eGu0QiO5vWx";
const WH_KEY = crypto.randomBytes(24);
const baseEnv = { APP_ENV: "development", CANCEL_LINK_SECRET: TEST_CANCEL_SECRET, ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec", APPS_SCRIPT_TOKEN: MAILTOKEN, YOCO_SECRET_KEY: "sk_test_localfake1234567890", YOCO_WEBHOOK_SECRET: "whsec_" + WH_KEY.toString("base64"), YOCO_MODE: "test", SITE_ORIGIN: "https://stuffdbagels-preview.example.workers.dev" };
const kv = (() => { const m = new Map([["pickups", JSON.stringify({ pickups: [{ id: "p1", name: "Strandfontein collection", area: "Strandfontein", days: "", active: true }] })]]); return { get: async (k) => m.get(k) ?? null, put: async () => {} }; })();

// --- fake Yoco (create + refund) and fake Apps Script behind fetch
const yoco = { created: 0, refunds: [], refundMode: "succeeded", delayMs: 0, byKey: new Map(), refunded: new Set(), siteverify: 0 };
const script = { calls: [] };
const realSiteverify = fakeSiteverify;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("siteverify")) yoco.siteverify++;
  const ts = realSiteverify(url, init);
  if (ts) return ts;
  let m;
  if (u === "https://payments.yoco.com/api/checkouts") {
    const id = `ch_${++yoco.created}${crypto.randomBytes(3).toString("hex")}`;
    return new Response(JSON.stringify({ id, status: "created", redirectUrl: `https://c.yoco.com/checkout/${id}`, processingMode: "test" }), { status: 201 });
  }
  if ((m = /^https:\/\/payments\.yoco\.com\/api\/checkouts\/([A-Za-z0-9_-]+)\/refund$/.exec(u))) {
    yoco.refunds.push({ id: m[1], method: init.method, headers: init.headers, body: init.body });
    if (yoco.delayMs) await new Promise((r) => setTimeout(r, yoco.delayMs));
    const key = init.headers["Idempotency-Key"];
    if (yoco.byKey.has(key)) return new Response(JSON.stringify(yoco.byKey.get(key)), { status: 200 });
    if (yoco.refundMode === "throw") throw new Error("network down");
    if (yoco.refundMode === "500") return new Response("{}", { status: 500 });
    if (yoco.refundMode === "garbage") return new Response('{"hello":"world"}', { status: 200 });
    if (yoco.refunded.has(m[1])) return new Response('{"error":"already refunded"}', { status: 422 }); // a second refund under a different key
    const out = { refundId: "rfd_" + crypto.randomBytes(6).toString("hex"), status: yoco.refundMode === "pending" ? "pending" : "succeeded" };
    yoco.refunded.add(m[1]); yoco.byKey.set(key, out);
    return new Response(JSON.stringify(out), { status: 200 });
  }
  if (u === "http://fake/exec") { script.calls.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
  throw new Error("unexpected fetch " + u);
};
const logs = [];
for (const k of ["log", "error", "warn", "info"]) console[k] = ((orig) => (...a) => logs.push(a.map(String).join(" ")))(console[k]);
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
let n = 0;
const ok = (name) => out("PASS", ++n, name);

let mailN = 0, ipN = 0;
const UUID = () => crypto.randomUUID();
const body = (o = {}) => ({ name: "Aisha Khan", phone: "0821234567", email: `aisha.private${++mailN}@example.com`, pickupId: "p1", pickupDate: "2026-11-28", pickupTime: "13:00", items: { "Classic Bagel": 1 }, note: "No onions please", website: "", attemptId: UUID(), turnstileToken: TS_DUMMY_TOKEN, ...o });
async function ctx() {
  const lim = await fakeLimiter({ now: () => clock.t });
  const ord = await fakeOrders(clock);
  return { lim, ord, env: (extra = {}) => ({ ...baseEnv, LIMITER: lim.ns, ORDERS: ord.ns, STUFFD_KV: kv, ...extra }) };
}
const call = async (fn) => { try { const res = await fn(); return { status: res.status, body: await res.json() }; } catch (e) { return { status: e.status ?? 500, body: { error: e.message } }; } };
const order = (c, b, env = c.env(), ip = `203.0.113.${++ipN % 250 + 1}`) => call(() => handleForm(new Request("http://x/api/order", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(b) }), env, "order", clock.t));
const post = (path, b, c, { env = c.env(), ip = "198.51.100.9", at = clock.t } = {}) => call(() => (path === "check" ? handleCancelCheck : handleCancel)(
  new Request("http://x/api/order/cancel", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(b) }), env, at));
const check = (c, token, o) => post("check", { token }, c, o);
const cancel = (c, token, over = {}, o) => post("cancel", { token, turnstileToken: TS_DUMMY_TOKEN, ...over }, c, o);
function signed(payload) {
  const id = "msg_" + crypto.randomUUID(), ts = Math.floor(clock.t / 1000);
  const raw = JSON.stringify({ id: "evt_" + id, type: "payment.succeeded", createdDate: "2026-11-16T10:00:00Z", payload });
  return { raw, headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + crypto.createHmac("sha256", WH_KEY).update(`${id}.${ts}.${raw}`).digest("base64") } };
}
// What the Orders object's alarm does (worker/orders.ts), with the same pure pieces: sign the link, send the confirmation, send cancellation emails.
async function alarm(c, env = baseEnv) {
  return c.ord.svc.tick(
    async (row) => {
      const link = row.cancelBy !== null && clock.t < row.cancelBy ? await T.cancelLink(env, row.ref, row.cancelBy) : null;
      return trySend(env, { ...JSON.parse(row.orderJson), paid: true, checkoutId: row.checkoutId, ...(link ? { cancelUrl: link, cancelByLabel: T.cancelByLabel(row.cancelBy) } : {}) });
    },
    async (row) => { const p = c.ord.svc.cancelMailPayload(row); return p ? trySend(env, p) : false; },
  );
}
/** A paid, confirmed order with its cancel link, the way a customer gets it. */
async function placed(c, over = {}) {
  clock.t = NOW;
  const r = await order(c, body(over));
  assert.equal(r.status, 200, JSON.stringify(r));
  const row = c.ord.rows().find((x) => x.ref === r.body.ref);
  const w = signed({ id: "p_" + crypto.randomUUID().slice(0, 8), amount: row.amountCents, currency: "ZAR", mode: "test", status: "succeeded", type: "payment", metadata: { checkoutId: row.checkoutId } });
  const h = await call(() => handleWebhook(new Request("http://x/api/yoco/webhook", { method: "POST", headers: w.headers, body: w.raw }), c.env(), clock.t));
  assert.equal(h.status, 200);
  script.calls.length = 0;
  await alarm(c);
  const confirm = script.calls.find((x) => x.type === "order");
  assert.ok(confirm, "the confirmation email was sent");
  const token = confirm.cancelUrl ? confirm.cancelUrl.split("#")[1] : null;
  return { ref: r.body.ref, checkoutId: row.checkoutId, token, confirm, row: () => c.ord.rows().find((x) => x.ref === r.body.ref) };
}
const reset = () => { yoco.refunds.length = 0; yoco.refundMode = "succeeded"; yoco.delayMs = 0; yoco.byKey.clear(); yoco.refunded.clear(); script.calls.length = 0; };

// 1. The order stores its cut-off and a SMALL set of cancel details; the confirmation email carries a signed link (the Worker signs, the script prints)
let c = await ctx(); reset();
let o = await placed(c);
assert.equal(o.row().cancelBy, BY, "cut-off = Thursday 00:00 SAST after Wednesday 25 Nov");
const cj = JSON.parse(o.row().cancelJson);
assert.deepEqual(Object.keys(cj).sort(), ["email", "items", "name", "phone", "pickupDate", "pickupPlace", "total"], "no note, no pickup time in the cancel details");
assert.ok(o.token, "the confirmation email has a cancel link");
assert.equal(o.confirm.cancelUrl, `${baseEnv.SITE_ORIGIN}/order/cancel#${o.token}`);
assert.equal(o.confirm.cancelByLabel, "Wednesday 25 Nov at 23:59");
assert.deepEqual(await T.verifyCancelToken(baseEnv, o.token), { ok: true, ref: o.ref, cancelByMs: BY });
ok("order -> paid -> confirmation email carries a Worker-signed link bound to the reference and the cut-off; cancel details exclude the note");

// 2. Secret missing or short: orders are refused BEFORE anything is counted or any money is taken
for (const [name, extra] of [["missing", { CANCEL_LINK_SECRET: undefined }], ["short", { CANCEL_LINK_SECRET: "x".repeat(31) }], ["empty", { CANCEL_LINK_SECRET: "" }]]) {
  c = await ctx(); const before = yoco.created; logs.length = 0;
  const r = await order(c, body(), c.env(extra));
  assert.equal(r.status, 503, name); assert.match(r.body.error, /isn't switched on/);
  assert.equal(yoco.created, before, name + ": no Yoco checkout"); assert.equal(c.lim.keys().length, 0, name + ": nothing counted"); assert.equal(c.ord.rows().length, 0);
  assert.ok(logs.some((l) => l.includes("CANCEL_LINK_SECRET")), name + ": a clear log line for the founder");
}
ok("CANCEL_LINK_SECRET missing, empty or under 32 characters: orders refused (503), no checkout, nothing counted, loud log line");

// 3. Check (read only): open, with the amount, the day and the cut-off, and no personal data
c = await ctx(); reset(); o = await placed(c);
let r = await check(c, o.token);
assert.equal(r.status, 200);
assert.deepEqual(r.body, { state: "open", ref: o.ref, total: 65, pickupDate: "2026-11-28", cancelBy: "Wednesday 25 Nov at 23:59", retry: false });
assert.ok(!/Aisha|aisha|0821234567|@/.test(JSON.stringify(r.body)), "no name, phone or email in the check answer");
assert.equal(yoco.refunds.length, 0, "opening the page never refunds");
assert.equal(o.row().refundState, null, "and changes nothing");
ok("check: state open with amount, collection day and cut-off; no personal data; nothing changes, no Yoco call");

// 4. Cancel: ONE full refund via Yoco with the exact request Yoco's docs describe; the browser's amount is ignored
reset();
r = await cancel(c, o.token, { amount: 1, amountCents: 1, total: 1 });
assert.equal(r.status, 200); assert.deepEqual(r.body, { state: "refunded", ref: o.ref, total: 65 });
assert.equal(yoco.refunds.length, 1);
const y = yoco.refunds[0];
assert.equal(y.id, o.checkoutId); assert.equal(y.method, "POST"); assert.equal(y.body, "{}", "full refund: no amount, whatever the browser sent");
assert.equal(y.headers["Idempotency-Key"], `refund-${o.ref}`); assert.match(y.headers.Authorization, /^Bearer sk_test_/);
assert.equal(o.row().refundState, "refunded"); assert.match(o.row().refundId, /^rfd_/);
ok("cancel: exactly one POST /api/checkouts/{checkoutId}/refund, body {}, Idempotency-Key refund-<ref>, Bearer key; an amount from the browser is ignored");

// 5. The emails: owner and customer (via the script), reminder deletion is the script's job on the same request
script.calls.length = 0; await alarm(c);
assert.equal(script.calls.length, 1); const m = script.calls[0];
assert.equal(m.type, "cancel"); assert.equal(m.outcome, "refunded"); assert.equal(m.ref, o.ref); assert.equal(m.checkoutId, o.checkoutId); assert.equal(m.token, MAILTOKEN);
assert.equal(m.name, "Aisha Khan"); assert.match(m.email, /^aisha\.private/); assert.equal(m.total, 65); assert.equal(m.pickupDate, "2026-11-28");
assert.equal(o.row().cmailState, "sent"); assert.equal(o.row().cancelJson, null, "details dropped once the script accepted them");
await alarm(c); assert.equal(script.calls.length, 1, "no second email");
ok("one cancellation request to the script (it emails the owner and the customer and deletes the reminder), then the personal data is dropped");

// 6. Idempotent: a second click, and ten parallel clicks, never call Yoco again
r = await cancel(c, o.token); assert.equal(r.status, 200); assert.deepEqual(r.body, { state: "refunded", ref: o.ref });
assert.equal(yoco.refunds.length, 1, "a second click does not touch Yoco");
c = await ctx(); reset(); o = await placed(c); yoco.delayMs = 15;
const burst = await Promise.all(Array.from({ length: CANCEL_LIMITS.cancelPerOrderPerHour }, (_, i) => cancel(c, o.token, {}, { ip: `198.51.100.${20 + i}` })));
assert.equal(yoco.refunds.length, 1, "six parallel clicks (the per-order limit): ONE Yoco call");
assert.equal(burst.filter((x) => x.body.state === "refunded").length, 1, "one request saw the refund happen");
assert.ok(burst.every((x) => x.status === 200 && ["refunded", "busy"].includes(x.body.state)), JSON.stringify(burst.map((x) => x.body.state)));
clock.t += 3601_000; // the per-order allowance (6 an hour) is spent: wait an hour
r = await cancel(c, o.token); assert.equal(r.body.state, "refunded"); assert.equal(yoco.refunds.length, 1);
ok("double click: no second refund; 6 parallel clicks from different networks (the most the per-order limit lets in): exactly one Yoco call, the rest are told it is being processed");

// 7. The cut-off, re-checked on the server at refund time
c = await ctx(); reset(); o = await placed(c);
r = await cancel(c, o.token, {}, { at: sast("2026-11-25", "23:59:59.999") }); // handler `now` is only used for the unknown-order fallback; the Orders clock decides
assert.equal(r.body.state, "refunded"); assert.equal(yoco.refunds.length, 1);
c = await ctx(); reset(); o = await placed(c);
clock.t = sast("2026-11-25", "23:59:59.999");
r = await cancel(c, o.token); assert.equal(r.body.state, "refunded", "Wed 23:59:59.999 SAST: still refundable"); assert.equal(yoco.refunds.length, 1);
c = await ctx(); reset(); o = await placed(c);
clock.t = sast("2026-11-26", "00:00:00.000");
r = await cancel(c, o.token); assert.deepEqual(r.body, { state: "closed", ref: o.ref }); assert.equal(yoco.refunds.length, 0, "Thu 00:00:00.000 SAST: no refund");
assert.equal((await check(c, o.token)).body.state, "closed");
assert.equal(o.row().refundState, null, "nothing changed");
for (const t of [sast("2026-11-26", "08:00:00.000"), sast("2026-11-28", "13:00:00.000"), sast("2026-12-20")]) { clock.t = t; r = await cancel(c, o.token); assert.equal(r.body.state, "closed"); }
assert.equal(yoco.refunds.length, 0, "after the cut-off there is no refund path at all");
ok("cut-off: Wed 23:59:59.999 SAST refunds, Thu 00:00:00.000 and everything later says closed (credit), with no Yoco call");

// 8. After the row is gone (deleted a day after the cut-off) a valid link still explains; before the cut-off an unknown order is just unknown
c = await ctx(); reset(); o = await placed(c);
clock.t = BY + 2 * 24 * 3600_000; await alarm(c); assert.equal(c.ord.rows().length, 0, "row deleted");
assert.equal((await check(c, o.token, { at: clock.t })).body.state, "closed"); assert.equal((await cancel(c, o.token, {}, { at: clock.t })).body.state, "closed");
clock.t = NOW;
const early = await T.makeCancelToken(baseEnv, "SB-ZZZZZZ", BY); // signed, but there is no such order
assert.equal((await check(c, early, { at: clock.t })).body.state, "unknown"); assert.equal((await cancel(c, early, {}, { at: clock.t })).body.state, "unknown");
assert.equal(yoco.refunds.length, 0);
ok("a valid link after its order's row is gone reads 'closed' (credit text); a signed link for an unknown order reads 'unknown'; no Yoco call");

// 9. Yoco pending counts as accepted: tell the customer it is processing, never refund twice
c = await ctx(); reset(); o = await placed(c); yoco.refundMode = "pending";
r = await cancel(c, o.token); assert.deepEqual(r.body, { state: "pending", ref: o.ref, total: 65 });
assert.equal(o.row().refundState, "pending");
await alarm(c); assert.equal(script.calls.at(-1).outcome, "pending");
r = await cancel(c, o.token); assert.equal(r.body.state, "pending"); assert.equal(yoco.refunds.length, 1);
assert.equal(c.ord.svc.attention().length, 0);
ok("Yoco 'pending': recorded as accepted, owner and customer told 'pending', a second click never refunds again");

// 10. Yoco failures: never marked refunded; owner told; customer may try again before the cut-off; the retry carries the SAME Idempotency-Key
for (const mode of ["500", "throw", "garbage"]) {
  c = await ctx(); reset(); o = await placed(c); yoco.refundMode = mode; logs.length = 0;
  r = await cancel(c, o.token);
  assert.equal(r.status, 200, mode); assert.equal(r.body.state, "failed", mode);
  assert.equal(o.row().refundState, "failed", mode); assert.equal(o.row().refundId, null);
  assert.notEqual(o.row().refundState, "refunded");
  await alarm(c); const mail = script.calls.at(-1);
  assert.equal(mail.type, "cancel"); assert.equal(mail.outcome, "failed", mode + ": the script is told the refund did NOT go through");
  assert.equal(c.ord.svc.attention()[0].status, "refund_failed");
  assert.ok(logs.some((l) => l.includes("refund failed:")), mode + ": reason logged");
  assert.ok(!logs.join("\n").includes(o.token) && !logs.join("\n").includes(o.checkoutId), mode + ": no token or checkout id in the logs");
  // the customer presses again after Yoco recovers
  yoco.refundMode = "succeeded";
  const again = await cancel(c, o.token); assert.equal(again.body.state, "refunded", mode + " retry");
  assert.deepEqual([...new Set(yoco.refunds.map((x) => x.headers["Idempotency-Key"]))], [`refund-${o.ref}`], "same key on both attempts");
  assert.equal(c.ord.svc.attention().length, 0, "no longer needs the owner");
  await alarm(c); assert.equal(script.calls.at(-1).outcome, "refunded", "and the owner hears about the success too");
}
ok("Yoco 500, network error or an answer without a refund id: state 'failed' (never 'refunded'), owner told, retry works with the same Idempotency-Key");

// 11. Yoco answers 'failed' status in a 200: not a refund
{
  c = await ctx(); reset(); o = await placed(c);
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).endsWith("/refund") ? new Response('{"refundId":"rfd_abc123","status":"failed"}') : real(u, i);
  r = await cancel(c, o.token); globalThis.fetch = real;
  assert.equal(r.body.state, "failed"); assert.equal(o.row().refundState, "failed");
}
ok("a 200 whose status is neither succeeded nor pending is a failure, never a refund");

// 12. The save after Yoco fails (Orders object hiccup): 503, nothing marked, the next press after 2 minutes repeats the call SAFELY (Yoco replays by key)
c = await ctx(); reset(); o = await placed(c); logs.length = 0;
let failFinish = true;
const flaky = { idFromName: c.ord.ns.idFromName, get: () => new Proxy({}, { get: (_t, name) => async (...args) => { if (name === "finishCancel" && failFinish) throw new Error("down"); return c.ord.svc[name](...args); } }) };
r = await cancel(c, o.token, {}, { env: c.env({ ORDERS: flaky }) });
assert.equal(r.status, 503); assert.equal(yoco.refunds.length, 1); assert.equal(o.row().refundState, "refunding");
assert.ok(logs.some((l) => l.includes("ACCEPTED by Yoco but not saved")), "loud log line for the owner");
r = await cancel(c, o.token); assert.equal(r.body.state, "busy", "inside 2 minutes: no second call"); assert.equal(yoco.refunds.length, 1);
clock.t += 121_000; failFinish = false;
r = await cancel(c, o.token); assert.equal(r.body.state, "refunded");
assert.equal(yoco.refunds.length, 2, "the call is repeated..."); assert.equal(new Set(yoco.refunds.map((x) => x.headers["Idempotency-Key"])).size, 1, "...with the same Idempotency-Key");
assert.equal(yoco.refunded.size, 1, "...and Yoco refunded once");
ok("Yoco answered but the save failed: 503, no false 'refunded'; after 2 minutes the repeat uses the same Idempotency-Key and Yoco refunds once");

// 13. Bad links cost nothing: no Turnstile call, no allowance, no storage
c = await ctx(); reset(); o = await placed(c);
const [rf, sec, sig] = o.token.split(".");
const before = { sv: yoco.siteverify, keys: c.lim.keys().length };
for (const t of [`${rf}.${Number(sec) + 7 * 86400}.${sig}`, `SB-AAAAAA.${sec}.${sig}`, `${rf}.${sec}.${sig.slice(0, -2)}AA`, "junk", "", undefined, 5, null]) {
  assert.equal((await cancel(c, t)).status, 400); assert.equal((await check(c, t)).status, 400);
}
assert.equal(yoco.siteverify, before.sv, "no Turnstile call for a bad link"); assert.equal(c.lim.keys().length, before.keys, "no allowance used");
assert.equal(yoco.refunds.length, 0); assert.equal(o.row().refundState, null);
ok("tampered, extended, other-order, truncated and missing tokens: 400, no Turnstile call, no allowance, no refund");

// 14. A token that is valid for the SAME order but forged with the wrong secret (what an attacker would have to do) is refused too
{
  const forged = await T.makeCancelToken({ CANCEL_LINK_SECRET: "attacker-guess-0123456789-abcdefghijklmn" }, o.ref, BY);
  assert.equal((await cancel(c, forged)).status, 400); assert.equal(yoco.refunds.length, 0);
}
ok("a token signed with the wrong secret is refused");

// 15. Turnstile: no token 400, wrong token 403, neither refunds nor uses allowance
c = await ctx(); reset(); o = await placed(c);
assert.equal((await cancel(c, o.token, { turnstileToken: undefined })).status, 400);
assert.equal((await cancel(c, o.token, { turnstileToken: "" })).status, 400);
assert.equal((await cancel(c, o.token, { turnstileToken: "x".repeat(2049) })).status, 400);
assert.equal((await cancel(c, o.token, { turnstileToken: "not-the-dummy-token" })).status, 403);
assert.equal(yoco.refunds.length, 0); assert.equal(c.ord.rows().find((x) => x.ref === o.ref).refundState, null);
assert.equal(c.lim.keys().filter((k) => k.startsWith("cancel")).length, 0, "a failed check used no allowance");
assert.equal((await cancel(c, o.token)).body.state, "refunded");
ok("Turnstile: missing token 400, bad token 403, no refund and no allowance used; a good one refunds");

// 16. Rate limits: per order 6 an hour, per network 10 an hour (cancel), 30 an hour (check)
c = await ctx(); reset(); o = await placed(c);
for (let i = 0; i < CANCEL_LIMITS.cancelPerOrderPerHour; i++) assert.equal((await cancel(c, o.token, {}, { ip: `198.51.100.${60 + i}` })).status, 200, "press " + i);
r = await cancel(c, o.token, {}, { ip: "198.51.100.99" }); assert.equal(r.status, 429, "the 7th press on one order in an hour"); assert.equal(yoco.refunds.length, 1);
c = await ctx(); reset(); o = await placed(c);
for (let i = 0; i < CANCEL_LIMITS.checkPerIpPerHour; i++) assert.equal((await check(c, o.token, { ip: "198.51.100.77" })).status, 200);
assert.equal((await check(c, o.token, { ip: "198.51.100.77" })).status, 429); assert.equal((await check(c, o.token, { ip: "198.51.100.78" })).status, 200, "another network is unaffected");
ok("rate limits: 6 an hour per order, 30 checks an hour per network; a refusal never reaches Yoco");

// 17. Not switched on: no ORDERS, a store that is down, Yoco not set up (for a refund), no secret: 503 and no Yoco call
c = await ctx(); reset(); o = await placed(c);
for (const [name, extra] of [["no secret", { CANCEL_LINK_SECRET: undefined }], ["short secret", { CANCEL_LINK_SECRET: "x".repeat(31) }], ["no ORDERS", { ORDERS: undefined }]]) {
  assert.equal((await cancel(c, o.token, {}, { env: c.env(extra) })).status, 503, name); assert.equal((await check(c, o.token, { env: c.env(extra) })).status, 503, name + " (check)");
}
for (const [name, extra] of [["no Yoco key", { YOCO_SECRET_KEY: undefined }], ["live key on test mode", { YOCO_SECRET_KEY: "sk_live_localfake1234567890" }], ["no webhook secret", { YOCO_WEBHOOK_SECRET: undefined }]]) {
  assert.equal((await cancel(c, o.token, {}, { env: c.env(extra) })).status, 503, name);
}
c.ord.state.fail = true; assert.equal((await cancel(c, o.token)).status, 503); assert.equal((await check(c, o.token)).status, 503); c.ord.state.fail = false;
c.lim.state.fail = true; assert.equal((await cancel(c, o.token)).status, 503, "counters down: fails closed"); c.lim.state.fail = false;
assert.equal(yoco.refunds.length, 0); assert.equal(o.row().refundState, null);
ok("fails closed: no secret, short secret, no ORDERS, no Yoco setup, Orders or counters down: 503 and no refund");

// 18. A paid order the customer never cancels: no refund state, no change, and nothing for the owner
c = await ctx(); reset(); o = await placed(c);
clock.t = BY + 3600_000; await alarm(c);
assert.equal(o.row().refundState, null); assert.equal(c.ord.svc.attention().length, 0); assert.equal(yoco.refunds.length, 0);
ok("an order nobody cancels is never refunded and never needs the owner");

// 19. An unpaid / expired / mismatching order has no link and can't be cancelled even with a validly signed token
c = await ctx(); reset(); clock.t = NOW;
const up = await order(c, body()); const upRow = c.ord.rows()[0];
const tokenForUnpaid = await T.makeCancelToken(baseEnv, up.body.ref, upRow.cancelBy);
assert.equal((await check(c, tokenForUnpaid)).body.state, "unknown"); assert.equal((await cancel(c, tokenForUnpaid)).body.state, "unknown"); assert.equal(yoco.refunds.length, 0);
ok("an unpaid order can't be cancelled, even with a correctly signed token");

// 20. Repeats of a known press have their own allowance (web-security PR #16 nit 3)
c = await ctx(); reset(); clock.t = NOW;
const same = body(); const ip = "192.0.2.77";
const first = await order(c, same, c.env(), ip); assert.equal(first.status, 200);
for (let i = 1; i <= 20; i++) assert.equal((await order(c, same, c.env(), ip)).status, 200, "repeat " + i);
assert.equal((await order(c, same, c.env(), ip)).status, 429, "the 21st repeat from one network in an hour");
assert.equal((await order(c, same, c.env(), "192.0.2.78")).status, 200, "another network can still repeat");
assert.equal(yoco.created > 0, true);
for (let i = 0; i < 4; i++) assert.equal((await order(c, body(), c.env(), "192.0.2.79")).status, 200, "new orders keep their own 5 an hour");
ok("repeating a known attemptId is limited to 20 an hour per network, apart from the 5 new orders an hour");

// 21. Logs: only the reference and the outcome
{
  c = await ctx(); reset(); logs.length = 0; o = await placed(c); await cancel(c, o.token); await alarm(c);
  const all = logs.join("\n");
  for (const s of [o.token, TEST_CANCEL_SECRET, "Aisha", "aisha.private", "0821234567", "rfd_", o.checkoutId, baseEnv.YOCO_SECRET_KEY, "No onions"]) assert.ok(!all.includes(s), "not in the logs: " + s);
  assert.ok(logs.some((l) => l.includes('"evt":"cancel"') && l.includes(o.ref)), "the outcome is logged with the reference");
}
ok("logs carry the reference and the outcome only: no token, secret, name, email, phone, note, checkout id or refund id");

out("cancel-handler: all", n, "groups passed");
