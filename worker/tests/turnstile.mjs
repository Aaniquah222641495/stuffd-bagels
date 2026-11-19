// Turnstile server check (D-SB-7) against the REAL Worker code with fake Durable Objects, a fake siteverify and a fake Yoco + Apps Script.
// Run: node worker/tests/turnstile.mjs
import assert from "node:assert/strict";
import { TS_DUMMY_TOKEN, TS_SITEVERIFY, YOCO_TEST_ENV, bundle, fakeLimiter, fakeOrders } from "./_bundle.mjs";
const { handleForm } = await bundle("worker/forms.ts");
const ts = await bundle("worker/turnstile.ts");

const sast = (iso, time = "12:00:00") => Date.parse(`${iso}T${time}+02:00`);
const NOW = sast("2026-11-16");
const TOKEN = "k7Vq2mXw9LpR4sTz8NbC3dHf6JyA1eGu0QiO5vWx";
const REAL_SECRET = "0x4AAAAAAAreal_looking_secret_for_tests_only";
const SITE = "https://stuffdbagels.co.za";

// ---- fake world: siteverify with real-key behaviour (tokens are single use), Yoco, Apps Script
const world = { siteverify: [], yoco: 0, script: [], mode: "real", used: new Set(), hostname: "stuffdbagels.co.za", action: null };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u === TS_SITEVERIFY) {
    const f = new URLSearchParams(String(init.body));
    const call = Object.fromEntries(f);
    world.siteverify.push(call);
    if (world.mode === "down") throw new Error("network");
    if (world.mode === "500") return new Response("oops", { status: 500 });
    if (world.mode === "html") return new Response("<html>", { status: 200 });
    if (world.mode === "badsecret") return new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-secret"] }));
    if (world.mode === "internal") return new Response(JSON.stringify({ success: false, "error-codes": ["internal-error"] }));
    const t = call.response;
    if (!t.startsWith("good-") || world.used.has(t)) return new Response(JSON.stringify({ success: false, "error-codes": [world.used.has(t) ? "timeout-or-duplicate" : "invalid-input-response"] }));
    world.used.add(t);
    return new Response(JSON.stringify({ success: true, hostname: world.hostname, action: world.action ?? call.__action ?? undefined, challenge_ts: new Date().toISOString() }));
  }
  if (u.startsWith("https://payments.yoco.com/api/checkouts")) { world.yoco++; return new Response(JSON.stringify({ id: "ch_" + world.yoco, status: "created", redirectUrl: "https://c.yoco.com/checkout/ch_" + world.yoco, processingMode: "test" }), { status: 201 }); }
  if (u === "http://fake/exec") { world.script.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
  throw new Error("unexpected fetch " + u);
};
const logs = [];
for (const k of ["log", "error", "warn", "info"]) console[k] = ((orig) => (...a) => logs.push(a.map(String).join(" ")))(console[k]);
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
let n = 0;
const ok = (name) => out("PASS", ++n, name);

const kv = (() => { const m = new Map([["pickups", JSON.stringify({ pickups: [{ id: "p1", name: "Kenilworth Corner", area: "Main Rd", days: "", active: true }] })]]); return { get: async (k) => m.get(k) ?? null, put: async () => {} }; })();
const prodEnv = { APP_ENV: "production", TURNSTILE_SECRET_KEY: REAL_SECRET, ...YOCO_TEST_ENV, SITE_ORIGIN: SITE, YOCO_MODE: "test" };
let goodN = 0;
const good = (action) => { world.action = action; return `good-${++goodN}`; };

