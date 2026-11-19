// The order state machine and retention rules (worker/orders-core.ts), with a fake clock. Run: node worker/tests/orders-core.mjs
import assert from "node:assert/strict";
import { fakeOrders } from "./_bundle.mjs";

let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-20T10:00:00Z");
const clock = { t: T0, now: () => clock.t };
const mk = async () => { clock.t = T0; return fakeOrders(clock); };
let seq = 0;
const A = () => `attempt-${++seq}`;
const order = (extra = {}) => JSON.stringify({ type: "order", ref: "SB-XXXXXX", name: "Aisha Khan", phone: "+27821234567", email: "a@example.com", total: 65, ...extra });
async function start(f, over = {}) {
  const a = { attemptId: A(), contentHash: "h1", ref: `SB-${String(++seq).padStart(6, "A")}`, amountCents: 6500, orderJson: order(), ...over };
  const b = await f.svc.begin(a);
  assert.equal(b.kind, "new");
  const checkoutId = `ch_${a.ref}`;
  assert.equal(f.svc.attach({ ref: a.ref, checkoutId, redirectUrl: "https://payments.yoco.com/x/" + a.ref }), true);
  return { ...a, checkoutId };
}
const pay = (f, o, over = {}) => f.svc.markPaid({ checkoutId: o.checkoutId, ref: null, amountCents: o.amountCents, currency: "ZAR", paymentId: "p_" + o.ref, webhookId: "w1", ...over });
const row = (f, ref) => f.rows().find((r) => r.ref === ref);

// 1. Happy path: creating -> pending -> paid -> confirmed, and the personal data is NULL after the emails
let f = await mk();
let o = await start(f);
assert.equal(row(f, o.ref).status, "pending"); assert.equal(f.svc.status(o.ref), "pending");
assert.deepEqual(pay(f, o), { kind: "paid", ref: o.ref, matchedBy: "checkoutId" });
assert.equal(row(f, o.ref).status, "paid"); assert.equal(f.svc.status(o.ref), "paid");
assert.equal(f.svc.due().emails.length, 1, "the email is due straight away");
const sent = [];
let next = await f.svc.tick(async (r) => { sent.push(JSON.parse(r.orderJson)); return true; });
assert.equal(sent.length, 1); assert.equal(sent[0].name, "Aisha Khan");
assert.equal(row(f, o.ref).status, "confirmed"); assert.equal(row(f, o.ref).orderJson, null, "PII gone once the emails are accepted");
assert.equal(f.svc.status(o.ref), "paid", "confirmed reports as paid");
assert.equal(next, T0 + 7 * DAY, "the stub is deleted after 7 days");
ok("happy path creating -> pending -> paid -> confirmed; order_json NULL after emailDone; stub kept 7 days");

// 2. Duplicate markPaid sends once (replay, double delivery, parallel)
f = await mk(); o = await start(f);
assert.equal(pay(f, o).kind, "paid");
assert.equal(pay(f, o, { webhookId: "w2" }).kind, "duplicate");
assert.equal(pay(f, o, { paymentId: "other" }).kind, "duplicate");
const parallel = await Promise.all(Array.from({ length: 10 }, () => f.svc.markPaid({ checkoutId: o.checkoutId, ref: null, amountCents: 6500, currency: "ZAR", paymentId: "p", webhookId: "w" })));
assert.equal(parallel.filter((r) => r.kind === "paid").length, 0); assert.equal(parallel.filter((r) => r.kind === "duplicate").length, 10);
const mails = []; await f.svc.tick(async (r) => { mails.push(r.ref); return true; });
assert.equal(mails.length, 1);
assert.equal(pay(f, o).kind, "duplicate", "still a duplicate after confirmed");
await f.svc.tick(async () => { throw new Error("must not send again"); });
assert.equal(row(f, o.ref).paymentId, "p_" + o.ref, "the first payment id is the one kept");
ok("duplicate / replayed / parallel markPaid: one transition to paid, one email");

