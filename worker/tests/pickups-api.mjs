// Admin pickup points: auth, validation, limits, add / edit / switch off / remove, and what the public list shows.
// Setup as in forms-api.mjs. Run: node worker/tests/pickups-api.mjs /tmp/fake.log
import assert from "node:assert/strict";
import { B, admin, post, resetPickups, clearRateLimits, ip } from "./_helpers.mjs";
clearRateLimits();
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const json = (r) => r.json();

await resetPickups([]);
// Empty by default: nothing invented.
assert.deepEqual(await json(await admin("/pickups")), []);
assert.deepEqual(await json(await fetch(B + "/api/pickups")), []);
ok("starts empty (admin and public lists)");

// Auth: same as events. No password / wrong password: 401, and nothing created.
for (const [method, url, body] of [["GET", "/api/admin/pickups"], ["POST", "/api/admin/pickups", { name: "x", area: "y" }], ["PUT", "/api/admin/pickups/abc", { name: "x", area: "y" }], ["DELETE", "/api/admin/pickups/abc"]]) {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(r.status, 401, `${method} ${url} without password`);
}
assert.equal((await fetch(B + "/api/admin/pickups", { headers: { "x-admin-password": "wrong", "CF-Connecting-IP": ip } })).status, 401);
clearRateLimits(); // the failed tries above count towards the 5-strikes lock-out
assert.deepEqual(await json(await admin("/pickups")), []);
ok("no password or wrong password: 401 on every pickup route");

// Add
let r = await admin("/pickups", "POST", { name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm", active: true });
assert.equal(r.status, 200); const a = (await json(r)).id; assert.match(a, /^[0-9a-f-]{36}$/);
r = await admin("/pickups", "POST", { name: "Second Point", area: "Claremont" }); // days optional, active defaults to on
const b = (await json(r)).id;
let list = await json(await admin("/pickups"));
assert.equal(list.length, 2); assert.equal(list[1].active, true); assert.equal(list[1].days, "");
ok("add: days optional, active defaults to on");

// Validation and limits (same style as events)
const bad = async (body, why) => assert.equal((await admin("/pickups", "POST", body)).status, 400, why);
await bad({ area: "x" }, "no name"); await bad({ name: "x" }, "no area"); await bad({ name: "  ", area: "x" }, "blank name");
await bad({ name: "x".repeat(61), area: "y" }, "name 61"); await bad({ name: "x", area: "y".repeat(121) }, "area 121");
await bad({ name: "x", area: "y", days: "z".repeat(121) }, "days 121"); await bad({ name: 5, area: "y" }, "name number");
await bad({ name: "x", area: "y", active: "yes" }, "active not boolean"); await bad([], "array body");
assert.equal((await admin("/pickups", "POST", { name: "x".repeat(60), area: "y".repeat(120), days: "z".repeat(120) })).status, 200, "exact limits are fine");
assert.equal((await fetch(B + "/api/admin/pickups", { method: "POST", headers: { "Content-Type": "text/plain", "CF-Connecting-IP": ip, "x-admin-password": (await import("./_helpers.mjs")).pw }, body: "{}" })).status, 400);
assert.equal((await admin("/pickups", "POST", { name: "x", area: "y", pad: "p".repeat(20000) })).status, 400, "over 10 KB body");
list = await json(await admin("/pickups")); await admin(`/pickups/${list.at(-1).id}`, "DELETE");
ok("validation: required, length limits (60/120/120), types, content-type, 10 KB body");

// Control characters are stripped, not stored
r = await admin("/pickups", "POST", { name: "Tab\tName\u0000", area: "Line\nBreak" });
const c = (await json(r)).id; const saved = (await json(await admin("/pickups"))).find((p) => p.id === c);
assert.equal(saved.name, "Tab Name"); assert.equal(saved.area, "Line Break");
await admin(`/pickups/${c}`, "DELETE");
ok("control characters are replaced by spaces");

// Edit and switch off
r = await admin(`/pickups/${a}`, "PUT", { name: "Kenilworth Corner 2", area: "Main Rd", days: "", active: false });
assert.equal(r.status, 200);
list = await json(await admin("/pickups")); assert.equal(list.find((p) => p.id === a).name, "Kenilworth Corner 2"); assert.equal(list.find((p) => p.id === a).active, false);
assert.equal((await admin(`/pickups/${a}`, "PUT", { name: "", area: "x" })).status, 400);
assert.equal((await admin("/pickups/not-there", "PUT", { name: "x", area: "y" })).status, 404);
assert.equal((await admin("/pickups/..%2Fevil", "PUT", { name: "x", area: "y" })).status, 400);
assert.equal((await admin("/pickups/not-there", "DELETE")).status, 404);
ok("edit and switch off; bad body 400; unknown id 404; unsafe id 400");

// Public list: active points only, and only the fields customers need
const pub = await json(await fetch(B + "/api/pickups"));
assert.deepEqual(pub.map((p) => p.id), [b]); assert.deepEqual(Object.keys(pub[0]).sort(), ["area", "days", "id", "name"]);
assert.equal((await fetch(B + "/api/pickups", { method: "POST" })).status, 405);
ok("public list shows active points only, with no internal fields");

// Remove
assert.equal((await admin(`/pickups/${a}`, "DELETE")).status, 200); assert.equal((await admin(`/pickups/${b}`, "DELETE")).status, 200);
assert.deepEqual(await json(await admin("/pickups")), []);
ok("remove");

// Max 30 points
for (let i = 0; i < 30; i++) assert.equal((await admin("/pickups", "POST", { name: `P${i}`, area: "A" })).status, 200);
assert.equal((await admin("/pickups", "POST", { name: "one too many", area: "A" })).status, 400);
await resetPickups([]);
ok("at most 30 pickup points");

// Availability: cut-off and weeks ahead are stored, validated, and shown publicly
let s = await admin("/availability", "POST", { ordersEnabled: true, closedDates: [], closedMessage: "", cutoffTime: "20:30", maxWeeksAhead: 6 });
assert.equal(s.status, 200);
let pubA = await json(await fetch(B + "/api/availability")); assert.equal(pubA.cutoffTime, "20:30"); assert.equal(pubA.maxWeeksAhead, 6);
for (const body of [{ cutoffTime: "24:00" }, { cutoffTime: "9:00" }, { cutoffTime: 2359 }, { maxWeeksAhead: 0 }, { maxWeeksAhead: 13 }, { maxWeeksAhead: 2.5 }, { maxWeeksAhead: "4" }]) {
  assert.equal((await admin("/availability", "POST", { ordersEnabled: true, closedDates: [], closedMessage: "", ...body })).status, 400, JSON.stringify(body));
}
assert.equal((await admin("/availability", "POST", { ordersEnabled: true, closedDates: [], closedMessage: "" })).status, 200, "older callers without the new fields still work");
pubA = await json(await fetch(B + "/api/availability")); assert.equal(pubA.cutoffTime, "23:59"); assert.equal(pubA.maxWeeksAhead, 4);
ok("cut-off time and weeks ahead: saved, validated (HH:MM, 1 to 12), defaults 23:59 and 4");
console.log(`pickups-api: all ${n} groups passed`);
