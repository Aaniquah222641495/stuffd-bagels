// Saturday collection rules, enforced by the real Worker order code (worker/forms.ts) with a fake clock and a fake KV.
// Run: node worker/tests/saturday-rules.mjs      (bundles forms.ts with the esbuild that comes with wrangler)
// All times are South African (SAST, UTC+2, no daylight saving).
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundle, fakeLimiter } from "./_bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { handleForm } = await bundle("worker/forms.ts");
const col = await import(pathToFileURL(path.join(root, "artifacts/stuffd-bagels/src/collection.ts")).href);

globalThis.fetch = async () => new Response('{"ok":true}'); // the Apps Script says yes
const sast = (iso, time = "12:00:00") => Date.parse(`${iso}T${time}+02:00`);

function kvWith(data) {
  const m = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
}
const POINTS = { pickups: [
  { id: "p1", name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm", active: true },
  { id: "p2", name: "Off Point", area: "Somewhere", days: "", active: false },
] };
async function order(date, now, { availability = {}, pickups = POINTS, body = {} } = {}) {
  const lim = await fakeLimiter({ now: () => now });
  const env = { LIMITER: lim.ns, APPS_SCRIPT_TOKEN: "t".repeat(40), STUFFD_KV: kvWith({ availability: { ordersEnabled: true, closedDates: [], closedMessage: "", ...availability }, pickups }), ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec" };
  const payload = { name: "Aisha", phone: "0821234567", email: "a@b.co", pickupId: "p1", pickupDate: date, items: { "Classic Bagel": 1 }, website: "", ...body };
  const req = new Request("http://x/api/order", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify(payload) });
  try {
    const res = await handleForm(req, env, "order", now);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    return { status: e.status ?? 500, body: { error: e.message } };
  }
}
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);

// 1. Wednesday 23:59 versus Thursday 00:00 (Saturday 21 Nov 2026 closes Wednesday 18 Nov)
assert.equal((await order("2026-11-21", sast("2026-11-18", "23:59:00"))).status, 200);
assert.equal((await order("2026-11-21", sast("2026-11-18", "23:59:59"))).status, 200);
let r = await order("2026-11-21", sast("2026-11-19", "00:00:00"));
assert.equal(r.status, 409); assert.match(r.body.error, /closed/i);
assert.equal((await order("2026-11-28", sast("2026-11-19", "00:00:00"))).status, 200, "after the cut-off, next Saturday is fine");
ok("Wed 23:59:00 and 23:59:59 accepted; Thu 00:00:00 refused; the following Saturday still open");

// 2. The boundary is SAST, not UTC: 21:59:59Z = Wed 23:59:59 SAST, 22:00:00Z = Thu 00:00:00 SAST
assert.equal((await order("2026-11-21", Date.parse("2026-11-18T21:59:59Z"))).status, 200);
assert.equal((await order("2026-11-21", Date.parse("2026-11-18T22:00:00Z"))).status, 409);
ok("cut-off follows South African time (22:00 UTC Wednesday = Thursday 00:00 SAST)");

// 3. Saturday only
for (const d of ["2026-11-20", "2026-11-22", "2026-11-25", "2026-11-23"]) assert.equal((await order(d, sast("2026-11-16"))).status, 400, d);
ok("Friday, Sunday, Monday and Wednesday collections refused");
for (const d of ["2026-11-14", "2026-11-07", "not-a-date", "2026-02-30", "", null]) assert.equal((await order(d, sast("2026-11-16"))).status, 400, String(d));
ok("past Saturdays, junk and impossible dates refused");

// 4. Closed Saturday
r = await order("2026-11-28", sast("2026-11-16"), { availability: { closedDates: ["2026-11-28"], closedMessage: "Closed that Saturday" } });
assert.equal(r.status, 409); assert.equal(r.body.error, "Closed that Saturday");
assert.equal((await order("2026-11-21", sast("2026-11-16"), { availability: { closedDates: ["2026-11-28"] } })).status, 200);
ok("a closed Saturday is refused with the owner's message; other Saturdays still open");

// 5. Weeks ahead (default 2, editable)
assert.equal((await order("2026-11-28", sast("2026-11-16"))).status, 200);   // 12 days ahead
assert.equal((await order("2026-12-05", sast("2026-11-16"))).status, 409);   // 19 days ahead, past the 2-week default
assert.equal((await order("2026-12-05", sast("2026-11-16"), { availability: { maxWeeksAhead: 4 } })).status, 200);
assert.equal((await order("2026-12-19", sast("2026-11-16"), { availability: { maxWeeksAhead: 4 } })).status, 409);   // 33 days ahead
assert.equal((await order("2027-01-09", sast("2026-11-16"), { availability: { maxWeeksAhead: 12 } })).status, 200);
ok("default 2 weeks ahead; owner can set 4 or 12");

// 6. Cut-off time is editable
assert.equal((await order("2026-11-21", sast("2026-11-18", "12:00:30"), { availability: { cutoffTime: "12:00" } })).status, 200);
assert.equal((await order("2026-11-21", sast("2026-11-18", "12:01:00"), { availability: { cutoffTime: "12:00" } })).status, 409);
assert.equal((await order("2026-11-21", sast("2026-11-18", "00:00:00"), { availability: { cutoffTime: "00:00" } })).status, 200);
assert.equal((await order("2026-11-21", sast("2026-11-18", "00:01:00"), { availability: { cutoffTime: "00:00" } })).status, 409);
ok("owner-set cut-off 12:00 and 00:00 respected to the minute");

