// Go-live rules, with no server: production admin password length, the limiter salt, HTTPS-only API, preview noindex.
// Run: node worker/tests/admin-policy.mjs
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { bundle, fakeLimiter } from "./_bundle.mjs";
// workerd has crypto.subtle.timingSafeEqual (auth.ts uses it); Node does not. Test-only shim with the same behaviour.
crypto.subtle.timingSafeEqual ??= (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const auth = await bundle("worker/auth.ts");
const lc = await bundle("worker/limiter-client.ts");
const http = await bundle("worker/http.ts");
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);
const req = (pw) => new Request("http://x/api/admin/availability", { headers: { "x-admin-password": pw, "CF-Connecting-IP": "203.0.113.9" } });
const run = async (env, pw) => { try { await auth.requireAdmin(req(pw), env); return 200; } catch (e) { return e.status ?? 500; } };
const lim = await fakeLimiter();
console.error = () => {}; // the refusals log a line on purpose
const L = (extra) => ({ LIMITER: lim.ns, ...extra });
const LONG = "correct-horse-battery-staple-91"; // 31 characters

// 1. Production (APP_ENV "production" or unset or anything unknown) refuses a password under 16 characters, even the right one
for (const appEnv of ["production", undefined, "", "prod", "Preview"]) {
  assert.equal(await run(L({ ADMIN_PASSWORD: "short-pass", APP_ENV: appEnv }), "short-pass"), 500, `short password, APP_ENV=${appEnv}`);
  assert.equal(await run(L({ ADMIN_PASSWORD: "x".repeat(15), APP_ENV: appEnv }), "x".repeat(15)), 500, "15 characters");
}
assert.equal(await run(L({ ADMIN_PASSWORD: "x".repeat(16), APP_ENV: "production" }), "x".repeat(16)), 200, "16 characters is enough");
assert.equal(await run(L({ ADMIN_PASSWORD: LONG, APP_ENV: "production" }), LONG), 200);
assert.equal(await run(L({ ADMIN_PASSWORD: LONG, APP_ENV: "production" }), "wrong"), 401);
ok("production (or unset / unknown APP_ENV): ADMIN_PASSWORD under 16 characters is refused for everyone (500); 16+ works");

// 2. Preview and development may use a short password
for (const appEnv of ["preview", "development"]) assert.equal(await run(L({ ADMIN_PASSWORD: "admin", APP_ENV: appEnv }), "admin"), 200, appEnv);
assert.equal(await run(L({ APP_ENV: "preview" }), "admin"), 500, "no password configured at all: refused");
ok("preview and development accept a short password");

// 3. The refusal comes before any counter is touched
const lim2 = await fakeLimiter();
try { await auth.requireAdmin(req("a"), { LIMITER: lim2.ns, ADMIN_PASSWORD: "a", APP_ENV: "production" }); } catch {}
assert.equal(lim2.keys().length, 0);
ok("a refused weak production password uses no limiter slot");

// 4. LIMITER_SALT: used when 16+ characters; otherwise falls back to ADMIN_PASSWORD, then to a fixed string
const salt = "s".repeat(16);
assert.equal(lc.limiterSalt({ LIMITER_SALT: salt, ADMIN_PASSWORD: "pw" }), salt);
assert.equal(lc.limiterSalt({ LIMITER_SALT: "short", ADMIN_PASSWORD: "pw" }), "pw", "too short: fall back");
assert.equal(lc.limiterSalt({ ADMIN_PASSWORD: "pw" }), "pw", "unset: fall back to the admin password (as before)");
assert.equal(lc.limiterSalt({}), "stuffd-forms", "nothing at all: fixed string, never undefined");
const e1 = await lc.hashKey("203.0.113.9", lc.limiterSalt({ LIMITER_SALT: salt, ADMIN_PASSWORD: "pw" }));
const e2 = await lc.hashKey("203.0.113.9", lc.limiterSalt({ ADMIN_PASSWORD: "pw" }));
assert.notEqual(e1, e2, "the salt, not the password, keys the hash once it is set");
// the admin lockout keys use the salt: changing the admin password does not move the counter
const lim3 = await fakeLimiter();
const E = { LIMITER: lim3.ns, LIMITER_SALT: salt, APP_ENV: "development" };
await run({ ...E, ADMIN_PASSWORD: "one-password-aaaa" }, "bad"); await run({ ...E, ADMIN_PASSWORD: "two-password-bbbb" }, "bad");
assert.equal(lim3.keys().length, 1, "one counter for the network whichever admin password is configured");
ok("LIMITER_SALT keys the counters (16+ characters); unset or short falls back to ADMIN_PASSWORD, then a fixed string; rotating the admin password doesn't reset counters once the salt is set");

// 5. HTTPS only (loopback excepted), noindex helper
assert.equal(http.plainHttpRefused(new URL("http://stuffdbagels.co.za/api/order")), true);
assert.equal(http.plainHttpRefused(new URL("http://stuffdbagels-preview.thedigitalpantryza.workers.dev/api/availability")), true);
assert.equal(http.plainHttpRefused(new URL("https://stuffdbagels.co.za/api/order")), false);
for (const u of ["http://localhost:8787/api/x", "http://127.0.0.1:8787/api/x", "http://[::1]:8787/api/x"]) assert.equal(http.plainHttpRefused(new URL(u)), false, u);
assert.equal(http.plainHttpRefused(new URL("http://localhost.evil.example/api/x")), true);
const res = http.withNoindex(new Response("<html>", { status: 404, headers: { "content-type": "text/html" } }));
assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow"); assert.equal(res.status, 404); assert.equal(await res.text(), "<html>"); assert.equal(res.headers.get("content-type"), "text/html");
ok("plain-HTTP /api refused except loopback (look-alike hostnames refused); noindex helper keeps status, body and headers");
const sheet = (v) => http.prepSheetLink(v);
assert.equal(sheet("https://docs.google.com/spreadsheets/d/abc_-123/edit#gid=0"), "https://docs.google.com/spreadsheets/d/abc_-123/edit#gid=0");
for (const bad of [undefined, "", "   ", "http://docs.google.com/spreadsheets/d/abc", "javascript:alert(1)", "https://docs.google.com/spreadsheets/d/", "https://docs.google.com.evil.example/spreadsheets/d/a", "https://evil.example/?https://docs.google.com/spreadsheets/d/a", "https://docs.google.com/document/d/abc"]) assert.equal(sheet(bad), "", String(bad));
ok("prep sheet link: only an https Google Sheets address is passed to the admin page, anything else is empty");
console.log(`admin-policy: all ${n} groups passed`);
