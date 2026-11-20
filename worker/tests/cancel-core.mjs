// Automatic refunds: the order state machine (worker/orders-core.ts beginCancel / finishCancel / cancel emails), with a fake clock.
// No Yoco and no Cloudflare here, only the rules. Run: node worker/tests/cancel-core.mjs
import assert from "node:assert/strict";
import { bundle, fakeOrders } from "./_bundle.mjs";

const col = await bundle("artifacts/stuffd-bagels/src/collection.ts");
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const sast = (iso, time = "12:00:00.000") => Date.parse(`${iso}T${time}+02:00`);
const SAT = "2026-11-28";
const BY = col.cutoffInstant(SAT, "23:59"); // Thu 26 Nov 00:00:00.000 SAST: Wednesday's 23:59 is the last minute
const clock = { t: sast("2026-11-20", "10:00:00.000"), now: () => clock.t };
let seq = 0;
const CANCEL_JSON = JSON.stringify({ name: "Aisha Khan", phone: "+27821234567", email: "a@example.com", pickupDate: SAT, pickupPlace: "Strandfontein", items: [{ name: "Classic Bagel", qty: 1, unit: 65, line: 65 }], total: 65 });

async function paidOrder(over = {}, { confirm = true } = {}) {
  clock.t = sast("2026-11-20", "10:00:00.000");
  const f = over.f ?? (await fakeOrders(clock));
  const ref = `SB-${String(++seq).padStart(6, "B")}`;
  const a = { attemptId: `at-${seq}`, contentHash: "h", ref, amountCents: 6500, orderJson: JSON.stringify({ type: "order", ref, name: "Aisha Khan", phone: "+27821234567", email: "a@example.com", note: "no onions" }), cancelBy: BY, cancelJson: CANCEL_JSON, ...over };
  delete a.f;
  assert.equal(f.svc.begin(a).kind, "new");
  assert.equal(f.svc.attach({ ref, checkoutId: `ch_${ref}`, redirectUrl: "https://c.yoco.com/x" }), true);
  assert.equal(f.svc.markPaid({ checkoutId: `ch_${ref}`, ref: null, amountCents: 6500, currency: "ZAR", paymentId: "p1", webhookId: "w1" }).kind, "paid");
  if (confirm) await f.svc.tick(async () => true);
  return { f, ref, checkoutId: `ch_${ref}` };
}
const row = (f, ref) => f.rows().find((r) => r.ref === ref);

// 1. Before the cut-off: claim, one Yoco call allowed, refund recorded, emails queued
let { f, ref, checkoutId } = await paidOrder();
assert.equal(row(f, ref).status, "confirmed");
assert.deepEqual(f.svc.cancelInfo(ref), { kind: "open", ref, amountCents: 6500, pickupDate: SAT, cancelBy: BY, retry: false });
let b = f.svc.beginCancel(ref);
assert.deepEqual(b, { kind: "claimed", ref, checkoutId, amountCents: 6500 });
assert.equal(row(f, ref).refundState, "refunding");
assert.equal(f.svc.finishCancel(ref, { kind: "refunded", refundId: "rfd_1" }), "refunded");
const r = row(f, ref);
assert.equal(r.refundState, "refunded"); assert.equal(r.refundId, "rfd_1"); assert.equal(r.cmailState, "due");
assert.equal(f.svc.cancelInfo(ref).kind, "refunded");
ok("paid order before the cut-off: claimed once, refund recorded, cancellation emails queued");