// 7. Month and year ends (cut-off Wednesday sits in the previous month or year)
assert.equal(col.cutoffDay("2026-08-01"), "2026-07-29");
assert.equal((await order("2026-08-01", sast("2026-07-29", "23:59:30"), { availability: { maxWeeksAhead: 4 } })).status, 200);
assert.equal((await order("2026-08-01", sast("2026-07-30", "00:00:00"))).status, 409);
assert.equal((await order("2026-08-01", sast("2026-07-31", "12:00:00"))).status, 409);
assert.equal((await order("2026-08-08", sast("2026-07-31", "12:00:00"))).status, 200);
assert.equal(col.cutoffDay("2027-01-02"), "2026-12-30");
assert.equal((await order("2027-01-02", sast("2026-12-30", "23:59:30"))).status, 200);
assert.equal((await order("2027-01-02", sast("2026-12-31", "00:00:00"))).status, 409);
assert.equal(col.cutoffDay("2026-10-03"), "2026-09-30");
assert.equal((await order("2026-10-03", sast("2026-09-30", "23:59:59"))).status, 200);
assert.equal((await order("2026-10-03", sast("2026-10-01", "00:00:00"))).status, 409);
assert.equal(col.cutoffDay("2028-03-04"), "2028-03-01"); // leap year: Sat 4 Mar, Wed 1 Mar
assert.equal(col.cutoffDay("2024-03-02"), "2024-02-28"); // leap year, Saturday 2 Mar closes Wednesday 28 Feb
assert.equal(col.isSaturday("2024-03-02") && col.isSaturday("2028-03-04"), true);
ok("cut-off rolls correctly across month end (Jul/Aug, Sep/Oct), year end (Dec/Jan) and a leap-year February");

// 8. Saturday itself, and the Friday before
assert.equal((await order("2026-11-21", sast("2026-11-21", "08:00:00"))).status, 409, "on the Saturday the order window is long closed");
assert.equal((await order("2026-11-28", sast("2026-11-21", "08:00:00"))).status, 200);
ok("on a Saturday morning, that day is closed and the next Saturday is offered");

// 9. Pickup point checks
assert.equal((await order("2026-11-28", sast("2026-11-16"), { body: { pickupId: "nope" } })).status, 409);
assert.equal((await order("2026-11-28", sast("2026-11-16"), { body: { pickupId: "p2" } })).status, 409, "inactive point refused");
assert.equal((await order("2026-11-28", sast("2026-11-16"), { body: { pickupId: undefined } })).status, 400);
assert.equal((await order("2026-11-28", sast("2026-11-16"), { body: { pickupId: undefined, eventId: "mgm-26" } })).status, 400, "markets are not a collection option");
assert.equal((await order("2026-11-28", sast("2026-11-16"), { body: { pickupId: "../x" } })).status, 400);
assert.equal((await order("2026-11-28", sast("2026-11-16"), { pickups: { pickups: [] } })).status, 409, "no pickup points: nothing to collect from");
r = await order("2026-11-28", sast("2026-11-16"), { body: { pickupTime: "around 10:30" } });
assert.equal(r.status, 200); assert.match(r.body.ref, /^SB-/); assert.equal(r.body.status, "awaiting_payment");
assert.equal((await order("2026-11-28", sast("2026-11-16"), { body: { pickupTime: "x".repeat(41) } })).status, 400);
ok("pickup point must exist and be active; markets/eventId refused; time note limited to 40 characters");

// 10. Orders off, closed today
assert.equal((await order("2026-11-28", sast("2026-11-16"), { availability: { ordersEnabled: false, closedMessage: "Back soon" } })).status, 409);
assert.equal((await order("2026-11-28", sast("2026-11-16"), { availability: { closedDates: ["2026-11-16"] } })).status, 409, "today closed pauses new orders");
ok("orders switched off, or today a closed date: refused");

// 11. Pure helpers the page uses
const rules = { cutoffTime: "23:59", maxWeeksAhead: 4, closedDates: [] };
assert.deepEqual(col.availableSaturdays(sast("2026-11-16"), rules), ["2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12"]);
assert.deepEqual(col.availableSaturdays(sast("2026-11-19", "00:00:00"), rules), ["2026-11-28", "2026-12-05", "2026-12-12"]);
assert.equal(col.nearestSaturdayNote(sast("2026-11-19", "08:00:00"), rules), "Orders for this Saturday closed on Wednesday. You're ordering for Saturday 28 Nov.");
assert.equal(col.nearestSaturdayNote(sast("2026-11-16"), rules), "");
assert.equal(col.nearestSaturdayNote(sast("2026-11-16"), { ...rules, closedDates: ["2026-11-21"] }), "We're closed on Saturday 21 Nov. You're ordering for Saturday 28 Nov.");
assert.deepEqual(col.availableSaturdays(sast("2026-11-16"), { ...rules, closedDates: ["2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12"] }), []);
ok("page helpers: available Saturdays roll forward after the cut-off; the explanatory line matches the founder's wording");
console.log(`saturday-rules: all ${n} groups passed`);
