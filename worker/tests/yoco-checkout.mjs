// createCheckout and modeOk (worker/yoco.ts) against a stubbed fetch. Run: node worker/tests/yoco-checkout.mjs
import assert from "node:assert/strict";
import { bundle } from "./_bundle.mjs";
const { createCheckout, modeOk, YocoError } = await bundle("worker/yoco.ts");
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const ENV = { YOCO_SECRET_KEY: "sk_test_localfake1234567890", YOCO_WEBHOOK_SECRET: "whsec_" + Buffer.alloc(24, 1).toString("base64"), YOCO_MODE: "test", SITE_ORIGIN: "https://preview.example.workers.dev" };
const input = { ref: "SB-ABCDEF", attemptId: "6f1c8f0e-8f2a-4b1e-9d52-0f7c1c2d3e4f", amountCents: 6500, lines: [{ name: "Classic Bagel", qty: 1, unitCents: 6500 }], now: Date.parse("2026-11-20T10:00:00Z") };
const reply = (j, status = 201) => async () => new Response(JSON.stringify(j), { status });
const good = { id: "ch_abc123", status: "created", redirectUrl: "https://c.yoco.com/checkout/ch_abc123", processingMode: "test" };
const reason = async (env, fetchImpl) => { globalThis.fetch = fetchImpl; try { await createCheckout(env, input); return "no error"; } catch (e) { assert.ok(e instanceof YocoError, String(e)); return `${e.reason}${e.status ? " " + e.status : ""}`; } };

// 1. modeOk
assert.equal(modeOk(ENV), null);
assert.equal(modeOk({ ...ENV, YOCO_MODE: undefined }), "mode"); assert.equal(modeOk({ ...ENV, YOCO_MODE: "prod" }), "mode");
assert.equal(modeOk({ ...ENV, YOCO_SECRET_KEY: undefined }), "secret"); assert.equal(modeOk({ ...ENV, YOCO_SECRET_KEY: "sk_test_" }), "secret");
assert.equal(modeOk({ ...ENV, YOCO_WEBHOOK_SECRET: undefined }), "webhook-secret"); assert.equal(modeOk({ ...ENV, YOCO_WEBHOOK_SECRET: "abc" }), "webhook-secret");
assert.equal(modeOk({ ...ENV, YOCO_SECRET_KEY: "sk_live_localfake1234567890" }), "prefix", "live key on the test Worker");
assert.equal(modeOk({ ...ENV, YOCO_MODE: "live" }), "prefix", "test key on the live Worker");
assert.equal(modeOk({ ...ENV, YOCO_MODE: "live", YOCO_SECRET_KEY: "sk_live_localfake1234567890" }), null);
assert.equal(modeOk({ ...ENV, SITE_ORIGIN: undefined }), "origin"); assert.equal(modeOk({ ...ENV, SITE_ORIGIN: "javascript:alert(1)" }), "origin"); assert.equal(modeOk({ ...ENV, SITE_ORIGIN: "not a url" }), "origin");
ok("modeOk: needs mode, key, whsec_ secret, origin; key prefix must match the mode (sk_test_ / sk_live_)");

// 2. Request shape
let seen;
globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(good), { status: 200 }); };
assert.deepEqual(await createCheckout(ENV, input), { id: "ch_abc123", redirectUrl: good.redirectUrl });
assert.equal(seen.url, "https://payments.yoco.com/api/checkouts"); assert.equal(seen.init.method, "POST");
assert.equal(seen.init.headers.Authorization, "Bearer " + ENV.YOCO_SECRET_KEY); assert.equal(seen.init.headers["Idempotency-Key"], input.attemptId);
assert.equal(seen.init.redirect, "manual"); assert.ok(seen.init.signal, "has a timeout");
const sent = JSON.parse(seen.init.body);
assert.equal(sent.amount, 6500); assert.equal(sent.currency, "ZAR"); assert.equal(sent.expiresAt, "2026-11-20T10:31:00.000Z");
assert.deepEqual(sent.lineItems, [{ displayName: "Classic Bagel", quantity: 1, pricingDetails: { price: 6500 } }]);
assert.equal(sent.successUrl, "https://preview.example.workers.dev/order/result?r=success&ref=SB-ABCDEF");
ok("POST https://payments.yoco.com/api/checkouts with Bearer key, Idempotency-Key, cents, ZAR, +31 min Z-form expiresAt, redirect:manual and a timeout");

