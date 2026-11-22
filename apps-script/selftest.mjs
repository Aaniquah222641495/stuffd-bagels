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
  sent.filter((m) => /^(New order|Booking enquiry): |^SB-[A-Z0-9]{6} cancelled/.test(m.subject)).map((m) => ({
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
assert.match(customer.body, /becomes credit for another collection day or one of our markets, valid for 6 months/, "cancellation policy (DRAFT) is in the order auto-reply");
assert.ok(customer.htmlBody.includes("you can choose a refund or credit"));
assert.ok(customer.htmlBody.includes("&lt;i&gt;please"), "customer text is escaped in the HTML email");
assert.ok(!customer.htmlBody.includes("<i>please"), "no raw HTML from the customer");
assert.deepEqual(labelled.map((l) => l[1]), ["Orders"]);

assert.match(owner.body, /Pickup point: Kenilworth Corner, Main Rd, Kenilworth/);
assert.match(owner.body, /Collection day: Sat 19 Dec 2026/);
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
assert.match(pOwner.body, /Collection day: Sat 19 Dec 2026/);
assert.match(pOwner.body, /Preferred time: 10:30/);
assert.match(pOwner.body, /Collection times: Saturdays, 10am to 1pm/);
assert.doesNotMatch(pOwner.body, /market/i, "no market wording in the owner email");
// The customer email may mention markets only through the cancellation policy (credit can be used at a market), never as a collection place.
assert.doesNotMatch(pCustomer.body.replace(/becomes credit for another collection day or one of our markets, valid for 6 months/, ""), /market/i, "no market wording in order emails apart from the credit policy");
assert.match(pCustomer.body, /Pickup point: Kenilworth Corner/);
assert.match(pCustomer.htmlBody, />Collect<\/div>[\s\S]*Kenilworth Corner/, "branded customer email shows where to collect");
assert.ok(pCustomer.htmlBody.includes("/logo-white.png") && /alt="STUFF'D"/.test(pCustomer.htmlBody), "customer email carries the logo, with alt text");
assert.ok(pOwner.htmlBody && pOwner.htmlBody.includes("/logo-white.png"), "owner email is branded HTML too");
assert.ok(pOwner.htmlBody.includes("https://wa.me/") && pOwner.htmlBody.includes("tel:+") && pOwner.htmlBody.includes("mailto:"), "owner email has WhatsApp, call and email buttons");
assert.ok(!/<i>please/.test(pOwner.htmlBody), "no raw customer HTML in the owner email");
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
// A paid order still goes through after the caps are hit: the customer has paid, so the owner must hear about it.
{ const paidLate = post({ ...order, ref: "SB-LATE99", email: "s.a.m.smith@gmail.com", checkoutId: "ch_LATE0099" });
  assert.equal(paidLate.ok, true, "paid orders are never refused by the daily or per-address caps"); }
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

// Pickup-day reminder (founder 2026-11-19): saved per paid order, sent on the collection day, then deleted.
{
  propStore.clear();
  const realDate = ctx.Date;
  const at = (iso) => { ctx.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [iso])); } static now() { return new realDate(iso).getTime(); } }; };
  const before = sent.length;
  const mk = (ref, pickupDate, extra = {}) => ({ ...order, ref, checkoutId: "ch_" + ref.replace("-", ""), pickupDate, pickupTime: "2pm to 3pm", email: ref.toLowerCase() + "@example.com", ...extra });
  assert.equal(post(mk("SB-REMA11", "2026-11-28")).ok, true);
  assert.equal(post(mk("SB-REMB22", "2026-12-05")).ok, true);
  assert.equal(post({ ...booking, ref: "BK-REMC33", email: "remc@example.com" }).ok, true);
  const saved = JSON.parse(propStore.get("rem_SB-REMA11"));
  assert.deepEqual(Object.keys(saved).sort(), ["email", "first", "items", "pickupDate", "pickupDays", "pickupPlace", "pickupTime", "ref"], "only what the reminder needs");
  assert.equal(saved.first, "Aisha", "first name only");
  assert.ok(!("phone" in saved) && !("note" in saved) && !("checkoutId" in saved), "no phone, note or payment id kept");
  assert.ok(!propStore.has("rem_BK-REMC33"), "bookings get no reminder");
  assert.match(sent[before + 1].body, /reminder on the morning of your collection day/, "confirmation tells the customer a reminder is coming");
  const sentBefore = sent.length;
  at("2026-11-27T08:15:00+02:00"); ctx.sendReminders();
  assert.equal(sent.length, sentBefore, "nothing the day before");
  at("2026-11-28T08:15:00+02:00"); ctx.sendReminders();
  assert.equal(sent.length, sentBefore + 1, "one reminder on collection day");
  const rem = sent.at(-1);
  assert.equal(rem.to, "sb-rema11@example.com");
  assert.equal(rem.subject, "STUFF'D: collection day! Your order SB-REMA11");
  assert.equal(rem.replyTo, "stuffd.bagels@gmail.com");
  assert.match(rem.body, /today is collection day/);
  assert.match(rem.body, /Where: Kenilworth Corner/);
  assert.match(rem.body, /Your preferred time: 2pm to 3pm/);
  assert.match(rem.body, /2 x Pizza Bagel/);
  assert.ok(rem.htmlBody.includes("/logo-white.png") && rem.htmlBody.includes("Collection day!"), "branded reminder");
  assert.ok(!rem.htmlBody.includes("<b>Khan"), "no raw customer HTML");
  assert.ok(!propStore.has("rem_SB-REMA11"), "deleted once sent");
  assert.ok(propStore.has("rem_SB-REMB22"), "later Saturday kept");
  ctx.sendReminders();
  assert.equal(sent.length, sentBefore + 1, "never sent twice");
  // Low quota on the day: held, not sent, and not deleted (an owner email still has room).
  assert.equal(post(mk("SB-REMD44", "2026-12-05")).ok, true);
  const s2 = sent.length;
  quota = 3; at("2026-12-05T08:15:00+02:00"); ctx.sendReminders();
  assert.equal(sent.length, s2, "quota below MIN_QUOTA: no reminders");
  assert.ok(propStore.has("rem_SB-REMB22"));
  quota = 100; ctx.sendReminders();
  assert.equal(sent.length, s2 + 2, "both 5 Dec reminders go once quota allows");
  // A reminder whose day has passed is deleted unsent; a broken one too.
  assert.equal(post(mk("SB-REME55", "2026-12-12")).ok, true);
  propStore.set("rem_SB-BROKEN", "{not json");
  const s3 = sent.length;
  at("2026-12-13T08:15:00+02:00"); ctx.sendReminders();
  assert.equal(sent.length, s3, "missed day: not sent late");
  assert.equal([...propStore.keys()].filter((k) => k.startsWith("rem_")).length, 0, "missed and broken reminders deleted");
  ctx.Date = realDate;
  propStore.clear();
}