// 2. Idempotent: a second click (or ten at once) never gets a second claim; after a refund it only reads 'already'
({ f, ref } = await paidOrder());
const parallel = await Promise.all(Array.from({ length: 10 }, async () => f.svc.beginCancel(ref)));
assert.equal(parallel.filter((x) => x.kind === "claimed").length, 1, "exactly one request may call Yoco");
assert.equal(parallel.filter((x) => x.kind === "busy").length, 9, "the others are told it is busy");
assert.equal(f.svc.finishCancel(ref, { kind: "refunded", refundId: "rfd_2" }), "refunded");
for (let i = 0; i < 3; i++) assert.deepEqual(f.svc.beginCancel(ref), { kind: "already", ref, state: "refunded" });
assert.equal(f.svc.finishCancel(ref, { kind: "failed" }), "refunded", "a late failure can never overwrite a refund that happened");
assert.equal(row(f, ref).refundId, "rfd_2");
ok("double click and 10 parallel clicks: one claim; afterwards 'already refunded' every time; a late failure can't undo it");

// 3. THE BOUNDARY: Wednesday 23:59:59.999 SAST works, Thursday 00:00:00.000 does not (same rule as ordering)
for (const [label, t, want] of [
  ["Wed 23:58:00", sast("2026-11-25", "23:58:00.000"), "claimed"],
  ["Wed 23:59:00.000", sast("2026-11-25", "23:59:00.000"), "claimed"],
  ["Wed 23:59:59.999", sast("2026-11-25", "23:59:59.999"), "claimed"],
  ["Thu 00:00:00.000", sast("2026-11-26", "00:00:00.000"), "closed"],
  ["Thu 00:00:00.001", sast("2026-11-26", "00:00:00.001"), "closed"],
  ["Fri", sast("2026-11-27"), "closed"],
  ["collection Saturday", sast(SAT), "closed"],
]) {
  ({ f, ref } = await paidOrder());
  clock.t = t;
  assert.equal(f.svc.beginCancel(ref).kind, want, label);
  assert.equal(f.svc.cancelInfo(ref).kind, want === "claimed" ? "busy" : "closed", label + " (info)");
}
// the instant itself is what collection.ts says closes ordering
assert.equal(col.saturdayStatus(SAT, BY - 1, { cutoffTime: "23:59", closedDates: [], addedSaturdays: [SAT], removedSaturdays: [], keptSaturdays: [], events: [], opensOn: {} }), "ok");
assert.equal(col.saturdayStatus(SAT, BY, { cutoffTime: "23:59", closedDates: [], addedSaturdays: [SAT], removedSaturdays: [], keptSaturdays: [], events: [], opensOn: {} }), "cutoff_passed");
ok("boundary: Wed 23:59:59.999 SAST claims, Thu 00:00:00.000 is closed; the same instant that closes ordering");

// 4. After the cut-off nothing is claimed and nothing is refunded; the row stays untouched
({ f, ref } = await paidOrder());
clock.t = BY + HOUR;
const before = row(f, ref);
assert.deepEqual(f.svc.beginCancel(ref), { kind: "closed", ref, cancelBy: BY });
assert.deepEqual(row(f, ref), before, "no state change");
assert.deepEqual(f.svc.cancelInfo(ref), { kind: "closed", ref, cancelBy: BY });
ok("after the cut-off: 'closed', no claim, the row is untouched (credit only, no refund path)");

// 5. The link's own expiry can only shorten the window, never extend it
({ f, ref } = await paidOrder());
clock.t = sast("2026-11-24", "12:00:00.000");
assert.equal(f.svc.beginCancel(ref, sast("2026-11-24", "11:00:00.000")).kind, "closed", "token expired earlier than the order's cut-off");
assert.equal(f.svc.beginCancel(ref, BY + 10 * DAY).kind, "claimed", "a long token can't push past the cut-off");
clock.t = BY + 1;
({ f, ref } = await paidOrder());
clock.t = BY + 1;
assert.equal(f.svc.beginCancel(ref, BY + 10 * DAY).kind, "closed", "a long token can't extend past the stored cut-off");
ok("token expiry only ever shortens the window; the stored cut-off is the limit");

