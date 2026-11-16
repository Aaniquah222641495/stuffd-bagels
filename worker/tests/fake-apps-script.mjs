// Stands in for the client's Google Apps Script web app: logs each POST, answers like script.google.com (302 then JSON).
// A name containing FailMe makes it answer { ok: false } so the Worker's failure path can be tested.
import http from "node:http";
import fs from "node:fs";
const log = process.argv[2];
http.createServer((req, res) => {
  if (req.url.startsWith("/echo")) { res.setHeader("content-type","application/json"); res.end(globalThis.next ?? '{"ok":true}'); return; }
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    fs.appendFileSync(log, JSON.stringify({ method: req.method, ct: req.headers["content-type"], body: JSON.parse(b || "{}") }) + "\n");
    const fail = b.includes("FailMe");
    globalThis.next = fail ? '{"ok":false,"error":"mail"}' : '{"ok":true}';
    // Like script.google.com: answer the POST with a redirect that the client follows with GET.
    res.statusCode = 302; res.setHeader("location", "/echo"); res.end();
  });
}).listen(8799, "127.0.0.1");
