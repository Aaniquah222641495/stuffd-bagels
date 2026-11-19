// Shared by the API tests in this folder. They talk to `wrangler dev` on :8787 (see forms-api.mjs for the setup).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const B = process.env.SB_BASE ?? "http://localhost:8787"; // SB_BASE: when 8787 is taken by another session
export const pw = /ADMIN_PASSWORD=(.*)/.exec(fs.readFileSync(path.join(root, ".dev.vars"), "utf8"))[1].trim();
const col = await import(pathToFileURL(path.join(root, "artifacts/stuffd-bagels/src/collection.ts")).href);
export { col };

export const log = process.argv[2]; // the fake Apps Script log (worker/tests/fake-apps-script.mjs writes it)
export const logged = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// Rate limits are per client network, and the Worker reads it from CF-Connecting-IP (wrangler dev lets a test set it; the real edge does not).
// So each test takes a fresh pretend IPv6 /64 whenever it wants a clean slate: clearRateLimits() just switches to a new one.
const fresh = () => `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}::1`;
export let ip = fresh();
export const newIp = () => (ip = fresh());
let mailN = 0;
const runId = Date.now().toString(36);
/** A new mailbox every call: the Worker caps customer replies per address per day. */
export const uniqueEmail = (who = "test") => `${who}${runId}n${++mailN}@example.com`;

export const post = (p, body, headers = {}) =>
  fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
export const admin = (p, method = "GET", body, headers = {}) =>
  fetch(B + "/api/admin" + p, {
    method,
    headers: { "x-admin-password": pw, "CF-Connecting-IP": ip, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// The site default is ONE collection Saturday a month (the last one, orders open on the 15th; client 2026-11-18). Most
// flows here need three open Saturdays whatever day the test runs, so setAvail adds the next five real Saturdays,
// already open, unless a test passes its own lists. The real default is asserted in saturday-rules.mjs and e2e step 6.
export function testRules(now = Date.now()) {
  const today = col.sastDay(now);
  const sats = [];
  for (let d = 0; sats.length < 5; d++) {
    const iso = new Date(Date.parse(today + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
    if (col.isSaturday(iso)) sats.push(iso);
  }
  return { addedSaturdays: sats, opensOn: Object.fromEntries(sats.map((d) => [d, today])) };
}
// A save that names every field. The admin API keeps any field a save OMITS (partial saves), so tests that want a clean slate
// must say so: DEFAULT_AVAIL is the factory state (standard cut-off, the built-in last-Saturday list).
export const DEFAULT_AVAIL = { ordersEnabled: true, closedDates: [], closedMessage: "", cutoffTime: "23:59", addedSaturdays: [], removedSaturdays: [], keptSaturdays: [], opensOn: {} };
export const resetAvail = (a = {}) => admin("/availability", "POST", { ...DEFAULT_AVAIL, ...a });
export const setAvail = (a) => admin("/availability", "POST", { ...DEFAULT_AVAIL, ...testRules(), ...a });

/** Saturdays open for orders right now under the test rules (real clock). Index 1+ is safely away from any cut-off edge. */
export const saturdays = () => col.availableSaturdays(Date.now(), { cutoffTime: "23:59", closedDates: [], ...testRules() });

/** Remove every pickup point, then create the given ones. Returns their ids. */
export async function resetPickups(points) {
  for (const p of await (await admin("/pickups")).json()) await admin(`/pickups/${p.id}`, "DELETE");
  const ids = [];
  for (const p of points) ids.push((await (await admin("/pickups", "POST", p)).json()).id);
  return ids;
}

/** Counters live in a Durable Object per client network, so "clearing" is just becoming a different pretend client. */
export function clearRateLimits() {
  newIp();
}

// ---- Yoco (fake) helpers for the payment tests. FAKE_YOCO and WHSEC must match the --var values wrangler dev was started with.
import crypto from "node:crypto";
export const FAKE_YOCO = process.env.FAKE_YOCO ?? "http://127.0.0.1:8798";
export const yocoCalls = async () => (await (await fetch(FAKE_YOCO + "/_calls")).json());
export const resetYoco = () => fetch(FAKE_YOCO + "/_reset", { method: "POST" });
export const checkoutIdOf = (redirectUrl) => redirectUrl.split("/pay/")[1];
/** POST a Yoco-style signed webhook to the Worker. `over` can break the signature, timestamp or secret on purpose. */
export function webhook(payload, { type = "payment.succeeded", id = "msg_" + crypto.randomUUID(), tsOffset = 0, secret = process.env.WHSEC, body, signWith } = {}) {
  const ts = Math.floor(Date.now() / 1000) + tsOffset;
  const raw = body ?? JSON.stringify({ id: "evt_" + id, type, createdDate: new Date().toISOString(), payload });
  const key = Buffer.from((signWith ?? secret).slice("whsec_".length), "base64");
  const sig = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return fetch(B + "/api/yoco/webhook", { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": "v1," + sig }, body: raw });
}
export const paidPayload = (checkoutId, over = {}) => ({ id: "p_" + crypto.randomBytes(4).toString("hex"), amount: 6500, currency: "ZAR", mode: "test", status: "succeeded", type: "payment", metadata: { checkoutId }, paymentMethodDetails: { type: "card", card: { maskedCard: "411111******1111", cardHolder: "TEST CARDHOLDER" } }, ...over });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits until `fn()` is true (polling), or fails the test. */
export async function until(fn, what, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await sleep(250); } throw new Error("timed out waiting for " + what); }
export const attemptId = () => crypto.randomUUID();
