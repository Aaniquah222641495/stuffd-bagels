// Yoco webhook signature checks, against the REAL worker/yoco.ts bundled for Node. Run: node worker/tests/yoco-verify.mjs
// The test vectors are made with Node's crypto the way Yoco's docs describe it: key = base64-decode(secret after "whsec_"),
// HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`, base64, header "v1,<sig>" (space-separated list).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { bundle } from "./_bundle.mjs";
const { verifyWebhook } = await bundle("worker/yoco.ts");

const keyBytes = crypto.randomBytes(24);
const SECRET = "whsec_" + keyBytes.toString("base64");
const NOW = Date.parse("2026-11-20T10:00:00Z");
const tsAt = (offsetSec) => String(Math.floor(NOW / 1000) + offsetSec);
const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", payload: { id: "p_1", amount: 6500, currency: "ZAR", mode: "test", status: "succeeded", type: "payment", metadata: { checkoutId: "ch_1" } } });
const sign = (id, ts, b, k = keyBytes) => crypto.createHmac("sha256", k).update(`${id}.${ts}.${b}`).digest("base64");
const headers = (o) => new Headers(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
const good = (ts = tsAt(0), id = "msg_1") => ({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": "v1," + sign(id, ts, body) });
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const check = async (h, b = body, secret = SECRET, now = NOW) => verifyWebhook(headers(h), b, secret, now);

// 1. A correct signature passes
assert.deepEqual(await check(good()), { ok: true });
ok("correct signature, id, timestamp and raw body: accepted");

// 2. One byte of the body changed (the amount): refused. Whitespace re-serialisation also breaks it (raw body matters).
assert.deepEqual(await check(good(), body.replace('"amount":6500', '"amount":5500')), { ok: false, reason: "signature" });
assert.deepEqual(await check(good(), JSON.stringify(JSON.parse(body), null, 1)), { ok: false, reason: "signature" });
assert.deepEqual(await check(good(), body + " "), { ok: false, reason: "signature" });
ok("one changed byte, re-serialised JSON or a trailing space in the body: 'signature'");

// 3. Wrong secret / a changed id or timestamp
assert.deepEqual(await check(good(), body, "whsec_" + crypto.randomBytes(24).toString("base64")), { ok: false, reason: "signature" });
assert.deepEqual(await check({ ...good(), "webhook-id": "msg_2" }), { ok: false, reason: "signature" });
assert.deepEqual(await check({ ...good(), "webhook-timestamp": tsAt(1) }), { ok: false, reason: "signature" });
ok("wrong secret, changed webhook-id or changed timestamp: 'signature'");

// 4. A captured body replayed with a fresh timestamp but the OLD signature
const old = good(tsAt(-100), "msg_9");
assert.deepEqual(await check(old), { ok: true }, "the original, still inside the window");
assert.deepEqual(await check({ ...old, "webhook-timestamp": tsAt(0) }), { ok: false, reason: "signature" });
ok("captured signature re-sent with a fresh timestamp: 'signature'");

// 5. Timestamp window: 180 s either side is fine, 181 s is not
assert.deepEqual(await check(good(tsAt(-180))), { ok: true });
assert.deepEqual(await check(good(tsAt(180))), { ok: true });
assert.deepEqual(await check(good(tsAt(-181))), { ok: false, reason: "timestamp" });
assert.deepEqual(await check(good(tsAt(181))), { ok: false, reason: "timestamp" });
for (const t of ["abc", "-5", "1.5", "", "99999999999999"]) assert.equal((await check(good(t))).ok, false, t);
ok("timestamp 180 s old / ahead accepted; 181 s old / ahead and non-numeric ones refused ('timestamp')");

// 6. Two signatures in the header: only the second matches (Yoco may send several, space-separated)
const ts = tsAt(0);
const wrong = crypto.randomBytes(32).toString("base64");
assert.deepEqual(await check({ "webhook-id": "m", "webhook-timestamp": ts, "webhook-signature": `v1,${wrong} v1,${sign("m", ts, body)}` }), { ok: true });
assert.deepEqual(await check({ "webhook-id": "m", "webhook-timestamp": ts, "webhook-signature": `v1,${sign("m", ts, body)} v1,${wrong}` }), { ok: true });
assert.deepEqual(await check({ "webhook-id": "m", "webhook-timestamp": ts, "webhook-signature": `v1,${wrong} v1,${wrong}` }), { ok: false, reason: "signature" });
ok("a header with two signatures matches when either one is right");

// 7. Junk entries are skipped, never crash, never match
const real = sign("m", ts, body);
for (const sig of [`v2,${real}`, `${real}`, `v1,`, `v1,!!!notbase64!!!`, `v1,${real.slice(0, 20)}`, `v1,${real}AAAA`, "v1", "  ", `v1,${Buffer.alloc(8).toString("base64")}`]) {
  const r = await check({ "webhook-id": "m", "webhook-timestamp": ts, "webhook-signature": sig });
  assert.equal(r.ok, false, sig);
}
assert.deepEqual(await check({ "webhook-id": "m", "webhook-timestamp": ts, "webhook-signature": `v1,!!!bad v1,${real}` }), { ok: true }, "junk entry then the right one");
ok("wrong version, no version, empty, bad base64, short and long signatures: refused without crashing");

// 8. Missing headers
for (const drop of ["webhook-id", "webhook-timestamp", "webhook-signature"]) assert.deepEqual(await check({ ...good(), [drop]: undefined }), { ok: false, reason: "headers" }, drop);
assert.deepEqual(await check({}), { ok: false, reason: "headers" });
ok("any of the three headers missing: 'headers'");

// 9. The secret itself: no whsec_ prefix or bad base64 -> 'secret' (the Worker answers 503; it is a set-up mistake, not an attack)
assert.deepEqual(await check(good(), body, keyBytes.toString("base64")), { ok: false, reason: "secret" });
assert.deepEqual(await check(good(), body, "whsec_!!!!"), { ok: false, reason: "secret" });
assert.deepEqual(await check(good(), body, "whsec_"), { ok: false, reason: "secret" });
ok("secret without the whsec_ prefix, or not base64: 'secret' (nothing is accepted)");

// 10. Unicode and large bodies are signed over the exact bytes received
const uni = JSON.stringify({ n: "Zaid é中 😀", pad: "x".repeat(50000) });
const t2 = tsAt(0);
assert.deepEqual(await verifyWebhook(headers({ "webhook-id": "u", "webhook-timestamp": t2, "webhook-signature": "v1," + sign("u", t2, uni) }), uni, SECRET, NOW), { ok: true });
ok("non-ASCII and a 50 KB body verify");
console.log(`yoco-verify: all ${n} groups passed`);