// Automatic refunds (founder 2026-11-19): the confirmation email carries a Worker-signed cancel link; a 'cancel' request emails the owner and the
// customer, deletes the pickup reminder, and respects the quota. The script never signs anything: it only prints a link the Worker made.
{
  propStore.clear(); cacheStore.clear(); labelled.length = 0;
  const SIG = "A".repeat(43);
  const link = (host = "stuffdbagels.co.za", ref = "SB-LNK234") => `https://${host}/order/cancel#${ref}.1764115200.${SIG}`;
  const label = "Wednesday 25 Nov at 23:59";
  const mk = (ref, extra = {}) => ({ ...order, ref, checkoutId: "ch_" + ref.replace("-", ""), email: ref.toLowerCase() + "@example.com", name: "Aisha Khan", note: "", ...extra });

  // The link and its label are printed in plain text and HTML, escaped, and only when they look exactly like what the Worker makes.
  let before = sent.length;
  assert.equal(post(mk("SB-LNK234", { cancelUrl: link(), cancelByLabel: label })).ok, true);
  let [oOwner, oCust] = sent.slice(before);
  assert.ok(oCust.body.includes(`Need to cancel? You can cancel and get a full refund until ${label}: ${link()}`), "plain text has the link and the cut-off");
  assert.ok(oCust.htmlBody.includes(`href="${link()}"`) && oCust.htmlBody.includes(">Cancel my order</a>") && oCust.htmlBody.includes(`until ${label}.`), "HTML has a Cancel my order button");
  assert.ok(!oOwner.body.includes("order/cancel#") && !oOwner.htmlBody.includes("order/cancel#"), "the owner email never carries the customer's link");
  assert.match(oOwner.body, /website refunds them automatically and emails you/, "owner is told refunds are automatic");
  assert.doesNotMatch(oOwner.body + oOwner.htmlBody, /you need the id to refund\.|what you need to refund/, "old 'you refund by hand' wording is gone");
  let badCount = 0;
  for (const [name, bad] of [
    ["another host", { cancelUrl: link("evil.example"), cancelByLabel: label }],
    ["look-alike host", { cancelUrl: link("stuffdbagels.co.za.evil.example"), cancelByLabel: label }],
    ["http", { cancelUrl: link().replace("https", "http"), cancelByLabel: label }],
    ["a query string", { cancelUrl: link() + "?x=1", cancelByLabel: label }],
    ["a different path", { cancelUrl: link().replace("/order/cancel", "/admin"), cancelByLabel: label }],
    ["a javascript: link", { cancelUrl: "javascript:alert(1)", cancelByLabel: label }],
    ["a short signature", { cancelUrl: link().slice(0, -3), cancelByLabel: label }],
    ["markup in the link", { cancelUrl: link() + '"><script>', cancelByLabel: label }],
    ["no label", { cancelUrl: link() }],
    ["a label with markup", { cancelUrl: link(), cancelByLabel: "<b>Wednesday</b> 25 Nov at 23:59" }],
    ["not a string", { cancelUrl: { a: 1 }, cancelByLabel: label }],
  ]) {
    const b4 = sent.length;
    const ref = "SB-" + "BAD" + String(100 + badCount++); // distinct every time (a random number sometimes repeated and was swallowed as a duplicate)
    assert.equal(post(mk(ref, bad)).ok, true, name + ": the PAID order is still accepted");
    const cust = sent[b4 + 1];
    assert.ok(!cust.body.includes("Need to cancel?") && !cust.htmlBody.includes("order/cancel"), name + ": link left out");
  }
  assert.equal(post(mk("SB-LNK234", { cancelUrl: link(), cancelByLabel: label })).duplicate, true);
  // The preview Worker shares this script, so its host is allowed too.
  before = sent.length;
  assert.equal(post(mk("SB-PRV234", { cancelUrl: link("stuffdbagels-preview.thedigitalpantryza.workers.dev", "SB-PRV234"), cancelByLabel: label })).ok, true);
  assert.ok(sent[before + 1].body.includes("stuffdbagels-preview.thedigitalpantryza.workers.dev/order/cancel#SB-PRV234"));
  // No link at all (no secret, or the cut-off had passed when the email went out): the email is the old one, no cancel wording.
  before = sent.length; assert.equal(post(mk("SB-NOL234")).ok, true);
  assert.ok(!sent[before + 1].body.includes("Need to cancel?") && !sent[before + 1].htmlBody.includes("Cancel my order"));
  assert.match(sent[before + 1].body, /Questions\? Just reply to this email/);
  propStore.clear(); cacheStore.clear();

  // A cancellation: owner "SB-xxxx cancelled and refunded", customer refund confirmation, reminder deleted, labelled under Orders.
  const paid = mk("SB-CNL234", { pickupDate: "2026-11-28" });
  assert.equal(post(paid).ok, true);
  assert.ok(propStore.has("rem_SB-CNL234"), "the reminder exists before the cancellation");
  const cancel = (o = "refunded", extra = {}) => ({ type: "cancel", outcome: o, checkoutId: paid.checkoutId, ref: "SB-CNL234", name: "Aisha <b>Khan</b>", email: paid.email, pickupDate: "2026-11-28", pickupPlace: "Strandfontein collection, Strandfontein", items: [{ name: "Classic Bagel", qty: 2, unit: 65, line: 1 }], total: 1, ...extra });
  const capBefore = propStore.get("cap_total");
  labelled.length = 0; before = sent.length;
  assert.deepEqual(post(cancel()), { ok: true });
  assert.equal(sent.length, before + 2, "one email to the owner, one to the customer");
  const [cOwner, cCust] = sent.slice(before);
  assert.equal(cOwner.subject, "SB-CNL234 cancelled and refunded"); assert.equal(cOwner.to, "stuffd.bagels@gmail.com");
  assert.match(cOwner.body, /CANCELLED AND REFUNDED SB-CNL234\. Yoco confirmed the full refund of R130\. Nothing for you to do\./, "total is recomputed from the items, not trusted");
  assert.match(cOwner.body, /Yoco checkout id: ch_SBCNL234/); assert.match(cOwner.body, /reminder for this order was deleted/);
  assert.equal(cCust.to, paid.email); assert.equal(cCust.subject, "STUFF'D: refund processed SB-CNL234"); assert.equal(cCust.replyTo, "stuffd.bagels@gmail.com");
  assert.match(cCust.body, /Your order is cancelled, Aisha\./); assert.match(cCust.body, /refund of R130 has been processed through Yoco/); assert.match(cCust.body, /Refund: R130/);
  assert.ok(cCust.htmlBody.includes("Refund processed") && cCust.htmlBody.includes("/logo-white.png"), "branded");
  assert.ok(cOwner.htmlBody.includes("&lt;b&gt;Khan") && !cOwner.htmlBody.includes("<b>Khan"), "customer text escaped in the owner HTML");
  assert.ok(!propStore.has("rem_SB-CNL234"), "the pickup reminder is deleted, so no reminder goes out");
  assert.ok(labelled.some((l) => l[0] === "SB-CNL234 cancelled and refunded" && l[1] === "Orders"), "the owner email is filed under Orders");
  assert.ok(!labelled.some((l) => /refund processed/i.test(l[0])), "the customer copy is not filed");
  assert.equal(propStore.get("cap_total"), capBefore, "a cancellation doesn't use up the booking cap");
  assert.equal(cacheTtl.get("cancel_SB-CNL234_refunded"), 21600);
  // The Worker retries until it hears ok: the same outcome is emailed once, a new outcome is a new email.
  assert.deepEqual(post(cancel()), { ok: true, duplicate: true }); assert.equal(sent.length, before + 2);
  const pend = sent.length; assert.equal(post(cancel("pending")).ok, true); assert.equal(sent.length, pend + 2);
  assert.equal(sent[pend].subject, "SB-CNL234 cancelled, refund pending"); assert.equal(sent[pend + 1].subject, "STUFF'D: your refund is on its way SB-CNL234");
  assert.match(sent[pend].body, /still pending\. Check in the Yoco app/); assert.match(sent[pend + 1].body, /Yoco is processing your refund of R130/);
  const fail = sent.length; assert.equal(post(cancel("failed")).ok, true);
  assert.equal(sent[fail].subject, "SB-CNL234 cancelled: REFUND FAILED, check Yoco");
  assert.match(sent[fail].body, /BUT THE REFUND WAS NOT CONFIRMED[\s\S]*FIRST check the Yoco app: it may already show a refund[\s\S]*Only if it does not, refund this payment in full/); assert.ok(!/phone|wa\.me|tel:/i.test((sent[fail].body + sent[fail].htmlBody).replace(/phone: see the original order email/gi, "")), "a cancellation email carries no phone number or WhatsApp / call button"); assert.match(sent[fail].body, /Phone: see the original order email/); assert.match(sent[fail].htmlBody, /Refund failed/);
  assert.equal(sent[fail + 1].subject, "STUFF'D: we've got your cancellation SB-CNL234");
  assert.match(sent[fail + 1].body, /couldn't finish your refund of R130 automatically\. We've been told and we will sort it out/); assert.match(sent[fail + 1].body, /To be refunded: R130/);
  assert.ok(!/credit|market/i.test(sent.slice(before).map((m) => m.body).join("\n")), "refund emails say nothing about credit");

  // Refusals: nothing is emailed for a malformed cancel, and a made-up outcome is not accepted.
  const b0 = sent.length;
  for (const bad of [cancel("done"), cancel(null), cancel("refunded", { ref: "BK-CNL234" }), cancel("refunded", { checkoutId: "" }), cancel("refunded", { items: [] }), cancel("refunded", { pickupPlace: "" }), cancel("refunded", { pickupDate: "tomorrow" }), cancel("refunded", { email: "nope" })])
    assert.equal(post(bad).ok, false, JSON.stringify(bad));
  assert.equal(post(cancel("refunded"), NONE).ok, false, "no token: refused"); assert.equal(post(cancel("pending"), "wrong").ok, false, "wrong token: refused");
  assert.equal(sent.length, b0);

  // Quota: the same wall as every other email. The reminder is still deleted (a cancelled order must never get 'collection day').
  propStore.clear(); cacheStore.clear();
  assert.equal(post(mk("SB-QTA234")).ok, true); assert.ok(propStore.has("rem_SB-QTA234"));
  quota = 3; const q0 = sent.length;
  assert.deepEqual(post(cancel("refunded", { ref: "SB-QTA234", checkoutId: "ch_SBQTA234" })), { ok: false, error: "quota" });
  assert.equal(sent.length, q0, "nothing sent below MIN_QUOTA"); assert.ok(!propStore.has("rem_SB-QTA234"), "reminder deleted even when the emails wait");
  quota = 100; assert.equal(post(cancel("refunded", { ref: "SB-QTA234", checkoutId: "ch_SBQTA234" })).ok, true, "the Worker's retry goes through once the quota allows");
  assert.equal(sent.length, q0 + 2);
  quota = 1; const q1 = sent.length;  // the owner email needs MIN_QUOTA; the customer one only 1
  assert.equal(post(cancel("pending", { ref: "SB-QTA234", checkoutId: "ch_SBQTA234" })).error, "quota"); assert.equal(sent.length, q1);
  quota = 100;

  // Never refused by the booking caps (the money has already moved).
  vm.runInContext("CONFIG.MAX_SUBMISSIONS_PER_DAY = 0", ctx);
  assert.equal(post(cancel("refunded", { ref: "SB-CAP234", checkoutId: "ch_SBCAP234" })).ok, true, "daily cap 0 does not stop a cancellation");
  vm.runInContext("CONFIG.MAX_SUBMISSIONS_PER_DAY = 40", ctx);

  // The reminder of ANOTHER order is untouched.
  propStore.clear(); cacheStore.clear();
  assert.equal(post(mk("SB-KEEP22")).ok, true); assert.equal(post(mk("SB-GONE22")).ok, true);
  assert.equal(post(cancel("refunded", { ref: "SB-GONE22", checkoutId: "ch_SBGONE22" })).ok, true);
  assert.ok(propStore.has("rem_SB-KEEP22") && !propStore.has("rem_SB-GONE22"), "only the cancelled order's reminder is deleted");
  // A cancelled order's reminder day arrives: nothing is sent for it.
  { const realDate = ctx.Date; const iso = "2026-12-19T08:15:00+02:00";
    ctx.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [iso])); } static now() { return new realDate(iso).getTime(); } };
    const s0 = sent.length; ctx.sendReminders(); ctx.Date = realDate;
    assert.equal(sent.length, s0 + 1, "one reminder (the order that wasn't cancelled)"); assert.equal(sent.at(-1).to, "sb-keep22@example.com"); }
  propStore.clear(); cacheStore.clear(); labelled.length = 0;

  // The new copy has no emoji and no em dash, and the cancel emails don't use the words the order-email test bans.
  const added = code.split("\n").filter((l) => /cancel|refund/i.test(l)).join("\n");
  assert.ok(!/[—–\u{1F300}-\u{1FAFF}☀-➿]/u.test(added), "no em dash, en dash or emoji in the cancel and refund wording");
  console.log("automatic refunds in Code.gs: link printing, cancel emails, reminder deletion, quota, caps");
}

