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
let quota = 100;
const threads = () =>
  sent.filter((m) => /^(New order|Booking enquiry): /.test(m.subject)).map((m) => ({
    getFirstMessageSubject: () => m.subject,
    addLabel: (l) => labelled.push([m.subject, l.getName()]),
  }));
const labels = new Map();
const ctx = {
  console,
  Date,
  JSON,
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => cacheStore.set(k, v) }) },
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
const post = (o) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(o) } }).s);

const order = {
  type: "order", ref: "SB-ABC234", name: "Aisha <b>Khan</b>", phone: "+27821234567", email: "aisha@example.com",
  pickupDate: "2026-12-19", pickupTime: "", pickupDays: "", pickupPlace: "Kenilworth Corner, Main Rd, Kenilworth",
  items: [{ name: "Pizza Bagel", qty: 2, unit: 95, line: 999 }, { name: "Steak'd Bagel", qty: 1, unit: 115, line: 115 }],
  note: "No onions <i>please</i>",
};
const r1 = post(order);
assert.equal(r1.ok, true);
assert.equal(sent.length, 2);
const [owner, customer] = sent;
assert.match(owner.subject, /^New order: Aisha <b>Khan<\/b>, Sat 19 Dec$/);
assert.match(owner.body, /AWAITING PAYMENT/);
assert.match(owner.body, /Total: R305/, "total is recomputed from qty x unit, not trusted");
assert.equal(owner.replyTo, "aisha@example.com");
assert.equal(customer.to, "aisha@example.com");
assert.match(customer.subject, /we've got your order SB-ABC234/);
assert.match(customer.body, /awaiting payment/);
assert.doesNotMatch(customer.body + customer.htmlBody, /order is confirmed/i);
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
assert.doesNotMatch(pOwner.body + pCustomer.body, /market/i, "no market wording in order emails");
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

// Token, when set.
vm.runInContext('CONFIG.SHARED_TOKEN = "s3cret"', ctx);
assert.equal(post({ ...booking, ref: "BK-BBB222", guests: 12 }).ok, false);
assert.equal(post({ ...booking, ref: "BK-BBB222", guests: 12, token: "s3cret" }).ok, true);
vm.runInContext('CONFIG.SHARED_TOKEN = ""', ctx);

// Quota.
quota = 2;
assert.equal(post({ ...booking, ref: "BK-CCC333", guests: 13 }).error, "quota");
console.log("apps-script selftest: all checks passed");