// 6. Only paid orders: unpaid, expired, mismatch, unknown, and orders made before refunds existed (no cut-off stored)
{
  const g = await fakeOrders(clock);
  clock.t = sast("2026-11-20", "10:00:00.000");
  assert.equal(g.svc.begin({ attemptId: "u1", contentHash: "h", ref: "SB-UNPAID", amountCents: 6500, orderJson: "{}", cancelBy: BY, cancelJson: CANCEL_JSON }).kind, "new");
  assert.equal(g.svc.beginCancel("SB-UNPAID").kind, "unknown", "creating");
  g.svc.attach({ ref: "SB-UNPAID", checkoutId: "ch_u", redirectUrl: "https://c.yoco.com/x" });
  assert.equal(g.svc.beginCancel("SB-UNPAID").kind, "unknown", "pending (unpaid)");
  assert.equal(g.svc.cancelInfo("SB-UNPAID").kind, "unknown");
  clock.t += 31 * MIN; await g.svc.tick(async () => true);
  assert.equal(g.svc.beginCancel("SB-UNPAID").kind, "unknown", "expired");
  assert.equal(g.svc.beginCancel("SB-NOSUCH").kind, "unknown");
  // mismatch
  clock.t = sast("2026-11-20", "10:00:00.000");
  g.svc.begin({ attemptId: "m1", contentHash: "h", ref: "SB-MISMAT", amountCents: 6500, orderJson: "{}", cancelBy: BY, cancelJson: CANCEL_JSON });
  g.svc.attach({ ref: "SB-MISMAT", checkoutId: "ch_m", redirectUrl: "https://c.yoco.com/x" });
  assert.equal(g.svc.markPaid({ checkoutId: "ch_m", ref: null, amountCents: 100, currency: "ZAR", paymentId: "p", webhookId: "w" }).kind, "mismatch");
  assert.equal(g.svc.beginCancel("SB-MISMAT").kind, "unknown", "a payment that didn't match is never auto-refunded");
  // an old order with no stored cut-off
  g.svc.begin({ attemptId: "o1", contentHash: "h", ref: "SB-OLDONE", amountCents: 6500, orderJson: "{}" });
  g.svc.attach({ ref: "SB-OLDONE", checkoutId: "ch_o", redirectUrl: "https://c.yoco.com/x" });
  g.svc.markPaid({ checkoutId: "ch_o", ref: null, amountCents: 6500, currency: "ZAR", paymentId: "p", webhookId: "w" });
  assert.equal(g.svc.beginCancel("SB-OLDONE").kind, "unknown", "no stored cut-off: no self-cancel");
}
ok("unpaid, expired, mismatched, unknown and pre-refund orders can't be cancelled by link");

// 7. Order email still retrying when the customer cancels: the 'order confirmed' retry stops, so no confirmation arrives after the cancellation
({ f, ref } = await paidOrder({}, { confirm: false }));
assert.equal(row(f, ref).status, "paid"); assert.equal(f.svc.due().emails.length, 1);
assert.equal(f.svc.beginCancel(ref).kind, "claimed");
assert.equal(row(f, ref).status, "confirmed"); assert.equal(row(f, ref).nextTryAt, null); assert.equal(row(f, ref).orderJson, null);
assert.equal(f.svc.due().emails.length, 0, "no further 'order confirmed' email");
ok("cancelling while the confirmation email is still being retried stops that email");

