// The signed "Cancel my order" token and the Yoco refund client, with the real code. Run: node worker/tests/cancel-token.mjs
import assert from "node:assert/strict";
import { TEST_CANCEL_SECRET, bundle } from "./_bundle.mjs";
const T = await bundle("worker/cancel-token.ts");
const Y = await bundle("worker/yoco.ts");
const col = await bundle("artifacts/stuffd-bagels/src/collection.ts");
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
let n = 0;
const ok = (name) => out("PASS", ++n, name);

const env = { CANCEL_LINK_SECRET: TEST_CANCEL_SECRET, SITE_ORIGIN: "https://stuffdbagels.co.za" };
const sast = (iso, time) => Date.parse(`${iso}T${time}+02:00`);
const BY = col.cutoffInstant("2026-11-28", "23:59"); // Saturday 28 Nov -> Thursday 26 Nov 00:00 SAST
assert.equal(BY, sast("2026-11-26", "00:00:00"), "the instant after Wed 25 Nov 23:59 SAST");

// 1. Round trip: the token names the order and the cut-off, and nothing else
const tok = await T.makeCancelToken(env, "SB-N9SE2N", BY);
assert.match(tok, /^SB-N9SE2N\.\d{10}\.[A-Za-z0-9_-]{43}$/);
assert.deepEqual(await T.verifyCancelToken(env, tok), { ok: true, ref: "SB-N9SE2N", cancelByMs: BY });
assert.equal(await T.makeCancelToken(env, "SB-N9SE2N", BY), tok, "deterministic: the same order and cut-off give the same link, so a resend never makes a different one");
ok("a token verifies and gives back the reference and the cut-off");

// 2. Any change fails: reference, cut-off, signature, shape
const [ref, sec, sig] = tok.split(".");
const flip = (s) => s.slice(0, -1) + (s.at(-1) === "A" ? "B" : "A");
const bad = [
  `SB-N9SE2P.${sec}.${sig}`, `${ref}.${Number(sec) + 1}.${sig}`, `${ref}.${Number(sec) - 1}.${sig}`, `${ref}.${sec}.${flip(sig)}`, `${ref}.${sec}.${sig.slice(1)}`, `${ref}.${sec}.${sig}A`,
  `${ref}.${sec}.`, `${ref}.${sec}`, `${ref}`, "", `${ref}.${sec}.${sig}.x`, ` ${tok}`, `${tok} `, tok.toLowerCase(), `sb-n9se2n.${sec}.${sig}`,
  `SB-N9SE2N.99999999999999.${sig}`, `SB-N9SE2N.-5.${sig}`, `SB-N9SE2N.1e10.${sig}`, "SB-N9SE2N.1764115200.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
];
// the last base64 character has two spare bits: changing only those decodes to the same bytes, but is not the signature we issued
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const li = ALPHA.indexOf(sig.at(-1));
bad.push(`${ref}.${sec}.${sig.slice(0, -1)}${ALPHA[(li & ~3) | ((li & 3) ^ 1)]}`);
for (const b of bad) assert.deepEqual(await T.verifyCancelToken(env, b), { ok: false }, JSON.stringify(b));
for (const b of [undefined, null, 5, {}, [], true, "x".repeat(5000)]) assert.deepEqual(await T.verifyCancelToken(env, b), { ok: false });
ok("changed reference, cut-off or signature, wrong length or shape, case changes, spaces, non-strings: all refused");

// 3. A token made with another secret is refused, and the secret decides everything
const other = { ...env, CANCEL_LINK_SECRET: "another-secret-0123456789-abcdefghijklmnop" };
assert.deepEqual(await T.verifyCancelToken(other, tok), { ok: false });
assert.deepEqual(await T.verifyCancelToken(env, await T.makeCancelToken(other, "SB-N9SE2N", BY)), { ok: false });
ok("a token signed with a different secret never verifies");

// 4. Fails closed without a good secret: no token is made and none verifies
for (const s of [undefined, "", "short", "x".repeat(31)]) {
  const e = { ...env, CANCEL_LINK_SECRET: s };
  assert.equal(T.cancelReady(e), false);
  assert.equal(await T.makeCancelToken(e, "SB-N9SE2N", BY), null);
  assert.deepEqual(await T.verifyCancelToken(e, tok), { ok: false });
  assert.equal(await T.cancelLink(e, "SB-N9SE2N", BY), null);
}
assert.equal(T.cancelReady({ CANCEL_LINK_SECRET: "x".repeat(32) }), true);
ok("secret missing or under 32 characters: no link is made, no token verifies");

// 5. The link: https origin, the token after # (never in the path or query), no link for junk inputs
const link = await T.cancelLink(env, "SB-N9SE2N", BY);
assert.equal(link, `https://stuffdbagels.co.za/order/cancel#${tok}`);
assert.ok(!new URL(link).search && new URL(link).pathname === "/order/cancel");
assert.equal(await T.cancelLink({ ...env, SITE_ORIGIN: "" }, "SB-N9SE2N", BY), null);
assert.equal(await T.cancelLink({ ...env, SITE_ORIGIN: "ftp://x" }, "SB-N9SE2N", BY), null);
assert.equal(await T.cancelLink(env, "SB-N9SE2N", null), null);
assert.equal(await T.makeCancelToken(env, "BK-N9SE2N", BY), null);
assert.equal(await T.makeCancelToken(env, "SB-N9SE2N", 0), null);
assert.equal(await T.makeCancelToken(env, "SB-N9SE2N", NaN), null);
ok("link = SITE_ORIGIN + /order/cancel#token; no link without an origin, a cut-off or a real reference");

