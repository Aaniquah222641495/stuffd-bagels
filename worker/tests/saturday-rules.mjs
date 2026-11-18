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
// By default the Saturday asked for is put on the list and already open, so the cut-off, closed-date and pickup tests
// below test only their own rule. Pass plain: true to use the real default list (last Saturday of the month, opens on the 15th).
async function order(date, now, { availability = {}, pickups = POINTS, body = {}, plain = false, events } = {}) {
  if (!plain && typeof date === "string") availability = { addedSaturdays: [date], opensOn: { [date]: "2000-01-01" }, ...availability };
  const lim = await fakeLimiter({ now: () => now });
  const env = { LIMITER: lim.ns, APPS_SCRIPT_TOKEN: "t".repeat(40), STUFFD_KV: kvWith({ availability: { ordersEnabled: true, closedDates: [], closedMessage: "", ...availability }, pickups, ...(events ? { events: { events: events.map((e, i) => ({ id: `e${i}`, venue: "Somewhere", ...e })) } } : {}) }), ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec" };
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

// 5. The default list: the LAST Saturday of each month, orders open on the 15th at 00:00 SAST (no per-test help: plain)
// events: [] keeps the bundled market list (content.ts) out of these date-rule tests; the market tests below pass their own.
const P = { plain: true, events: [] };
assert.equal(col.lastSaturdayOfMonth(2026, 11), "2026-11-28");
let r5 = await order("2026-11-28", sast("2026-11-14", "23:59:59"), P);
assert.equal(r5.status, 409); assert.match(r5.body.error, /open on Sun 15 Nov|open on Sunday 15 Nov/);
assert.equal((await order("2026-11-28", sast("2026-11-15", "00:00:00"), P)).status, 200, "the 15th at 00:00 SAST opens it");
assert.equal((await order("2026-11-28", Date.parse("2026-11-14T21:59:59Z"), P)).status, 409, "21:59:59 UTC on the 14th is still the 14th in SAST");
assert.equal((await order("2026-11-28", Date.parse("2026-11-14T22:00:00Z"), P)).status, 200, "22:00 UTC on the 14th is 00:00 on the 15th in SAST");
assert.equal((await order("2026-11-28", sast("2026-11-25", "23:59:59"), P)).status, 200, "Wednesday 23:59 still accepted");
r5 = await order("2026-11-28", sast("2026-11-26", "00:00:00"), P);
assert.equal(r5.status, 409); assert.match(r5.body.error, /closed/i, "Thursday 00:00 refused");
ok("last Saturday of November: refused before the 15th, accepted from 15th 00:00 SAST to Wednesday 23:59:59, refused from Thursday 00:00");

// Other Saturdays are not on the default list
for (const d of ["2026-11-21", "2026-12-05", "2026-12-12", "2026-11-07"]) assert.equal((await order(d, sast("2026-11-16"), P)).status, d < "2026-11-16" ? 400 : 409, d);
assert.match((await order("2026-12-05", sast("2026-11-16"), P)).body.error, /isn't a collection day/);
ok("a Saturday that is not the month's last Saturday is refused (past ones are plain bad requests)");

// December and the year end
assert.equal(col.lastSaturdayOfMonth(2026, 12), "2026-12-26");
assert.equal((await order("2026-12-26", sast("2026-12-14", "23:59:59"), P)).status, 409);
assert.equal((await order("2026-12-26", sast("2026-12-15", "00:00:00"), P)).status, 200);
assert.equal((await order("2026-12-26", sast("2026-12-23", "23:59:59"), P)).status, 200);
assert.equal((await order("2026-12-26", sast("2026-12-24", "00:00:00"), P)).status, 409);
assert.equal(col.lastSaturdayOfMonth(2027, 1), "2027-01-30");
assert.equal((await order("2027-01-30", sast("2026-12-28"), P)).status, 409, "January's Saturday is listed from December but opens on 15 Jan");
assert.equal((await order("2027-01-30", sast("2027-01-14", "23:59:59"), P)).status, 409);
assert.equal((await order("2027-01-30", sast("2027-01-15", "00:00:00"), P)).status, 200);
ok("December (opens 15 Dec, closes Wed 23 Dec) and the year end (Jan 2027 opens 15 Jan)");

// Months where the last Saturday is the 31st / 29th / 30th / 28th / 26th (leap years too)
for (const [y, m, d] of [[2026, 10, "2026-10-31"], [2026, 8, "2026-08-29"], [2026, 2, "2026-02-28"], [2026, 1, "2026-01-31"], [2024, 3, "2024-03-30"], [2028, 2, "2028-02-26"], [2024, 2, "2024-02-24"], [2025, 5, "2025-05-31"]]) assert.equal(col.lastSaturdayOfMonth(y, m), d, `${y}-${m}`);
assert.equal(col.cutoffDay("2026-10-31"), "2026-10-28");
assert.equal((await order("2026-10-31", sast("2026-10-28", "23:59:30"), P)).status, 200);
assert.equal((await order("2026-10-31", sast("2026-10-29", "00:00:00"), P)).status, 409);
assert.equal((await order("2026-08-29", sast("2026-08-26", "23:59:59"), P)).status, 200);
assert.equal((await order("2026-08-29", sast("2026-08-27", "00:00:00"), P)).status, 409);
ok("last Saturday of the month for 8 awkward months (31st, 30th, 29th, 28th, leap Feb) and cut-offs near the month end");

// Owner changes: opening day, added Saturdays, removed Saturdays, closed dates, cut-off
const open20 = { opensOn: { "2026-11-28": "2026-11-20" } };
assert.equal((await order("2026-11-28", sast("2026-11-19", "23:59:59"), { ...P, availability: open20 })).status, 409);
assert.equal((await order("2026-11-28", sast("2026-11-20", "00:00:00"), { ...P, availability: open20 })).status, 200);
assert.equal((await order("2026-11-28", sast("2026-11-03"), { ...P, availability: { opensOn: { "2026-11-28": "2026-11-01" } } })).status, 200, "owner can open earlier than the 15th");
assert.equal((await order("2026-11-28", sast("2026-11-17"), { ...P, availability: { opensOn: { "2026-11-28": "2026-11-30" } } })).status, 200, "an opening day after the Saturday is ignored (bad data): the 15th is used");
assert.equal((await order("2026-12-05", sast("2026-11-14", "23:59:59"), { ...P, availability: { addedSaturdays: ["2026-12-05"] } })).status, 409, "an added early-month Saturday opens on the 15th of the month before");
assert.equal((await order("2026-12-05", sast("2026-11-15", "00:00:00"), { ...P, availability: { addedSaturdays: ["2026-12-05"] } })).status, 200);
assert.equal((await order("2026-11-28", sast("2026-11-16"), { ...P, availability: { removedSaturdays: ["2026-11-28"] } })).status, 409, "a removed default Saturday is refused");
assert.equal((await order("2026-11-28", sast("2026-11-16"), { ...P, availability: { closedDates: ["2026-11-28"], closedMessage: "Closed that Saturday" } })).body.error, "Closed that Saturday", "closed dates still work");
assert.equal((await order("2026-11-28", sast("2026-11-25", "12:00:30"), { ...P, availability: { cutoffTime: "12:00" } })).status, 200);
assert.equal((await order("2026-11-28", sast("2026-11-25", "12:01:00"), { ...P, availability: { cutoffTime: "12:00" } })).status, 409);
assert.equal((await order("2026-11-21", sast("2026-11-16"), { ...P, availability: { addedSaturdays: ["2026-11-22"] } })).status, 409, "an added non-Saturday is dropped");
ok("owner overrides: opening day, added and removed Saturdays, closed dates, cut-off; bad data ignored");

// 6. Cut-off time is editable
assert.equal((await order("2026-11-21", sast("2026-11-18", "12:00:30"), { availability: { cutoffTime: "12:00" } })).status, 200);
assert.equal((await order("2026-11-21", sast("2026-11-18", "12:01:00"), { availability: { cutoffTime: "12:00" } })).status, 409);
assert.equal((await order("2026-11-21", sast("2026-11-18", "00:00:00"), { availability: { cutoffTime: "00:00" } })).status, 200);
assert.equal((await order("2026-11-21", sast("2026-11-18", "00:01:00"), { availability: { cutoffTime: "00:00" } })).status, 409);
ok("owner-set cut-off 12:00 and 00:00 respected to the minute");

// 7. Month and year ends (cut-off Wednesday sits in the previous month or year)
assert.equal(col.cutoffDay("2026-08-01"), "2026-07-29");
assert.equal((await order("2026-08-01", sast("2026-07-29", "23:59:30"), {})).status, 200);
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

// 10b. Markets: a default Saturday is skipped when a market covers it or its Sunday
const mkt = (start, end = start, name = "Test Market") => ({ name, start, end });
const NOW = sast("2026-11-16");
// market on the Saturday itself
r = await order("2026-11-28", NOW, { ...P, events: [mkt("2026-11-28")] });
assert.equal(r.status, 409); assert.match(r.body.error, /isn't a collection day/);
// market on the Sunday only
assert.equal((await order("2026-11-28", NOW, { ...P, events: [mkt("2026-11-29")] })).status, 409);
// multi-day market spanning the weekend
assert.equal((await order("2026-11-28", NOW, { ...P, events: [mkt("2026-11-26", "2026-11-30")] })).status, 409);
// a market on the Friday only, or the Monday after, does not skip it
assert.equal((await order("2026-11-28", NOW, { ...P, events: [mkt("2026-11-27")] })).status, 200);
assert.equal((await order("2026-11-28", NOW, { ...P, events: [mkt("2026-11-30")] })).status, 200);
// put back overrides the skip
assert.equal((await order("2026-11-28", NOW, { ...P, events: [mkt("2026-11-28")], availability: { keptSaturdays: ["2026-11-28"] } })).status, 200);
// the skip follows the bundled list too when the owner has saved none (MGM '26 runs 16-20 Dec: 26 Dec is clear, so no skip)
assert.equal((await order("2026-12-26", sast("2026-12-16"), { plain: true })).status, 200);
// and the bundled Luxe Cape Club (31 Oct to 1 Nov) skips Saturday 31 Oct on its own
assert.equal((await order("2026-10-31", sast("2026-10-20"), { plain: true })).status, 409);
// hand-added Saturday on a market weekend: kept (not removed) and warned about
const mgm = [mkt("2026-12-16", "2026-12-20", "MGM '26")];
assert.equal((await order("2026-12-19", sast("2026-12-01"), { ...P, events: mgm, availability: { addedSaturdays: ["2026-12-19"], opensOn: { "2026-12-19": "2026-12-01" } } })).status, 200, "hand-added Saturday on a market weekend is NOT removed");
const rMgm = { cutoffTime: "23:59", closedDates: [], events: mgm, addedSaturdays: ["2026-12-19"] };
assert.ok(col.collectionSaturdays(sast("2026-12-01"), rMgm).includes("2026-12-19"));
assert.equal(col.saturdayWarning("2026-12-19", rMgm), "MGM '26 is on that weekend");
assert.equal(col.saturdayWarning("2026-12-26", rMgm), "");
// the admin lists the skipped default and put back clears it
const rSkip = { cutoffTime: "23:59", closedDates: [], events: [mkt("2026-11-29", "2026-11-29", "Spring Market")] };
assert.deepEqual(col.skippedSaturdays(NOW, rSkip), [{ date: "2026-11-28", event: "Spring Market" }]);
assert.ok(!col.collectionSaturdays(NOW, rSkip).includes("2026-11-28"));
assert.deepEqual(col.skippedSaturdays(NOW, { ...rSkip, keptSaturdays: ["2026-11-28"] }), []);
assert.ok(col.collectionSaturdays(NOW, { ...rSkip, keptSaturdays: ["2026-11-28"] }).includes("2026-11-28"));
assert.equal(col.saturdayWarning("2026-11-28", { ...rSkip, keptSaturdays: ["2026-11-28"] }), "Spring Market is on that weekend", "a put-back Saturday is warned about");
assert.deepEqual(col.skippedSaturdays(NOW, { ...rSkip, removedSaturdays: ["2026-11-28"] }), [], "a removed Saturday is not also shown as skipped");
// a market added later: default Saturdays already open are kept (orders may exist), not yet open ones are skipped
const nm = [{ name: "New Market", start: "2026-11-28", end: "2026-11-28" }];
assert.deepEqual(col.saturdaysToKeep(sast("2026-11-16"), { cutoffTime: "23:59", closedDates: [] }, nm), ["2026-11-28"], "already open on the 15th: keep it");
assert.deepEqual(col.saturdaysToKeep(sast("2026-11-10"), { cutoffTime: "23:59", closedDates: [] }, nm), [], "not open yet: the skip applies");
ok("markets: Saturday and Sunday skip, Friday and Monday do not, put back overrides, hand-added and already-open Saturdays are kept with a warning");

// 10c. Client data: no collection on 26 Dec 2026 (removed in the owner's list), list resumes 30 Jan 2027
const noDec = { cutoffTime: "23:59", closedDates: [], removedSaturdays: ["2026-12-26"] };
assert.deepEqual(col.collectionSaturdays(sast("2026-11-16"), noDec).slice(0, 2), ["2026-11-28", "2027-01-30"]);
assert.equal(col.openingNote(sast("2026-11-26", "08:00:00"), noDec), "Orders for Saturday 30 Jan open on Friday 15 Jan. Back in the new year.");
assert.equal((await order("2026-12-26", sast("2026-12-16"), { ...P, availability: { removedSaturdays: ["2026-12-26"] } })).status, 409);
assert.equal((await order("2027-01-30", sast("2027-01-15"), { ...P, availability: { removedSaturdays: ["2026-12-26"] } })).status, 200);
ok("with 26 Dec removed the list is 28 Nov then 30 Jan, and the page says when January opens");

// 11. Pure helpers the page and admin use
const rules = { cutoffTime: "23:59", closedDates: [] };
assert.deepEqual(col.collectionSaturdays(sast("2026-11-16"), rules), ["2026-11-28", "2026-12-26", "2027-01-30", "2027-02-27", "2027-03-27", "2027-04-24"]);
assert.deepEqual(col.collectionSaturdays(sast("2026-11-29"), rules).slice(0, 2), ["2026-12-26", "2027-01-30"], "this month's Saturday drops off once it has passed");
assert.deepEqual(col.availableSaturdays(sast("2026-11-16"), rules), ["2026-11-28"]);
assert.deepEqual(col.availableSaturdays(sast("2026-11-14", "23:59:59"), rules), []);
assert.deepEqual(col.availableSaturdays(sast("2026-11-26", "00:00:00"), rules), [], "after the Wednesday cut-off nothing is open until 15 Dec");
assert.equal(col.openingNote(sast("2026-11-26", "08:00:00"), rules), "Orders for Saturday 26 Dec open on Tuesday 15 Dec.");
assert.equal(col.openingNote(sast("2026-11-10"), rules), "Orders for Saturday 28 Nov open on Sunday 15 Nov.");
assert.equal(col.openingNote(sast("2026-11-16"), rules), "Orders for Saturday 26 Dec open on Tuesday 15 Dec.", "while Nov 28 is open, the next one is announced");
assert.deepEqual(col.availableSaturdays(sast("2026-11-16"), { ...rules, closedDates: ["2026-11-28"] }), []);
assert.deepEqual(col.availableSaturdays(sast("2026-11-16"), { ...rules, addedSaturdays: ["2026-11-21"], opensOn: { "2026-11-21": "2026-11-10" } }), ["2026-11-21", "2026-11-28"]);
assert.equal(col.opensOnFor("2026-12-26", {}), "2026-12-15");
assert.equal(col.opensOnFor("2026-12-05", {}), "2026-11-15");
assert.equal(col.opensOnFor("2027-01-02", {}), "2026-12-15");
ok("page helpers: the default list, who is open when, and the 'opens on' line");
console.log(`saturday-rules: all ${n} groups passed`);