// Market pre-orders (SB-20): wording, owner subject, Gmail label for ANY market name with no code change, reminder, cancellation.
{
  propStore.clear(); cacheStore.clear(); labelled.length = 0; labels.clear(); sent.length = 0;
  const mkt = (ref, marketName, extra = {}) => ({
    ...order, ref, name: "Maryam", email: `${ref.toLowerCase()}@example.com`, pickupDate: "2026-12-18", pickupTime: "10am to 11am", pickupDays: "10am to 7pm",
    pickupPlace: "Our stall at Summer Social '26, Whitebox by Limitless, Wetton", marketName, items: [{ name: "Classic Bagel", qty: 2, unit: 65, line: 130 }], ...extra,
  });
  const fresh = () => { sent.length = 0; labelled.length = 0; }; // the fake Gmail search ignores "-label:", so earlier emails would be re-filed
  assert.equal(post(mkt("SB-MKT234", "Summer Social '26")).ok, true);
  const [mOwner, mCust] = sent.slice(-2);
  assert.equal(mOwner.subject, "New order: Maryam, Fri 18 Dec (Summer Social '26)", "owner subject names the market");
  assert.match(mOwner.body, /Collect at: Our stall at Summer Social '26, Whitebox by Limitless, Wetton/);
  assert.match(mOwner.body, /Collection day: Fri 18 Dec 2026/);
  assert.match(mOwner.body, /Stall hours: 10am to 7pm/);
  assert.doesNotMatch(mOwner.body, /Pickup point|Collection Saturday/);
  assert.match(mCust.body, /Collect at our stall at Summer Social '26, Fri 18 Dec 2026, 10am to 7pm\./, "customer email says where, which day and the hours");
  assert.doesNotMatch(mCust.body + mCust.htmlBody, /collection Saturday/i, "'collection day' wording only");
  assert.ok(mCust.htmlBody.includes("Stall hours: 10am to 7pm"));
  // Filed under the parent and a sub-label made from the name; created parent first; NOT under Orders.
  assert.deepEqual(labelled.map((l) => l[1]), ["Market Pre-orders", "Market Pre-orders/Summer Social '26"]);
  assert.ok(labels.has("Market Pre-orders") && labels.has("Market Pre-orders/Summer Social '26"), "both labels were created");
  assert.deepEqual([...labels.keys()].filter((k) => k.startsWith("Market")), ["Market Pre-orders", "Market Pre-orders/Summer Social '26"], "parent first, then the child");
  assert.ok(propStore.get("rem_SB-MKT234").includes("Summer Social"), "the reminder keeps the market name");

  // ANY new market name works with no code change: a made-up one gets its own label.
  fresh();
  assert.equal(post(mkt("SB-NEW234", "Oranjezicht City Farm Market")).ok, true);
  assert.deepEqual(labelled.map((l) => l[1]), ["Market Pre-orders", "Market Pre-orders/Oranjezicht City Farm Market"]);
  // Unsafe names: "/" would nest, control characters and brackets are removed, long names are cut to 40, spaces are trimmed.
  const tidy = (n) => vm.runInContext(`marketLabelPath_(${JSON.stringify(n)})`, ctx);
  assert.equal(tidy("Evil/Nested/Name"), "Market Pre-orders/Evil Nested Name", "no stray nesting");
  assert.equal(tidy("  Night\u0007 Market\n(x)  "), "Market Pre-orders/Night Market x");
  assert.equal(tidy("A".repeat(60)), "Market Pre-orders/" + "A".repeat(40), "capped at 40 characters");
  assert.equal(tidy(""), "Market Pre-orders", "missing name: the parent label");
  assert.equal(tidy("///"), "Market Pre-orders", "nothing usable left: the parent label");
  assert.equal(tidy(undefined), "Market Pre-orders");
  assert.equal(tidy("Market Pre-orders"), "Market Pre-orders", "a market called the same as the parent does not nest into itself");
  fresh();
  assert.equal(post(mkt("SB-SLH234", "Bad/Slash Market")).ok, true);
  assert.equal(sent.at(-2).subject, "New order: Maryam, Fri 18 Dec (Bad Slash Market)");
  assert.deepEqual(labelled.map((l) => l[1]), ["Market Pre-orders", "Market Pre-orders/Bad Slash Market"]);
  // Name missing or empty on a market order: filed under the plain parent label only.
  fresh();
  assert.equal(post(mkt("SB-EMP234", "")).ok, true);
  assert.equal(sent.at(-2).subject, "New order: Maryam, Fri 18 Dec (Market Pre-orders)");
  assert.deepEqual(labelled.map((l) => l[1]), ["Market Pre-orders"]);
  assert.ok(![...labels.keys()].includes("Market Pre-orders/Market Pre-orders"), "no Market Pre-orders/Market Pre-orders");
  // Saturday orders still go to Orders only.
  fresh();
  assert.equal(post({ ...order, ref: "SB-SAT234" }).ok, true);
  assert.deepEqual(labelled.map((l) => l[1]), ["Orders"]);

  // Reminder on the market morning names the stall.
  { const realDate = ctx.Date; const iso = "2026-12-18T08:15:00+02:00";
    ctx.Date = class extends realDate { constructor(...a) { super(...(a.length ? a : [iso])); } static now() { return new realDate(iso).getTime(); } };
    const s0 = sent.length; ctx.sendReminders(); ctx.Date = realDate;
    const rem = sent.slice(s0).find((m) => m.to === "sb-mkt234@example.com");
    assert.ok(rem, "the market order's reminder is sent on the market day");
    assert.match(rem.body, /Come and see us at our stall at Summer Social '26, 10am to 7pm\./);
    assert.match(rem.body, /Stall hours: 10am to 7pm/);
    assert.ok(!propStore.has("rem_SB-MKT234"), "and deleted"); }
  // A cancellation of a market order: subject carries the market, filed under it, reminder deleted.
  propStore.clear(); cacheStore.clear(); fresh();
  assert.equal(post(mkt("SB-CMK234", "Summer Social '26")).ok, true);
  labelled.length = 0;
  assert.equal(post({ type: "cancel", outcome: "refunded", checkoutId: "ch_CMK234", ref: "SB-CMK234", name: "Maryam", email: "sb-cmk234@example.com", pickupDate: "2026-12-18",
    pickupPlace: "Our stall at Summer Social '26, Whitebox by Limitless, Wetton", marketName: "Summer Social '26", items: [{ name: "Classic Bagel", qty: 2, unit: 65, line: 130 }], total: 130 }).ok, true);
  assert.ok(sent.some((m) => m.subject === "SB-CMK234 cancelled and refunded (Summer Social '26)"), "cancel subject carries the market");
  assert.ok(labelled.some((l) => l[0].startsWith("SB-CMK234 cancelled") && l[1] === "Market Pre-orders/Summer Social '26"), "cancellation filed under the market");
  assert.ok(!propStore.has("rem_SB-CMK234"));
  propStore.clear(); cacheStore.clear(); labelled.length = 0; labels.clear();
  console.log("market pre-orders in Code.gs: wording, subject, labels for any market name, reminder, cancellation");
}

// Quota.
quota = 2;
assert.equal(post({ ...booking, ref: "BK-CCC333", guests: 13, email: "quota@example.com" }).error, "quota");
console.log("apps-script selftest: all checks passed");

// The cancellation policy has three copies (collection.ts, Code.gs, the FAQ in content.ts): they must stay identical.
{
  const fs = await import("node:fs");
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const policy = src("../artifacts/stuffd-bagels/src/collection.ts").match(/CANCELLATION_POLICY =\s*"([^"]+)"/)[1];
  assert.ok(policy.includes("valid for 6 months"));
  assert.ok(src("./Code.gs").includes(`CANCELLATION_POLICY_ = "${policy}"`), "Code.gs copy matches");
  assert.ok(src("../artifacts/stuffd-bagels/src/content.ts").includes(policy), "FAQ copy matches");
  console.log("cancellation policy: three copies identical");
}

// Turnstile wiring (D-SB-7): the CSP lets the widget load, both forms post a token, the Worker checks it on both routes, and no secret is in the repo.
{
  const fs = await import("node:fs");
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const csp = src("../artifacts/stuffd-bagels/public/_headers").match(/Content-Security-Policy: (.*)/)[1];
  const dir = (name) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "");
  assert.ok(dir("script-src").includes("https://challenges.cloudflare.com") && dir("frame-src").includes("https://challenges.cloudflare.com"), "CSP allows the Turnstile script and frame");
  assert.ok(!dir("script-src").includes("'unsafe-inline'") && !dir("script-src").includes("*"), "script-src stays tight");
  assert.ok(dir("connect-src") === "connect-src 'self'", "connect-src stays 'self'");
  const forms = src("../worker/forms.ts");
  assert.ok(/verifyTurnstile\(request, env, body\.turnstileToken, "order"\)/.test(forms) && /verifyTurnstile\(request, env, body\.turnstileToken, "booking"\)/.test(forms), "Worker checks both routes");
  assert.ok(forms.indexOf('verifyTurnstile(request, env, body.turnstileToken, "order")') < forms.indexOf("createCheckout(env"), "order: checked before a Yoco checkout");
  assert.ok(forms.indexOf('verifyTurnstile(request, env, body.turnstileToken, "booking")') < forms.indexOf("await forward(env, payload)"), "booking: checked before the email");
  assert.ok(src("../artifacts/stuffd-bagels/src/pages/Home.tsx").includes('useTurnstile("order"') && src("../artifacts/stuffd-bagels/src/components/booking-form.tsx").includes('useTurnstile("booking"'), "both forms use the widget");
  const wr = src("../wrangler.jsonc");
  assert.ok(!/TURNSTILE_SECRET_KEY"\s*:/.test(wr), "the secret is never a var in wrangler.jsonc");
  assert.ok(/"vars": \{ "APP_ENV": "production",[^}]*"TURNSTILE_SITE_KEY": "0x4AAAAAAGIpBftgw-wYSqUM",/.test(wr), "production has the real (public) Turnstile site key, not a documented test key");
  assert.ok(/"preview": \{[\s\S]*"TURNSTILE_SITE_KEY": "1x00000000000000000000AA"/.test(wr), "preview uses the documented test site key");
  console.log("turnstile wiring: CSP, both routes, both forms, no secret in config");
}

// Automatic refunds wiring: the Worker signs and checks, the page is static and private, the CSP is pinned to the Turnstile script path, and the secret is only ever a secret.
{
  const fs = await import("node:fs");
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const headers = src("../artifacts/stuffd-bagels/public/_headers");
  const csp = headers.match(/Content-Security-Policy: (.*)/)[1];
  const dir = (name) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "");
  assert.equal(dir("script-src"), "script-src 'self' https://challenges.cloudflare.com/turnstile/v0/", "script-src is pinned to the Turnstile script path (web-security PR #16 nit 5)");
  assert.ok(/\/order\/cancel\n  X-Robots-Tag: noindex\n  Cache-Control: no-store\n  ! Referrer-Policy\n  Referrer-Policy: no-referrer/.test(headers), "/order/cancel: noindex, never cached, no referrer");
  const cancel = src("../worker/cancel.ts"), forms = src("../worker/forms.ts"), index = src("../worker/index.ts"), core = src("../worker/orders-core.ts");
  assert.ok(index.includes('parts[2] === "cancel"') && index.includes('methodOnly(request, ["POST"]);\n    return handleCancel('), "cancel is POST only");
  assert.ok(cancel.indexOf("verifyTurnstile(request, env, body.turnstileToken") < cancel.indexOf("refundCheckout(env"), "Turnstile is checked before any refund");
  assert.ok(cancel.indexOf("tokenOf(env, body)") < cancel.indexOf("verifyTurnstile("), "a bad link is refused before Turnstile is spent");
  assert.ok(cancel.indexOf("beginCancel(") < cancel.indexOf("refundCheckout(env"), "the claim is written before Yoco is called");
  assert.ok(!/body\.(amount|total)|\.amount\b/.test(cancel), "the cancel handler never reads an amount from the browser");
  assert.ok(forms.includes("cancelReady(env)"), "orders are refused without the cancel secret");
  assert.ok(core.includes("now >= until"), "the cut-off is re-checked on the server when the refund is claimed");
  const wr = src("../wrangler.jsonc");
  assert.ok(!/CANCEL_LINK_SECRET"\s*:/.test(wr), "the cancel secret is never a var in wrangler.jsonc");
  console.log("automatic refunds wiring: POST only, Turnstile before refund, claim before Yoco, secret not in config, CSP pinned, cancel page private");
}
