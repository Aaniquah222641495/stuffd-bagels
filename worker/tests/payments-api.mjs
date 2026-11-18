// The payment path against `wrangler dev` with a fake Yoco and the fake Apps Script (ADR-0041, build brief step 10).
// Setup (4 processes; all test keys below are made-up local values, never real Yoco keys):
//   FAKE_PORT=8899 node worker/tests/fake-apps-script.mjs $S/fake.log
//   FAKE_YOCO_PORT=8798 node worker/tests/fake-yoco.mjs
//   export WHSEC="whsec_$(openssl rand -base64 24)" TOKEN=$(openssl rand -base64 36 | tr -d '/+=\n')
//   npx wrangler@4.148.0 dev --port 8787 --persist-to $S/state --var APP_ENV:development --var APPS_SCRIPT_URL:http://127.0.0.1:8899/exec \
//     --var APPS_SCRIPT_TOKEN:$TOKEN --var YOCO_API_BASE:http://127.0.0.1:8798 --var YOCO_SECRET_KEY:sk_test_localfake0123456789 \
//     --var YOCO_WEBHOOK_SECRET:$WHSEC --var YOCO_MODE:test --var SITE_ORIGIN:http://localhost:8787 > $S/wrangler.out 2>&1
//   rm -f $S/fake.log; node worker/tests/payments-api.mjs $S/fake.log $S/wrangler.out
// argv[2] = the fake Apps Script log, argv[3] = wrangler's output (checked for personal data).
import assert from "node:assert/strict";
import fs from "node:fs";
import { admin, attemptId, checkoutIdOf, clearRateLimits, logged, paidPayload, post, resetPickups, resetYoco, FAKE_YOCO, saturdays, setAvail, sleep, uniqueEmail, until, webhook, yocoCalls, B } from "./_helpers.mjs";

