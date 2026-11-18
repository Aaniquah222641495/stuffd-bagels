// Runs Code.gs in Node with fake Google services and checks the logic: `node apps-script/selftest.mjs`.
// It cannot prove Gmail behaves; the real test is testOrder / testBooking in the editor (README).
import vm from "node:vm";
import crypto from "node:crypto";
import fs from "node:fs";
import assert from "node:assert/strict";

const code = fs.readFileSync(new URL("./Code.gs", import.meta.url), "utf8");
const sent = [];
const labelled = [];
const cacheStore = new Map();
const cacheTtl = new Map();
let quota = 100;
const threads = () =>
  sent.filter((m) => /^(New order|Booking enquiry): /.test(m.subject)).map((m) => ({
    getFirstMessageSubject: () => m.subject,
    addLabel: (l) => labelled.push([m.subject, l.getName()]),
  }));
const labels = new Map();
const propStore = new Map();
const ctx = {
  console,
  Date,
  JSON,
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v, ttl) => { cacheStore.set(k, v); cacheTtl.set(k, ttl); } }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => propStore.get(k) ?? null,
    setProperty: (k, v) => void propStore.set(k, String(v)),
    deleteProperty: (k) => void propStore.delete(k),
    getProperties: () => Object.fromEntries(propStore),
  }) },
  MailApp: { sendEmail: (m) => sent.push(m), getRemainingDailyQuota: () => quota },
  Session: { getEffectiveUser: () => ({ getEmail: () => "stuffd.bagels@gmail.com" }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
    computeDigest: (_a, s) => [...crypto.createHash("sha256").update(s).digest()].map((b) => (b > 127 ? b - 256 : b)),
    formatDate: (d, tz, f) => {
      const o = { timeZone: "Africa/Johannesburg" };
      if (f === "yyyy-MM-dd") return d.toLocaleDateString("sv-SE", o);
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { ...o, weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(d).map((p) => [p.type, p.value]));
      return f === "EEE d MMM" ? `${parts.weekday} ${parts.day} ${parts.month}` : `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
    },
  },
  GmailApp: {
    getUserLabelByName: (n) => labels.get(n) ?? null,
    createLabel: (n) => { const l = { getName: () => n }; labels.set(n, l); return l; },
    search: () => threads(),
  },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const TOKEN = "k7Vq2mXw9LpR4sTz8NbC3dHf6JyA1eGu0QiO5vWx"; // 40 characters, as the README asks for
assert.ok(TOKEN.length >= 32);
vm.runInContext(`CONFIG.SHARED_TOKEN = ${JSON.stringify(TOKEN)}`, ctx);
const NONE = Symbol("no token field");
const post = (o, token = TOKEN) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(token === NONE ? o : { ...o, token }) } }).s);

const order = {
  type: "order", paid: true, checkoutId: "ch_ABC123xyz", ref: "SB-ABC234", name: "Aisha <b>Khan</b>", phone: "+27821234567", email: "aisha@example.com",
  pickupDate: "2026-12-19", pickupTime: "", pickupDays: "", pickupPlace: "Kenilworth Corner, Main Rd, Kenilworth",
  items: [{ name: "Pizza Bagel", qty: 2, unit: 95, line: 999 }, { name: "Steak'd Bagel", qty: 1, unit: 115, line: 115 }],
  note: "No onions <i>please</i>",
};
const r1 = post(order);
assert.equal(r1.ok, true);
assert.equal(sent.length, 2);
const [owner, customer] = sent;
assert.match(owner.subject, /^New order: Aisha <b>Khan<\/b>, Sat 19 Dec$/);
assert.match(owner.body, /PAID ONLINE \(Yoco\) R305\. Confirmed\./);
assert.match(owner.body, /Yoco checkout id: ch_ABC123xyz/);
assert.doesNotMatch(owner.body, /awaiting/i);
assert.match(owner.body, /Total: R305/, "total is recomputed from qty x unit, not trusted");
assert.equal(owner.replyTo, "aisha@example.com");
assert.equal(customer.to, "aisha@example.com");
assert.equal(customer.subject, "STUFF'D: order confirmed SB-ABC234");
assert.match(customer.body, /Paid and confirmed/);
assert.match(customer.body, /Your payment has been received and your order is confirmed/);
assert.doesNotMatch(customer.body + customer.htmlBody, /awaiting|how to pay|be in touch/i, "no 'awaiting payment' wording in the customer email");
assert.match(customer.body, /becomes credit for another collection Saturday or one of our markets, valid for 2 months/, "cancellation policy (DRAFT) is in the order auto-reply");
assert.ok(customer.htmlBody.includes("credit, not a refund"));
assert.ok(customer.htmlBody.includes("&lt;i&gt;please"), "customer text is escaped in the HTML email");
assert.ok(!customer.htmlBody.includes("<i>please"), "no raw HTML from the customer");
assert.deepEqual(labelled.map((l) => l[1]), ["Orders"]);

assert.match(owner.body, /Pickup point: Kenilworth Corner, Main Rd, Kenilworth/);
assert.match(owner.body, /Collection Saturday: Sat 19 Dec 2026/);
assert.match(customer.body, /Pickup point: Kenilworth Corner/);

// Duplicate (same ref) is accepted but sends nothing.
assert.deepEqual(post(order), { ok: true, duplicate: true });
assert.equal(sent.length, 2);

// A second order at a pickup point with a preferred time and the point's own collection times.
const point = { ...order, ref: "SB-PNT234", name: "Zaid", email: "zaid@example.com", pickupDate: "2026-12-19", pickupTime: "10:30", pickupPlace: "Kenilworth Corner, Main Rd, Kenilworth", pickupDays: "Saturdays, 10am to 1pm" };
assert.equal(post(point).ok, true);
const [pOwner, pCustomer] = sent.slice(-2);
assert.equal(pOwner.subject, "New order: Zaid, Sat 19 Dec");
assert.match(pOwner.body, /Pickup point: Kenilworth Corner, Main Rd, Kenilworth/);
assert.match(pOwner.body, /Collection Saturday: Sat 19 Dec 2026/);
assert.match(pOwner.body, /Preferred time: 10:30/);
assert.match(pOwner.body, /Collection times: Saturdays, 10am to 1pm/);
assert.doesNotMatch(pOwner.body, /market/i, "no market wording in the owner email");
// The customer email may mention markets only through the cancellation policy (credit can be used at a market), never as a collection place.
assert.doesNotMatch(pCustomer.body.replace(/becomes credit for another collection Saturday or one of our markets, valid for 2 months/, ""), /market/i, "no market wording in order emails apart from the credit policy");
assert.match(pCustomer.body, /Pickup point: Kenilworth Corner/);
assert.match(pCustomer.htmlBody, /Pickup point/);
labelled.length = 0;
sent.length = 2; // back to the first order's two emails for the counts below

const booking = { type: "booking", ref: "BK-ZZZ999", name: "Sam", phone: "+27829999999", email: "sam@example.com", eventDate: "2027-02-14", venue: "Kenilworth", guests: 80, details: "Birthday" };
assert.equal(post(booking).ok, true);
assert.equal(sent.length, 4);
assert.equal(sent[2].subject, "Booking enquiry: Sam, Sun 14 Feb 2027");
assert.match(sent[3].body, /Nothing is booked until we confirm/);
assert.ok(labelled.some((l) => l[1] === "Bookings"));

// Rejections.
for (const bad of [
  { ...order, ref: "x", email: "a@b.co" },
  { ...order, ref: "SB-ABC235", email: "nope" },
  { ...order, ref: "SB-ABC236", phone: "0821234567" },
  { ...order, ref: "SB-ABC237", items: [] },
  { ...order, ref: "SB-ABC238", items: [{ name: "X", qty: 999, unit: 5 }] },
  { ...booking, ref: "BK-AAA111", guests: 0 },
  { type: "other" },
]) assert.equal(post(bad).ok, false);
assert.equal(sent.length, 4, "nothing sent for invalid input");
assert.equal(ctx.doPost({ postData: { contents: "not json" } }).s.includes('"invalid"'), true);

// Token is REQUIRED (M3). Empty or short means every request is refused, even one that "matches".
const goodBooking = { ...booking, ref: "BK-BBB222", guests: 12, email: "tokentest@example.com" };
assert.equal(post(goodBooking, NONE).ok, false, "no token field: refused");
assert.equal(post(goodBooking, "").ok, false, "empty token: refused");
assert.equal(post(goodBooking, "wrong").ok, false, "wrong token: refused");
assert.equal(post(goodBooking, TOKEN.slice(0, -1) + "X").ok, false, "same length, one character off: refused");
assert.equal(post(goodBooking, TOKEN + "x").ok, false, "longer token: refused");
assert.equal(post(goodBooking, 12345).ok, false, "non-string token: refused");
assert.equal(sent.length, 4, "nothing sent without the right token");
vm.runInContext('CONFIG.SHARED_TOKEN = ""', ctx);
assert.equal(post(goodBooking, "").ok, false, "script token empty + empty token sent: still refused");
assert.equal(post(goodBooking, NONE).ok, false, "script token empty + no token sent: still refused");
vm.runInContext('CONFIG.SHARED_TOKEN = "s3cret"', ctx);
assert.equal(post(goodBooking, "s3cret").ok, false, "script token too short: refused even when it matches");
assert.equal(sent.length, 4);
vm.runInContext(`CONFIG.SHARED_TOKEN = ${JSON.stringify(TOKEN)}`, ctx);
assert.equal(post(goodBooking).ok, true, "right 32+ character token: accepted");
assert.equal(sent.length, 6);

// Per-address cap: 3 customer replies per mailbox per day; case, +tag and Gmail dots are the same mailbox.
const cap = (ref, email) => post({ ...booking, ref, email, guests: 20 });
assert.equal(cap("BK-CAP111", "Sam.Smith@gmail.com").ok, true);
assert.equal(cap("BK-CAP112", "samsmith+two@googlemail.com").ok, true);
assert.equal(cap("BK-CAP113", "SAM.SMITH+3@gmail.com").ok, true);
const before = sent.length;
assert.deepEqual(cap("BK-CAP114", "s.a.m.smith@gmail.com"), { ok: false, error: "cap" });
assert.equal(sent.length, before, "4th for the same mailbox sends nothing");
assert.equal(cap("BK-CAP115", "someone.else@example.com").ok, true, "another address is unaffected");

// Daily total cap: below Gmail's 100 a day (40 submissions x 2 emails = 80).
assert.ok(vm.runInContext("CONFIG.MAX_SUBMISSIONS_PER_DAY * 2 < 100", ctx));
vm.runInContext("CONFIG.MAX_SUBMISSIONS_PER_DAY = 10", ctx);
let accepted = 0, refused = 0;
for (let i = 0; i < 12; i++) post({ ...booking, ref: `BK-DAY${String(100 + i)}`, email: `day${i}@example.com`, guests: 30 + i }).ok ? accepted++ : refused++;
assert.equal(accepted + refused, 12);
assert.ok(refused >= 1, "the daily cap stops further submissions");
assert.equal(post({ ...booking, ref: "BK-DAY999", email: "late@example.com", guests: 99 }).error, "cap");
// A new day starts from zero and old per-address counters are tidied away.
for (const [k, v] of propStore) propStore.set(k, "2000-01-01:" + v.split(":")[1]);
assert.equal(post({ ...booking, ref: "BK-DAY998", email: "late@example.com", guests: 98 }).ok, true);
assert.ok([...propStore.keys()].filter((k) => k.startsWith("cap_rc_")).length <= 1, "old per-address counters removed");
vm.runInContext("CONFIG.MAX_SUBMISSIONS_PER_DAY = 40", ctx);
propStore.clear();

// Paid orders only (ADR-0041): an order that isn't marked paid, or has no Yoco checkout id, is refused and nothing is emailed.
{
  const before = sent.length;
  const base = { ...order, name: "Unpaid Una", email: "una@example.com" };
  const { paid: _p, ...noPaid } = base;
  const { checkoutId: _c, ...noCheckout } = base;
  let k = 0;
  for (const bad of [noPaid, { ...base, paid: false }, { ...base, paid: "true" }, { ...base, paid: 1 }, { ...base, paid: "yes" }, noCheckout, { ...base, checkoutId: "" }, { ...base, checkoutId: 12345 }, { ...base, checkoutId: "ch bad id" }, { ...base, checkoutId: "x" }]) {
    assert.equal(post({ ...bad, ref: `SB-UNP${String(100 + k++)}` }).ok, false, JSON.stringify([bad.paid, bad.checkoutId]));
  }
  assert.equal(sent.length, before, "no owner email and no customer email for an unpaid order");
  // Bookings are not paid and are unaffected.
  assert.equal(post({ ...booking, ref: "BK-NOPAY1", email: "nopay@example.com", guests: 21 }).ok, true);
  assert.equal(sent.length, before + 2);
  sent.length = before;
}

// A paid order is de-duplicated by reference for the full 6 hours CacheService allows; two payments for the same cart are two orders.
{
  const before = sent.length;
  const paidOrder = { ...order, ref: "SB-PAID22", email: "paid@example.com", name: "Pay Pal", checkoutId: "ch_PAID1111" };
  const contentKeys = () => [...cacheTtl.keys()].filter((k) => k.startsWith("dupec_")).length;
  const keysBefore = contentKeys();
  assert.equal(post(paidOrder).ok, true); assert.equal(sent.length, before + 2);
  assert.equal(contentKeys(), keysBefore, "no content key for orders");
  assert.equal(cacheTtl.get("dupe_SB-PAID22"), 21600, "reference held for 6 hours (the CacheService maximum)");
  assert.deepEqual(post(paidOrder), { ok: true, duplicate: true }, "a retry after an ambiguous timeout sends nothing more");
  assert.deepEqual(post({ ...paidOrder, checkoutId: "ch_PAID1111" }), { ok: true, duplicate: true });
  assert.equal(sent.length, before + 2);
  // same customer, same cart, a different payment (different reference and checkout): a genuine second order
  assert.equal(post({ ...paidOrder, ref: "SB-PAID23", checkoutId: "ch_PAID2222" }).ok, true);
  assert.equal(sent.length, before + 4, "the second paid order is not swallowed as a duplicate of the first");
  // bookings keep the 10-minute window
  assert.equal(cacheTtl.get("dupe_BK-ZZZ999"), 600);
  propStore.clear();
}

// No 'awaiting payment' anywhere in the script.
assert.ok(!/awaiting payment|AWAITING/i.test(code), "Code.gs has no 'awaiting payment' wording");

// Quota.
quota = 2;
assert.equal(post({ ...booking, ref: "BK-CCC333", guests: 13, email: "quota@example.com" }).error, "quota");
console.log("apps-script selftest: all checks passed");

// The cancellation policy has three copies (collection.ts, Code.gs, the FAQ in content.ts): they must stay identical.
{
  const fs = await import("node:fs");
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const policy = src("../artifacts/stuffd-bagels/src/collection.ts").match(/CANCELLATION_POLICY =\s*"([^"]+)"/)[1];
  assert.ok(policy.includes("valid for 2 months"));
  assert.ok(src("./Code.gs").includes(`CANCELLATION_POLICY_ = "${policy}"`), "Code.gs copy matches");
  assert.ok(src("../artifacts/stuffd-bagels/src/content.ts").includes(policy), "FAQ copy matches");
  console.log("cancellation policy: three copies identical");
}