// 8. Failure paths: failed is recorded, owner is told; the customer may press again before the cut-off; Yoco's Idempotency-Key keeps a repeat safe
({ f, ref } = await paidOrder());
assert.equal(f.svc.beginCancel(ref).kind, "claimed");
assert.equal(f.svc.finishCancel(ref, { kind: "failed" }), "failed");
assert.equal(row(f, ref).refundState, "failed"); assert.equal(row(f, ref).refundId, null); assert.equal(row(f, ref).cmailState, "due");
assert.deepEqual(f.svc.cancelInfo(ref), { kind: "open", ref, amountCents: 6500, pickupDate: SAT, cancelBy: BY, retry: true }, "still before the cut-off: may try again");
assert.equal(f.svc.attention().find((a) => a.ref === ref).status, "refund_failed", "listed for the owner");
assert.equal(f.svc.beginCancel(ref).kind, "claimed", "a repeat after a failure is allowed");
assert.equal(f.svc.finishCancel(ref, { kind: "pending", refundId: "rfd_p" }), "pending");
assert.equal(f.svc.attention().filter((a) => a.ref === ref).length, 0, "no longer needs the owner");
assert.equal(f.svc.cancelInfo(ref).kind, "pending");
assert.deepEqual(f.svc.beginCancel(ref), { kind: "already", ref, state: "pending" }, "pending is an accepted refund: never refunded again");
// failed, then the cut-off passes: no new attempt, the customer is told we are on it
({ f, ref } = await paidOrder());
f.svc.beginCancel(ref); f.svc.finishCancel(ref, { kind: "failed" });
clock.t = BY + 1;
assert.deepEqual(f.svc.beginCancel(ref), { kind: "failed_closed", ref });
assert.deepEqual(f.svc.cancelInfo(ref), { kind: "failed", ref });
ok("failed refund: recorded, owner lists it, retry allowed before the cut-off, never refunded twice; after the cut-off the owner finishes it");

// 9. A claim that never got an answer (the Worker died between Yoco and the save) is stuck for 2 minutes, then may be claimed again
({ f, ref } = await paidOrder());
assert.equal(f.svc.beginCancel(ref).kind, "claimed");
clock.t += 119_000; assert.equal(f.svc.beginCancel(ref).kind, "busy"); assert.equal(f.svc.cancelInfo(ref).kind, "busy");
clock.t += 1_000; assert.equal(f.svc.cancelInfo(ref).kind, "open", "reads as open again once stale"); assert.equal(f.svc.beginCancel(ref).kind, "claimed");
ok("a claim with no recorded answer blocks for 2 minutes, then can be claimed again (same Idempotency-Key at Yoco)");

// 10. finishCancel only finishes a claim
({ f, ref } = await paidOrder());
assert.equal(f.svc.finishCancel(ref, { kind: "refunded", refundId: "rfd_x" }), "ignored", "nothing claimed: nothing recorded");
assert.equal(row(f, ref).refundState, null);
assert.equal(f.svc.finishCancel("SB-NOSUCH", { kind: "failed" }), "ignored");
ok("finishCancel ignores anything that wasn't claimed");

// 11. The cancellation emails: payload, retries, then personal data dropped / kept
({ f, ref, checkoutId } = await paidOrder());
f.svc.beginCancel(ref); f.svc.finishCancel(ref, { kind: "refunded", refundId: "rfd_m" });
const sentCancel = [], sentOrder = [];
const send = async (r) => { sentOrder.push(r.ref); return true; };
let attempts = 0;
let wake = await f.svc.tick(send, async (r) => { attempts++; sentCancel.push(f.svc.cancelMailPayload(r)); return false; });
assert.equal(attempts, 1); assert.equal(wake, clock.t + MIN, "retry in a minute, like the order emails");
assert.equal(row(f, ref).cmailState, "due");
clock.t += MIN; await f.svc.tick(send, async (r) => { sentCancel.push(f.svc.cancelMailPayload(r)); return true; });
assert.equal(row(f, ref).cmailState, "sent"); assert.equal(row(f, ref).cancelJson, null, "personal data dropped once the emails are accepted");
const p = sentCancel.at(-1);
assert.equal(p.type, "cancel"); assert.equal(p.outcome, "refunded"); assert.equal(p.ref, ref); assert.equal(p.checkoutId, checkoutId);
assert.equal(p.name, "Aisha Khan"); assert.equal(p.email, "a@example.com"); assert.equal(p.total, 65); assert.equal(p.pickupDate, SAT);
assert.ok(!("note" in p) && !("pickupTime" in p) && !("orderJson" in p), "no free-text note in the cancellation details");
assert.equal(row(f, ref).deleteAt, clock.t + 60 * DAY, "a refunded stub (no personal data) is kept 60 days so the link keeps saying 'already refunded'");
assert.equal(row(f, ref).contentHash, "", "the hash of name, phone and email goes with them");
assert.equal(f.svc.lookup(row(f, ref).attemptId, "any-hash").kind, "paid", "a repeat press of that attempt just reads 'already paid'");
await f.svc.tick(send, async () => { throw new Error("must not send again"); });
assert.equal(f.svc.cancelMailPayload(row(f, ref)), null, "nothing left to send");
ok("cancellation emails: retried like order emails, the payload carries what the script needs, PII dropped once accepted, stub kept 60 days");