assert.ok(process.env.WHSEC, "set WHSEC to the same value wrangler dev was started with");
clearRateLimits(); await setAvail({}); await resetYoco();
const [P1] = await resetPickups([{ name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm" }]);
const SAT = saturdays()[1];
const WHO = "Zainab Paymenttest"; // searched for in wrangler's output at the end
const order = (o = {}) => ({ name: WHO, phone: "082 123 4567", email: uniqueEmail("payer"), pickupId: P1, pickupDate: SAT, items: { "Pizza Bagel": 2 }, toppings: {}, note: "", website: "", attemptId: attemptId(), ...o });
const emails = [];
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const startOrder = async (o = order()) => { clearRateLimits(); /* a fresh pretend network: 5 orders an hour each */ const r = await post("/api/order", o); const j = await r.json(); return { r, j, o, checkoutId: j.redirectUrl ? checkoutIdOf(j.redirectUrl) : null }; };
const statusOf = async (ref) => (await (await fetch(`${B}/api/order/status?ref=${ref}`)).json()).status;

// 1. The order opens a Yoco checkout and sends no email
let a = await startOrder(order({ total: 1, amount: 1 }));
assert.equal(a.r.status, 200); assert.match(a.j.ref, /^SB-[A-Z2-9]{6}$/); assert.equal(a.j.total, 190); assert.match(a.j.redirectUrl, /^http:\/\/127\.0\.0\.1:8798\/pay\/ch_/);
let calls = (await yocoCalls()).calls;
assert.equal(calls.length, 1); assert.equal(calls[0].body.amount, 19000, "R190 in cents; the browser's amount is ignored");
assert.match(calls[0].headers.authorization, /^Bearer sk_test_/); assert.equal(calls[0].headers["idempotency-key"], a.o.attemptId);
assert.equal(calls[0].body.metadata.ref, a.j.ref); assert.equal(calls[0].body.successUrl, `http://localhost:8787/order/result?r=success&ref=${a.j.ref}`);
assert.ok(!JSON.stringify(calls[0].body).includes("Zainab") && !JSON.stringify(calls[0].body).includes(a.o.email), "no personal data sent to Yoco");
await sleep(1500);
assert.equal(logged().length, 0, "the fake Apps Script saw nothing: no email before payment");
assert.equal(await statusOf(a.j.ref), "pending");
ok("order -> Yoco checkout for the SERVER total in cents (browser amount ignored), ref in metadata, no personal data, nothing emailed, status pending");

// 2. Double submit with one attemptId -> one Yoco call, the same redirect
resetYoco(); await resetYoco();
const dup = order(); const [d1, d2, d3] = await Promise.all([post("/api/order", dup), post("/api/order", dup), post("/api/order", dup)]);
const codes = [d1.status, d2.status, d3.status]; const bodies = await Promise.all([d1.json(), d2.json(), d3.json()]);
assert.ok(codes.includes(200), JSON.stringify(codes)); for (const [i, c] of codes.entries()) assert.ok(c === 200 || c === 409, `status ${c}`);
const again = await (await post("/api/order", dup)).json();
assert.equal(again.redirectUrl, bodies.find((b) => b.redirectUrl).redirectUrl, "the same payment page every time");
assert.equal((await yocoCalls()).calls.length, 1, "one Yoco call for four presses");
ok("four presses with one attemptId (three in parallel): one Yoco call, one payment page");

// 3. A signed webhook -> exactly one owner + one customer email request, paid:true, and the status goes pending -> paid
a = await startOrder(); assert.equal(a.r.status, 200);
let w = await webhook(paidPayload(a.checkoutId, { amount: 19000 })); assert.equal(w.status, 200);
assert.equal(await statusOf(a.j.ref), "paid");
await until(() => logged().length >= 1, "the paid-order email request");
await sleep(1500);
let l = logged(); assert.equal(l.length, 1, "exactly one request to the script (it sends the owner and customer emails)");
assert.equal(l[0].body.type, "order"); assert.equal(l[0].body.paid, true); assert.equal(l[0].body.checkoutId, a.checkoutId); assert.equal(l[0].body.ref, a.j.ref); assert.equal(l[0].body.total, 190); assert.equal(l[0].body.name, WHO);
ok("signed payment.succeeded -> paid -> one email request with paid:true and the checkout id; status endpoint pending -> paid");

// 4. Same webhook again, a retry, a replay: nothing more is sent
await webhook(paidPayload(a.checkoutId, { amount: 19000 }));
const same = paidPayload(a.checkoutId, { amount: 19000 }); const id1 = "msg_dup1";
assert.equal((await webhook(same, { id: id1 })).status, 200); assert.equal((await webhook(same, { id: id1 })).status, 200);
await sleep(2500); assert.equal(logged().length, 1, "duplicates and replays send no second email");
ok("the same event again, a retry with a new id and a replay: 200 each, still one email");

// 5. Bad signature 401, stale and future timestamp 400: no email, order stays pending
const before = logged().length;
let b = await startOrder();
assert.equal((await webhook(paidPayload(b.checkoutId, { amount: 19000 }), { signWith: "whsec_" + Buffer.alloc(24, 9).toString("base64") })).status, 401);
assert.equal((await webhook(paidPayload(b.checkoutId, { amount: 19000 }), { body: "{}", id: "x" })).status, 400, "signed but not an event: refused");
assert.equal((await webhook(paidPayload(b.checkoutId, { amount: 19000 }), { tsOffset: -181 })).status, 400);
assert.equal((await webhook(paidPayload(b.checkoutId, { amount: 19000 }), { tsOffset: 181 })).status, 400);
const tamper = await fetch(B + "/api/yoco/webhook", { method: "POST", headers: { "webhook-id": "m", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,AAAA" }, body: "{}" });
assert.equal(tamper.status, 401); assert.equal((await fetch(B + "/api/yoco/webhook", { method: "POST", body: "{}" })).status, 400, "no headers");
assert.equal((await fetch(B + "/api/yoco/webhook")).status, 405);
await sleep(1500); assert.equal(await statusOf(b.j.ref), "pending"); assert.equal(logged().length, before);
ok("forged signature 401, stale / future timestamp 400, no headers 400, GET 405: nothing changes, no email");

// 6. Amount mismatch: no email, and the owner sees it under attention
let m = await startOrder();
assert.equal((await webhook(paidPayload(m.checkoutId, { amount: 100 }))).status, 200);
await sleep(2000); assert.equal(logged().length, before, "no email for a payment that doesn't match");
assert.equal(await statusOf(m.j.ref), "pending", "never reported as paid");
let att = await (await admin("/orders/attention")).json();
assert.ok(att.items.some((i) => i.ref === m.j.ref && i.status === "mismatch" && i.order.name === WHO), "listed with the order details");
assert.equal((await fetch(B + "/api/admin/orders/attention")).status, 401, "attention needs the admin password");
ok("verified payment for the wrong amount: 200, no email, shown under /api/admin/orders/attention (admin only)");

// 7. Mode mismatch: a live-mode event on this test-mode Worker is ignored
let lv = await startOrder();
assert.equal((await webhook(paidPayload(lv.checkoutId, { amount: 19000, mode: "live" }))).status, 200);
await sleep(1500); assert.equal(await statusOf(lv.j.ref), "pending"); assert.equal(logged().length, before);
ok("event with mode live on a test-mode Worker: 200 and ignored");

// 8. Other events and unknown checkouts
assert.equal((await webhook(paidPayload(lv.checkoutId, { amount: 19000 }), { type: "refund.succeeded" })).status, 200);
assert.equal((await webhook(paidPayload("ch_doesnotexist", { amount: 19000 }))).status, 200);
await sleep(1000); assert.equal(await statusOf(lv.j.ref), "pending");
ok("other event types and unknown checkouts: 200, nothing happens");

// 9. Yoco failure -> 502 and the allowance is given back; changed cart -> 409
await fetch(FAKE_YOCO + "/_failnext", { method: "POST" });
const failing = await post("/api/order", order()); assert.equal(failing.status, 502); assert.match((await failing.json()).error, /payment page didn't open/);
const base = order(); await post("/api/order", base);
const ch = await post("/api/order", { ...base, items: { "Pizza Bagel": 3 } }); assert.equal(ch.status, 409);
ok("Yoco 500 -> 502 with a plain message; same attemptId with a changed cart -> 409");

// 10. Browser-visible shape: status endpoint says nothing else; junk refs are unknown
const st = await (await fetch(`${B}/api/order/status?ref=${a.j.ref}`)).json(); assert.deepEqual(Object.keys(st), ["status"]);
assert.equal(await statusOf("SB-ZZZZZZ"), "unknown"); assert.equal(await statusOf("nope"), "unknown");
assert.equal((await fetch(B + "/api/order/pay", { method: "POST" })).status, 404, "the old pay stub is gone");
ok("status endpoint returns only { status }; unknown / junk refs -> unknown; /api/order/pay is gone");

// 11. No personal data in what wrangler printed
if (process.argv[3]) {
  const out = fs.readFileSync(process.argv[3], "utf8");
  for (const needle of ["Zainab", "Paymenttest", "payer", "082 123 4567", "+27821234567", "TEST CARDHOLDER", "411111", "sk_test_localfake", process.env.WHSEC, process.env.TOKEN].filter(Boolean)) assert.ok(!out.includes(needle), "wrangler output contains: " + needle.slice(0, 12));
  ok(`no name, email, phone, card data or secret in wrangler's ${out.split("\n").length} output lines`);
}
await resetPickups([]); clearRateLimits();
console.log(`payments-api: all ${n} groups passed`);
