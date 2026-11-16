// Limiter logic with no server: node worker/tests/limiter-unit.mjs
// Real code (limiter-core.ts, limiter-client.ts, forms.ts rate limiting) bundled for Node, a fake clock, an in-memory stand-in for the Durable Object.
import assert from "node:assert/strict";
import { bundle, fakeLimiter } from "./_bundle.mjs";
const core = await bundle("worker/limiter-core.ts");
const client = await bundle("worker/limiter-client.ts");
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);

// 1. IPv6 is keyed by /64
const b = client.ipBucket;
assert.equal(b("203.0.113.9"), "203.0.113.9");
assert.equal(b("2001:db8:1:2::1"), b("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff"));
assert.equal(b("2001:db8:1:2::1"), "2001:0db8:0001:0002::/64");
assert.notEqual(b("2001:db8:1:2::1"), b("2001:db8:1:3::1"));
assert.equal(b("::1"), "0000:0000:0000:0000::/64");
assert.equal(b("::ffff:203.0.113.9"), "203.0.113.9", "IPv4-mapped IPv6 is the IPv4 address");
assert.equal(b("2001:db8::"), "2001:0db8:0000:0000::/64");
assert.equal(b("fe80::1%en0"), "fe80:0000:0000:0000::/64");
assert.equal(b("unknown"), "unknown");
ok("IPv4 as is; IPv6 cut to /64 (compressed, upper case, zone id, mapped IPv4 handled)");

// 2. Same mailbox written different ways
const e = client.normaliseEmail;
assert.equal(e("Sam.Smith+x@Gmail.com"), "samsmith@gmail.com");
assert.equal(e("samsmith@googlemail.com"), "samsmith@gmail.com");
assert.equal(e("a.b+c@example.com"), "a.b@example.com", "dots only ignored for Gmail");
ok("email normalised: case, +tag, Gmail dots and googlemail.com");

// 3. Window, all-or-nothing, refund, expiry
const store = () => { const m = new Map(); return { get: (id) => m.get(id), put: (id, r) => void m.set(id, r) }; };
const s = store(), T = 1_000_000;
const rules = [{ id: "15m", limit: 5, windowSec: 900 }, { id: "day", limit: 30, windowSec: 86400 }];
for (let i = 0; i < 5; i++) assert.equal(core.takeRules(s, rules, T + i).ok, true);
let v = core.takeRules(s, rules, T + 5);
assert.equal(v.ok, false); assert.ok(v.retryAfter > 890 && v.retryAfter <= 900);
assert.equal(s.get("day").count, 5, "a refused take changes nothing (all or nothing)");
assert.equal(core.takeRules(s, rules, T + 901_000).ok, true, "after 15 minutes the 15m window reopens");
ok("5 slots per 15 minutes, refusal leaves counters untouched, window reopens");
core.refundRules(s, ["15m", "day"], T + 902_000); core.refundRules(s, ["15m", "day"], T + 902_000); core.refundRules(s, ["15m", "day"], T + 902_000);
assert.equal(s.get("15m").count, 0, "refund never goes below zero");
ok("refund gives slots back, floor at zero");

// 4. Per-day cap on one network: 30 across many 15-minute windows, then locked until the day ends. Nobody else is affected.
const d = store(); let ts = T, accepted = 0;
for (let i = 0; i < 80; i++) { if (core.takeRules(d, rules, ts).ok) accepted++; ts += 181_000; } // 3 minutes apart: 5 per window
assert.equal(accepted, 30);
const other = store(); assert.equal(core.takeRules(other, rules, ts).ok, true);
ok("per-network daily cap of 30 holds across windows, other networks unaffected");

// 5. Parallel: 12 simultaneous takes under one key -> exactly 5 allowed
const lim = await fakeLimiter();
const stub = lim.ns.get("admin:x");
const results = await Promise.all(Array.from({ length: 12 }, () => stub.take(rules)));
assert.equal(results.filter((r) => r.ok).length, 5);
assert.equal(results.filter((r) => !r.ok).length, 7);
ok("12 parallel takes: exactly 5 allowed, 7 refused");
console.log(`limiter-unit: all ${n} groups passed`);