// 12. If the cancellation emails never go out: 'cancel_email_failed' for the owner, details kept 7 days
({ f, ref } = await paidOrder());
f.svc.beginCancel(ref); f.svc.finishCancel(ref, { kind: "refunded", refundId: "rfd_n" });
for (let i = 0; i < 6; i++) { await f.svc.tick(send, async () => false); clock.t += 7 * HOUR; }
assert.equal(row(f, ref).cmailState, "failed");
const a2 = f.svc.attention().find((a) => a.ref === ref);
assert.equal(a2.status, "cancel_email_failed"); assert.equal(a2.order.email, "a@example.com", "details kept so the owner can act");
ok("cancellation emails that never go out: listed under 'needs you' with the details");

// 13. A failed refund keeps its details after the owner email, and a later success sends the new outcome
({ f, ref } = await paidOrder());
f.svc.beginCancel(ref); f.svc.finishCancel(ref, { kind: "failed" });
const outcomes = [];
await f.svc.tick(send, async (r) => { outcomes.push(f.svc.cancelMailPayload(r).outcome); return true; });
assert.equal(row(f, ref).cmailState, "sent"); assert.notEqual(row(f, ref).cancelJson, null, "failed: details kept for the owner and for a retry");
f.svc.beginCancel(ref); f.svc.finishCancel(ref, { kind: "refunded", refundId: "rfd_late" });
await f.svc.tick(send, async (r) => { outcomes.push(f.svc.cancelMailPayload(r).outcome); return true; });
assert.deepEqual(outcomes, ["failed", "refunded"]); assert.equal(row(f, ref).cancelJson, null);
ok("failed then refunded: two different emails (owner hears both), details dropped at the end");

// 14. Retention: a paid order's row outlives its cut-off by a day; unrefunded rows are deleted then; nothing is deleted early
({ f, ref } = await paidOrder());
const wantDelete = Math.max(clock.t + 7 * DAY, BY + DAY);
assert.equal(row(f, ref).deleteAt, wantDelete); assert.ok(wantDelete >= BY + DAY, "the cancel link keeps working until the cut-off");
clock.t = BY - 1; await f.svc.tick(send); assert.ok(row(f, ref), "still there just before the cut-off");
clock.t = wantDelete; await f.svc.tick(send); assert.equal(row(f, ref), undefined, "deleted a day after the cut-off");
// an order made 14 days before its cut-off still has its row at the cut-off (the 7-day default would have lost it)
{ const long = await paidOrder({ cancelBy: sast("2026-12-03", "00:00:00.000") }); // cut-off 13 days after the order
  assert.equal(row(long.f, long.ref).deleteAt, sast("2026-12-04", "00:00:00.000"));
  clock.t = sast("2026-12-02", "12:00:00.000"); await long.f.svc.tick(send);
  assert.equal(long.f.svc.beginCancel(long.ref).kind, "claimed", "a 12-day-old order can still be cancelled"); }
ok("retention: the row (and the cancel details) outlive the cut-off by a day, so an order made 2 weeks ahead can still be cancelled");

// 15. Nothing in the public status leaks: refunds don't change what the result page sees
({ f, ref } = await paidOrder());
f.svc.beginCancel(ref); f.svc.finishCancel(ref, { kind: "refunded", refundId: "rfd_q" });
assert.equal(f.svc.status(ref), "paid", "the Yoco result page still reads 'paid'");
ok("public order status is unchanged by a refund");

console.log("cancel-core: all", n, "groups passed");