async function go(kind, over = {}, { env = {}, ip = "203.0.113.9" } = {}) {
  const lim = over.__lim ?? (await fakeLimiter({ now: () => NOW }));
  const ord = await fakeOrders({ now: () => NOW });
  const e = { LIMITER: lim.ns, ORDERS: ord.ns, ...prodEnv, APP_ENV: "production", STUFFD_KV: kv, ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec", APPS_SCRIPT_TOKEN: TOKEN, ...env };
  const base = kind === "order"
    ? { name: "Aisha", phone: "0821234567", email: `a${++goodN}@example.com`, pickupId: "p1", pickupDate: "2026-11-28", items: { "Classic Bagel": 1 }, website: "", attemptId: crypto.randomUUID() }
    : { name: "Sam", phone: "0821234567", email: `s${++goodN}@example.com`, eventDate: "2026-12-20", venue: "Hall", guests: 20, details: "", website: "" };
  const { __lim, ...rest } = over;
  const body = { ...base, ...rest };
  try {
    const res = await handleForm(new Request("http://x/api/" + kind, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), e, kind, NOW);
    return { status: res.status, body: await res.json(), lim, body_: body };
  } catch (err) { return { status: err.status ?? 500, body: { error: err.message }, lim }; }
}
const quiet = () => { assert.equal(world.yoco, 0, "no Yoco checkout"); assert.equal(world.script.length, 0, "no email request"); };
const reset = () => { world.yoco = 0; world.script.length = 0; world.siteverify.length = 0; logs.length = 0; world.mode = "real"; world.hostname = "stuffdbagels.co.za"; };

// 1. A good token: both forms go through, and siteverify got the secret, the token and the visitor's address
reset();
let r = await go("order", { turnstileToken: good("order") });
assert.equal(r.status, 200); assert.match(r.body.redirectUrl, /yoco\.com/); assert.equal(world.yoco, 1);
assert.equal(world.siteverify.length, 1); assert.equal(world.siteverify[0].secret, REAL_SECRET); assert.equal(world.siteverify[0].remoteip, "203.0.113.9"); assert.match(world.siteverify[0].response, /^good-/);
r = await go("booking", { turnstileToken: good("booking") });
assert.equal(r.status, 200); assert.equal(world.script.length, 1); assert.equal(world.siteverify.length, 2);
ok("good token: order opens a checkout, booking sends its email; siteverify gets secret, token and remoteip");

// 2. No token, empty, non-string, oversized: refused with 400 BEFORE siteverify, Yoco or email
reset();
for (const kind of ["order", "booking"]) for (const t of [undefined, "", 5, null, {}, "x".repeat(2049)]) {
  r = await go(kind, { turnstileToken: t }); assert.equal(r.status, 400, `${kind} ${String(t).slice(0, 8)}`); assert.match(r.body.error, /security check/i);
}
quiet(); assert.equal(world.siteverify.length, 0, "no call to Cloudflare for a missing token");
ok("missing / empty / non-string / over-2048 token: 400 friendly message, nothing called, nothing sent");

// 3. Bad token, and a token used twice (single use)
reset();
r = await go("order", { turnstileToken: "bad-token" }); assert.equal(r.status, 403); assert.match(r.body.error, /security check/i); quiet();
const t = good("order");
assert.equal((await go("order", { turnstileToken: t })).status, 200); world.yoco = 0;
r = await go("order", { turnstileToken: t }); assert.equal(r.status, 403, "second use of one token"); quiet();
r = await go("booking", { turnstileToken: "bad-token" }); assert.equal(r.status, 403); quiet();
ok("invalid token: 403; the same token twice: second is 403 (timeout-or-duplicate); nothing sent");

// 4. A failed check does not use up anyone's rate-limit allowance
reset();
const lim = await fakeLimiter({ now: () => NOW });
for (let i = 0; i < 12; i++) assert.equal((await go("order", { turnstileToken: "bad-token", __lim: lim })).status, 403);
assert.equal(lim.keys().length, 0, "no counter was even created");
assert.equal((await go("order", { turnstileToken: good("order"), __lim: lim })).status, 200, "a real visitor still gets through after 12 bot attempts from the same network");
ok("12 failed checks from one network use no allowance (per-network, per-mailbox and daily counters untouched)");

// 5. Hostname and action
reset();
world.hostname = "evil.example"; r = await go("order", { turnstileToken: good("order") }); assert.equal(r.status, 403); quiet();
world.hostname = "www.stuffdbagels.co.za"; assert.equal((await go("order", { turnstileToken: good("order") })).status, 200); world.yoco = 0;
world.hostname = "stuffdbagels.co.za";
r = await go("order", { turnstileToken: good("booking") }); assert.equal(r.status, 403, "a booking token cannot place an order"); quiet();
r = await go("booking", { turnstileToken: good("order") }); assert.equal(r.status, 403, "an order token cannot send a booking"); quiet();
world.action = null; r = await go("order", { turnstileToken: "good-noaction" }); assert.equal(r.status, 403, "no action reported with a real secret: refused"); quiet();
ok("real keys: wrong hostname refused (www. form allowed), wrong or missing action refused (order vs booking)");

// 6. Production without the secret: refuse and log clearly, send nothing, count nothing
reset();
for (const env of [{ TURNSTILE_SECRET_KEY: undefined }, { TURNSTILE_SECRET_KEY: "" }, { TURNSTILE_SECRET_KEY: "   " }, { TURNSTILE_SECRET_KEY: undefined, APP_ENV: undefined }, { TURNSTILE_SECRET_KEY: undefined, APP_ENV: "staging" }]) {
  for (const kind of ["order", "booking"]) { logs.length = 0; r = await go(kind, { turnstileToken: good(kind) }, { env }); assert.equal(r.status, 503, JSON.stringify(env) + kind); assert.ok(logs.some((l) => /TURNSTILE_SECRET_KEY is NOT SET/.test(l)), "clear line for wrangler tail"); }
}
quiet(); assert.equal(world.siteverify.length, 0);
ok("production (or unset / unknown APP_ENV) without TURNSTILE_SECRET_KEY: 503 + a clear log line, nothing called or sent");

// 7. Cloudflare's documented TEST secrets are refused in production, even the always-pass one
reset();
for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
  logs.length = 0; r = await go("order", { turnstileToken: TS_DUMMY_TOKEN }, { env: { TURNSTILE_SECRET_KEY: secret } }); assert.equal(r.status, 503); assert.ok(logs.some((l) => /TEST secrets/.test(l)));
}
quiet();
assert.equal(ts.turnstileSiteKey({ APP_ENV: "production", TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }), "", "test site key never served in production");
assert.equal(ts.turnstileSiteKey({ APP_ENV: "production" }), "", "no site key in production until set");
assert.equal(ts.turnstileSiteKey({ APP_ENV: "production", TURNSTILE_SITE_KEY: "" }), "", "an empty production site key serves no key (no widget; the Worker still demands a token)");
assert.equal(ts.turnstileSiteKey({ APP_ENV: "production", TURNSTILE_SITE_KEY: "0x4AAAAAAGIpBftgw-wYSqUM" }), "0x4AAAAAAGIpBftgw-wYSqUM");
ok("production refuses Cloudflare's documented test secrets, and never serves a test site key");