// 6. The label the email prints: the LAST minute that works (one before the cut-off instant), SAST
assert.equal(T.cancelByLabel(BY), "Wednesday 25 Nov at 23:59");
assert.equal(T.cancelByLabel(col.cutoffInstant("2026-08-01", "23:59")), "Wednesday 29 Jul at 23:59", "month end");
assert.equal(T.cancelByLabel(col.cutoffInstant("2027-01-02", "23:59")), "Wednesday 30 Dec at 23:59", "year end");
assert.equal(T.cancelByLabel(col.cutoffInstant("2026-11-28", "18:00")), "Wednesday 25 Nov at 18:00", "an owner-set cut-off time");
ok("the cut-off label reads 'Wednesday 25 Nov at 23:59' (month end, year end, owner-set time)");

// 7. Yoco refund client: request shape and every way an answer can be wrong
const YENV = { YOCO_SECRET_KEY: "sk_live_localfake1234567890", YOCO_WEBHOOK_SECRET: "whsec_" + Buffer.alloc(24, 1).toString("base64"), YOCO_MODE: "live", SITE_ORIGIN: "https://stuffdbagels.co.za" };
const realFetch = globalThis.fetch;
let seen;
const reply = (status, body, raw) => { globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response(raw ?? JSON.stringify(body), { status }); }; };
reply(200, { refundId: "rfd_aPgrM9VVPAjXuNRCVRmuMWEb", status: "succeeded" });
assert.deepEqual(await Y.refundCheckout(YENV, { checkoutId: "ch_Kg7bAbc123", ref: "SB-N9SE2N" }), { refundId: "rfd_aPgrM9VVPAjXuNRCVRmuMWEb", status: "succeeded" });
assert.equal(seen.url, "https://payments.yoco.com/api/checkouts/ch_Kg7bAbc123/refund");
assert.equal(seen.init.method, "POST"); assert.equal(seen.init.body, "{}", "full refund: no amount is ever sent");
assert.equal(seen.init.headers.Authorization, "Bearer sk_live_localfake1234567890");
assert.equal(seen.init.headers["Idempotency-Key"], "refund-SB-N9SE2N");
assert.equal(seen.init.redirect, "manual");
reply(202, { refundId: "rfd_pending1", status: "pending" });
assert.deepEqual(await Y.refundCheckout(YENV, { checkoutId: "ch_Kg7bAbc123", ref: "SB-N9SE2N" }), { refundId: "rfd_pending1", status: "pending" }, "any 2xx, pending counts");
const reason = async (a = { checkoutId: "ch_Kg7bAbc123", ref: "SB-N9SE2N" }, e = YENV) => { try { await Y.refundCheckout(e, a); return "no error"; } catch (err) { return err.reason + (err.status ? " " + err.status : ""); } };
reply(500, {}); assert.equal(await reason(), "status 500");
reply(422, { error: "already refunded" }); assert.equal(await reason(), "status 422");
reply(302, {}); assert.equal(await reason(), "status 302", "a redirect is never followed or believed");
reply(200, { hello: "world" }); assert.equal(await reason(), "response");
reply(200, { refundId: "rfd_x1y2z3", status: "failed" }); assert.equal(await reason(), "response", "a status that is not succeeded or pending is not a refund");
reply(200, { refundId: "rfd_x1y2z3", status: "SUCCEEDED" }); assert.equal(await reason(), "response");
reply(200, { refundId: "bad id!", status: "succeeded" }); assert.equal(await reason(), "response");
reply(200, { refundId: 5, status: "succeeded" }); assert.equal(await reason(), "response");
reply(200, null, "not json"); assert.equal(await reason(), "response");
globalThis.fetch = async () => { throw new Error("network down"); }; assert.equal(await reason(), "network");
globalThis.fetch = async () => { throw new Error("must not be called"); };
assert.equal(await reason({ checkoutId: "../../evil", ref: "SB-N9SE2N" }), "refund", "a checkout id that isn't one of ours never reaches the URL");
assert.equal(await reason({ checkoutId: "ch_Kg7bAbc123", ref: "x" }), "refund");
assert.equal(await reason(undefined, { ...YENV, YOCO_SECRET_KEY: "sk_test_localfake1234567890" }), "mode", "a test key on a live Worker never calls Yoco");
assert.equal(await reason(undefined, { ...YENV, YOCO_SECRET_KEY: undefined }), "mode");
globalThis.fetch = realFetch;
ok("refund client: POST /api/checkouts/{id}/refund, Bearer key, Idempotency-Key refund-<ref>, body {}; non-2xx, redirects, bad or missing refundId, other statuses, junk, network errors all throw");

// 8. One place decides the deadline, and it is the rule that closes ordering (SB-20 market days will change only this function)
assert.equal(T.cancelDeadline("2026-11-28", "23:59"), col.cutoffInstant("2026-11-28", "23:59"));
assert.equal(T.cancelDeadline("2026-11-28", "18:00"), col.cutoffInstant("2026-11-28", "18:00"));
ok("cancelDeadline is the single source of the cut-off instant");

out("cancel-token: all", n, "groups passed");
