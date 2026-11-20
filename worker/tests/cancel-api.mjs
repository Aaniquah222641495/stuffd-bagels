// Automatic refunds against `wrangler dev`: the REAL Durable Object (SQLite, alarm, signed link), with the fake Yoco (refund route) and the fake Apps Script.
// Yoco only refunds LIVE checkouts, so a real Yoco is never used here. Start wrangler with the setup in README.md plus
//   --var CANCEL_LINK_SECRET:$CANCEL   and export the same value as CANCEL (a made-up 32+ character test value).
// Run: CANCEL=... WHSEC=... node worker/tests/cancel-api.mjs $S/fake.log $S/wrangler.out
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { B, FAKE_YOCO, TS_TOKEN, admin, attemptId, checkoutIdOf, clearRateLimits, logged, newIp, paidPayload, post, resetPickups, resetYoco, saturdays, setAvail, sleep, uniqueEmail, until, webhook } from "./_helpers.mjs";

assert.ok(process.env.WHSEC && process.env.CANCEL, "set WHSEC and CANCEL to the same values wrangler dev was started with");
const WHO = "Cancelia Refundtest";
clearRateLimits(); await setAvail({}); await resetYoco();
const [P1] = await resetPickups([{ name: "Strandfontein collection", area: "Strandfontein", days: "Saturdays, 13:00 to 18:00" }]);
const SAT = saturdays()[1];
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const refundMode = (mode, delayMs = 0) => fetch(FAKE_YOCO + "/_refund", { method: "POST", body: JSON.stringify({ mode, delayMs }) });
const yoco = async () => (await (await fetch(FAKE_YOCO + "/_calls")).json());
const cancelPost = (path, body, ip = true) => { if (ip) newIp(); return post(path, body); };
const check = async (token) => { const r = await cancelPost("/api/order/cancel/check", { token }); return { status: r.status, body: await r.json() }; };
const cancel = async (token, extra = {}) => { const r = await cancelPost("/api/order/cancel", { token, turnstileToken: TS_TOKEN, ...extra }); return { status: r.status, body: await r.json() }; };

/** An independent implementation of the token (Node crypto), so a mistake in the Worker's can't hide behind itself. */
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const mkToken = (ref, sec, secret = process.env.CANCEL) => `${ref}.${sec}.${b64url(crypto.createHmac("sha256", secret).update(`stuffd-cancel-v1|${ref}|${sec}`).digest())}`;

async function placed(items = { "Classic Bagel": 1 }) {
  clearRateLimits();
  const o = { name: WHO, phone: "082 123 4567", email: uniqueEmail("canceller"), pickupId: P1, pickupDate: SAT, items, toppings: {}, note: "secret note", website: "", attemptId: attemptId() };
  const r = await post("/api/order", o); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j));
  const checkoutId = checkoutIdOf(j.redirectUrl);
  const w = await webhook(paidPayload(checkoutId, { amount: j.total * 100 })); assert.equal(w.status, 200);
  await until(() => logged().some((x) => x.body.type === "order" && x.body.ref === j.ref), "the confirmation email request");
  const mail = logged().find((x) => x.body.type === "order" && x.body.ref === j.ref).body;
  return { ref: j.ref, total: j.total, checkoutId, mail, token: mail.cancelUrl?.split("#")[1], email: o.email };
}
const cancelMails = (ref) => logged().filter((x) => x.body.type === "cancel" && x.body.ref === ref).map((x) => x.body);

// 1. The real Durable Object signs the link into the confirmation email; the page is static (nothing in the path or query)
let a = await placed();
assert.ok(a.token, "the confirmation email carries a cancel link: " + JSON.stringify(Object.keys(a.mail)));
assert.equal(a.mail.cancelUrl, `${B}/order/cancel#${a.token}`); assert.match(a.mail.cancelByLabel, /^Wednesday \d{1,2} [A-Z][a-z]{2} at 23:59$/);
const [rf, sec, sg] = a.token.split("."); assert.equal(rf, a.ref);
assert.equal(a.token, mkToken(a.ref, sec), "the Worker's token equals an independent HMAC-SHA256 of stuffd-cancel-v1|ref|cutoff");
assert.equal(Number(sec) * 1000 > Date.now(), true);
assert.ok(!JSON.stringify(a.mail).includes(process.env.CANCEL), "the secret is never in an email request");
ok("confirmation email request carries /order/cancel#token signed by the Worker (matches an independent HMAC), plus the cut-off label");

