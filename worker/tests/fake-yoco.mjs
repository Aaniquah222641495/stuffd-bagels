// Stands in for Yoco's Checkout API while testing with `wrangler dev` (the Worker is started with
// --var YOCO_API_BASE:http://127.0.0.1:8798, which it honours ONLY for http://127.0.0.1). Never talks to the internet.
//   POST /api/checkouts   records the call (headers, body) and answers like Yoco: { id, status, redirectUrl, processingMode }.
//                         The same Idempotency-Key returns the first answer again (Idempotent-Replayed: true), like Yoco.
//                         POST /_failnext makes the NEXT create-checkout call answer 500 (the order body carries no free text, by design).
//   GET  /pay/<id>        a tiny "payment page" with three links to the checkout's success / cancel / failure URLs;
//                         records the Referer it was reached with.
//   POST /turnstile/v0/siteverify   stands in for Cloudflare's Turnstile check (the Worker is started with --var TURNSTILE_API_BASE:http://127.0.0.1:8798,
//                         honoured only for http://127.0.0.1). Like Cloudflare's documented test secret: only the secret 1x0000000000000000000000000000000AA with
//                         the token XXXX.DUMMY.TOKEN.XXXX passes; anything else fails with invalid-input-response. Calls are recorded in `siteverify`.
//   GET  /_calls          the recorded calls and page visits as JSON.      POST /_reset   clears them.
// Run: FAKE_YOCO_PORT=8798 node worker/tests/fake-yoco.mjs
import http from "node:http";
import crypto from "node:crypto";
const calls = [];
const visits = [];
const byKey = new Map();
let failNext = 0;
const checkouts = new Map();
const siteverify = [];
const port = Number(process.env.FAKE_YOCO_PORT ?? 8798);
http.createServer((req, res) => {
  const json = (status, obj, extra = {}) => { res.writeHead(status, { "content-type": "application/json", ...extra }); res.end(JSON.stringify(obj)); };
  if (req.method === "GET" && req.url === "/_calls") return json(200, { calls, visits, siteverify });
  if (req.method === "POST" && req.url === "/_reset") { calls.length = 0; visits.length = 0; siteverify.length = 0; byKey.clear(); return json(200, { ok: true }); }
  if (req.method === "POST" && req.url === "/_failnext") { failNext++; return json(200, { ok: true }); }
  if (req.method === "GET" && req.url.startsWith("/pay/")) {
    const id = req.url.slice(5).split("?")[0];
    visits.push({ id, referer: req.headers.referer ?? null });
    const c = checkouts.get(id);
    res.writeHead(c ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    return res.end(c ? `<!doctype html><title>Fake Yoco</title><h1>Fake Yoco checkout</h1><p>R${c.amount / 100}</p><a id="ok" href="${c.successUrl}">Pay</a> <a id="cancel" href="${c.cancelUrl}">Cancel</a> <a id="fail" href="${c.failureUrl}">Fail</a>` : "unknown checkout");
  }
  if (req.method === "POST" && req.url === "/turnstile/v0/siteverify") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const f = Object.fromEntries(new URLSearchParams(b));
      siteverify.push({ secretIsTestPass: f.secret === "1x0000000000000000000000000000000AA", response: f.response, remoteip: f.remoteip ?? null });
      const good = f.secret === "1x0000000000000000000000000000000AA" && f.response === "XXXX.DUMMY.TOKEN.XXXX";
      json(200, good ? { success: true, hostname: "example.com", challenge_ts: new Date().toISOString() } : { success: false, "error-codes": ["invalid-input-response"] });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/checkouts") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const key = req.headers["idempotency-key"];
      const body = JSON.parse(b || "{}");
      calls.push({ headers: { authorization: req.headers.authorization, "idempotency-key": key, "content-type": req.headers["content-type"] }, body });
      if (failNext > 0) { failNext--; return json(500, { error: "boom" }); }
      if (key && byKey.has(key)) return json(200, byKey.get(key), { "Idempotent-Replayed": "true" });
      const id = "ch_" + crypto.randomBytes(8).toString("hex");
      const out = { id, status: "created", amount: body.amount, currency: "ZAR", redirectUrl: `http://127.0.0.1:${port}/pay/${id}`, processingMode: "test", externalId: body.externalId };
      checkouts.set(id, body);
      if (key) byKey.set(key, out);
      json(201, out);
    });
    return;
  }
  json(404, { error: "not found" });
}).listen(port, "127.0.0.1");
