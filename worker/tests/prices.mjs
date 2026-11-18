// Server-side prices: totals come from content.ts, never from the browser. Setup as in forms-api.mjs.
// Run: rm -f /tmp/fake.log && node worker/tests/prices.mjs /tmp/fake.log
import assert from "node:assert/strict";
import fs from "node:fs";
import { clearRateLimits, log, post, resetPickups, saturdays, setAvail, uniqueEmail } from "./_helpers.mjs";
clearRateLimits(); await setAvail({});
const [P] = await resetPickups([{ name: "Test Point", area: "Test Area" }]);
const SAT = saturdays()[1];
const send = (b) => post("/api/order", b);
const last = () => JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n").at(-1));
const o = (x = {}) => ({ name: "Aisha", phone: "0821234567", email: uniqueEmail("price"), pickupId: P, pickupDate: SAT, items: { "Steak'd Bagel": 1, "Classic Bagel": 2 }, website: "", ...x });
let r = await send(o({ total: 1, price: 1, prices: { "Steak'd Bagel": 1 } })); let j = await r.json();
assert.equal(r.status, 200); assert.equal(j.total, 245, "server total 115 + 2 x 65 regardless of what the browser sends");
const f = last().body;
assert.equal(f.total, 245);
const byName = Object.fromEntries(f.items.map((i) => [i.name, i.unit])); assert.deepEqual(byName, { "Steak'd Bagel": 115, "Classic Bagel": 65 });
console.log("PASS server prices: Steak'd R115 + 2 x Classic R65 = R245; browser-sent total/price fields ignored");
for (const [n, items] of [["old name Plain", { "Plain Bagel": 1 }], ["old price table name", { "Extra Cheese": 1 }]]) { r = await send(o({ items })); assert.equal(r.status, 400, n); }
r = await send(o({ toppings: { "Extra Cheese": 1 } })); assert.equal(r.status, 400, "Extra Cheese has no confirmed price: refused");
r = await send(o({ toppings: { "Extra Jalapeno": 2 } })); j = await r.json(); assert.equal(r.status, 200); assert.equal(j.total, 115 + 2 * 65 + 2 * 5, "Extra Jalapeno R5 each, priced on the server");
assert.equal(last().body.total, 255);
r = await send(o({ toppings: { "Extra Jalapeno": 1, "Extra Cheese": 1 } })); assert.equal(r.status, 400, "a priced topping does not let an unpriced one through");
console.log("PASS Extra Jalapeno R5 accepted and priced; Extra Cheese (null price) refused; old 'Plain Bagel' refused");
r = await send(o({ items: { "Pizza Bagel": 1, "Jalapeno Bagel": 1, "Cheesy Bagel": 1 } })); j = await r.json(); assert.equal(j.total, 95 + 75 + 85);
console.log("PASS Pizza R95 + Jalapeno R75 + Cheesy R85 = R255");

await resetPickups([]);
clearRateLimits();