// 3. Amount and currency mismatch -> mismatch, no email, kept 7 days with details, listed under attention
f = await mk(); o = await start(f);
assert.deepEqual(pay(f, o, { amountCents: 100 }), { kind: "mismatch", ref: o.ref });
assert.equal(row(f, o.ref).status, "mismatch"); assert.equal(f.svc.due().emails.length, 0);
assert.equal(f.svc.status(o.ref), "pending", "never reported as paid to the browser");
let att = f.svc.attention(); assert.equal(att.length, 1); assert.equal(att[0].status, "mismatch"); assert.equal(att[0].order.name, "Aisha Khan"); assert.equal(att[0].checkoutId, o.checkoutId);
assert.equal(pay(f, o).kind, "duplicate", "a later matching event can't flip a mismatch");
let f2 = await mk(); let o2 = await start(f2);
assert.equal(pay(f2, o2, { currency: "USD" }).kind, "mismatch");
f2 = await mk(); o2 = await start(f2);
assert.equal(pay(f2, o2, { amountCents: 6501 }).kind, "mismatch"); f2 = await mk(); o2 = await start(f2);
assert.equal(pay(f2, o2, { amountCents: 6499 }).kind, "mismatch");
clock.t = T0 + 7 * DAY + 1; await f.svc.tick(async () => true);
assert.equal(f.rows().length, 0, "mismatch row deleted after 7 days");
ok("amount (+1, -1, tampered) and currency mismatch -> mismatch: no email, never 'paid' to the browser, listed for the owner, deleted at 7 days");

// 4. Unknown checkout (another Yoco integration on her account)
f = await mk(); o = await start(f);
assert.deepEqual(f.svc.markPaid({ checkoutId: "ch_other", ref: null, amountCents: 6500, currency: "ZAR", paymentId: "p", webhookId: "w" }), { kind: "unknown" });
assert.deepEqual(f.svc.markPaid({ checkoutId: null, ref: null, amountCents: 6500, currency: "ZAR", paymentId: "p", webhookId: "w" }), { kind: "unknown" });
assert.equal(row(f, o.ref).status, "pending");
ok("a payment for a checkout we don't know changes nothing");

// 5. Fallback: Yoco sends no checkout id but passes our ref metadata
f = await mk(); o = await start(f);
assert.deepEqual(f.svc.markPaid({ checkoutId: null, ref: o.ref, amountCents: 6500, currency: "ZAR", paymentId: "p", webhookId: "w" }), { kind: "paid", ref: o.ref, matchedBy: "ref" });
f2 = await mk(); o2 = await start(f2);
assert.equal(f2.svc.markPaid({ checkoutId: null, ref: o2.ref, amountCents: 1, currency: "ZAR", paymentId: "p", webhookId: "w" }).kind, "mismatch", "the amount is still checked");
ok("fallback match on metadata.ref when there is no checkout id; amount still checked");

// 6. Expiry: 30 minutes, local clock; a late payment after expiry is final
f = await mk(); o = await start(f);
clock.t = T0 + 29 * MIN; assert.equal(f.svc.status(o.ref), "pending");
clock.t = T0 + 30 * MIN; assert.equal(f.svc.status(o.ref), "expired", "30 minutes on the clock: expired, no Yoco call");
assert.equal(f.svc.due().expirations.length, 1);
await f.svc.tick(async () => { throw new Error("no email for an unpaid order"); });
assert.equal(row(f, o.ref).status, "expired");
assert.equal(f.svc.attention().length, 0, "an expired order is not an alert");
clock.t = T0 + 40 * MIN;
assert.deepEqual(pay(f, o), { kind: "paid", ref: o.ref, matchedBy: "checkoutId" }, "late payment after expiry is final");
assert.equal(f.svc.due().emails.length, 1);
ok("unpaid order expires at 30 minutes (no email); a late payment after expiry still becomes paid");

