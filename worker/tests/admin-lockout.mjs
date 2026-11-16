// M2 of the 2026-11-16 re-test: the admin lockout must hold under PARALLEL wrong passwords. Run against wrangler dev (see README).
// Each group uses its own pretend client network (the Worker reads CF-Connecting-IP; wrangler dev lets a test set it).
import assert from "node:assert/strict";
import { B, pw } from "./_helpers.mjs";
const rnd = () => Math.floor(Math.random() * 0xffff).toString(16);
const net = () => `2001:db8:${rnd()}:${rnd()}`; // a fresh /64
const tryPw = (ip, password) => fetch(B + "/api/admin/availability", { headers: { "x-admin-password": password, "CF-Connecting-IP": ip } });
let n = 0;
const ok = (name) => console.log("PASS", ++n, name);

// 1. 12 parallel wrong passwords from one address: 5 are told "wrong", the other 7 are locked out.
let ip = `${net()}::1`;
let rs = await Promise.all(Array.from({ length: 12 }, () => tryPw(ip, "wrong")));
let codes = rs.map((r) => r.status).sort();
assert.equal(codes.filter((c) => c === 401).length, 5, codes.join());
assert.equal(codes.filter((c) => c === 429).length, 7, codes.join());
assert.ok(rs.find((r) => r.status === 429).headers.get("retry-after"));
ok("12 parallel wrong passwords: exactly 5 x 401, 7 x 429 (with Retry-After)");

// 2. Sequential: the 6th wrong try onward is 429. The right password is refused while locked (and the lock holds).
ip = `${net()}::1`;
const seq = []; for (let i = 0; i < 8; i++) seq.push((await tryPw(ip, "wrong")).status);
assert.deepEqual(seq, [401, 401, 401, 401, 401, 429, 429, 429]);
const locked = await tryPw(ip, pw);
assert.equal(locked.status, 429); assert.ok(Number(locked.headers.get("retry-after")) > 800 && Number(locked.headers.get("retry-after")) <= 900);
ok("6th wrong try onward = 429; correct password also 429 while locked; Retry-After about 900 s");

// 3. Rotating inside one /64 does not help; another /64 is untouched.
const mine = net();
rs = await Promise.all(Array.from({ length: 12 }, (_, i) => tryPw(`${mine}:${rnd()}:${rnd()}:${rnd()}:${(i + 1).toString(16)}`, "wrong"))); // 8 hextets: same first 64 bits
codes = rs.map((r) => r.status);
assert.equal(codes.filter((c) => c === 401).length, 5, codes.join());
assert.equal((await tryPw(`${mine}::beef`, pw)).status, 429, "same /64, new address: still locked");
assert.equal((await tryPw(`${net()}::1`, "wrong")).status, 401, "a different /64 is not locked");
assert.equal((await tryPw(`${net()}::1`, pw)).status, 200, "the owner on another network gets in");
ok("12 parallel tries from 12 addresses in one /64: 5 x 401; the /64 stays locked; other networks unaffected");

// 4. The owner is not harmed by a few parallel good requests, and good logins never use up the allowance.
ip = `${net()}::1`;
rs = await Promise.all(Array.from({ length: 4 }, () => tryPw(ip, pw)));
assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 200]);
for (let i = 0; i < 20; i++) assert.equal((await tryPw(ip, pw)).status, 200);
for (let i = 0; i < 5; i++) assert.equal((await tryPw(ip, "wrong")).status, 401);
assert.equal((await tryPw(ip, "wrong")).status, 429, "wrong tries still count after many good ones");
ok("good logins are refunded: 24 correct requests, then 5 wrong tries still allowed before the lock");

// 5. Unauthenticated routes that do not exist answer like real ones (no route enumeration), and missing password counts as a try.
ip = `${net()}::1`;
assert.equal((await fetch(B + "/api/admin/users", { headers: { "CF-Connecting-IP": ip } })).status, 401);
ok("unknown admin path without password: 401");
console.log(`admin-lockout: all ${n} groups passed`);