// 2. Opening the link only reads
let r = await check(a.token);
assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.body).sort(), ["cancelBy", "pickupDate", "ref", "retry", "state", "total"]);
assert.equal(r.body.state, "open"); assert.equal(r.body.total, a.total); assert.equal(r.body.pickupDate, SAT); assert.equal(r.body.retry, false);
assert.ok(!JSON.stringify(r.body).includes("Cancelia") && !JSON.stringify(r.body).includes("@"), "no personal data");
assert.equal((await yoco()).refunds.length, 0);
assert.equal((await fetch(`${B}/api/order/cancel/check`)).status, 405); assert.equal((await fetch(`${B}/api/order/cancel`)).status, 405);
assert.equal((await fetch(`${B}/api/order/cancel?token=${a.token}`)).status, 405, "a GET with the token in the URL never cancels");
assert.equal((await yoco()).refunds.length, 0);
ok("check is read only (no Yoco call), no personal data; GET is 405 even with the token in the URL");

// 3. Security gates before any refund
assert.equal((await cancel(a.token, { turnstileToken: undefined })).status, 400);
assert.equal((await cancel(a.token, { turnstileToken: "bogus" })).status, 403);
for (const t of [mkToken(a.ref, sec, "wrong-secret-0123456789-abcdefghijklmnop"), mkToken("SB-AAAAAA", sec).replace(/^SB-AAAAAA/, a.ref), `${a.ref}.${Number(sec) + 86400}.${sg}`, "junk", ""]) {
  assert.equal((await cancel(t)).status, 400, t.slice(0, 30)); assert.equal((await check(t)).status, 400);
}
assert.equal((await cancelPost("/api/order/cancel", { token: a.token, turnstileToken: TS_TOKEN }, true).then((x) => x.status)), 200, "and the right token with the right check works (this IS the refund)");
const y = (await yoco()).refunds;
assert.equal(y.length, 1, "exactly one Yoco refund call");
assert.equal(y[0].id, a.checkoutId); assert.equal(y[0].body, "{}"); assert.equal(y[0].headers["idempotency-key"], `refund-${a.ref}`); assert.match(y[0].headers.authorization, /^Bearer sk_test_/);
ok("no Turnstile 400, bad Turnstile 403, wrong-secret / extended / junk tokens 400: no refund; then the genuine press makes ONE refund call {} with Idempotency-Key refund-<ref>");

// 4. The cancellation emails go out through the real alarm, once; the personal data is then dropped
await until(() => cancelMails(a.ref).length >= 1, "the cancellation email request");
await sleep(2500);
let cm = cancelMails(a.ref); assert.equal(cm.length, 1, "one request to the script (it emails owner and customer and deletes the reminder)");
assert.equal(cm[0].outcome, "refunded"); assert.equal(cm[0].checkoutId, a.checkoutId); assert.equal(cm[0].name, WHO); assert.equal(cm[0].email, a.email); assert.equal(cm[0].total, a.total);
assert.ok(!("note" in cm[0]), "the note is not part of the cancellation details");
ok("one cancellation email request (outcome refunded) sent by the Durable Object alarm");

// 5. Idempotent: again and again
for (let i = 0; i < 3; i++) { r = await cancel(a.token); assert.equal(r.status, 200); assert.equal(r.body.state, "refunded"); }
assert.equal((await check(a.token)).body.state, "refunded");
assert.equal((await yoco()).refunds.length, 1, "no second refund");
await sleep(1500); assert.equal(cancelMails(a.ref).length, 1, "no second email");
ok("a second, third and fourth press: still 'refunded', no second Yoco call, no second email");

// 6. Parallel presses on a fresh order: one refund
await resetYoco(); await refundMode("succeeded", 150);
a = await placed();
const burst = await Promise.all(Array.from({ length: 5 }, () => cancel(a.token)));
assert.equal((await yoco()).refunds.length, 1, "five parallel presses: one Yoco call");
assert.ok(burst.every((x) => x.status === 200 && ["refunded", "busy"].includes(x.body.state)), JSON.stringify(burst.map((x) => x.body)));
assert.equal(burst.filter((x) => x.body.state === "refunded").length, 1);
await until(() => cancelMails(a.ref).length >= 1, "email"); await sleep(1500); assert.equal(cancelMails(a.ref).length, 1);
ok("five parallel presses against the real Durable Object: exactly one refund call, one email");