// 7. Retention: unpaid rows go at 48 h, creating rows at 5 minutes
f = await mk(); o = await start(f);
const stuck = await f.svc.begin({ attemptId: A(), contentHash: "h", ref: "SB-STUCK2", amountCents: 6500, orderJson: order() });
assert.equal(stuck.kind, "new");
clock.t = T0 + 5 * MIN + 1; await f.svc.tick(async () => true);
assert.equal(row(f, "SB-STUCK2"), undefined, "creating row dropped after 5 minutes"); assert.ok(row(f, o.ref));
clock.t = T0 + 48 * HOUR - 1; await f.svc.tick(async () => true); assert.ok(row(f, o.ref), "still there just before 48 h");
assert.equal(pay(f, o).kind, "paid", "a very late payment inside the window still works");
f2 = await mk(); o2 = await start(f2);
clock.t = T0 + 48 * HOUR + 1; await f2.svc.tick(async () => true);
assert.equal(f2.rows().length, 0, "unpaid row deleted at 48 hours");
assert.equal(f2.svc.status(o2.ref), "unknown");
f2 = await mk(); o2 = await start(f2); pay(f2, o2); await f2.svc.tick(async () => true);
clock.t = T0 + 7 * DAY - 1; await f2.svc.tick(async () => true); assert.equal(f2.rows().length, 1);
clock.t = T0 + 7 * DAY + 1; await f2.svc.tick(async () => true); assert.equal(f2.rows().length, 0, "confirmed stub deleted at 7 days");
ok("retention: creating 5 min, unpaid 48 h, confirmed stub 7 days");

// 8. Email retry schedule 1 min, 5 min, 30 min, 2 h, 6 h, then email_failed; details kept 7 days; attention lists it
f = await mk(); o = await start(f); pay(f, o);
let attempts = 0; const failing = async () => { attempts++; return false; };
const gaps = [];
let last = clock.t;
await f.svc.tick(failing); // attempt 1 at paid time
for (let i = 0; i < 6; i++) {
  const r = row(f, o.ref);
  if (r.status !== "paid") break;
  gaps.push(r.nextTryAt - clock.t); clock.t = r.nextTryAt;
  await f.svc.tick(failing);
}
assert.deepEqual(gaps, [1 * MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 6 * HOUR]);
assert.equal(attempts, 6, "first try plus five retries");
assert.equal(row(f, o.ref).status, "email_failed"); assert.ok(row(f, o.ref).orderJson, "details kept so the owner can act");
att = f.svc.attention(); assert.equal(att.length, 1); assert.equal(att[0].status, "email_failed"); assert.equal(att[0].order.phone, "+27821234567");
assert.equal(f.svc.status(o.ref), "paid", "the payment itself is real: reported as paid");
assert.equal(pay(f, o).kind, "duplicate");
await f.svc.tick(async () => { throw new Error("no more sends"); });
clock.t += 7 * DAY + 1; await f.svc.tick(async () => true); assert.equal(f.rows().length, 0);
ok("email retries at 1 min, 5 min, 30 min, 2 h, 6 h then email_failed (details kept 7 days, listed under attention)");

// 9. A retry that succeeds ends the story; a thrown error counts as a failure
f = await mk(); o = await start(f); pay(f, o);
await f.svc.tick(async () => { throw new Error("network"); });
assert.equal(row(f, o.ref).status, "paid"); assert.equal(row(f, o.ref).emailTries, 1);
clock.t += 1 * MIN; assert.equal(f.svc.due().emails.length, 1);
await f.svc.tick(async () => true);
assert.equal(row(f, o.ref).status, "confirmed"); assert.equal(row(f, o.ref).orderJson, null);
ok("email fails once (thrown), succeeds on retry -> confirmed");