// 8. Preview and development fall back to the always-pass test keys (so the preview keeps working)
reset();
const dummyEnv = { TURNSTILE_SECRET_KEY: undefined };
for (const appEnv of ["preview", "development"]) {
  world.mode = "real";
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url) === TS_SITEVERIFY) { const f = Object.fromEntries(new URLSearchParams(String(init.body))); seen.push(f); const okTok = f.secret === "1x0000000000000000000000000000000AA" && f.response === TS_DUMMY_TOKEN; return new Response(JSON.stringify(okTok ? { success: true, hostname: "example.com" } : { success: false, "error-codes": ["invalid-input-response"] })); } return prev(url, init); };
  r = await go("order", { turnstileToken: TS_DUMMY_TOKEN }, { env: { ...dummyEnv, APP_ENV: appEnv } }); assert.equal(r.status, 200, appEnv + " dummy token passes (example.com hostname, no action)");
  r = await go("order", { turnstileToken: "real-looking-token" }, { env: { ...dummyEnv, APP_ENV: appEnv } }); assert.equal(r.status, 403, appEnv + " other tokens still fail");
  assert.equal(seen.length, 2); globalThis.fetch = prev;
}
assert.equal(ts.turnstileSiteKey({ APP_ENV: "preview" }), "1x00000000000000000000AA");
assert.equal(ts.turnstileSiteKey({ APP_ENV: "development" }), "1x00000000000000000000AA");
ok("preview and development: the documented always-pass keys work, hostname/action not demanded, other tokens still fail");

// 9. Cloudflare down, slow, rejecting our secret: fail closed (503), say so in the log, send nothing
reset();
for (const mode of ["down", "500", "html", "badsecret", "internal"]) {
  world.mode = mode; logs.length = 0;
  for (const kind of ["order", "booking"]) { r = await go(kind, { turnstileToken: good(kind) }); assert.equal(r.status, 503, mode + kind); }
  assert.ok(logs.some((l) => l.startsWith("turnstile:")), mode + " logged");
  if (mode === "badsecret") assert.ok(logs.some((l) => /REJECTED TURNSTILE_SECRET_KEY/.test(l)));
}
quiet();
ok("siteverify unreachable / 500 / not JSON / secret rejected / internal-error: 503, logged, nothing sent (fails closed)");

// 10. Honeypot still answers like a success without any check; the secret and token never appear in logs
reset();
r = await go("order", { website: "http://spam.example" }); assert.equal(r.status, 200); quiet();
world.mode = "real"; await go("order", { turnstileToken: "bad-secret-leak-check" }); await go("booking", { turnstileToken: good("booking") });
for (const l of logs) { assert.ok(!l.includes(REAL_SECRET), "secret in log"); assert.ok(!l.includes("bad-secret-leak-check"), "token in log"); assert.ok(!/@example\.com|Aisha|082/.test(l), "personal data in log"); }
ok("honeypot is unchanged; no secret, token or personal data in the log lines");

// 11. A known retry of the same press needs no second token (flaky network)
reset();
const sameLim = await fakeLimiter({ now: () => NOW });
const ord = await fakeOrders({ now: () => NOW });
const attemptId = crypto.randomUUID();
const envX = { LIMITER: sameLim.ns, ORDERS: ord.ns, ...prodEnv, APP_ENV: "production", STUFFD_KV: kv, ADMIN_PASSWORD: "x", APPS_SCRIPT_URL: "http://fake/exec", APPS_SCRIPT_TOKEN: TOKEN };
const mk = (tok) => new Request("http://x/api/order", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.50" }, body: JSON.stringify({ name: "Aisha", phone: "0821234567", email: "same@example.com", pickupId: "p1", pickupDate: "2026-11-28", items: { "Classic Bagel": 1 }, website: "", attemptId, turnstileToken: tok }) });
const first = await (await handleForm(mk(good("order")), envX, "order", NOW)).json();
const second = await handleForm(mk(`good-${goodN}`), envX, "order", NOW); // the same, now spent, token
assert.equal(second.status, 200); assert.equal((await second.json()).redirectUrl, first.redirectUrl); assert.equal(world.yoco, 1); assert.equal(world.siteverify.length, 1, "no second siteverify call");
ok("a repeat of the same press gets the same checkout back without spending another token");

out(`turnstile: all ${n} groups passed`);