// 3. Responses
assert.equal(await reason(ENV, reply(good, 200)), "no error"); assert.equal(await reason(ENV, reply(good, 202)), "no error", "any 2xx");
for (const s of [400, 401, 409, 422, 500]) assert.equal(await reason(ENV, async () => new Response("{}", { status: s })), `status ${s}`);
assert.equal(await reason(ENV, async () => new Response("<html>", { status: 200 })), "response");
assert.equal(await reason(ENV, async () => { throw new Error("offline"); }), "network");
assert.equal(await reason(ENV, async () => new Response("", { status: 302, headers: { location: "https://evil.example" } })), "status 302", "a redirect from the API is not followed");
for (const id of [undefined, 5, "", "ab", "x".repeat(101), "ch_a b", "ch_<script>"]) assert.equal(await reason(ENV, reply({ ...good, id })), "response", String(id));
ok("2xx accepted; 4xx / 5xx / HTML / network error / 3xx / odd ids fail with a reason");

// 4. redirectUrl must be https on yoco.com or a subdomain
for (const redirectUrl of ["https://evil.example/pay", "https://payments.yoco.com.evil.example/x", "https://evilyoco.com/x", "http://c.yoco.com/x", "https://user:pw@c.yoco.com/x", "javascript:alert(1)", "//c.yoco.com/x", "", undefined, 5]) {
  assert.equal(await reason(ENV, reply({ ...good, redirectUrl })), "redirect", String(redirectUrl));
}
for (const redirectUrl of ["https://c.yoco.com/checkout/ch_abc123", "https://yoco.com/x", "https://a.b.yoco.com/x?y=1"]) assert.equal(await reason(ENV, reply({ ...good, redirectUrl })), "no error", redirectUrl);
ok("redirectUrl: https and yoco.com or *.yoco.com only (look-alikes, http, credentials, scripts refused)");

// 5. Mode in the response
assert.equal(await reason(ENV, reply({ ...good, processingMode: "live" })), "mode");
assert.equal(await reason({ ...ENV, YOCO_MODE: "live", YOCO_SECRET_KEY: "sk_live_localfake1234567890" }, reply({ ...good, processingMode: "test" })), "mode");
ok("a checkout whose processingMode disagrees with YOCO_MODE is not used");

// 6. YOCO_API_BASE is only honoured for http://127.0.0.1
globalThis.fetch = async (url) => { seen = { url }; return new Response(JSON.stringify({ ...good, redirectUrl: "http://127.0.0.1:8798/pay/ch_abc123" }), { status: 201 }); };
assert.deepEqual(await createCheckout({ ...ENV, YOCO_API_BASE: "http://127.0.0.1:8798" }, input), { id: "ch_abc123", redirectUrl: "http://127.0.0.1:8798/pay/ch_abc123" });
assert.equal(seen.url, "http://127.0.0.1:8798/api/checkouts");
for (const base of ["https://evil.example", "http://localhost:8798", "http://127.0.0.1.evil.example:80", "http://127.0.0.1@evil.example/", "http://10.0.0.1"]) {
  globalThis.fetch = async (url) => { seen = { url }; return new Response(JSON.stringify(good), { status: 201 }); };
  await createCheckout({ ...ENV, YOCO_API_BASE: base }, input);
  assert.equal(seen.url, "https://payments.yoco.com/api/checkouts", base + " ignored");
}
// with the fake base, a redirect to another origin is still refused
globalThis.fetch = reply({ ...good, redirectUrl: "https://c.yoco.com/x" });
assert.equal(await reason({ ...ENV, YOCO_API_BASE: "http://127.0.0.1:8798" }, reply({ ...good, redirectUrl: "https://evil.example/x" })), "redirect");
ok("YOCO_API_BASE only works for http://127.0.0.1...; any other value is ignored and the real Yoco is used");
console.log(`yoco-checkout: all ${n} groups passed`);