// 10. Idempotency: same attempt, same hash -> same redirect; different hash -> changed; expired -> expired; busy; paid
f = await mk();
const a1 = { attemptId: "att-X", contentHash: "H", ref: "SB-AAAAAA", amountCents: 6500, orderJson: order() };
assert.deepEqual(f.svc.lookup("att-X", "H"), { kind: "none" });
assert.equal(f.svc.begin(a1).kind, "new");
assert.deepEqual(f.svc.begin(a1), { kind: "busy" }, "second tap while the checkout is being made");
assert.deepEqual(f.svc.lookup("att-X", "H"), { kind: "busy" });
f.svc.attach({ ref: "SB-AAAAAA", checkoutId: "ch_1", redirectUrl: "https://payments.yoco.com/r/1" });
assert.deepEqual(f.svc.begin({ ...a1, ref: "SB-BBBBBB" }), { kind: "existing", ref: "SB-AAAAAA", redirectUrl: "https://payments.yoco.com/r/1", amountCents: 6500 }, "the stored ref and URL, not a new row");
assert.equal(f.rows().length, 1);
assert.deepEqual(f.svc.lookup("att-X", "H2"), { kind: "changed" });
assert.deepEqual(f.svc.begin({ ...a1, contentHash: "H2", ref: "SB-CCCCCC" }), { kind: "changed" });
clock.t = T0 + 31 * MIN;
assert.deepEqual(f.svc.lookup("att-X", "H"), { kind: "expired" });
clock.t = T0 + 5 * MIN;
pay(f, { checkoutId: "ch_1", amountCents: 6500, ref: "SB-AAAAAA" });
assert.deepEqual(f.svc.lookup("att-X", "H"), { kind: "paid" });
assert.equal(f.rows().length, 1);
ok("same attempt + same content -> same ref and URL; changed cart -> changed; past expiry -> expired; in flight -> busy; paid -> paid; never a second row");

// 11. drop only removes creating rows; attach only works on creating rows
f = await mk(); o = await start(f);
f.svc.drop(o.ref); assert.ok(row(f, o.ref), "a pending row is not dropped");
await f.svc.begin({ attemptId: "att-D", contentHash: "H", ref: "SB-DDDDDD", amountCents: 6500, orderJson: order() });
f.svc.drop("SB-DDDDDD"); assert.equal(row(f, "SB-DDDDDD"), undefined);
assert.equal(f.svc.attach({ ref: "SB-DDDDDD", checkoutId: "ch_z", redirectUrl: "https://payments.yoco.com/z" }), false);
assert.equal(f.svc.attach({ ref: o.ref, checkoutId: "ch_z", redirectUrl: "https://payments.yoco.com/z" }), false, "can't re-attach a pending row");
// the same attempt id can start again once its dropped row is gone
assert.equal((await f.svc.begin({ attemptId: "att-D", contentHash: "H", ref: "SB-EEEEEE", amountCents: 6500, orderJson: order() })).kind, "new");
ok("drop and attach only act on creating rows; a dropped attempt can start again");

// 12. status: only four values, never data; unknown refs are 'unknown'
f = await mk(); o = await start(f);
assert.equal(f.svc.status("SB-NOPEEE"), "unknown");
for (const v of [f.svc.status(o.ref), f.svc.status("junk")]) assert.ok(["pending", "paid", "expired", "unknown"].includes(v));
ok("status reports pending / paid / expired / unknown only");

// 13. contentHash is stable and sensitive
const { core } = f;
const base = { items: [{ name: "A", qty: 1 }, { name: "B", qty: 2 }], pickupId: "p", pickupDate: "2026-11-28", pickupTime: "", name: "N", phone: "+27", email: "e@x.co", note: "" };
const h = await core.contentHash(base);
assert.equal(h, await core.contentHash({ ...base, items: [...base.items].reverse() }), "item order doesn't matter");
for (const change of [{ pickupId: "q" }, { pickupDate: "2026-12-26" }, { name: "M" }, { note: "x" }, { items: [{ name: "A", qty: 2 }, { name: "B", qty: 2 }] }, { email: "f@x.co" }]) assert.notEqual(h, await core.contentHash({ ...base, ...change }));
ok("content hash ignores item order and changes with any detail of the order");
console.log(`orders-core: all ${n} groups passed`);