// 7. Pending counts as accepted
await resetYoco(); await refundMode("pending");
a = await placed();
r = await cancel(a.token); assert.deepEqual(r.body, { state: "pending", ref: a.ref, total: a.total });
await until(() => cancelMails(a.ref).length >= 1, "email"); assert.equal(cancelMails(a.ref)[0].outcome, "pending");
assert.equal((await cancel(a.token)).body.state, "pending"); assert.equal((await yoco()).refunds.length, 1);
ok("Yoco 'pending': the customer is told it is processing, the owner's email says pending, no second refund");

// 8. Failure: never 'refunded'; owner told; listed under attention; a retry with the same key finishes it
await resetYoco(); await refundMode("fail");
a = await placed();
r = await cancel(a.token); assert.equal(r.status, 200); assert.equal(r.body.state, "failed");
await until(() => cancelMails(a.ref).length >= 1, "email"); assert.equal(cancelMails(a.ref)[0].outcome, "failed");
let att = await (await admin("/orders/attention")).json();
assert.ok(att.items.some((i) => i.ref === a.ref && i.status === "refund_failed" && i.order?.email === a.email), "the owner sees it with the customer's details");
assert.equal((await check(a.token)).body.state, "open"); assert.equal((await check(a.token)).body.retry, true);
await refundMode("succeeded");
r = await cancel(a.token); assert.equal(r.body.state, "refunded");
const keys = new Set((await yoco()).refunds.map((x) => x.headers["idempotency-key"])); assert.deepEqual([...keys], [`refund-${a.ref}`]);
await until(() => cancelMails(a.ref).length >= 2, "second email"); assert.equal(cancelMails(a.ref)[1].outcome, "refunded");
att = await (await admin("/orders/attention")).json(); assert.ok(!att.items.some((i) => i.ref === a.ref), "off the owner's list once refunded");
ok("Yoco 500: state 'failed', owner emailed and shown under attention, retry allowed and finishes with the same Idempotency-Key");

// 9. A garbage answer from Yoco is a failure too
await resetYoco(); await refundMode("garbage");
a = await placed(); r = await cancel(a.token); assert.equal(r.body.state, "failed");
await refundMode("succeeded");
ok("a 200 from Yoco without a refund id is not a refund");

// 10. Expired link (validly signed) and unknown order
await resetYoco();
a = await placed();
const past = Math.floor(Date.now() / 1000) - 60;
const expired = mkToken(a.ref, past);
assert.deepEqual((await check(expired)).body, { state: "closed", ref: a.ref }); assert.deepEqual((await cancel(expired)).body, { state: "closed", ref: a.ref });
const ghost = mkToken("SB-ZZZZ22", Math.floor(Date.now() / 1000) + 86400);
assert.equal((await check(ghost)).body.state, "unknown"); assert.equal((await cancel(ghost)).body.state, "unknown");
assert.equal((await yoco()).refunds.length, 0, "no Yoco call for an expired link or an unknown order");
assert.equal((await cancel(a.token)).body.state, "refunded", "the real link still works");
ok("a validly signed but expired link reads 'closed' and refunds nothing; an unknown order reads 'unknown'; the real link still works");

// 11. Rate limit per order (6 an hour), whichever network
await resetYoco();
a = await placed();
const codes = []; for (let i = 0; i < 8; i++) codes.push((await cancel(a.token)).status);
assert.deepEqual(codes.slice(0, 6), [200, 200, 200, 200, 200, 200]); assert.deepEqual(codes.slice(6), [429, 429]);
assert.equal((await yoco()).refunds.length, 1);
ok("per-order limit: the 7th press in an hour is 429, and still only one refund call");

// 12. Orders are refused while paying (the secret is in this test run, so this checks the happy path stays open) and the status endpoint is unchanged
r = await (await fetch(`${B}/api/order/status?ref=${a.ref}`)).json(); assert.deepEqual(r, { status: "paid" });
ok("the Yoco result page still sees 'paid' for a cancelled order");

// 13. Nothing sensitive in wrangler's output
if (process.argv[3]) {
  const outp = fs.readFileSync(process.argv[3], "utf8");
  for (const needle of ["Cancelia", "Refundtest", "canceller", "082 123 4567", "secret note", process.env.CANCEL, process.env.WHSEC, "sk_test_localfake", "rfd_"].filter(Boolean)) assert.ok(!outp.includes(needle), "wrangler output contains: " + needle);
  assert.ok(!/order\/cancel#SB-/.test(outp), "no cancel token in the logs");
  ok(`no name, email, phone, note, token, secret or refund id in wrangler's ${outp.split("\n").length} output lines`);
}
await resetPickups([]); clearRateLimits();
console.log(`cancel-api: all ${n} groups passed`);
