// Turnstile over HTTP against `wrangler dev` (APP_ENV development: Cloudflare's documented always-pass test keys, with the check answered by
// fake-yoco.mjs through --var TURNSTILE_API_BASE:http://127.0.0.1:8798). Setup as in forms-api.mjs, plus that var.
//   node worker/tests/turnstile-api.mjs /tmp/fake.log
import assert from "node:assert/strict";
import { B, TS_TOKEN, attemptId, clearRateLimits, ip, logged, post, resetPickups, resetYoco, saturdays, setAvail, uniqueEmail, yocoCalls } from "./_helpers.mjs";

clearRateLimits(); await setAvail({}); await resetYoco();
const [P1] = await resetPickups([{ name: "Kenilworth Corner", area: "Main Rd, Kenilworth", days: "Saturdays, 10am to 1pm" }]);
const [, SAT] = saturdays();
const order = (o = {}) => ({ name: "Aisha Khan", phone: "082 123 4567", email: uniqueEmail("ts"), pickupId: P1, pickupDate: SAT, items: { "Pizza Bagel": 1 }, toppings: {}, note: "", website: "", attemptId: attemptId(), ...o });
const booking = (o = {}) => ({ name: "Sam", phone: "+27 82 999 9999", email: uniqueEmail("tsb"), eventDate: "2027-06-12", venue: "Kenilworth", guests: 40, details: "", website: "", ...o });
const before = logged().length;
let n = 0; const ok = (m) => console.log("PASS", ++n, m);

let r = await fetch(B + "/api/config"); let j = await r.json();
assert.equal(r.status, 200); assert.deepEqual(j, { turnstileSiteKey: "1x00000000000000000000AA" }); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
assert.equal((await fetch(B + "/api/config", { method: "POST" })).status, 405);
ok("/api/config serves the public site key (the documented test key in development); POST refused");

for (const [kind, make] of [["order", order], ["booking", booking]]) {
  r = await post("/api/" + kind, make({ turnstileToken: undefined })); assert.equal(r.status, 400, kind + " no token"); assert.match((await r.json()).error, /security check/i);
  r = await post("/api/" + kind, make({ turnstileToken: "forged-token" })); assert.equal(r.status, 403, kind + " forged token"); assert.match((await r.json()).error, /security check/i);
}
assert.equal((await yocoCalls()).calls.length, 0, "no Yoco checkout was made for a refused order");
assert.equal(logged().length, before, "no email request for a refused booking");
ok("order and booking: no token 400, forged token 403, no Yoco checkout and no email");

r = await post("/api/order", order()); j = await r.json(); assert.equal(r.status, 200); assert.match(j.redirectUrl, /\/pay\/ch_/);
r = await post("/api/booking", booking()); assert.equal(r.status, 200);
const sv = (await yocoCalls()).siteverify;
assert.equal(sv.length, 4, "only the two forged tokens and the two good ones reach the check (a missing token never does)");
assert.ok(sv.every((c) => c.remoteip === ip), "the visitor's address is passed as remoteip");
assert.equal(sv.filter((c) => c.response === TS_TOKEN).length, 2);
ok("good token: order opens a checkout and booking is forwarded; siteverify got the visitor's address");
console.log(`turnstile-api: all ${n} groups passed`);
